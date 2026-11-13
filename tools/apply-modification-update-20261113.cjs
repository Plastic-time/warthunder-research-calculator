const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const fixture = require('./fixtures/modification-update-20261113.json');
const { layout } = require('./event-modifications.cjs');
const { gameRequirements } = require('./modification-requirements.cjs');
const { updatePrerequisiteChunks } = require('./update-rafale-modifications.cjs');
const vehicleIds = Object.keys(fixture.vehicles);
const correction = { gameVersion:fixture.version, datamineCommit:fixture.commit,
  sourcePath:'char.vromfs.bin_u/config/wpcost.blkx',
  scope:'F-5E Switzerland and JAS39A modification membership, costs, tiers, prerequisites and game layout',
  provenance:'tools/fixtures/modification-update-20261113.json' };
function correctVehicle(vehicle) {
  const entry = fixture.vehicles[vehicle.i];
  if (!entry) return vehicle;
  assert.deepEqual(vehicle,entry.previous,'Unexpected modification baseline');
  const result = structuredClone(vehicle), categories = ['lth','armor','weapon'];
  const ids = new Set(entry.entries.map(e=>e.id));
  const mods = entry.entries.map(e=>{
    const g = {...e.global,...e.cost};
    for (const key of ['reqExp','value','openCostGold']) assert(Number.isInteger(g[key]) && g[key]>=0,'Missing '+key);
    assert(g.tier>=1 && g.tier<=4 && !g.isHidden && categories.includes(g.modClass));
    return {id:e.id,category:g.modClass,tier:g.tier,prev:g.prevModification,requires:gameRequirements(e.cost,ids)};
  });
  const widths = layout(mods,categories), active = categories.filter((_,i)=>widths[i]>0);
  result.c = active.map(k=>[...vehicle.c[categories.indexOf(k)].slice(0,2),widths[categories.indexOf(k)]]);
  result.l = {};
  result.m = mods.map((m,i)=>{
    const e = entry.entries[i], g = {...e.global,...e.cost};
    const old = vehicle.m.find(v=>v[0]===m.id);
    result.l[m.id] = e.names;
    const icon = (g.image_aircraft || g.image).split('#').at(-1).replace(/\.avif$/,'.png');
    return [m.id,active.indexOf(m.category),m.tier,m.column,e.names.zh,e.names.en,old?.[6]||icon,
      g.reqExp,g.value,g.openCostGold,m.requires,i,...(old?.[12] ? [old[12]] : [])];
  });
  assert.equal(new Set(result.m.map(m=>m.slice(1,4).join(':'))).size,result.m.length,'Overlapping cells');
  result.r = entry.tierRequirements.slice(0,3);
  result.t = result.m.reduce((s,m)=>[s[0]+m[7],s[1]+m[8]],[0,0]);
  result.gameSource = correction;
  return result;
}
function restoreChunk(value) {
  const result = structuredClone(value);
  for (const [id,entry] of Object.entries(fixture.vehicles)) if(result.v[id]) {
    assert.deepEqual(result.v[id],correctVehicle(entry.previous));
    result.v[id] = structuredClone(entry.previous);
  }
  return result;
}
function restoreCatalog(value) {
  const result = structuredClone(value);
  for (const id of vehicleIds) {
    assert.deepEqual(result.corrections[id],correction);
    if(fixture.previousCorrections[id]) result.corrections[id]=fixture.previousCorrections[id];
    else delete result.corrections[id];
  }
  Object.assign(result.chunks,fixture.previousChunks);
  result.stats.modifications=fixture.previousCount;
  return result;
}
if(require.main===module) {
  const directory=process.argv[2]; assert(directory,'Pinned source directory required');
  for(const s of fixture.sources) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(directory+'/'+s.local)).digest('hex'),s.sha256);
  if(process.argv.includes('--apply')) updatePrerequisiteChunks({vehicleIds,correctVehicle,correction});
}
module.exports={correctVehicle,restoreChunk,restoreCatalog,correction};
