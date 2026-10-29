const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { wikiUnits } = require('./audit-datamine-roster.cjs');
const { ratings, patchTree, restoreTree, verifySources } = require('./apply-battle-ratings.cjs');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
const unit = (country, type, id) => wikiUnits(read(`docs/database/${country}/${country}_${type}.json`)).get(id);

test('October 29 default RB ratings use the correct battle context without changing research budgets', () => {
  const eagle = unit('usa', 'aviation', 'f_15c_golden_eagle');
  assert.equal(eagle.br, '15.0');
  assert.equal(unit('ussr', 'aviation', 'su_30sm2').br, '15.0');
  assert.equal(unit('china', 'aviation', 'j_16').br, '15.0');
  for (const [type, id, context, br] of [
    ['ground', 'us_t58', 'tank', '9.0'],
    ['helicopters', 'uh_1b', 'tank', '9.0'],
    ['ships', 'us_destroyer_porter_1941', 'ship', '5.0']
  ]) {
    const vehicle = unit('usa', type, id);
    assert.equal(vehicle.br, br);
    assert.equal(vehicle.game_battle_ratings.context, context);
    assert.deepEqual(Object.keys(vehicle.game_battle_ratings.by_battle), [context]);
  }
  const bomber = unit('japan', 'aviation', 'p1y1_mod11');
  assert.equal(bomber.rp, 18000);
  assert.equal(bomber.sp, 47000);
});

test('A-10A keeps air RB separate from its changed ground-battle RB', () => {
  const aircraft = unit('usa', 'aviation', 'a_10a_early');
  assert.equal(aircraft.br, '10.3');
  assert.equal(aircraft.game_battle_ratings?.context, 'air');
  assert.equal(aircraft.game_battle_ratings?.by_battle.air.RB, '10.3');
  assert.equal(aircraft.game_battle_ratings?.by_battle.tank.RB, '11.0');
  assert.equal(aircraft.wiki.battle_ratings_by_battle.tank.RB, '10.3', 'Original Wiki evidence stays historical');
});

test('mode overrides fall back only to the same difficulty, never another battle context', () => {
  const ranks = { economicRankArcade: 27, economicRankHistorical: 28, economicRankSimulation: 29,
    economicRankTankHistorical: 30, economicRankShipArcade: 24 };
  assert.deepEqual(ratings(ranks, 'aviation'), { context: 'air', by_battle: {
    air: { AB: '10.0', RB: '10.3', SB: '10.7' },
    tank: { AB: '10.0', RB: '11.0', SB: '10.7' },
    ship: { AB: '9.0', RB: '10.3', SB: '10.7' }
  } });
  for (const type of ['ground', 'helicopters']) assert.equal(ratings(ranks, type).context, 'tank');
  for (const type of ['ships', 'boats']) assert.equal(ratings(ranks, type).context, 'ship');
  assert.equal(ratings({ ...ranks, economicRankTankHistorical: 0 }, 'ground').by_battle.tank.RB, '1.0');
  assert.equal(ratings({ ...ranks, economicRankHistorical: 42 }, 'aviation').by_battle.air.RB, '15.0');
  for (const invalid of [null, undefined, -1, 1.5, '30']) {
    assert.throws(() => ratings({ ...ranks, economicRankTankHistorical: invalid }, 'aviation'), /invalid BR/);
    assert.throws(() => ratings({ ...ranks, economicRankHistorical: invalid }, 'aviation'), /invalid BR/);
  }
  assert.throws(() => ratings(ranks, 'unknown'), /Unknown tree/);
});

test('folder ranges follow child BRs and reject missing ratings', () => {
  const evidence = { units: { a: { previousBr: '14.7', ranks: { economicRankArcade: 42, economicRankHistorical: 42, economicRankSimulation: 42 } } }, groups: { folder: '14.0-14.7' } };
  const tree = [{ type: 'multiple', data_unit_id: 'folder', br: '14.0-14.7', items: [
    { type: 'single', data_unit_id: 'a', br: '14.7', rp: 100 },
    { type: 'single', data_unit_id: 'b', br: '14.0', rp: null }
  ] }];
  const patched = patchTree(tree, 'aviation', evidence);
  assert.equal(patched[0].br, '14.0-15.0');
  assert.deepEqual(restoreTree(patched, evidence), tree);
  assert.equal(tree[0].items[0].br, '14.7', 'Inputs are not mutated');
  assert.throws(() => patchTree(patched, 'aviation', evidence), /Unexpected|already exists/);
  tree[0].items[1].br = '-';
  assert.throws(() => patchTree(tree, 'aviation', evidence), /missing values/);
});

test('all reviewed snapshots differ only in BR fields and runtime mirrors remain identical', () => {
  const evidence = read('config/battle-rating-update.json');
  const manifest = read('docs/database/manifest.json');
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(Object.keys(evidence.units).length, 638);
  assert.equal(manifest.battleRatings.commit, evidence.commit);
  assert.equal(manifest.battleRatings.fullSnapshotUpgrade, false);
  let units = 0, defaults = 0;
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, 'docs', entry.path));
    assert(bytes.equals(fs.readFileSync(path.join(root, entry.path))));
    assert.equal(hash(bytes), entry.sha256);
    const tree = JSON.parse(bytes), type = path.basename(entry.path, '.json').split('_').slice(1).join('_');
    if (evidence.trees[entry.path]) {
      const previous = restoreTree(tree, evidence);
      assert.equal(hash(JSON.stringify(previous, null, 2) + '\n'), evidence.trees[entry.path], 'No non-BR changes: ' + entry.path);
      assert.deepEqual(patchTree(previous, type, evidence), tree);
    }
    for (const [id, vehicle] of wikiUnits(tree)) {
      if (!evidence.units[id]) { assert(!vehicle.game_battle_ratings); continue; }
      const expected = ratings(evidence.units[id].ranks, type);
      assert.deepEqual(vehicle.game_battle_ratings, expected, id);
      assert.equal(vehicle.br, expected.by_battle[expected.context].RB);
      if (vehicle.br !== evidence.units[id].previousBr) defaults++;
      units++;
    }
  }
  assert.equal(units, 638);
  assert.equal(defaults, 442);
});

test('pinned source validation fails closed when files are unavailable', () => {
  assert.throws(() => verifySources(null, read('config/battle-rating-update.json')), /Provide/);
});
