const assert = require('node:assert/strict');
const source = require('./fixtures/october-modifications.json');
const { gameRequirements } = require('./modification-requirements.cjs');
const { updatePrerequisiteChunks } = require('./update-rafale-modifications.cjs');
const vehicleIds = Object.keys(source.vehicles);
const correction = {
  gameVersion: source.gameVersion, datamineCommit: source.datamineCommit, sourcePath: source.sourcePath,
  scope: 'Reviewed changes since 2.59.0.38 for F-86E(M), MiG-23M and Object 416 only; other data and existing corrections preserved',
  provenance: 'doc/release-v1.0.23.md',
};

function correctOctober(vehicle) {
  const entry = source.vehicles[vehicle.i];
  if (!entry) return vehicle;
  const { old, current } = entry;
  const allowed = new Set([...Object.keys(old.mods), ...Object.keys(current.mods)]);
  assert(vehicle.m.every(m => allowed.has(m[0])), 'Unexpected modification membership; review update');
  for (const id of Object.keys(old.mods)) {
    if (current.mods[id]) assert(vehicle.m.some(m => m[0] === id), 'Missing existing modification: ' + id);
  }
  const result = structuredClone(vehicle);
  result.m = result.m.filter(m => current.mods[m[0]]);
  if (vehicle.i === 'f_86em_greece' && !result.m.some(m => m[0] === 'us_aim_9b')) {
    result.m.push(['us_aim_9b', 2, 4, 1, 'AIM-9B', 'AIM-9B', 'air_to_air_missile.png', 0, 0, 0, [], 13]);
  }
  assert.deepEqual(result.m.map(m => m[0]).sort(), Object.keys(current.mods).sort());
  const visible = new Set(result.m.map(m => m[0]));
  for (const m of result.m) {
    const before = old.mods[m[0]], after = current.mods[m[0]];
    for (const [field, index] of [['tier', 2], ['reqExp', 7], ['value', 8], ['openCostGold', 9]]) {
      if (!before || before[field] !== after[field]) {
        assert(Number.isFinite(after[field]), 'Missing numeric field: ' + field);
        m[index] = after[field];
      }
    }
    if (!before || JSON.stringify(before.reqModification) !== JSON.stringify(after.reqModification)) {
      m[10] = gameRequirements(after, visible);
    }
  }
  // Only tiers I-III unlock a subsequent tier. The tier-IV field is retained in the source fixture.
  for (let i = 0; i < 3; i++) if (old.tierRequirements[i] !== current.tierRequirements[i]) result.r[i] = current.tierRequirements[i];
  result.t = result.m.reduce((sum, m) => [sum[0] + m[7], sum[1] + m[8]], [0, 0]);
  return result;
}
if (require.main === module) updatePrerequisiteChunks({ vehicleIds, correctVehicle: correctOctober, correction });
module.exports = { correctOctober, vehicleIds, correction };
