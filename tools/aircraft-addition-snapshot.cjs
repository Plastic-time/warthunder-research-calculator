// Remove only the checked additions when comparing immutable historical snapshots.
const assert = require('node:assert/strict');
const fixture = require('../config/eagles-shadow-aircraft.json');
function restoreTree(value) {
  const tree = structuredClone(value);
  for (const rank of tree) for (const section of ['researchable_vehicles', 'premium_vehicles']) {
    if (!rank[section]) continue;
    rank[section] = rank[section].map(column => column.filter(unit => {
      const c = fixture.units.find(c => c.id === unit.data_unit_id);
      if (!c) return true;
      assert.deepEqual(unit, c.unit); return false;
    })).filter((column, i) => section !== 'premium_vehicles' || column.length || !rank[section][i].some(u => fixture.units.some(c => c.id === u.data_unit_id)));
  }
  return tree;
}
function restoreCatalog(value) {
  const result = require('./apply-modification-update-20261113.cjs').restoreCatalog(value);
  if (!result.aircraftAddition) return result;
  delete result.aircraftAddition;
  for (const c of fixture.units) delete result.vehicles[c.id];
  Object.assign(result.chunks, fixture.previous.chunks); result.stats = fixture.previous.catalogStats;
  return result;
}
function restoreManifest(value) {
  const result = structuredClone(value);
  if (!result.eaglesShadowAircraft) return result;
  delete result.eaglesShadowAircraft; result.unit_count -= fixture.units.length; result.unique_units -= fixture.units.length;
  result.files = result.files.map(f => fixture.previous.manifestFiles.find(p => p.path === f.path) || f);
  return result;
}
function restoreRoster(value) {
  const result = structuredClone(value);
  for (const c of fixture.units) {
    const tree = result.trees[c.country + '/aviation'];
    if (!tree.units[c.id]) continue;
    delete tree.units[c.id]; tree.matched--; tree.gameOnlyCount--;
    if (!tree.gameOnlyCount) delete tree.gameOnlyCount;
    if (c.unit.is_premium) result.acquisitionCounts.pack--;
  }
  return result;
}
module.exports = { restoreTree, restoreCatalog, restoreManifest, restoreRoster };
