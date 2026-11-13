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
test('F-15EX grid matches the in-game modification screen', () => {
  // Rows transcribed from the supplied game screenshot, left to right.
  const rows = [
    ['new_compressor_jet','f_4c_CdMin_Fuse','countermeasures_belt_pack','M60_belt_pack','us_aim_9m','us_sniper_pod','us_jdam'],
    ['f_4c_g_suit','structure_str','asm','M60_new_gun',null,'us_gbu_laser','us_ljdam'],
    ['cd_98','new_cover','us_agm_84h','us_agm_65','us_aim_120b_c','us_apkws','us_gbu_15v1'],
    ['hp_105_jet','air_extinguisher','us_arm','us_agm_130','us_aim_120d','us_agm154_jsow','us_gbu_53'],
  ];
  const mods = read('docs/database/modifications/usa_aviation.json').v.f_15ex;
  assert.deepEqual(mods.c.map(c => c[2]), [2,1,4]);
  const actual = Array.from({length:4}, () => Array(7).fill(null));
  for (const m of mods.m) {
    const offset = mods.c.slice(0,m[1]).reduce((n,c) => n+c[2],0);
    actual[m[2]-1][offset+m[3]] = m[0];
  }
  assert.deepEqual(actual, rows);
});

test('all nine layouts reproduce the pinned game branch relations', () => {
  const { layout } = require('./event-modifications.cjs');
  const source = require('./fixtures/eagles-shadow-layout-20261111.json');
  const categories = ['lth','armor','weapon'];
  assert.equal(source.commit, fixture.commit);
  for (const unit of source.units) {
    const mods = structuredClone(unit.mods);
    const widths = layout(mods, categories);
    const active = categories.filter((_,i) => widths[i] > 0);
    const saved = fixture.units.find(u => u.id === unit.id).modification;
    assert.deepEqual(saved.c.map(c => c[2]), widths.filter(w => w > 0), unit.id);
    assert.deepEqual(saved.m.map(m => [m[0],...m.slice(1,4),m[10]]),
      mods.map(m => [m.id,active.indexOf(m.category),m.tier,m.column,m.requires]), unit.id);
  }
});
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
    const chunk = require('./apply-modification-update-20261113.cjs').restoreChunk(read('docs/' + previous.path));
    for (const c of fixture.units) if (chunk.v[c.id]) {
      assert.deepEqual(chunk.v[c.id], c.modification); delete chunk.v[c.id];
    }
    assert.equal(hash(JSON.stringify(chunk) + '\n'), previous.sha256, previous.path);
  }
});
