const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { get_unlock_quantity } = require('../dict/unlock_quantity');

const root = path.resolve(__dirname, '..');
const repository = 'gszabi99/War-Thunder-Datamine';
const ranks = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const types = { ground: 'Tank', aviation: 'Aircraft', helicopters: 'Helicopter', ships: 'Ship', boats: 'Boat' };
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function loadSources(directory) {
  const metadata = read(path.join(directory, 'sources.json'));
  const result = { metadata, files: {}, provenance: [] };
  for (const [label, name] of [['baseline', 'wpcost'], ['current', 'wpcost'], ['current', 'rank'], ['current', 'shop']]) {
    const revision = label === 'current' ? metadata.upstream : metadata.baseline;
    assert.match(revision.commit, /^[a-f0-9]{40}$/);
    assert.match(revision.version, /^\d+\.\d+\.\d+\.\d+$/);
    const sourcePath = `char.vromfs.bin_u/config/${name}.blkx`;
    const sources = metadata.sources.filter(s => s.label === label && s.file === sourcePath);
    assert.equal(sources.length, 1, 'Missing or ambiguous source: ' + label + ':' + name);
    const source = sources[0];
    assert.equal(source.commit, revision.commit);
    assert.equal(source.url, `https://raw.githubusercontent.com/${repository}/${revision.commit}/${sourcePath}`);
    const bytes = fs.readFileSync(path.join(directory, `${label}-${name}.json`));
    assert.equal(bytes.length, source.bytes, 'Source size mismatch');
    assert.equal(sha256(bytes), source.sha256, 'Source checksum mismatch');
    result.files[`${label}-${name}`] = JSON.parse(bytes);
    result.provenance.push(source);
  }
  return result;
}

function indexUnits(tree) {
  const units = new Map();
  for (const rank of tree) for (const section of ['researchable_vehicles', 'premium_vehicles']) {
    for (const column of rank[section] || []) for (const item of column) {
      for (const unit of item.type === 'multiple' ? item.items : [item]) {
        assert(!units.has(unit.data_unit_id.toLowerCase()), 'Duplicate unit');
        units.set(unit.data_unit_id.toLowerCase(), { unit, group: item.type === 'multiple' ? item : null });
      }
    }
  }
  return units;
}

function projectTree({ tree, country, type, rankConfig, beforeCosts, currentCosts, currentShop }) {
  assert(Object.hasOwn(types, type), 'Unsupported tree type');
  const units = indexUnits(tree), rankRules = [], missingRankFields = [], prerequisites = [];
  const before = new Map(Object.entries(beforeCosts).map(([id, data]) => [id.toLowerCase(), data]));
  const current = new Map(Object.entries(currentCosts).map(([id, data]) => [id.toLowerCase(), data]));
  const shop = currentShop[`country_${country}`]?.[type === 'ground' ? 'army' : type];
  for (const rank of tree) {
    const number = ranks.indexOf(rank.rank) + 1;
    assert(number > 0, 'Unknown rank');
    const field = `needBuyToOpenNextInEra${types[type]}${number}`;
    const value = rankConfig.needBuyToOpenNextInEra?.[`country_${country}`]?.[field];
    if (value === undefined) { missingRankFields.push({ country, type, rank: rank.rank, field }); continue; }
    assert(Number.isInteger(value) && value >= 0, 'Invalid rank requirement');
    rankRules.push({ country, type, rank: rank.rank, field, required: value });
  }
  for (const [id, { unit, group }] of units) {
    const old = before.get(id), next = current.get(id);
    assert(next, 'Missing game unit: ' + id);
    if (!old || old.reqAir === next.reqAir) continue;
    // Clearing a prerequisite can mean column inheritance; it is not an automatic removal.
    assert(typeof next.reqAir === 'string' && next.reqAir, 'Prerequisite removal requires review: ' + id);
    assert(units.has(next.reqAir.toLowerCase()), 'Prerequisite missing from this tree: ' + id);
    let shopNode;
    function find(node) {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key.toLowerCase() === id) shopNode = value;
        if (value && typeof value === 'object') find(value);
      }
    }
    find(shop);
    assert(shopNode, 'Changed unit missing from shop: ' + id);
    if (shopNode.reqAir !== undefined) assert.equal(shopNode.reqAir, next.reqAir, 'Conflicting shop prerequisite');
    prerequisites.push({ country, type, id: unit.data_unit_id, previous: old.reqAir ?? null,
      required: next.reqAir, groupId: group?.items[0]?.data_unit_id === unit.data_unit_id ? group.data_unit_id : null });
  }
  return { rankRules, missingRankFields, prerequisites };
}

function audit(directory) {
  const source = loadSources(directory);
  const manifest = read(path.join(root, 'docs/database/manifest.json'));
  const dependencies = read(path.join(root, 'dict/shop_dependencies.json'));
  const report = { schema: 1, gameVersion: source.metadata.upstream.version,
    datamineCommit: source.metadata.upstream.commit, baseline: source.metadata.baseline,
    sources: source.provenance, fullSnapshotUpgrade: false, applied: false,
    treeCount: 0, rankRules: [], missingRankFields: [], prerequisites: [], differences: [] };
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, 'docs', entry.path));
    assert.equal(sha256(bytes), entry.sha256, 'Snapshot checksum mismatch');
    assert(bytes.equals(fs.readFileSync(path.join(root, entry.path))), 'Desktop and web snapshots differ');
    const country = entry.path.split('/')[1];
    const type = path.basename(entry.path, '.json').slice(country.length + 1);
    const projection = projectTree({ tree: JSON.parse(bytes), country, type,
      rankConfig: source.files['current-rank'], beforeCosts: source.files['baseline-wpcost'],
      currentCosts: source.files['current-wpcost'], currentShop: source.files['current-shop'] });
    report.treeCount++;
    for (const key of ['rankRules', 'missingRankFields', 'prerequisites']) report[key].push(...projection[key]);
    for (const rule of projection.rankRules) {
      const local = get_unlock_quantity(country, type, rule.rank);
      if (local !== rule.required) report.differences.push({ kind: 'rank', ...rule, local });
    }
    for (const rule of projection.prerequisites) for (const id of [rule.id, rule.groupId].filter(Boolean)) {
      const local = dependencies[country]?.[type]?.units[id];
      if (local !== rule.required) report.differences.push({ kind: 'dependency', country, type, id,
        required: rule.required, local: local ?? null });
    }
  }
  return report;
}

if (require.main === module) {
  try {
    const directory = process.argv[2];
    assert(directory, 'Usage: node tools/audit-planning-rules.cjs <pinned-source-directory>');
    const report = audit(path.resolve(directory));
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'logs/planning-rule-audit.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ gameVersion: report.gameVersion, trees: report.treeCount,
      rankRules: report.rankRules.length, missingRankFields: report.missingRankFields.length,
      changedUpstreamPrerequisites: report.prerequisites.length, differences: report.differences, applied: false }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { loadSources, projectTree, audit };
