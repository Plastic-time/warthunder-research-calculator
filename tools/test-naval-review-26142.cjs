const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..', 'docs');
const catalog = require('../docs/database/modifications/catalog.json');
const previous = require('./fixtures/naval-modifications-26142-previous.json');
const trees = Object.assign({}, ...Object.values(catalog.chunks).map(chunk => require(path.join(root, chunk.path)).v));

test('Fletcher and Emden use the reviewed third-tier prices and fourth-tier unlock counts', () => {
  const propeller = trees.us_destroyer_fletcher.m.find(row => row[0] === 'new_ship_screw');
  assert.deepEqual(propeller.slice(7, 10), [340, 480, 100]);
  const turrets = trees.germ_cruiser_emden_1944.m.find(row => row[0] === 'new_main_caliber_turrets');
  assert.deepEqual(turrets.slice(7, 10), [880, 1800, 155]);
  for (const id of ['us_destroyer_fletcher', 'germ_cruiser_emden_1944']) assert.equal(trees[id].r[2], 4);
  assert.deepEqual(trees.us_destroyer_fletcher.m.find(row => row[0] === 'ship_bomb_mortar')[10], ['ship_depth_charge']);
});

test('existing naval trees include the visible coils and depth charges in their research totals', () => {
  const reviewed = catalog.navalModificationReview;
  assert.equal(reviewed.version, '2.61.0.42');
  const counts = { ship_depth_charge: 0, ship_main_degaussing: 0 };
  const changedPrices = [0, 0, 0];
  assert.deepEqual([...reviewed.vehicles].sort(), Object.keys(previous.vehicles).sort());
  for (const id of reviewed.vehicles) {
    const ship = trees[id];
    const record = previous.vehicles[id];
    assert.equal(createHash('sha256').update(JSON.stringify(ship) + '\n').digest('hex'), record.afterHash, id);
    const old = new Map(record.before.m.map(row => [row[0], row]));
    assert(!ship.m.some(row => row[0] === 'ship_base_degaussing'));
    assert.equal(new Set(ship.m.map(row => row.slice(1, 4).join('/'))).size, ship.m.length, id);
    assert.deepEqual(ship.t, ship.m.reduce(([rp, sl], row) => [rp + row[7], sl + row[8]], [0, 0]), id);
    for (const row of ship.m) {
      const original = old.get(row[0]);
      if (original) {
        for (let n = 0; n < 3; n++) if (original[7 + n] !== row[7 + n]) changedPrices[n]++;
      } else {
        assert(Object.hasOwn(counts, row[0]), 'Unexpected addition: ' + row[0]);
        counts[row[0]]++;
      }
      if (row[0] === 'ship_main_degaussing') {
        assert.equal(row[2], 4);
        assert.equal(row[4], '消磁线圈');
        assert.equal(ship.c[row[1]][1], 'Unsinkability');
      }
    }
  }
  for (const id of ['us_destroyer_fletcher', 'us_cruiser_omaha_class_raleigh', 'germ_destroyer_class1936b', 'germ_cruiser_emden_1944']) {
    const depth = trees[id].m.find(row => row[0] === 'ship_depth_charge');
    assert.equal(depth[2], 3);
    assert(depth[7] > 0 && depth[8] > 0);
  }
  assert.deepEqual(counts, { ship_depth_charge: 4, ship_main_degaussing: 49 });
  assert.deepEqual(changedPrices, [157, 157, 734]);
  const premiumCoil = trees.ussr_destroyer_pr56_blagorodny.m.find(row => row[0] === 'ship_main_degaussing');
  assert.deepEqual(premiumCoil.slice(7, 10), [0, 0, 0]);
});

test('Yak-130 unlocks its guided bomb at 10.3 in both RB contexts', () => {
  const { wikiUnits } = require('./audit-datamine-roster.cjs');
  const yak = wikiUnits(require('../docs/database/ussr/ussr_aviation.json')).get('yak_130_early');
  assert.deepEqual(yak.game_battle_ratings.by_battle, {
    air: { AB: '9.3', RB: '9.0', SB: '9.0' },
    tank: { AB: '9.3', RB: '9.0', SB: '9.0' },
    ship: { AB: '9.0', RB: '9.0', SB: '9.0' },
  });
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'custom-battle-ratings.js'), 'utf8'), { window });
  const profile = window.WTCustomBattleRatings.yak_130_early;
  assert.deepEqual(Array.from(profile, level => [level.air, level.ground, Array.from(level.mods)]),
    [['9.0', '9.0', []], ['10.3', '10.3', ['su_kab_tv']]]);
  assert(trees.yak_130_early.m.some(row => row[0] === 'su_kab_tv'));
});
