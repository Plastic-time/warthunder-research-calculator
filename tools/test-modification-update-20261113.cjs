const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = require('./fixtures/modification-update-20261113.json');
const catalog = require('../docs/database/modifications/catalog.json');
const vehicle = id => JSON.parse(fs.readFileSync('docs/'+catalog.chunks[catalog.vehicles[id]].path)).v[id];
for (const [id, entry] of Object.entries(fixture.vehicles)) test(id+' matches live membership, costs and prerequisites', () => {
  const actual = vehicle(id);
  assert.deepEqual(actual.m.map(m=>m[0]).sort(),entry.entries.map(m=>m.id).sort());
  for (const {id:key,cost} of entry.entries) {
    const m = actual.m.find(m=>m[0]===key);
    assert.deepEqual([m[2],m[7],m[8],m[9]], [cost.tier,cost.reqExp,cost.value,cost.openCostGold]);
    assert.deepEqual(m[10], [].concat(cost.reqModification||[]));
  }
  assert.deepEqual(actual.r,entry.tierRequirements.slice(0,3));
});
test('F-5E Maverick chain and Gripen RB 99 use real research prerequisites', () => {
  const f = Object.fromEntries(vehicle('f-5e_switzerland').m.map(m=>[m[0],m]));
  assert.deepEqual(f.us_agm_65b[10],[]);
  assert.deepEqual(f.us_agm_65d[10],['us_agm_65b']);
  assert.deepEqual(f.us_agm_65g[10],['us_agm_65d']);
  assert.deepEqual(vehicle('f-5e_switzerland').t,[197000,305600]);
  assert.deepEqual(vehicle('saab_jas39a').t,[260900,402000]);
  assert.deepEqual(vehicle('saab_jas39a').m.find(m=>m[0]==='swd_rb99')[10],['swd_rb74m']);
});
test('only the two reviewed trees change; mirrors, hashes and old artwork remain intact', () => {
  const {correctVehicle,restoreChunk}=require('./apply-modification-update-20261113.cjs');
  const hash=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
  for(const [key,old] of Object.entries(fixture.previousChunks)) {
    const bytes=fs.readFileSync('docs/'+old.path);
    assert(bytes.equals(fs.readFileSync('public/'+old.path)));
    assert.equal(hash(bytes),catalog.chunks[key].sha256);
    assert.equal(bytes.length,catalog.chunks[key].bytes);
    assert.equal(hash(JSON.stringify(restoreChunk(JSON.parse(bytes)))+'\n'),old.sha256);
  }
  for(const [id,entry] of Object.entries(fixture.vehicles)) {
    const actual=vehicle(id);
    assert.deepEqual(actual,correctVehicle(entry.previous));
    assert.throws(()=>correctVehicle(actual),/Unexpected modification baseline/);
    for(const m of entry.previous.m) if(m[12]) assert.deepEqual(actual.m.find(n=>n[0]===m[0])[12],m[12]);
    for(const names of Object.values(actual.l)) assert.deepEqual(Object.keys(names).sort(),['de','en','es','fr','ja','ru','zh']);
  }
});
