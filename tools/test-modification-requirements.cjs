const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gameRequirements } = require('./modification-requirements.cjs');
const { correctRafale, vehicleIds } = require('./update-rafale-modifications.cjs');
const fixture = require('./fixtures/rafale-modification-requirements.json');
const planner = require('../docs/modification-planner.js');
const root = path.resolve(__dirname, '..');
const catalog = require('../docs/database/modifications/catalog.json');
const visible = new Set(['gun', 'pod', 'bomb']);
assert.deepEqual(gameRequirements({ prevModification: 'gun' }, visible), []);
assert.deepEqual(gameRequirements({ reqModification: ['POD', 'pod'], prevModification: 'gun' }, visible), ['pod']);
assert.deepEqual(gameRequirements({ reqModification: 'pod', wikiRequired: 'gun' }, visible), ['pod']);
assert.throws(() => gameRequirements(null, visible));
assert.throws(() => gameRequirements({ reqModification: 'missing' }, visible));
assert.throws(() => gameRequirements({ reqModification: {} }, visible));
for (const id of vehicleIds) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'docs', catalog.chunks[catalog.vehicles[id]].path))).v[id];
  const ids = new Set(raw.m.map(m => m[0]));
  for (const mod of raw.m) assert.deepEqual(mod[10], gameRequirements(fixture.vehicles[id][mod[0]], ids), id + ':' + mod[0]);
  assert.deepEqual(correctRafale(raw), raw, 'Correction must be idempotent');
  const broken = structuredClone(raw);
  broken.m.find(m => m[0] === 'fr_mica_em')[10] = ['aden_new_gun'];
  assert.deepEqual(correctRafale(broken), raw, 'Remove only incorrect prerequisites');
  const data = {
    mods: raw.m.map(m => ({ id: m[0], tier: m[2], rp: m[7], sl: m[8], requires: m[10], order: m[11] })),
    tierRequirements: { 1: raw.r[0], 2: raw.r[1], 3: raw.r[2] },
  };
  const result = planner.plan(data, ['fr_mica_em'], ['new_compressor_jet', 'hydravlic_power', 'structure_str', 'f_4c_g_suit']);
  assert.deepEqual(result.includedIds, ['fr_mica_em']);
  assert.deepEqual(result.dependencyIds, []);
  assert.equal(result.rp, 15000);
  assert.equal(result.sl, 23000);
  const fromStock = planner.plan(data, ['fr_mica_em'], []);
  assert.equal(fromStock.tierCounts[1], 1);
  assert.equal(fromStock.tierCounts[2], 3);
  assert.equal(fromStock.rp, 63000);
  assert.equal(fromStock.sl, 95000);
  assert(!fromStock.dependencyIds.includes('aden_new_gun'));
  const bomb = planner.plan(data, ['fr_aasm_250_sbu_54'], []);
  const pod = id === 'rafale_m_f3r' ? 'fr_talios_pod' : 'fr_damocles_pod';
  assert(bomb.dependencyIds.includes(pod) && bomb.dependencyIds.includes('us_gbu_laser'));
}
console.log(JSON.stringify({ rafalePrerequisites: true, variants: vehicleIds.length, layoutNotDependency: true, realPrerequisitesPreserved: true }));

const goldenSource = require('./fixtures/golden-eagle-modification-requirements.json');
const { correctGoldenEagle } = require('./update-golden-eagle-modifications.cjs');
const goldenRaw = JSON.parse(fs.readFileSync(path.join(root, 'docs', catalog.chunks[catalog.vehicles[goldenSource.vehicleId]].path))).v[goldenSource.vehicleId];
const goldenIds = new Set(goldenRaw.m.map(m => m[0]));
for (const mod of goldenRaw.m) {
  assert.deepEqual(mod[10], gameRequirements(goldenSource.mods[mod[0]], goldenIds), mod[0]);
}
assert.equal(goldenRaw.m.reduce((sum, m) => sum + m[10].length, 0), 5);
assert.deepEqual(correctGoldenEagle(goldenRaw), goldenRaw);
const brokenGolden = structuredClone(goldenRaw);
for (const mod of brokenGolden.m) {
  const previous = goldenSource.mods[mod[0]].prevModification;
  if (previous) mod[10] = [previous];
}
assert.deepEqual(correctGoldenEagle(brokenGolden), goldenRaw, 'Remove layout edges without altering any other fields');
const badTier = structuredClone(goldenRaw);
badTier.m.find(m => m[0] === 'f_4c_g_suit')[2] = 2;
assert.throws(() => correctGoldenEagle(badTier), /tier changed/);
assert.deepEqual(goldenRaw.m.find(m => m[0] === 'us_aim_120d')[10], ['us_aim_120c']);
assert.deepEqual(goldenRaw.m.find(m => m[0] === 'us_aim_120c')[10], ['us_aim_9m']);
console.log(JSON.stringify({ goldenEaglePrerequisites: true, actualArrows: 5, gSuitTier: 3 }));
