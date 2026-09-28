const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = require('./fixtures/f4u7-modifications.json');
const { correctF4u7 } = require('./update-f4u7-modifications.cjs');
const planner = require('../public/modification-planner.js');
const chunk = require('../public/database/modifications/france_aviation.json');
const vehicle = chunk.v[source.vehicleId];
assert.deepEqual(vehicle, correctF4u7(vehicle), 'Published F4U-7 is stale');
assert.deepEqual(vehicle.r, [1, 3, 3]);
assert.deepEqual(vehicle.t, [47800, 86900]);
assert(fs.readFileSync('public/database/modifications/france_aviation.json').equals(fs.readFileSync('docs/database/modifications/france_aviation.json')));
const mods = vehicle.m.map(m => ({ id: m[0], category: String(m[1]), tier: m[2], rp: m[7], sl: m[8], requires: m[10], order: m[11] }));
const data = { branch: 'aviation', categories: vehicle.c.map((c, i) => ({ id: String(i), name: { en: c[1] } })), tierRequirements: { 1: 1, 2: 3, 3: 3 }, mods };
assert.deepEqual(mods.find(m => m.id === 'frc_mk3').requires, ['fr_matra_t_10_150']);
assert.equal(mods.find(m => m.id === 'anm3_new_gun').tier, 2);
for (const airCombat of [true, false]) {
  for (const target of mods) {
    const result = planner.plan(data, [target.id], [], {}, { airCombat });
    for (let tier = 1; tier < target.tier; tier++) assert(result.tierCounts[tier] >= data.tierRequirements[tier]);
    for (const m of mods.filter(m => result.includedIds.includes(m.id))) {
      for (const req of m.requires) assert(result.includedIds.includes(req));
    }
  }
  const all = planner.plan(data, mods.map(m => m.id), [], {}, { airCombat });
  assert.equal(all.rp, 47800);
  assert.equal(all.sl, 86900);
  const cannon = planner.plan(data, ['anm3_new_gun'], [], {}, { airCombat });
  assert.equal(cannon.rp, 3700);
  assert.equal(cannon.sl, 6800);
  const partial = planner.plan(data, ['anm3_new_gun'], ['anm3_belt_pack'], { anm3_new_gun: 800 }, { airCombat });
  assert.equal(partial.rp, 1000);
  assert.equal(partial.sl, 3300);
}
console.log('F4U-7: costs, tier gates, real prerequisites, totals and partial progress verified.');
