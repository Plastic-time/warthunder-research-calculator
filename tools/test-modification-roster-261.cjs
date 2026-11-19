const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('../docs/database/modifications/catalog.json');
const planner = require('../docs/modification-planner.js');
const root = path.resolve(__dirname, '..');
const vehicle = id => require('../docs/' + catalog.chunks[catalog.vehicles[id]].path).v[id];
const window = {};
const previous = require('./fixtures/modification-roster-261-previous.json');
let added = 0, removed = 0;
for (const [id, record] of Object.entries(previous.vehicles)) {
  const current = vehicle(id);
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(current) + '\n').digest('hex'), record.afterHash, id);
  const oldIds = new Set(record.before.m.map(row => row[0]));
  const newIds = new Set(current.m.map(row => row[0]));
  added += [...newIds].filter(mod => !oldIds.has(mod)).length;
  removed += [...oldIds].filter(mod => !newIds.has(mod)).length;
}
assert.deepEqual([added, removed], [54, 19]);
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/custom-battle-ratings.js'), 'utf8'), { window });
for (const [id, levels] of Object.entries(window.WTCustomBattleRatings)) {
  const keys = new Set(vehicle(id).m.map(row => row[0]));
  for (const level of levels) for (const key of level.mods) assert(keys.has(key), id + '/' + key);
}
const bison = vehicle('mig-21_bison');
const rvv = bison.m.find(row => row[0] === 'mig_21_bison_r_77e');
assert.equal(rvv[2], 4);
assert.equal(rvv[5], 'RVV-AE');
assert.deepEqual(rvv.slice(7, 11), [0, 0, 0, ['mig_29_r_27t1']]);
assert(!bison.autoUnlockWith);
const yak = vehicle('yak_141');
assert(!yak.m.some(row => row[0] === 'mi_24_r_60m'));
assert.deepEqual(yak.m.find(row => row[0] === 'yak_141_r_77').slice(7,11), [13000,20000,690,['mig_29_r_27t']]);
const paired = vehicle('ah_64e');
assert.equal(paired.aliases.MAW_system_heli_false_thermal_targets_large, 'MAW_system_heli_false_thermal_targets_large_dircm');
const child = 'atgm_spike_nlos_mitl', parent = 'atgm_spike_nlos';
assert.equal(paired.autoUnlockWith[child], parent);
const data = {
  branch: 'other', categories: [], tierRequirements: paired.r.reduce((r,n,i)=>({...r,[i+1]:n}),{}),
  mods: paired.m.map(row => ({ id: row[0], tier: row[2], rp: row[7], sl: row[8], requires: row[10],
    order: row[11], autoUnlockWith: paired.autoUnlockWith[row[0]] })),
};
const before = planner.plan(data, [child], []);
assert(before.includedIds.includes(parent));
assert(before.rp > 0 && before.sl > 0);
const after = planner.plan(data, [child], [parent]);
assert(after.researchedIds.includes(child));
assert.deepEqual([after.rp, after.sl], [0,0]);
console.log('BR membership, Bison, Yak-141, saved MAW IDs and parent-linked unlocks passed');
