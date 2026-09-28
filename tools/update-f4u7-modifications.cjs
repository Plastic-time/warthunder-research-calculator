const assert = require('node:assert/strict');
const source = require('./fixtures/f4u7-modifications.json');
const { gameRequirements } = require('./modification-requirements.cjs');
const { updatePrerequisiteChunks } = require('./update-rafale-modifications.cjs');
const vehicleIds = [source.vehicleId];
const correction = {
  gameVersion: source.gameVersion,
  datamineCommit: source.datamineCommit,
  sourcePath: source.sourcePath,
  scope: 'F4U-7 modification costs, cannon tier and tier unlock counts only; membership and real prerequisites unchanged',
  provenance: 'doc/release-v1.0.19.md',
};
function correctF4u7(vehicle) {
  if (vehicle.i !== source.vehicleId) return vehicle;
  assert.deepEqual(vehicle.m.map(m => m[0]).sort(), Object.keys(source.mods).sort(), 'F4U-7 membership changed; review correction');
  const result = structuredClone(vehicle);
  result.r = [...source.tierRequirements];
  const visible = new Set(result.m.map(m => m[0]));
  for (const m of result.m) {
    const game = source.mods[m[0]];
    assert.deepEqual(m[10], gameRequirements(game, visible), 'F4U-7 prerequisites changed; review correction');
    m[2] = game.tier;
    m[7] = game.reqExp;
    m[8] = game.value;
    m[9] = game.openCostGold;
  }
  result.t = result.m.reduce((sum, m) => [sum[0] + m[7], sum[1] + m[8]], [0, 0]);
  return result;
}
if (require.main === module) updatePrerequisiteChunks({ vehicleIds, correctVehicle: correctF4u7, correction });
module.exports = { correctF4u7, correction, vehicleIds };
