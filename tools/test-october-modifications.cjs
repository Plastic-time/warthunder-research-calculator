const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = require('./fixtures/october-modifications.json');
const { correctOctober, correction } = require('./update-october-modifications.cjs');
const planner = require('../public/modification-planner.js');
const catalog = require('../public/database/modifications/catalog.json');
const vehicles = {};
for (const [id, entry] of Object.entries(source.vehicles)) {
  const file = catalog.chunks[catalog.vehicles[id]].path;
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../public', file))).v[id];
  assert.deepEqual(raw, correctOctober(entry.previous), id + ': patch differs');
  assert.deepEqual(raw, correctOctober(raw), id + ': not idempotent');
  assert.deepEqual(catalog.corrections[id], correction);
  const slots = raw.m.map(m => [m[1], m[2], m[3]].join(':'));
  assert.equal(new Set(slots).size, slots.length, 'Overlapping modification slots');
  assert.deepEqual(raw.r, entry.current.tierRequirements.slice(0, 3));
  const data = {
    branch: id === 'ussr_object_416' ? 'other' : 'aviation',
    categories: raw.c.map((c, i) => ({ id: String(i), name: { en: c[1] } })),
    tierRequirements: { 1: raw.r[0], 2: raw.r[1], 3: raw.r[2] },
    mods: raw.m.map(m => ({ id: m[0], category: String(m[1]), tier: m[2], rp: m[7], sl: m[8], requires: m[10], order: m[11] })),
  };
  for (const airCombat of [false, true]) {
    for (const target of data.mods.filter(m => m.rp > 0)) {
      const result = planner.plan(data, [target.id], [], {}, { airCombat });
      for (let tier = 1; tier < target.tier; tier++) assert(result.tierCounts[tier] >= data.tierRequirements[tier]);
      for (const mod of data.mods.filter(m => result.includedIds.includes(m.id))) {
        for (const req of mod.requires) assert(result.includedIds.includes(req));
      }
    }
    const all = planner.plan(data, data.mods.map(m => m.id), [], {}, { airCombat });
    assert.deepEqual([all.rp, all.sl], raw.t);
  }
  vehicles[id] = { raw, data };
}
const f86 = vehicles.f_86em_greece;
assert.deepEqual(f86.raw.t, [145800,226000]);
assert.equal(f86.data.mods.find(m => m.id === 'frc_mk2').tier, 1);
assert.equal(f86.data.mods.find(m => m.id === 'us_750lb_m117').tier, 2);
assert.equal(f86.data.mods.find(m => m.id === 'flbc_mk2').tier, 3);
const aim = f86.data.mods.find(m => m.id === 'us_aim_9b');
assert.equal(aim.tier, 4);
assert.deepEqual(aim.requires, [], 'prevModification must not become a bomb prerequisite');
const owned = f86.data.mods.filter(m => m.id !== aim.id).map(m => m.id);
const partial = planner.plan(f86.data, [aim.id], owned, { [aim.id]: 6000 }, { airCombat: false });
assert.equal(partial.rp, 10000);
assert.equal(partial.sl, 25000);
const mig = vehicles.mig_23m;
assert.deepEqual(mig.data.mods.find(m => m.id === 'il_28sh_s24').requires, ['yak_38_b8m1']);
const route = planner.plan(mig.data, ['il_28sh_s24'], [], {}, { airCombat: false });
for (const id of ['mig_21_ub32','yak_38_b8m1','il_28sh_s24']) assert(route.includedIds.includes(id));
const tank = vehicles.ussr_object_416;
assert(!tank.data.mods.some(m => m.id === 'art_support'));
assert.deepEqual(tank.raw.t, [88600,147600]);
assert.deepEqual(tank.raw.r, [1,2,3], 'Tier-IV config does not reduce the tier-III unlock gate');
assert.equal(source.vehicles.ussr_object_416.current.tierRequirements[3], 1);
for (const id of ['new_tank_transmission','new_tank_engine','100mm_ussr_Smoke_ammo_pack']) {
  const m = tank.data.mods.find(m => m.id === id);
  assert.equal(m.rp, 9900); assert.equal(m.sl, 16000);
}
console.log('October update: three vehicles, membership, real prerequisites, costs, tier gates and partial progress verified.');
