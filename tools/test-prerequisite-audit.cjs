const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { auditVehicle, projections, checkGraph, protectedIds } = require('./audit-modification-prerequisites.cjs');
const proof = require('./fixtures/modification-prerequisite-audit.json');
const catalog = require('../public/database/modifications/catalog.json');
const planner = require('../public/modification-planner.js');
assert.equal(catalog.prerequisiteAudit.datamineCommit, proof.datamineCommit);
assert.equal(catalog.prerequisiteAudit.verifiedMods, proof.verifiedMods);
const root = path.resolve(__dirname, '..');
const vehicles = new Map();
let vehicleCount = 0, modCount = 0, genuineEdges = 0, plannedTargets = 0;
for (const [key, meta] of Object.entries(catalog.chunks)) {
  const chunk = JSON.parse(fs.readFileSync(path.join(root, 'public', meta.path)));
  // Compare the original audit against its snapshot, before the reviewed F4U-7 cost update.
  const audited = structuredClone(chunk);
  if (audited.v['f4u-7']) {
    const previous = require('./fixtures/f4u7-modifications.json').previous;
    const v = audited.v['f4u-7'];
    v.r = previous.tierRequirements;
    v.t = previous.totals;
    for (const m of v.m) {
      const saved = previous.mods[m[0]];
      [m[2], m[7], m[8], m[9]] = saved;
    }
    assert.deepEqual(chunk.v['f4u-7'], require('./update-f4u7-modifications.cjs').correctF4u7(chunk.v['f4u-7']));
  }
  assert.deepEqual(projections(audited), proof.chunks[key], key + ': pinned prerequisite or other-field proof differs');
  for (const v of Object.values(chunk.v)) {
    vehicles.set(v.i, v);
    checkGraph(v);
    vehicleCount++;
    modCount += v.m.length;
    if (!protectedIds.includes(v.i)) genuineEdges += v.m.reduce((n, m) => n + m[10].length, 0);
    const data = {
      branch: key.endsWith('_aviation') ? 'aviation' : 'other',
      categories: v.c.map((c, i) => ({ id: String(i), name: { en: c[1] } })),
      tierRequirements: { 1: v.r[0], 2: v.r[1], 3: v.r[2] },
      mods: v.m.map(m => ({ id: m[0], category: String(m[1]), tier: m[2], rp: m[7], sl: m[8], requires: m[10], order: m[11] })),
    };
    const byId = new Map(data.mods.map(m => [m.id, m]));
    for (const tier of [1, 2, 3, 4]) {
      const target = data.mods.find(m => m.tier === tier && m.rp > 0);
      if (!target) continue;
      const result = planner.plan(data, [target.id], [], {}, { airCombat: true });
      const included = new Set([...result.includedIds, ...result.researchedIds]);
      assert(result.includedIds.includes(target.id));
      for (const id of result.includedIds) {
        for (const req of byId.get(id).requires) assert(included.has(req), v.i + ':' + id);
      }
      for (let gate = 1; gate <= 3; gate++) {
        if (result.includedIds.some(id => byId.get(id).tier > gate)) {
          assert(result.tierCounts[gate] >= data.tierRequirements[gate], v.i + ': tier gate ' + gate);
        }
      }
      assert.equal(result.rp, result.includedIds.reduce((n, id) => n + byId.get(id).rp, 0));
      assert.equal(result.sl, result.includedIds.reduce((n, id) => n + byId.get(id).sl, 0));
      plannedTargets++;
    }
  }
}
assert.equal(vehicleCount, proof.examinedVehicles);
assert.equal(modCount, proof.examinedMods);
for (const saved of proof.preserved) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(vehicles.get(saved.id))).digest('hex');
  assert.equal(digest, saved.sha256, saved.id + ': user correction changed');
}
let bol = 0, bolWithPrerequisites = 0;
for (const [vehicle, id, tier, required] of proof.countermeasures) {
  const m = vehicles.get(vehicle).m.find(m => m[0] === id);
  assert.equal(m[2], tier);
  assert.deepEqual(m[10], required, vehicle + ':' + id);
  if (!['uk_ltc_bol', 'swd_ltc_bol'].includes(id)) continue;
  bol++;
  if (required.length) bolWithPrerequisites++;
  // Keep each real BOL dependency while preferring it over cheap airframe filler.
  const data = {
    branch: 'aviation',
    categories: [{ id: 'airframe', name: { en: 'Flight performance' } }],
    tierRequirements: { [tier]: 1 },
    mods: [
      { id, tier, rp: m[7], sl: m[8], requires: required, category: 'survival', order: 1 },
      ...required.map(id => ({ id, tier: Math.max(1, tier - 1), rp: 100, sl: 10, requires: [], category: 'survival', order: 0 })),
      { id: 'cheap', tier, rp: 1, sl: 1, requires: [], category: 'airframe', order: 0 },
      { id: 'target', tier: tier + 1, rp: 1, sl: 1, requires: [], category: 'weapon', order: 2 },
    ],
  };
  const result = planner.plan(data, ['target'], [], {}, { airCombat: true });
  assert(result.includedIds.includes(id) || result.researchedIds.includes(id), vehicle + ': BOL is preferred or already unlocked');
  assert(!result.includedIds.includes('cheap'));
  for (const req of required) assert(result.includedIds.includes(req), vehicle + ': preserve BOL prerequisite');
}
assert.equal(bol, 23);
assert.equal(bolWithPrerequisites, 10);
const f15i = vehicles.get('f_15i_raam');
for (const id of ['hydravlic_power', 'cd_98', 'hp_105_jet']) {
  assert.deepEqual(f15i.m.find(m => m[0] === id)[10], []);
}
const minimal = { i: 'test', m: [['source', 0, 1, 0, '', '', '', 1, 1, 0, [], 0], ['target', 0, 2, 0, '', '', '', 1, 1, 0, ['source'], 1]] };
assert.equal(auditVehicle(minimal, { modifications: { source: {}, target: { prevModification: 'source' } } }).changes.length, 1);
assert.equal(auditVehicle(minimal, { modifications: { source: {}, target: { reqModification: 'source' } } }).changes.length, 0);
assert.throws(() => auditVehicle(minimal, { modifications: { source: {}, target: {} } }), /Non-layout/);
assert.throws(() => auditVehicle(minimal, { modifications: { source: {} } }), /Missing game modification/);
console.log(JSON.stringify({ vehicleCount, modCount, genuineEdges, plannedTargets, countermeasureRecords: proof.countermeasures.length, bol, bolWithPrerequisites, protectedVehicles: proof.preserved.length }));
