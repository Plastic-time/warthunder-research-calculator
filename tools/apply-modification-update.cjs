const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const evidence = require('./fixtures/modification-update-20261029.json');
const { gameRequirements } = require('./modification-requirements.cjs');
const { updatePrerequisiteChunks } = require('./update-rafale-modifications.cjs');
const vehicleIds = Object.keys(evidence.vehicles);
const correction = {
  gameVersion: evidence.version, datamineCommit: evidence.commit,
  sourcePath: 'char.vromfs.bin_u/config/wpcost.blkx',
  scope: 'Six reviewed modification trees: explicit costs, membership, tiers and reqModification; prevModification is layout only',
  provenance: 'doc/modification-update-20261029.md',
};

function correctVehicle(vehicle, source = evidence) {
  const entry = source.vehicles[vehicle.i];
  if (!entry) return vehicle;
  assert.deepEqual(vehicle, entry.previous, 'Unexpected modification baseline; review before applying');
  const result = structuredClone(vehicle), game = entry.after.mods;
  result.m = result.m.filter(m => Object.hasOwn(game, m[0]));
  if (['f_102a_late','f_102a_greece'].includes(vehicle.i)) {
    // Keep existing cells stable. The independent gun uses the new third weapon column.
    for (const [id, tier, column] of [['M163_Minigun_new_gun',1,2], ['us_aim_26b',4,0]]) {
      const item = source.additions[id];
      assert.equal(item.definition.modClass, 'weapon');
      const icon = item.definition.image.split('#').at(-1).replace(/\.avif$/, '.png');
      result.m.push([id,2,tier,column,item.names.zh,item.names.en,icon,0,0,0,[],result.m.length]);
      (result.l ||= {})[id] = item.names;
    }
    result.c[2][2] = 3;
  }
  const ids = new Set(result.m.map(m => m[0]));
  for (const m of result.m) {
    const g = game[m[0]];
    assert(Number.isInteger(g.tier) && g.tier >= 1 && g.tier <= 4, 'Invalid research tier');
    for (const [field,index] of [['tier',2],['reqExp',7],['value',8],['openCostGold',9]]) {
      assert(Number.isInteger(g[field]) && g[field] >= 0, 'Unknown or invalid ' + field);
      m[index] = g[field];
    }
    m[10] = gameRequirements(g, ids);
  }
  result.r = entry.after.tierRequirements.slice(0,3);
  result.r.forEach(n => assert(Number.isInteger(n) && n >= 0));
  result.t = result.m.reduce((s,m) => [s[0]+m[7],s[1]+m[8]], [0,0]);
  return result;
}

// Reverse only this dated update so earlier audit hashes remain independently verifiable.
function restoreCatalog(catalog) {
  const restored = structuredClone(catalog);
  for (const id of vehicleIds) {
    assert.deepEqual(restored.corrections[id], correction);
    delete restored.corrections[id];
    const key = restored.vehicles[id];
    restored.chunks[key] = evidence.previousChunks[key];
  }
  restored.stats.modifications = evidence.previousModificationCount;
  return restored;
}

function verifySources(directory) {
  assert(directory, 'Provide the pinned source directory');
  const sources = {};
  for (const s of evidence.sources) {
    const bytes = fs.readFileSync(path.join(directory,s.localFile));
    assert.equal(bytes.length,s.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),s.sha256,s.file);
    if(s.role) sources[s.role] = JSON.parse(bytes);
  }
  const catalog = require('../docs/database/modifications/catalog.json');
  const fields = ['modifications',...Array.from({length:4},(_,i) => 'needBuyToOpenNextInTier'+(i+1))];
  const changed = Object.keys(catalog.vehicles).filter(id => sources.previous[id] && sources.current[id]
    && fields.some(k => JSON.stringify(sources.previous[id][k]) !== JSON.stringify(sources.current[id][k])));
  assert.deepEqual(changed.sort(),vehicleIds.slice().sort(), 'Unreviewed supported modifications');
  for (const [id,entry] of Object.entries(evidence.vehicles)) for (const [label,role] of [['before','previous'],['after','current']]) {
    assert.deepEqual(entry[label].mods,sources[role][id].modifications);
    assert.deepEqual(entry[label].tierRequirements,fields.slice(1).map(k=>sources[role][id][k]));
  }
  return { verified: changed.length, version: evidence.version };
}

if (require.main === module) {
  console.log(verifySources(process.argv[2]));
  if (process.argv.includes('--apply')) updatePrerequisiteChunks({vehicleIds,correctVehicle,correction});
}
module.exports = { correctVehicle, restoreCatalog, verifySources, correction, vehicleIds };
