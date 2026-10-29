const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { premiumAcquisition, wikiUnits } = require('./audit-datamine-roster.cjs');
const { changes, verifyDelta } = require('./audit-reviewed-data-delta.cjs');
const fixture = require('./fixtures/game-data-review-2.59.0.86.json');
const latestReview = require('./fixtures/game-data-review-2.59.0.92.json');
const { verifyReview } = require('./audit-game-data-20261028.cjs');
const corrections = require('../config/acquisition-corrections.json');
const additions = require('../config/game-roster-additions.json');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));

test('J35A has verified regular GE pricing without changing its research costs or Wiki evidence', () => {
  const tree = read('docs/database/sweden/sweden_aviation.json');
  const unit = wikiUnits(tree).get('saab_j35a');
  const before = structuredClone(unit);
  assert.equal(unit.is_premium, true);
  assert.equal(unit.rp, 0);
  assert.equal(unit.sp, 0);
  const acquisition = premiumAcquisition(unit);
  assert.deepEqual(acquisition, corrections.saab_j35a);
  assert.equal(acquisition.price, '9,090');
  assert.equal(acquisition.currency, 'GE');
  assert.equal(acquisition.provenance.gameDataCommit, fixture.upstream.commit);
  assert.match(acquisition.provenance.url, /^https:\/\/warthunder\.com\/en\/news\//);
  assert.deepEqual(unit, before);
  assert.equal(premiumAcquisition({ ...unit, is_premium: false }), null);
  acquisition.price = '4,545';
  assert.equal(premiumAcquisition(unit).price, '9,090', 'Callers cannot mutate the correction');
  assert.deepEqual(tree, read('database/sweden/sweden_aviation.json'));
});

test('historical J35A review remains unchanged outside the later explicit game additions', () => {
  const report = read('docs/roster-audit.json');
  assert.deepEqual(report, read('public/roster-audit.json'));
  const unit = report.trees['sweden/aviation'].units.saab_j35a;
  assert.equal(unit.category, 'premium-golden-eagles');
  assert.deepEqual(unit.acquisition, corrections.saab_j35a);
  assert.deepEqual(report.acquisitionCounts, { 'golden-eagles': 368, pack: 96, special: 313 });
  for (const c of additions.units) {
    const tree = report.trees[c.country + '/' + c.type];
    delete tree.units[c.id];
    delete tree.snapshotSha256;
    delete tree.gameOnlyCount;
    tree.matched--;
  }
  delete report.trees['sweden/aviation'].units.saab_j35a;
  delete report.acquisitionCounts;
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex'), fixture.rosterUnchangedSha256);
});

test('partial review checkpoints do not promote the full snapshot or import hidden additions', () => {
  for (const [name, scope] of Object.entries(read('config/data-review-checkpoints.json').scopes)) {
    const expected = name === 'vehicle-costs' ? read('config/vehicle-cost-update.json')
      : name === 'modifications' ? require('./fixtures/modification-update-20261029.json') : latestReview.upstream;
    assert.equal(scope.gameVersion, expected.version);
    assert.equal(scope.gameDataCommit, expected.commit);
    assert(fs.existsSync(path.join(root, scope.provenance)));
  }
  assert.equal(read('config/data-version.json').gameVersion, '2.59.0.17');
  const ids = new Set(Object.values(read('docs/roster-audit.json').trees).flatMap(tree => Object.keys(tree.units)));
  for (const entry of fixture.deferredRosterEntries) assert.equal(ids.has(entry.id), additions.units.some(c => c.id === entry.id));
  assert.equal(fixture.sources.length, 6);
  for (const source of fixture.sources) {
    assert.equal(source.commit, (source.label === 'baseline' ? fixture.baseline : fixture.upstream).commit);
    assert(source.url.includes('/' + source.commit + '/'));
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
});

test('October 28 review leaves the supported roster, costs and modification snapshots intact', () => {
  for (const [file, expected] of Object.entries(latestReview.unchangedSnapshots)) {
    let bytes = fs.readFileSync(path.join(root, file));
    if (file.endsWith('/modifications/catalog.json')) {
      bytes = Buffer.from(JSON.stringify(require('./apply-modification-update.cjs').restoreCatalog(JSON.parse(bytes))) + '\n');
    }
    if (file === 'docs/database/manifest.json') {
      const manifest = JSON.parse(bytes), br = read('config/battle-rating-update.json');
      const costs = read('config/vehicle-cost-update.json');
      assert.equal(manifest.vehicleCosts.commit, costs.commit);
      delete manifest.vehicleCosts;
      for (const entry of manifest.files) entry.sha256 = costs.trees[entry.path];
      assert.equal(manifest.battleRatings.commit, br.commit);
      delete manifest.battleRatings;
      for (const entry of manifest.files) if (br.trees[entry.path]) entry.sha256 = br.trees[entry.path];
      bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    }
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected);
  }
  const ids = new Set(Object.values(read('docs/roster-audit.json').trees).flatMap(tree => Object.keys(tree.units)));
  const mods = read('docs/database/modifications/catalog.json').vehicles;
  for (const id of Object.keys(latestReview.changedUnits)) {
    assert(!ids.has(id));
    assert(!Object.hasOwn(mods, id));
  }
  assert.equal(latestReview.wpcostChanges, 163);
  assert.equal(latestReview.sources.length, 6);
  for (const source of latestReview.sources) {
    assert.equal(source.commit, latestReview[source.label === 'current' ? 'upstream' : 'baseline'].commit);
    assert.equal(source.url, `https://raw.githubusercontent.com/gszabi99/War-Thunder-Datamine/${source.commit}/${source.file}`);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
  assert(latestReview.rankChanges.every(row => row.path.includes('InEraHuman')));
});

test('incremental review fails closed on unreviewed fields or newly supported entries', () => {
  const data = { 'baseline-wpcost': { internal: { value: 1 } }, 'current-wpcost': { internal: { value: 2 } },
    'baseline-shop': {}, 'current-shop': {}, 'baseline-rank': {}, 'current-rank': {} };
  const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const evidence = { upstream: latestReview.upstream, wpcostChanges: 1,
    wpcostDeltaSha256: digest(changes(data['baseline-wpcost'], data['current-wpcost'])),
    shopDeltaSha256: digest([]), rankChanges: [] };
  const verify = (candidate, roster = new Set(), mods = new Set()) => verifyReview(candidate, roster, mods, evidence);
  assert.equal(verify(data).supportedChanges, 0);
  assert.throws(() => verify(data, new Set(['internal'])), /supported snapshot/);
  assert.throws(() => verify(data, new Set(), new Set(['internal'])), /supported snapshot/);
  for (const mutate of [
    d => { d['current-wpcost'].internal.value = 3; },
    d => { d['current-wpcost'].internal.reqAir = 'unexpected'; },
    d => { d['current-shop'].unexpected = { rank: 1 }; },
    d => { d['current-rank'].needBuyToOpenNextInEraAircraft5 = 7; }
  ]) {
    const candidate = structuredClone(data); mutate(candidate);
    assert.throws(() => verify(candidate), /Unreviewed/);
  }
});

function syntheticSources() {
  const data = { 'baseline-wpcost': {}, 'current-wpcost': {}, 'baseline-rank': {}, 'current-rank': {},
    'baseline-shop': {}, 'current-shop': {} };
  data['baseline-wpcost'].saab_j35a = { value: 0 };
  data['current-wpcost'].saab_j35a = { value: 0 };
  for (const row of fixture.costChanges) for (const [label, field] of [['baseline', 'before'], ['current', 'after']]) {
    if (row[field] === null) continue;
    const parts = row.path.slice(1).split('/');
    let node = data[label + '-wpcost'];
    for (const key of parts.slice(0, -1)) node = node[key] ||= {};
    node[parts.at(-1)] = structuredClone(row[field]);
  }
  for (const entry of fixture.deferredRosterEntries) {
    const { id, ...fields } = entry;
    data['current-wpcost'][id] = fields;
    data['current-shop'][id] = { ...fields, rank: 1 };
  }
  return data;
}

test('the F-111A internal launcher rename does not create a research node or change its budget', () => {
  const catalog = read('docs/database/modifications/catalog.json');
  const chunk = catalog.chunks[catalog.vehicles.f_111a];
  const bytes = fs.readFileSync(path.join(root, 'docs', chunk.path));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), chunk.sha256);
  const mods = JSON.parse(bytes).v.f_111a.m;
  const pack = mods.find(row => row[0] === 'countermeasures_belt_pack');
  assert.deepEqual(pack.slice(7, 9), [6500, 10000]);
  assert.equal(pack[2], 1);
  assert.deepEqual(pack[10], []);
  assert(!mods.some(row => /^countermeasures_launcher_chaff/.test(row[0])));
  const old = fixture.costChanges.find(row => row.path.endsWith('/countermeasures_launcher_chaff')).before;
  const current = fixture.costChanges.find(row => row.path.endsWith('/countermeasures_launcher_chaff_large')).after;
  assert.deepEqual(old, current);
  assert.equal(current.tier, 0);
});

test('delta audit rejects unreviewed costs, ranks, shop changes and altered hidden status', () => {
  assert.deepEqual(changes({ a: 1 }, { a: 2 }), [{ path: '/a', before: 1, after: 2 }]);
  assert.equal(verifyDelta(syntheticSources()).applied, false);
  for (const mutate of [
    data => { data['current-wpcost'].saab_j35a.value = 100; },
    data => { data['current-rank'].count = 4; },
    data => { data['current-shop'].unexpected = { rank: 1 }; },
    data => { data['current-wpcost'][fixture.deferredRosterEntries[0].id].showOnlyWhenBought = false; },
  ]) {
    const data = syntheticSources(); mutate(data);
    assert.throws(() => verifyDelta(data));
  }
});
