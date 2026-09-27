const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = require('./fixtures/rafale-modification-requirements.json');
const { gameRequirements } = require('./modification-requirements.cjs');
const vehicleIds = Object.keys(source.vehicles);
const correction = {
  gameVersion: source.gameVersion, datamineCommit: source.datamineCommit, sourcePath: source.sourcePath,
  scope: 'Rafale modification prerequisites only; prices, tiers and membership unchanged',
  confirmation: 'Rafale C and EG in-game screenshots supplied by user; game UI uses reqModification for arrows and unlock checks, prevModification for layout',
  provenance: 'doc/rafale-prerequisites.md',
};

function correctRafale(vehicle) {
  if (!vehicleIds.includes(vehicle.i)) return vehicle;
  const mods = source.vehicles[vehicle.i];
  assert.deepEqual(vehicle.m.map(m => m[0]).sort(), Object.keys(mods).sort(), 'Rafale membership changed; review correction');
  const result = structuredClone(vehicle);
  const visible = new Set(result.m.map(m => m[0]));
  for (const mod of result.m) {
    assert.equal(mod[2], mods[mod[0]].tier, 'Rafale tier changed; review correction');
    mod[10] = gameRequirements(mods[mod[0]], visible);
  }
  return result;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const catalogPath = 'database/modifications/catalog.json';
  const raw = fs.readFileSync(path.join(root, 'docs', catalogPath));
  assert(raw.equals(fs.readFileSync(path.join(root, 'public', catalogPath))));
  const catalog = JSON.parse(raw), chunks = new Map(), writes = new Map(), removed = [];
  for (const id of vehicleIds) {
    const meta = catalog.chunks[catalog.vehicles[id]];
    if (!chunks.has(meta.path)) {
      const bytes = fs.readFileSync(path.join(root, 'docs', meta.path));
      assert(bytes.equals(fs.readFileSync(path.join(root, 'public', meta.path))));
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), meta.sha256);
      chunks.set(meta.path, JSON.parse(bytes));
    }
    const chunk = chunks.get(meta.path), before = chunk.v[id], after = correctRafale(before);
    for (let i = 0; i < before.m.length; i++) {
      for (const req of before.m[i][10]) if (!after.m[i][10].includes(req)) removed.push(id + ':' + req + '->' + before.m[i][0]);
    }
    chunk.v[id] = after;
    catalog.corrections = { ...catalog.corrections, [id]: correction };
  }
  for (const [file, chunk] of chunks) {
    const content = JSON.stringify(chunk) + '\n';
    const meta = catalog.chunks[chunk.k];
    meta.bytes = Buffer.byteLength(content);
    meta.sha256 = crypto.createHash('sha256').update(content).digest('hex');
    writes.set(file, content);
  }
  writes.set(catalogPath, JSON.stringify(catalog) + '\n');
  for (const folder of ['docs', 'public']) for (const [file, content] of writes) fs.writeFileSync(path.join(root, folder, file), content);
  console.log(JSON.stringify({ vehicles: vehicleIds, removedEdges: removed.length, removed }));
}
if (require.main === module) main();
module.exports = { correctRafale, correction, vehicleIds };
