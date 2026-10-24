const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeUnit, battleRating, verifySources } = require('./apply-game-roster-additions.cjs');
const { wikiUnits, premiumAcquisition } = require('./audit-datamine-roster.cjs');
const additions = require('../config/game-roster-additions.json');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));

test('game-only additions use pinned evidence and explicit reward availability, not Wiki placeholders', () => {
  assert.equal(additions.commit, 'aa326f10c6ba7d523647572368ead2e4d51ffb4d');
  assert.deepEqual(additions.units.map(c => c.id), ['bf-109e-3_tl', 'germ_panzerjager_panther_g2', 'germ_s_700_s_706']);
  for (const s of additions.sources) {
    assert.equal(s.commit, additions.commit);
    assert(s.url.includes('/' + additions.commit + '/'));
    assert.match(s.sha256, /^[a-f0-9]{64}$/);
  }
  for (const c of additions.units) {
    const expected = makeUnit(c);
    const file = 'database/' + c.country + '/' + c.country + '_' + c.type + '.json';
    const tree = read('docs/' + file);
    assert.deepEqual(tree, read(file));
    assert.deepEqual(wikiUnits(tree).get(c.id), expected);
    assert(!Object.hasOwn(expected, 'wiki'), 'Do not fabricate Wiki provenance');
    assert.equal(expected.game_source.cost_policy, 'reward-excluded-from-ordinary-research');
    assert.equal(expected.rp, 0); assert.equal(expected.sp, 0);
    assert.equal(expected.required_unit_id, '');
    assert.deepEqual(premiumAcquisition(expected), c.premium
      ? read('docs/roster-audit.json').trees[c.country + '/' + c.type].units[c.id].acquisition : null);
    assert(tree.find(r => r.rank === expected.rank).premium_vehicles.some(col => col.some(u => u.data_unit_id === c.id)));
    assert(!tree.some(r => wikiUnits(r.researchable_vehicles).has(c.id)));
    assert.deepEqual(read('docs/vehicle-names.json').names[c.id], c.names);
    assert.equal(read('docs/vehicle-names.json').keys[c.id], c.nameKey);
    assert.deepEqual(Object.keys(c.names).sort(), ['de','en','es','fr','ja','ru','zh']);
    assert.equal(c.modificationStatus, 'verified-game-data');
    assert.equal(read('docs/database/modifications/catalog.json').vehicles[c.id], 'germany_' + c.type);
    const raw = fs.readFileSync(path.join(root, 'docs', file));
    const manifestEntry = read('docs/database/manifest.json').files.find(e => e.path === file);
    assert.equal(manifestEntry.sha256, crypto.createHash('sha256').update(raw).digest('hex'));
    const previous = structuredClone(tree);
    for (const rank of previous) rank.premium_vehicles = rank.premium_vehicles.filter(column => !column.some(u => u.data_unit_id === c.id));
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(previous, null, 2) + '\n').digest('hex'),
      read('docs/roster-audit.json').trees[c.country + '/' + c.type].wikiSha256, 'All previous vehicle fields and placement must remain unchanged');
  }
  assert.equal(read('config/data-version.json').vehicleCount, 3238);
  assert.equal(read('config/data-version.json').gameVersion, '2.59.0.17');
});

test('BR uses explicit mode-specific game ranks and rejects missing fields', () => {
  assert.deepEqual([0,1,2,3,4,5,16].map(battleRating), ['1.0','1.3','1.7','2.0','2.3','2.7','6.3']);
  assert.deepEqual(additions.units.map(c => makeUnit(c).br), ['2.3','6.3','2.7']);
  for (const rank of [null, undefined, NaN, -1, '4']) assert.throws(() => battleRating(rank));
  const missing = structuredClone(additions.units[0]);
  delete missing.gameFields.economicRankHistorical;
  assert.throws(() => makeUnit(missing), /economic rank/);
});

test('future events, wrong unit identity and untrusted official URLs fail closed', () => {
  assert.throws(() => verifySources(), /Provide/);
  for (const mutate of [
    c => { c.acquisition.availableFrom = '2099-01-01T00:00:00Z'; },
    c => { c.shop.id = 'donor_unit'; },
    c => { c.acquisition.url = 'javascript:alert(1)'; },
    c => { c.acquisition.url = 'https://warthunder.com.evil.invalid/'; },
    c => { c.gameFields.country = 'country_usa'; },
    c => { c.type = 'ground'; },
    c => { c.premium = true; },
    c => { c.image.url = 'https://static.encyclopedia.warthunder.com/slots/donor.png'; },
  ]) { const c = structuredClone(additions.units[0]); mutate(c); assert.throws(() => makeUnit(c)); }
  const pending = additions.deferred[0];
  assert.equal(pending.id, 'ussr_bt_7_m_816');
  assert(Date.parse(pending.availableFrom) > Date.parse(additions.reviewedAt));
  assert(!wikiUnits(read('docs/database/ussr/ussr_ground.json')).has(pending.id));
});
