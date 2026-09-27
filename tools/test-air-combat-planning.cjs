const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const planner = require('../public/modification-planner.js');
const cm = 'countermeasures_belt_pack';
const options = { airCombat: true };
const mod = (id, tier, category, rp = 100, requires = []) => ({
  id, tier, category, rp, sl: rp * 2, requires, order: 0,
});
const data = {
  branch: 'aviation',
  categories: [
    { id: 'flight', name: { en: 'Flight performance' } },
    { id: 'survival', name: { en: 'Survivability' } },
    { id: 'weapon', name: { en: 'Weaponry' } },
  ],
  tierRequirements: { 1: 1, 2: 2, 3: 2 },
  mods: [
    mod('bomb1', 1, 'weapon', 1),
    mod('engine1', 1, 'flight'),
    mod(cm, 1, 'survival'),
    mod('bomb2', 2, 'weapon', 1),
    mod('missileBase', 2, 'weapon', 110),
    mod('engine2', 2, 'flight', 120),
    mod('airframe2', 2, 'survival', 130),
    mod('selectedMissile', 3, 'weapon', 150, ['missileBase']),
    mod('otherMissile', 4, 'weapon', 200),
  ],
};
const run = (source = data, selected = ['selectedMissile'], researched = [], progress = {}, settings = options) =>
  planner.plan(source, selected, researched, progress, settings);
const before = JSON.stringify(data);
const result = run();
assert.deepEqual(result.priorityIds, [cm]);
assert.deepEqual(result.dependencyIds, ['missileBase']);
assert.deepEqual(result.fillerIds, ['engine2']);
assert.equal(result.tierCounts[1], 1);
assert.equal(result.tierCounts[2], 2);
assert.equal(result.rp, 480);
assert.equal(result.sl, 960);
assert(!result.includedIds.includes('otherMissile'), 'Do not force the highest missile');
assert(!result.includedIds.includes('airframe2'), 'Stop when the tier quota is met');
assert(!result.includedIds.includes('bomb2'), 'Prefer airframe work even if bombs cost less');
assert.equal(JSON.stringify(data), before, 'Never mutate prices, targets or prerequisites');
const plain = run(data, undefined, [], {}, { airCombat: false });
assert.deepEqual(plain.priorityIds, []);
assert(plain.includedIds.includes('bomb1'));
assert(plain.includedIds.includes('bomb2'));
assert.equal(plain.rp, 262);
assert.deepEqual(run(data, undefined, [cm]).priorityIds, []);
assert.equal(run(data, undefined, [cm]).rp, 380);
assert.equal(run(data, undefined, [], { [cm]: 40 }).rp, 440);
assert.equal(run(data, undefined, [], { [cm]: 40 }).sl, 960);
assert.deepEqual(run(data, []).includedIds, []);
assert.deepEqual(run(data, ['selectedMissile'], ['selectedMissile']).includedIds, []);
assert.deepEqual(run(data, [cm]).priorityIds, [], 'A manual countermeasure target stays a target');
assert.deepEqual(run({ ...data, branch: 'ground' }), plain);
assert.deepEqual(run({ ...data, branch: 'helicopter' }), plain);
assert.deepEqual(run({ ...data, branch: undefined }), plain);
const free = structuredClone(data);
Object.assign(free.mods.find(m => m.id === cm), { rp: 0, sl: 0 });
assert.equal(run(free).rp, 380);
assert.deepEqual(run(free).priorityIds, []);
const extraPod = structuredClone(data);
extraPod.mods.push(mod('uk_ltc_bol', 2, 'survival'));
assert(!run(extraPod).priorityIds.includes('uk_ltc_bol'));
const noCountermeasure = { ...data, mods: data.mods.filter(m => m.id !== cm) };
assert.deepEqual(run(noCountermeasure).priorityIds, []);
assert(run(noCountermeasure).fillerIds.includes('engine1'));
const warningOnly = structuredClone(noCountermeasure);
warningOnly.mods.push({ ...mod('MAW_warning_only', 1, 'weapon'), name: { en: 'Flares/Chaff MAW' } });
assert.deepEqual(run(warningOnly).priorityIds, [], 'Do not guess from translated names');
const countermeasureDependency = structuredClone(data);
countermeasureDependency.mods.find(m => m.id === cm).requires = ['engine1'];
assert(run(countermeasureDependency).dependencyIds.includes('engine1'));
const insufficient = structuredClone(noCountermeasure);
insufficient.tierRequirements[2] = 4;
assert(run(insufficient).includedIds.includes('bomb2'), 'Keep a reachable route when preferred fillers run out');

for (const suit of ['g_suit', 'f_4c_g_suit']) {
  const handling = structuredClone(data);
  handling.mods.find(m => m.id === 'selectedMissile').requires = [];
  handling.mods.find(m => m.id === 'engine2').id = 'hydravlic_power';
  handling.mods.find(m => m.id === 'airframe2').id = suit;
  handling.mods.push(mod('cheapAirframe', 2, 'flight', 2));
  const preferred = run(handling);
  assert.deepEqual(preferred.fillerIds, ['hydravlic_power', suit], 'Boosters and G-suit precede ordinary airframe work');
  assert.equal(preferred.tierCounts[2], 2, 'Do not select the entire tier');
  assert.deepEqual(run(handling, undefined, ['hydravlic_power']).fillerIds, [suit]);
  assert(run(handling, undefined, [], {}, { airCombat: false }).fillerIds.includes('cheapAirframe'));
}

for (const [chunk, id] of [
  ['france_aviation', 'rafale_c_f3'],
  ['france_aviation', 'rafale_m_f3r'],
  ['israel_aviation', 'rafale_eg_greece'],
]) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/database/modifications', chunk + '.json'))).v[id];
  const aircraft = {
    branch: 'aviation',
    categories: raw.c.map((c, i) => ({ id: String(i), name: { en: c[1] } })),
    tierRequirements: { 1: raw.r[0], 2: raw.r[1], 3: raw.r[2] },
    mods: raw.m.map(m => ({ id: m[0], category: String(m[1]), tier: m[2], rp: m[7], sl: m[8], requires: m[10], order: m[11] })),
  };
  const stock = run(aircraft, ['fr_mica_em']);
  const maw = 'MAW_system_heli_false_thermal_targets_large';
  assert.deepEqual(stock.priorityIds, [maw]);
  assert.deepEqual(stock.dependencyIds, []);
  assert.equal(stock.rp, 63000);
  assert.equal(stock.sl, 95000);
  assert.equal(stock.tierCounts[1], 1);
  assert.equal(stock.tierCounts[2], 3);
  assert(!stock.includedIds.includes('aden_new_gun'));
  const researched = ['new_compressor_jet', 'hydravlic_power', 'structure_str', 'f_4c_g_suit'];
  assert.equal(run(aircraft, ['fr_mica_em'], researched).rp, 27000);
  assert.equal(run(aircraft, ['fr_mica_em'], [...researched, maw]).rp, 15000);
  assert.equal(run(aircraft, ['fr_mica_em'], researched, {}, { airCombat: false }).rp, 15000);
}
const goldenRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/database/modifications/usa_aviation.json'))).v.f_15c_golden_eagle;
const golden = {
  branch: 'aviation',
  categories: goldenRaw.c.map((c, i) => ({ id: String(i), name: { en: c[1] } })),
  tierRequirements: { 1: goldenRaw.r[0], 2: goldenRaw.r[1], 3: goldenRaw.r[2] },
  mods: goldenRaw.m.map(m => ({ id: m[0], category: String(m[1]), tier: m[2], rp: m[7], sl: m[8], requires: m[10], order: m[11] })),
};
const goldenPlan = run(golden, ['us_aim_120d']);
assert.deepEqual(new Set(goldenPlan.dependencyIds), new Set(['us_aim_9m', 'us_aim_120c']));
assert(goldenPlan.fillerIds.includes('hydravlic_power'));
assert(goldenPlan.fillerIds.includes('f_4c_g_suit'));
assert(goldenPlan.fillerIds.includes('uk_ltc_bol'));
assert(!goldenPlan.includedIds.includes('structure_str'));
assert(!goldenPlan.includedIds.includes('new_compressor_jet'));
assert.equal(goldenPlan.tierCounts[2], 2);
assert.equal(goldenPlan.tierCounts[3], 3);
assert.equal(goldenPlan.rp, 104600);
assert.equal(goldenPlan.sl, 163000);
console.log('Air combat preference: targeted missiles, countermeasures, tier fillers and costs passed');
