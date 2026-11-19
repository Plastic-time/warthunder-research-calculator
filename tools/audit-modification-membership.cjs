const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function visibleMods(unit, definitions) {
  return Object.fromEntries(Object.entries(unit.modifications || {}).filter(([id, cost]) => {
    assert(definitions[id], 'Unknown game modification: ' + id);
    const mod = { ...definitions[id], ...cost };
    return Number.isInteger(mod.tier) && mod.tier >= 1 && mod.tier <= 4 && mod.modClass
      && !mod.isHidden && !(mod.costGold > 0)
      && !(mod.group && (mod.effects?.additiveBulletMod || mod.effects?.bulletMod));
  }));
}

function audit(directory, root = path.resolve(__dirname, '..')) {
  const read = file => JSON.parse(fs.readFileSync(file));
  const version = fs.readFileSync(path.join(directory, 'version'), 'utf8').trim();
  const definitions = read(path.join(directory, 'modifications.blkx')).modifications;
  const units = new Map(Object.entries(read(path.join(directory, 'wpcost.blkx'))).map(([id, unit]) => [id.toLowerCase(), unit]));
  const catalog = read(path.join(root, 'docs/database/modifications/catalog.json'));
  const differences = [];
  let checked = 0;
  for (const [chunk, meta] of Object.entries(catalog.chunks)) {
    const live = read(path.join(root, 'docs', meta.path));
    for (const [id, vehicle] of Object.entries(live.v)) {
      assert.equal(catalog.vehicles[id], chunk);
      const unit = units.get(id.toLowerCase());
      assert(unit, 'Missing economy source: ' + id);
      const visible = visibleMods(unit, definitions);
      const shipped = new Set(vehicle.m.map(mod => mod[0]));
      const missing = Object.keys(visible).filter(mod => !shipped.has(mod));
      const obsolete = [...shipped].filter(mod => !Object.hasOwn(visible, mod));
      if (missing.length || obsolete.length) differences.push({ id, missing, obsolete });
      checked++;
    }
  }
  assert.equal(checked, Object.keys(catalog.vehicles).length);
  const components = new Set();
  const manifest = read(path.join(root, 'docs/database/manifest.json'));
  for (const file of manifest.files) {
    if (!/^database\/(\w+)\/\1_\w+\.json$/.test(file.path)) continue;
    for (const rank of read(path.join(root, 'docs', file.path))) {
      for (const item of [...rank.researchable_vehicles.flat(), ...rank.premium_vehicles.flat()]) {
        for (const unit of item.items || [item]) {
          if (catalog.vehicles[unit.data_unit_id]) continue;
          assert(unit.is_component && catalog.vehicles[unit.component_of], 'Missing vehicle tree: ' + unit.data_unit_id);
          components.add(unit.data_unit_id);
        }
      }
    }
  }
  return { version, checked, componentsWithoutIndependentTrees: components.size, differences };
}

if (require.main === module) {
  const result = audit(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
  if (result.differences.length) process.exitCode = 1;
}
module.exports = { audit, visibleMods };
