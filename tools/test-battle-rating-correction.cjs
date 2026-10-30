const assert = require('node:assert/strict');
const { test } = require('node:test');
const { wikiUnits } = require('./audit-datamine-roster.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { patchTree, restoreCorrection, ratings, verifySources } = require('./apply-battle-ratings.cjs');
const evidence = require('../config/battle-rating-correction.json');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const unit = (country, id) => wikiUnits(require(`../docs/database/${country}/${country}_aviation.json`)).get(id);

test('October 30 Hawk correction keeps air and ground ratings separate', () => {
  for (const id of ['hawk_t1a_early', 'hawk_t1a']) {
    const aircraft = unit('britain', id);
    assert.equal(aircraft.br, '7.3');
    const modes = aircraft.game_battle_ratings.by_battle;
    assert.deepEqual(modes.air, { AB: '7.3', RB: '7.3', SB: '7.3' });
    assert.equal(modes.ship.AB, '7.3');
    assert.equal(modes.ship.RB, '7.3');
    assert.equal(modes.tank.RB, '7.0');
    assert.equal(modes.tank.SB, '7.0');
  }
});

test('all 50 trees retain every field outside seven reviewed BR corrections', () => {
  const manifest = read('docs/database/manifest.json');
  assert.equal(manifest.battleRatingCorrection.commit, evidence.commit);
  assert.equal(manifest.battleRatingCorrection.fullSnapshotUpgrade, false);
  let found = 0, defaults = 0, trees = 0;
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, file.path));
    assert(bytes.equals(fs.readFileSync(path.join(root, 'docs', file.path))));
    assert.equal(hash(bytes), file.sha256);
    const current = JSON.parse(bytes), previous = restoreCorrection(current);
    assert.equal(hash(JSON.stringify(previous, null, 2) + '\n'), evidence.trees[file.path], file.path);
    const type = path.basename(file.path, '.json').split('_').slice(1).join('_');
    assert.deepEqual(patchTree(previous, type, evidence), current);
    if (hash(bytes) !== evidence.trees[file.path]) trees++;
    for (const [id, aircraft] of wikiUnits(current)) if (evidence.units[id]) {
      found++;
      assert.deepEqual(aircraft.game_battle_ratings, ratings(evidence.units[id].ranks, type));
      if (aircraft.br !== evidence.units[id].previousBr) defaults++;
    }
    file.sha256 = evidence.trees[file.path];
  }
  assert.equal(found, 7); assert.equal(defaults, 2); assert.equal(trees, 4);
  delete manifest.battleRatingCorrection;
  assert.equal(hash(JSON.stringify(manifest, null, 2) + '\n'), evidence.manifestSha256);
});

test('correction rejects changed previous mode evidence and repeated application', () => {
  const current = read('docs/database/china/china_aviation.json');
  assert.throws(() => patchTree(current, 'aviation', evidence), /Unexpected previous BR source/);
  const previous = restoreCorrection(current);
  const invalid = structuredClone(previous);
  wikiUnits(invalid).get('f_16a_block_20_mlu').game_battle_ratings.by_battle.tank.RB = '1.0';
  assert.throws(() => patchTree(invalid, 'aviation', evidence), /Unexpected previous BR source/);
  assert.deepEqual(restoreCorrection(patchTree(previous, 'aviation', evidence)), previous);
  assert.throws(() => verifySources(null, evidence), /Provide/);
});

test('October 30 F-16 correction only lowers air SB and inherited naval SB', () => {
  const aircraft = unit('china', 'f_16a_block_20_mlu');
  assert.equal(aircraft.br, '13.7');
  assert.deepEqual(aircraft.game_battle_ratings.by_battle, {
    air: { AB: '13.7', RB: '13.7', SB: '13.7' },
    tank: { AB: '13.7', RB: '13.3', SB: '12.7' },
    ship: { AB: '13.7', RB: '13.7', SB: '13.7' }
  });
});

test('October 30 four ground RB corrections do not change air RB', () => {
  for (const [country, id, br] of [
    ['japan', 'n1k2_j', '6.0'], ['japan', 'n1k2_jko', '6.0'],
    ['britain', 'spitfire_mk18e', '5.7'], ['ussr', 'yak-3u', '5.7']
  ]) {
    const aircraft = unit(country, id);
    assert.equal(aircraft.br, br);
    assert.equal(aircraft.game_battle_ratings.by_battle.air.RB, br);
    assert.equal(aircraft.game_battle_ratings.by_battle.tank.RB, '6.3');
  }
});
