const assert = require('node:assert/strict');
const source = require('./fixtures/golden-eagle-modification-requirements.json');
const { gameRequirements } = require('./modification-requirements.cjs');
const { updatePrerequisiteChunks } = require('./update-rafale-modifications.cjs');
const vehicleIds = [source.vehicleId];
const correction = {
  gameVersion: source.gameVersion,
  datamineCommit: source.datamineCommit,
  sourcePath: source.sourcePath,
  scope: 'F-15C Golden Eagle modification prerequisites only; prices, tiers and membership unchanged',
  provenance: 'doc/golden-eagle-prerequisites.md',
};
function correctGoldenEagle(vehicle) {
  if (vehicle.i !== source.vehicleId) return vehicle;
  assert.deepEqual(vehicle.m.map(m => m[0]).sort(), Object.keys(source.mods).sort(), 'Golden Eagle membership changed; review correction');
  const result = structuredClone(vehicle);
  const visible = new Set(result.m.map(m => m[0]));
  for (const mod of result.m) {
    assert.equal(mod[2], source.mods[mod[0]].tier, 'Golden Eagle tier changed; review correction');
    mod[10] = gameRequirements(source.mods[mod[0]], visible);
  }
  return result;
}
if (require.main === module) updatePrerequisiteChunks({ vehicleIds, correctVehicle: correctGoldenEagle, correction });
module.exports = { correctGoldenEagle, vehicleIds, correction };
