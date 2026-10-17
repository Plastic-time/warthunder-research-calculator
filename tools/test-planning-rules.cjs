const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const { test } = require('node:test');
const { loadSources, projectTree } = require('./audit-planning-rules.cjs');
const fixture = require('./fixtures/planning-rules-2.59.0.73.json');
const { get_unlock_quantity } = require('../dict/unlock_quantity');
const { syncRankUnlocks, ruleRevision } = require('./sync-rank-unlocks.cjs');
const cheerio = require('cheerio');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function projectionInput() {
  return { country: 'usa', type: 'ground',
    tree: [{ rank: 'II', researchable_vehicles: [[
      { type: 'single', data_unit_id: 'a', required_unit_id: '' },
      { type: 'single', data_unit_id: 'b', required_unit_id: 'a' },
    ]], premium_vehicles: [] }],
    rankConfig: { needBuyToOpenNextInEra: { country_usa: { needBuyToOpenNextInEraTank2: 6 } } },
    beforeCosts: { a: {}, b: {} }, currentCosts: { a: {}, b: { reqAir: 'a' } },
    currentShop: { country_usa: { army: { range: [{ a: { rank: 2 }, b: { rank: 2 } }] } } } };
}

test('pinned source identity and checksums are mandatory', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-planning-proof-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const metadata = { baseline: fixture.baseline, upstream: { version: fixture.gameVersion, commit: fixture.datamineCommit }, sources: [] };
  for (const source of fixture.sources) {
    const name = path.basename(source.file, '.blkx');
    fs.writeFileSync(path.join(directory, `${source.label}-${name}.json`), '{}');
    metadata.sources.push({ ...source, bytes: 2, sha256: hash('{}') });
  }
  const save = () => fs.writeFileSync(path.join(directory, 'sources.json'), JSON.stringify(metadata));
  save();
  assert.equal(loadSources(directory).provenance.length, 4);
  fs.writeFileSync(path.join(directory, 'current-rank.json'), '[]');
  assert.throws(() => loadSources(directory), /checksum/);
  fs.writeFileSync(path.join(directory, 'current-rank.json'), '{}');
  metadata.upstream.commit = 'master';
  save();
  assert.throws(() => loadSources(directory));
});

test('missing source fields remain unverified, not zero', () => {
  const input = projectionInput();
  delete input.rankConfig.needBuyToOpenNextInEra.country_usa.needBuyToOpenNextInEraTank2;
  const result = projectTree(input);
  assert.equal(result.rankRules.length, 0);
  assert.equal(result.missingRankFields.length, 1);
  assert.equal(result.prerequisites[0].required, 'a');
});

test('ambiguous, unavailable or conflicting prerequisites fail closed', () => {
  const input = projectionInput();
  input.currentCosts.b.reqAir = 'unavailable';
  assert.throws(() => projectTree(input), /missing from this tree/);
  input.currentCosts.b.reqAir = '';
  assert.throws(() => projectTree(input), /removal requires review/);
  input.currentCosts.b.reqAir = 'a';
  input.currentShop.country_usa.army.range[0].b.reqAir = 'different';
  assert.throws(() => projectTree(input), /Conflicting shop prerequisite/);
  delete input.currentCosts.b;
  assert.throws(() => projectTree(input), /Missing game unit/);
});

test('both copies match all 241 explicit source rank requirements', () => {
  assert.equal(fs.readFileSync(path.join(root, 'docs/unlock-quantity.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'dict/unlock_quantity.js'), 'utf8'));
  let count = 0;
  for (const [country, types] of Object.entries(fixture.rankRules)) {
    for (const [type, ranks] of Object.entries(types)) for (const [rank, expected] of Object.entries(ranks)) {
      assert.equal(get_unlock_quantity(country, type, rank), expected, `${country}/${type}/${rank}`);
      count++;
    }
  }
  assert.equal(count, 241);
  assert.equal(fixture.missingRankFields.length, 37);
  assert.equal(fixture.fullSnapshotUpgrade, false);
});

test('the published rule URL changes with its contents, not just the installer version', () => {
  const $ = cheerio.load(fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'));
  const script = $('script[src^="unlock-quantity.js?"]');
  assert.equal(script.length, 1);
  const url = new URL(script.attr('src'), 'https://local.invalid/');
  const source = fs.readFileSync(path.join(root, 'docs/unlock-quantity.js'), 'utf8');
  assert.equal(url.searchParams.get('r'), ruleRevision(source), 'Run node tools/sync-rank-unlocks.cjs');
});

test('syncing rules refreshes only their URL and is stable across line endings', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-rule-cache-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'dict'));
  fs.mkdirSync(path.join(directory, 'docs'));
  const html = '<!-- keep layout -->\n<script src="unlock-quantity.js?v=1.0.26"></script>\n<script src="app.js?v=unchanged"></script>\n';
  const htmlPath = path.join(directory, 'docs/index.html');
  const sourcePath = path.join(directory, 'dict/unlock_quantity.js');
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(sourcePath, 'const required = 5;\n');
  syncRankUnlocks(directory);
  const first = fs.readFileSync(htmlPath, 'utf8');
  assert.equal(first, html.replace('?v=1.0.26', '?v=1.0.26&amp;r=' + ruleRevision('const required = 5;\n')));
  syncRankUnlocks(directory);
  assert.equal(fs.readFileSync(htmlPath, 'utf8'), first);
  fs.writeFileSync(sourcePath, 'const required = 6;\r\n');
  syncRankUnlocks(directory);
  assert.equal(fs.readFileSync(htmlPath, 'utf8'), html.replace('?v=1.0.26', '?v=1.0.26&amp;r=' + ruleRevision('const required = 6;\n')));
  assert.equal(fs.readFileSync(path.join(directory, 'docs/unlock-quantity.js'), 'utf8'), 'const required = 6;\r\n');
});

function appContext(folder) {
  const context = vm.createContext({
    document: { documentElement: {}, getElementById: () => ({}), addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => [] },
    window: { matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: () => null, setItem() {} },
    CustomEvent: class {}, console,
  });
  for (const file of ['i18n.js', 'app-translations.js', 'static-translations.js', 'module-translations.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, folder, file), 'utf8'), context);
  }
  if (folder === 'docs') vm.runInContext(fs.readFileSync(path.join(root, folder, 'unlock-quantity.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, folder, 'app.js'), 'utf8').replace(/\binit\(\);\s*$/, '') +
    '\nglobalThis.calc = { state, flattenTree, getDependencyIds, getRankUnlockQuantity };', context);
  return context.calc;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try { assert.equal(response.statusCode, 200); resolve(JSON.parse(Buffer.concat(chunks))); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Local API timeout')));
    req.on('error', reject);
  });
}

test('50 backend trees and static trees use the reviewed gates and 15 prerequisites', async t => {
  const app = require('../main');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const backend = appContext('public'), web = appContext('docs');
  const manifest = read('docs/database/manifest.json');
  let prerequisites = 0;
  for (const file of manifest.files) {
    const country = file.path.split('/')[1], type = path.basename(file.path, '.json').slice(country.length + 1);
    const staticTree = read('docs/' + file.path);
    const response = await getJson(`http://127.0.0.1:${server.address().port}/api/tree/${country}/${type}`);
    assert.equal(response.success, true);
    backend.state.country = web.state.country = country;
    backend.state.type = web.state.type = type;
    backend.flattenTree(response.data);
    web.flattenTree(staticTree);
    for (const [rank, required] of Object.entries(fixture.rankRules[country]?.[type] || {})) {
      assert.equal(backend.getRankUnlockQuantity(response.data.find(row => row.rank === rank)), required);
      assert.equal(web.getRankUnlockQuantity(staticTree.find(row => row.rank === rank)), required);
    }
    for (const rule of fixture.prerequisites.filter(rule => rule.country === country && rule.type === type)) {
      for (const calc of [backend, web]) {
        assert.equal(calc.state.unitMap.get(rule.id).required_unit_id, rule.required, rule.id);
        // Rank-I dependency traversal is an existing policy, outside this data-only update.
        if (rule.id === 'fr_mtb96_vosper') {
          assert.equal(calc.state.unitMap.get(rule.id).rank, 'II');
          assert.equal(calc.state.unitMap.get(rule.required).rank, 'I');
          assert.deepEqual([...calc.getDependencyIds(rule.id)], [rule.id]);
        } else assert(calc.getDependencyIds(rule.id).includes(rule.required), 'Missing actual prerequisite: ' + rule.id);
        if (rule.groupId) assert.equal(calc.state.groupMap.get(rule.groupId).required_unit_id, rule.required);
      }
      prerequisites++;
    }
  }
  assert.equal(manifest.files.length, 50);
  assert.equal(prerequisites, 15);
});

test('automatic planning fills the sixth Israeli rank-IV aircraft', () => {
  const planner = require('../public/planner');
  const units = Array.from({ length: 7 }, (_, i) => ({ data_unit_id: `rank4_${i}`, rank: 'IV',
    section: 'researchable', rp: 100 + i, sp: 200 + i, required_unit_id: '' }));
  units.push({ data_unit_id: 'target', rank: 'V', section: 'researchable', rp: 500, sp: 1000, required_unit_id: '' });
  const result = planner.plan({ units, groups: [],
    ranks: [{ rank: 'IV', unlockQuantity: get_unlock_quantity('israel', 'aviation', 'IV') }, { rank: 'V', unlockQuantity: 0 }],
    initialIds: [], ownedIds: units.slice(0, 5).map(unit => unit.data_unit_id), targetIds: ['target'],
    waypointIds: [], timeLimitMs: 1000, maxStates: 10000 });
  assert(result.feasible);
  assert.equal(result.rankCounts.find(rank => rank.rank === 4).required, 6);
  assert.equal(result.fillerIds.length, 1);
  assert.equal(result.totalRp, 605);
});

test('the four user-confirmed modification corrections remain byte-equivalent', () => {
  for (const folder of ['docs', 'public']) {
    const catalog = read(folder + '/database/modifications/catalog.json');
    for (const [id, expected] of Object.entries(fixture.protectedVehicles)) {
      const vehicle = read(folder + '/' + catalog.chunks[catalog.vehicles[id]].path).v[id];
      assert.equal(hash(JSON.stringify(vehicle)), expected, id);
    }
  }
});
