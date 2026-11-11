const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fixture = require('../config/eagles-shadow-aircraft.json');
const { wikiUnits } = require('./audit-datamine-roster.cjs');
const root = path.resolve(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p)));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
for (const c of fixture.units) test(`${c.id}: aircraft, prices, prerequisites and modification tree are available`, () => {
  const file = `database/${c.country}/${c.country}_aviation.json`;
  const tree = read('docs/' + file), unit = wikiUnits(tree).get(c.id);
  assert(unit, 'Missing new aircraft'); assert.deepEqual(unit, c.unit);
  assert.deepEqual(read(file), tree);
  const meta = read('docs/database/manifest.json').files.find(f => f.path === file);
  assert.equal(meta.sha256, hash(fs.readFileSync(path.join(root, file))));
  if (!unit.is_premium) assert(wikiUnits(tree).has(unit.required_unit_id), 'Prerequisite must exist');
  else { assert.equal(unit.rp, 0); assert.equal(unit.sp, 0); assert.equal(unit.required_unit_id, ''); }
  const cat = read('docs/database/modifications/catalog.json');
  assert(cat.vehicles[c.id]); const chunkMeta = cat.chunks[cat.vehicles[c.id]];
  assert.equal(chunkMeta.sha256, hash(fs.readFileSync(path.join(root, 'docs', chunkMeta.path))));
  const mods = read('docs/' + chunkMeta.path).v[c.id];
  assert.deepEqual(mods, c.modification); assert.deepEqual(read('public/' + chunkMeta.path).v[c.id], mods);
  assert.deepEqual(mods.t, mods.m.reduce((s,m)=>[s[0]+m[7],s[1]+m[8]],[0,0]));
  const ids = new Set(mods.m.map(m=>m[0])), cells = new Set();
  for (const m of mods.m) {
    for (const prerequisite of m[10]) assert(ids.has(prerequisite));
    for (const n of m.slice(7,10)) assert(Number.isInteger(n) && n >= 0);
    const cell = m.slice(1,4).join(':'); assert(!cells.has(cell), 'Overlapping modification cells'); cells.add(cell);
  }
  assert.deepEqual(read('docs/vehicle-names.json').names[c.id], c.names);
});
test('new ordinary aircraft retain their game research prices', () => {
  assert.deepEqual(fixture.units.filter(c=>!c.unit.is_premium).map(c=>[c.id,c.unit.rp,c.unit.sp]), [
    ['f_15ex',400000,1080000],['su_15tm',190000,530000],['fulmar_mk2',5900,6300],
    ['firefly_mk1_thailand',18000,47000],['b_33_indonesia',63000,200000],['f_15ia',400000,1080000],
  ]);
});
test('every pre-existing aircraft and modification remains unchanged', () => {
  const { restoreTree } = require('./aircraft-addition-snapshot.cjs');
  for (const previous of fixture.previous.manifestFiles) {
    const tree = restoreTree(read('docs/' + previous.path));
    assert.equal(hash(JSON.stringify(tree, null, 2) + '\n'), previous.sha256, previous.path);
  }
  for (const previous of Object.values(fixture.previous.chunks)) {
    const chunk = read('docs/' + previous.path);
    for (const c of fixture.units) if (chunk.v[c.id]) {
      assert.deepEqual(chunk.v[c.id], c.modification); delete chunk.v[c.id];
    }
    assert.equal(hash(JSON.stringify(chunk) + '\n'), previous.sha256, previous.path);
  }
});
