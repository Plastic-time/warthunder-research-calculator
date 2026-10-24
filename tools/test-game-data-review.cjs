const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { premiumAcquisition, wikiUnits } = require('./audit-datamine-roster.cjs');
const { changes, verifyDelta } = require('./audit-reviewed-data-delta.cjs');
const fixture = require('./fixtures/game-data-review-2.59.0.86.json');
const corrections = require('../config/acquisition-corrections.json');
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

test('roster change is limited to J35A and acquisition counts, with identical web copies', () => {
  const report = read('docs/roster-audit.json');
  assert.deepEqual(report, read('public/roster-audit.json'));
  const unit = report.trees['sweden/aviation'].units.saab_j35a;
  assert.equal(unit.category, 'premium-golden-eagles');
  assert.deepEqual(unit.acquisition, corrections.saab_j35a);
  assert.deepEqual(report.acquisitionCounts, { 'golden-eagles': 368, pack: 96, special: 311 });
  delete report.trees['sweden/aviation'].units.saab_j35a;
  delete report.acquisitionCounts;
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex'), fixture.rosterUnchangedSha256);
});

test('partial review checkpoints do not promote the full snapshot or import hidden additions', () => {
  for (const scope of Object.values(read('config/data-review-checkpoints.json').scopes)) {
    assert.equal(scope.gameVersion, fixture.upstream.version);
    assert.equal(scope.gameDataCommit, fixture.upstream.commit);
    assert(fs.existsSync(path.join(root, scope.provenance)));
  }
  assert.equal(read('config/data-version.json').gameVersion, '2.59.0.17');
  const ids = new Set(Object.values(read('docs/roster-audit.json').trees).flatMap(tree => Object.keys(tree.units)));
  for (const entry of fixture.deferredRosterEntries) assert(!ids.has(entry.id));
  assert.equal(fixture.sources.length, 6);
  for (const source of fixture.sources) {
    assert.equal(source.commit, (source.label === 'baseline' ? fixture.baseline : fixture.upstream).commit);
    assert(source.url.includes('/' + source.commit + '/'));
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
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
