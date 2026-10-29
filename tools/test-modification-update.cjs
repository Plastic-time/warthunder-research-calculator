const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const evidence = require('./fixtures/modification-update-20261029.json');
const { gameRequirements } = require('./modification-requirements.cjs');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const catalog = read('docs/database/modifications/catalog.json');
const vehicle = id => read('docs/' + catalog.chunks[catalog.vehicles[id]].path).v[id];

test('all six updated vehicles match explicit game costs, visible membership and real prerequisites', () => {
  for (const [id, entry] of Object.entries(evidence.vehicles)) {
    const v = vehicle(id), game = entry.after.mods;
    const expected = Object.keys(game).filter(key => game[key].tier >= 1 && game[key].reqExp !== undefined && game[key].costGold === 0);
    assert.deepEqual(v.m.map(m => m[0]).sort(), expected.sort(), id);
    const ids = new Set(expected);
    for (const m of v.m) {
      const g = game[m[0]];
      assert.deepEqual([m[2], m[7], m[8], m[9]], [g.tier, g.reqExp, g.value, g.openCostGold], id + ':' + m[0]);
      assert.deepEqual(m[10], gameRequirements(g, ids), id + ':' + m[0]);
    }
    assert.deepEqual(v.r, entry.after.tierRequirements.slice(0, 3));
    assert.deepEqual(v.t, v.m.reduce((s,m) => [s[0]+m[7], s[1]+m[8]], [0,0]));
  }
});

test('both F-102 trees add independent 7.62 mm guns and the real AIM-4G / AIM-4F / AIM-26B chain', () => {
  for (const id of ['f_102a_late','f_102a_greece']) {
    const v=vehicle(id), mods=Object.fromEntries(v.m.map(m=>[m[0],m]));
    assert.deepEqual(mods.us_aim_26b?.[10], ['us_aim_4f']);
    assert.deepEqual(mods.us_aim_4f[10], ['us_aim_4g']);
    assert.deepEqual(mods.M163_Minigun_new_gun?.[10], []);
    assert.deepEqual(v.t, [112500,176500]);
    for(const key of ['hydravlic_power','cd_98','hp_105_jet']) assert.deepEqual(mods[key][10], []);
    for(const key of Object.keys(evidence.additions)) assert.deepEqual(v.l[key], evidence.additions[key].names);
  }
});

test('Challenger removes obsolete research ammo without changing the III-to-IV gate', () => {
  const v=vehicle('uk_challenger_1');
  assert(!v.m.some(m=>m[0].includes('L23A1')));
  assert.deepEqual(v.t,[210300,351000]);
  assert.deepEqual(v.r,[1,2,2]);
  assert.equal(evidence.vehicles.uk_challenger_1.before.tierRequirements[3],3);
  assert.equal(evidence.vehicles.uk_challenger_1.after.tierRequirements[3],2);
});

test('Ki-93 57 mm ammunition has no invented dependency on the 20 mm gun upgrade', () => {
  const mods=vehicle('ki_93_1_ko').m;
  assert.deepEqual(mods.find(m=>m[0]==='ho_401_belt_pack')[10],[]);
  assert.deepEqual(mods.find(m=>m[0]==='ho401_new_gun')[10],['ho_401_belt_pack']);
});

test('every untouched vehicle, chunk and historical correction is preserved byte-for-byte', () => {
  const { restoreCatalog } = require('./apply-modification-update.cjs');
  const touched = new Set(Object.keys(evidence.vehicles).map(id=>catalog.vehicles[id]));
  for(const [key,meta] of Object.entries(catalog.chunks)) {
    const bytes=fs.readFileSync(path.join(root,'docs',meta.path));
    assert(bytes.equals(fs.readFileSync(path.join(root,'public',meta.path))));
    assert.equal(sha(bytes),meta.sha256);
    assert.equal(bytes.length,meta.bytes);
    const chunk=JSON.parse(bytes);
    if(touched.has(key)) for(const [id,entry] of Object.entries(evidence.vehicles)) if(chunk.v[id]) chunk.v[id]=entry.previous;
    assert.equal(sha(JSON.stringify(chunk)+'\n'),evidence.previousChunks[key].sha256,key);
  }
  assert.equal(sha(JSON.stringify(restoreCatalog(catalog))+'\n'),evidence.catalogSha256);
  assert.equal(catalog.stats.modifications,evidence.previousModificationCount+3);
});

test('updater is deterministic and rejects changed baselines, unknown prices and missing prerequisites', () => {
  const { correctVehicle } = require('./apply-modification-update.cjs');
  for(const [id,entry] of Object.entries(evidence.vehicles)) {
    assert.deepEqual(correctVehicle(entry.previous),vehicle(id));
    assert.throws(()=>correctVehicle(vehicle(id)),/baseline/);
    const bad=structuredClone(entry.previous); bad.m[0][7]++;
    assert.throws(()=>correctVehicle(bad),/baseline/);
  }
  for(const mutate of [
    e=>{delete e.vehicles.f_102a_late.after.mods.us_aim_26b.reqExp;},
    e=>{e.vehicles.f_102a_late.after.mods.us_aim_26b.reqModification='missing';},
    e=>{e.vehicles.f_102a_late.after.mods.us_aim_26b.value=-1;}
  ]) {
    const bad=structuredClone(evidence); mutate(bad);
    assert.throws(()=>correctVehicle(bad.vehicles.f_102a_late.previous,bad));
  }
});
