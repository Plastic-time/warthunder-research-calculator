const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const fixture = require('../config/eagles-shadow-aircraft.json');
const { wikiUnits } = require('./audit-datamine-roster.cjs');
const root = path.resolve(__dirname, '..');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p)));

function apply() {
  const writes = new Map();
  const put = (p, v, pretty = false) => writes.set(p, JSON.stringify(v, null, pretty ? 2 : undefined) + '\n');
  const manifest = read('docs/database/manifest.json');
  const catalog = read('docs/database/modifications/catalog.json');
  const roster = read('docs/roster-audit.json');
  const names = read('docs/vehicle-names.json');
  const version = read('config/data-version.json');
  const trees = new Map(), chunks = new Map();
  assert(!manifest.eaglesShadowAircraft, 'Aircraft already added');
  for (const c of fixture.units) {
    const key = c.country + '_aviation', file = `database/${c.country}/${key}.json`;
    if (!trees.has(file)) {
      const bytes = fs.readFileSync(path.join(root, 'docs', file));
      assert(bytes.equals(fs.readFileSync(path.join(root, file))));
      assert.equal(hash(bytes), manifest.files.find(f => f.path === file).sha256);
      trees.set(file, JSON.parse(bytes));
    }
    const tree = trees.get(file), unit = structuredClone(c.unit);
    assert(!wikiUnits(tree).has(c.id), 'Duplicate aircraft');
    const rank = tree.find(r => r.rank === unit.rank);
    assert(rank, 'Missing aircraft rank');
    if (unit.is_premium) rank.premium_vehicles.push([unit]);
    else {
      assert(Number.isInteger(unit.rp) && unit.rp > 0 && Number.isInteger(unit.sp) && unit.sp > 0);
      let column, parentIndex = -1;
      for (const row of tree) row.researchable_vehicles.forEach((col, i) => col.forEach((item, j) => {
        if (wikiUnits(item).has(unit.required_unit_id)) { column = i; if (row === rank) parentIndex = j; }
      }));
      assert(Number.isInteger(column), 'Missing prerequisite placement: ' + c.id);
      while (rank.researchable_vehicles.length <= column) rank.researchable_vehicles.push([]);
      // New entries at the start of a rank precede its existing aircraft; same-rank entries follow their parent/folder.
      rank.researchable_vehicles[column].splice(parentIndex + 1, 0, unit);
    }
    const audit = roster.trees[c.country + '/aviation'];
    audit.units[c.id] = { title: unit.title, category: unit.is_premium ? 'premium-pack' : 'standard', matched: true,
      hidden: false, evidence: { id: c.id, rank: ['','I','II','III','IV','V','VI','VII','VIII','IX'].indexOf(unit.rank) },
      ...(unit.is_premium ? { acquisition: { type: 'pack', provenance: { kind: 'official-announcement', url: fixture.official } } } : {}) };
    audit.matched++; audit.gameOnlyCount = (audit.gameOnlyCount || 0) + 1;
    if (unit.is_premium) roster.acquisitionCounts.pack++;
    names.names[c.id] = c.names; names.keys[c.id] = c.nameKey; names.count++;
    for (const [locale, coverage] of Object.entries(names.coverage.languages)) {
      coverage.source++; if (locale !== 'en' && c.names[locale] === c.names.en) coverage.sameAsEnglish++;
    }
    const meta = catalog.chunks[key];
    if (!chunks.has(key)) {
      const bytes = fs.readFileSync(path.join(root, 'docs', meta.path));
      assert(bytes.equals(fs.readFileSync(path.join(root, 'public', meta.path))));
      assert.equal(hash(bytes), meta.sha256); chunks.set(key, JSON.parse(bytes));
    }
    assert(!catalog.vehicles[c.id]);
    chunks.get(key).v[c.id] = c.modification; catalog.vehicles[c.id] = key;
  }
  for (const [file, tree] of trees) {
    put(file, tree, true); put('docs/' + file, tree, true);
    const entry = manifest.files.find(f => f.path === file);
    entry.sha256 = hash(writes.get(file)); entry.units = wikiUnits(tree).size;
  }
  for (const [key, chunk] of chunks) {
    const meta = catalog.chunks[key]; put('docs/' + meta.path, chunk); put('public/' + meta.path, chunk);
    const bytes = writes.get('docs/' + meta.path);
    meta.sha256 = hash(bytes); meta.bytes = Buffer.byteLength(bytes); meta.vehicles = Object.keys(chunk.v).length;
    meta.modifications = Object.values(chunk.v).reduce((n, v) => n + v.m.length, 0);
  }
  const count = fixture.units.length;
  manifest.unit_count += count; manifest.unique_units += count; version.vehicleCount += count;
  const source = { version: fixture.version, commit: fixture.commit, ids: fixture.units.map(c => c.id),
    provenance: 'config/eagles-shadow-aircraft.json', fullSnapshotUpgrade: false };
  manifest.eaglesShadowAircraft = source; version.aircraftAddition = source; catalog.aircraftAddition = source;
  version.latestReview = { gameVersion: fixture.version, gameDataCommit: fixture.commit,
    scope: 'partial-aircraft-additions', fullSnapshotUpgrade: false, provenance: source.provenance };
  catalog.stats.treeUnits += count; catalog.stats.vehicles += count;
  catalog.stats.modifications = Object.values(catalog.chunks).reduce((n, c) => n + c.modifications, 0);
  put('docs/database/manifest.json', manifest, true); put('config/data-version.json', version, true);
  for (const dir of ['public', 'docs']) {
    put(dir + '/vehicle-names.json', names); put(dir + '/roster-audit.json', roster);
    put(dir + '/database/modifications/catalog.json', catalog);
  }
  for (const [file, bytes] of writes) fs.writeFileSync(path.join(root, file), bytes);
  console.log(`Added ${count} aircraft and ${fixture.units.reduce((n,c)=>n+c.modification.m.length,0)} modifications.`);
}
if (require.main === module) apply();
module.exports = { apply };
