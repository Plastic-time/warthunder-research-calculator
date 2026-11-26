const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { wikiUnits } = require('./audit-datamine-roster.cjs');
const manifest = require('../docs/database/manifest.json');
const catalog = require('../docs/database/modifications/catalog.json');
const roster = require('../docs/roster-audit.json');
const names = require('../docs/vehicle-names.json');
const snapshot = (country, type) => require('../docs/database/' + country + '/' + country + '_' + type + '.json');

test('all reviewed roster entries appear once with a localized name and a complete modification tree', () => {
  const review = manifest.rosterUpdate;
  assert.equal(review?.commit, '4268c8d0acfeeb8ba175176fabce053ceb74702f');
  assert.equal(new Set(review.ids).size, 31);
  const seen = [];
  for (const [tree, audit] of Object.entries(roster.trees)) {
    const [country, type] = tree.split('/');
    for (const [id, unit] of wikiUnits(snapshot(country, type))) {
      if (!review.ids.includes(id)) continue;
      seen.push(id);
      const meta = catalog.chunks[catalog.vehicles[id]];
      const vehicle = require('../docs/' + meta.path).v[id];
      assert.equal(catalog.vehicles[id], country + '_' + type);
      assert.equal(vehicle.gameSource.commit, review.commit);
      assert.deepEqual(vehicle.t, vehicle.m.reduce(([rp, sl], row) => [rp + row[7], sl + row[8]], [0, 0]));
      assert.equal(new Set(vehicle.m.map(row => row.slice(1, 4).join('/'))).size, vehicle.m.length);
      assert.equal(unit.game_source.commit, review.commit);
      assert.equal(audit.units[id].matched, true);
      assert.deepEqual(Object.keys(names.names[id]).sort(), ['de','en','es','fr','ja','ru','zh']);
    }
  }
  assert.deepEqual(seen.sort(), [...review.ids].sort());
});

test('the PCE-842 event uses live battle ratings and excludes internal vehicle prices', () => {
  const unit = wikiUnits(snapshot('usa','boats')).get('us_pce_842_class');
  assert(unit);
  assert.equal(unit.br, '3.0');
  assert.deepEqual([unit.rp, unit.sp, unit.required_unit_id], [0, 0, '']);
  assert.equal(unit.game_source.acquisition.channel, 'vehicle-event');
  const vehicle = require('../docs/database/modifications/usa_boats.json').v[unit.data_unit_id];
  assert.deepEqual(vehicle.m.find(row => row[0] === 'new_ship_pumps').slice(7, 10), [17000, 27000, 480]);
  for (const id of ['us_pce_842_class', 'it_destroyer_audace', 'germ_battleship_pr_h39']) {
    const chunk = require('../docs/' + catalog.chunks[catalog.vehicles[id]].path);
    assert.equal(chunk.v[id].m.find(row => row[0] === 'ship_main_degaussing')[4], '消磁线圈');
    assert.equal(chunk.v[id].l.ship_main_degaussing.zh, '消磁线圈');
  }
});

test('the Leopard 2A8 retains its ordinary costs and the 2A7V prerequisite', () => {
  const unit = wikiUnits(snapshot('germany','ground')).get('germ_leopard_2a8');
  assert(unit);
  assert.deepEqual([unit.rp, unit.sp, unit.required_unit_id], [420000, 1120000, 'germ_leopard_2a7v']);
});

test('historical tree comparisons recover every pre-update byte including folder placement', () => {
  const before = require('./fixtures/roster-before-26142.json');
  const { restoreTree } = require('./roster-snapshot-26142.cjs');
  for (const [file, meta] of Object.entries(before.manifest)) {
    const restored = restoreTree(require('../docs/' + file));
    assert.equal(createHash('sha256').update(JSON.stringify(restored, null, 2) + '\n').digest('hex'), meta.sha256, file);
  }
});
