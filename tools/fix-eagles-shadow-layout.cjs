// Rebuild only presentation coordinates from pinned game layout fields.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { layout } = require('./event-modifications.cjs');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
const source = read('tools/fixtures/eagles-shadow-layout-20261111.json');
const fixture = read('config/eagles-shadow-aircraft.json');
const catalog = read('public/database/modifications/catalog.json');
const categories = ['lth', 'armor', 'weapon'];
const writes = new Map(), chunks = new Map();
assert.equal(source.commit, fixture.commit);
for (const unit of source.units) {
  const target = fixture.units.find(u => u.id === unit.id);
  assert(target);
  const mods = structuredClone(unit.mods), widths = layout(mods, categories);
  const active = categories.filter((_, i) => widths[i] > 0);
  const packed = target.modification;
  // Category labels are keyed by the original three game classes; a previously
  // removed empty class must not shift labels on repeated runs.
  const labels = fixture.units.find(u => u.id === 'f_15ex').modification.c;
  packed.c = active.map(c => [...labels[categories.indexOf(c)].slice(0,2), widths[categories.indexOf(c)]]);
  assert.equal(packed.m.length, mods.length);
  for (const [i, m] of mods.entries()) {
    const saved = packed.m[i];
    assert.equal(saved[0], m.id); assert.equal(saved[2], m.tier);
    assert.deepEqual(saved[10], m.requires);
    saved[1] = active.indexOf(m.category); saved[3] = m.column;
  }
  const key = catalog.vehicles[unit.id], meta = catalog.chunks[key];
  if (!chunks.has(key)) chunks.set(key, read('public/' + meta.path));
  chunks.get(key).v[unit.id] = packed;
}
writes.set('config/eagles-shadow-aircraft.json', JSON.stringify(fixture,null,2)+'\n');
for (const [key, chunk] of chunks) {
  const bytes = JSON.stringify(chunk)+'\n', meta = catalog.chunks[key];
  meta.bytes = Buffer.byteLength(bytes);
  meta.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  for (const prefix of ['public/', 'docs/']) writes.set(prefix+meta.path, bytes);
}
for (const prefix of ['public/', 'docs/']) writes.set(prefix+'database/modifications/catalog.json', JSON.stringify(catalog)+'\n');
let changed = 0;
for (const [file, bytes] of writes) {
  if (fs.readFileSync(path.join(root,file),'utf8') === bytes) continue;
  assert(process.argv.includes('--apply'), 'Layout differs: '+file+' (use --apply to write)');
  fs.writeFileSync(path.join(root,file), bytes); changed++;
}
console.log(`${source.units.length} aircraft layouts checked; ${changed} files updated`);
