const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { battleRating } = require('./apply-game-roster-additions.cjs');
const root = path.resolve(__dirname, '..');
const modes = { AB: 'Arcade', RB: 'Historical', SB: 'Simulation' };
const prefixes = { air: '', tank: 'Tank', ship: 'Ship' };
const rankField = /^economicRank(?:Tank|Ship)?(?:Arcade|Historical|Simulation)$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));

function ratings(ranks, type) {
  const context = { aviation: 'air', helicopters: 'tank', ground: 'tank', ships: 'ship', boats: 'ship' }[type];
  assert(context, 'Unknown tree type');
  const by_battle = {};
  for (const [battle, prefix] of Object.entries(prefixes)) {
    if (type !== 'aviation' && battle !== context) continue;
    by_battle[battle] = {};
    for (const [mode, suffix] of Object.entries(modes)) {
      const specific = 'economicRank' + prefix + suffix;
      const field = Object.hasOwn(ranks, specific) ? specific : 'economicRank' + suffix;
      assert(Number.isInteger(ranks[field]) && ranks[field] >= 0, 'Missing or invalid BR field: ' + field);
      by_battle[battle][mode] = battleRating(ranks[field]);
    }
  }
  return { context, by_battle };
}

function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  for (const value of Object.values(node)) if (value && typeof value === 'object') visit(value, callback);
  if (node.type === 'single' || node.type === 'multiple') callback(node);
}

function patchTree(tree, type, evidence) {
  const result = structuredClone(tree);
  visit(result, node => {
    const id = node.data_unit_id?.toLowerCase();
    const entry = evidence.units[id];
    if (node.type === 'single' && entry) {
      assert.equal(node.br, entry.previousBr, 'Unexpected pre-update BR: ' + id);
      assert(!node.game_battle_ratings, 'BR source already exists: ' + id);
      node.game_battle_ratings = ratings(entry.ranks, type);
      node.br = node.game_battle_ratings.by_battle[node.game_battle_ratings.context].RB;
    } else if (node.type === 'multiple' && node.items.some(item => evidence.units[item.data_unit_id?.toLowerCase()])) {
      const values = node.items.map(item => /^\d+\.\d$/.test(item.br) ? Number(item.br) : NaN);
      assert(values.every(Number.isFinite), 'Cannot invent a folder BR from missing values');
      const low = Math.min(...values).toFixed(1), high = Math.max(...values).toFixed(1);
      node.br = low === high ? low : low + '-' + high;
    }
  });
  return result;
}

// Reconstruct the previous snapshot for historical integrity assertions; only BR fields are reversed.
function restoreTree(tree, evidence = read('config/battle-rating-update.json')) {
  const result = structuredClone(tree);
  visit(result, node => {
    const id = node.data_unit_id?.toLowerCase();
    if (node.type === 'single' && evidence.units[id] && node.game_battle_ratings) {
      node.br = evidence.units[id].previousBr;
      delete node.game_battle_ratings;
    } else if (node.type === 'multiple' && Object.hasOwn(evidence.groups, id)) node.br = evidence.groups[id];
  });
  return result;
}

function verifySources(directory, evidence) {
  assert(directory, 'Provide --source-dir with pinned sources');
  const sources = {};
  for (const source of evidence.sources) {
    const bytes = fs.readFileSync(path.join(directory, source.localFile));
    assert.equal(bytes.length, source.bytes, 'Source length mismatch');
    assert.equal(digest(bytes), source.sha256, 'Source hash mismatch');
    assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), source.gitBlob, 'Git blob mismatch');
    if (source.role === 'current' || source.role === 'previous') sources[source.role] = JSON.parse(bytes);
  }
  const index = data => new Map(Object.entries(data).map(([id, unit]) => [id.toLowerCase(), unit]));
  const old = index(sources.previous), current = index(sources.current);
  const extract = value => Object.fromEntries(Object.entries(value).filter(([key]) => rankField.test(key)));
  const { wikiUnits } = require('./audit-datamine-roster.cjs');
  for (const file of read('docs/database/manifest.json').files) {
    for (const id of wikiUnits(read('docs/' + file.path)).keys()) {
      assert(current.has(id) && old.has(id), 'Missing source vehicle: ' + id);
      const changed = !require('node:util').isDeepStrictEqual(extract(old.get(id)), extract(current.get(id)));
      assert.equal(Object.hasOwn(evidence.units, id), changed, 'Incomplete BR delta coverage: ' + id);
    }
  }
  for (const [id, entry] of Object.entries(evidence.units)) {
    assert(current.has(id) && old.has(id), 'Missing source vehicle: ' + id);
    assert.deepEqual(extract(current.get(id)), entry.ranks, 'Unverified BR source: ' + id);
    assert.notDeepEqual(extract(old.get(id)), entry.ranks, 'Vehicle has no BR delta: ' + id);
  }
  return { verified: true, units: Object.keys(evidence.units).length };
}

function apply(directory, write = false) {
  const evidence = read('config/battle-rating-update.json');
  verifySources(directory, evidence);
  const manifest = read('docs/database/manifest.json'), writes = new Map();
  assert(!manifest.battleRatings, 'BR update already applied');
  for (const file of manifest.files) {
    const source = fs.readFileSync(path.join(root, file.path));
    assert(source.equals(fs.readFileSync(path.join(root, 'docs', file.path))), 'Runtime mirrors differ');
    assert.equal(digest(source), file.sha256, 'Manifest does not match snapshot');
    const old = JSON.parse(source), type = path.basename(file.path, '.json').split('_').slice(1).join('_');
    const updated = patchTree(old, type, evidence);
    if (JSON.stringify(old) === JSON.stringify(updated)) continue;
    assert.equal(file.sha256, evidence.trees[file.path], 'Unexpected baseline snapshot');
    const bytes = JSON.stringify(updated, null, 2) + '\n';
    assert.equal(digest(JSON.stringify(restoreTree(updated, evidence), null, 2) + '\n'), file.sha256, 'Non-BR data changed');
    file.sha256 = digest(bytes);
    writes.set(file.path, bytes); writes.set('docs/' + file.path, bytes);
  }
  manifest.battleRatings = { version: evidence.version, commit: evidence.commit, scope: 'changed-mode-specific-battle-ratings',
    provenance: 'config/battle-rating-update.json', fullSnapshotUpgrade: false };
  writes.set('docs/database/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  if (write) for (const [file, bytes] of writes) fs.writeFileSync(path.join(root, file), bytes);
  return { applied: write, files: writes.size, units: Object.keys(evidence.units).length };
}

if (require.main === module) {
  try {
    const at = process.argv.indexOf('--source-dir');
    assert(at >= 0 && process.argv[at + 1], 'Provide --source-dir');
    console.log(JSON.stringify(apply(process.argv[at + 1], process.argv.includes('--apply'))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { ratings, patchTree, restoreTree, verifySources, rankField };
