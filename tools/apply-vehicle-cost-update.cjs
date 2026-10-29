const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { wikiUnits } = require('./audit-datamine-roster.cjs');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const cost = unit => ({ rp: unit.reqExp, sl: unit.value });
const valid = value => Number.isSafeInteger(value) && value >= 0;
const validCosts = value => value && valid(value.rp) && valid(value.sl);

function verifyDelta(previous, current, evidence) {
  const changed = Object.keys(current).filter(id => previous[id]
    && (previous[id].reqExp !== current[id].reqExp || previous[id].value !== current[id].value));
  assert.deepEqual(changed.sort(), Object.keys(evidence.units).sort(), 'Unreviewed vehicle cost delta');
  for (const [id, entry] of Object.entries(evidence.units)) {
    assert(previous[id] && current[id], 'Missing source vehicle: ' + id);
    assert.deepEqual(cost(previous[id]), entry.before, 'Previous source costs: ' + id);
    assert.deepEqual(cost(current[id]), entry.after, 'Current source costs: ' + id);
    assert(validCosts(entry.before) && validCosts(entry.after), 'Missing or invalid costs');
  }
}

function verifySources(directory, evidence = read('config/vehicle-cost-update.json')) {
  assert(directory, 'Provide --source-dir');
  const sources = {};
  for (const source of evidence.sources) {
    const bytes = fs.readFileSync(path.join(directory, source.localFile));
    assert.equal(bytes.length, source.bytes, 'Source length mismatch');
    assert.equal(hash(bytes), source.sha256, 'Source hash mismatch');
    assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), source.gitBlob, 'Git blob mismatch');
    sources[source.role] = JSON.parse(bytes);
  }
  assert(sources.previous && sources.current, 'Both pinned sources are required');
  verifyDelta(sources.previous, sources.current, evidence);
  return { verified: true, units: Object.keys(evidence.units).length };
}

function patchCosts(tree, evidence = read('config/vehicle-cost-update.json')) {
  const result = structuredClone(tree);
  for (const [id, unit] of wikiUnits(result)) {
    const entry = evidence.units[id];
    if (!entry) continue;
    assert(!unit.is_premium && !unit.is_squadron && !unit.is_component, 'Only ordinary vehicles are approved');
    assert.equal(unit.wiki?.purchase_currency, 'SL', 'Unverified purchase currency');
    assert(!unit.game_costs, 'Cost update already applied');
    assert.deepEqual({ rp: unit.rp, sl: unit.sp }, entry.before, 'Unexpected pre-update costs');
    assert(validCosts(entry.before) && validCosts(entry.after), 'Missing or invalid costs');
    unit.rp = entry.after.rp; unit.sp = entry.after.sl;
    unit.game_costs = { version: evidence.version, commit: evidence.commit,
      ...entry.after, provenance: 'config/vehicle-cost-update.json' };
  }
  return result;
}

// Reverse only this reviewed price correction when checking older immutable snapshots.
function restoreCosts(tree, evidence = read('config/vehicle-cost-update.json')) {
  const result = structuredClone(tree);
  for (const [id, unit] of wikiUnits(result)) if (evidence.units[id] && unit.game_costs) {
    unit.rp = evidence.units[id].before.rp; unit.sp = evidence.units[id].before.sl;
    delete unit.game_costs;
  }
  return result;
}

function apply(directory, write = false) {
  const evidence = read('config/vehicle-cost-update.json');
  verifySources(directory, evidence);
  const manifest = read('docs/database/manifest.json'), writes = new Map(), found = new Set();
  assert.equal(hash(fs.readFileSync(path.join(root, 'docs/database/manifest.json'))), evidence.manifestSha256, 'Unexpected baseline manifest');
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, file.path));
    assert(bytes.equals(fs.readFileSync(path.join(root, 'docs', file.path))), 'Runtime mirrors differ');
    assert.equal(hash(bytes), file.sha256, 'Manifest hash mismatch');
    const tree = JSON.parse(bytes), updated = patchCosts(tree, evidence);
    for (const id of wikiUnits(tree).keys()) if (evidence.units[id]) { assert(!found.has(id)); found.add(id); }
    if (JSON.stringify(tree) === JSON.stringify(updated)) continue;
    assert.deepEqual(restoreCosts(updated, evidence), tree, 'Non-cost data changed');
    const next = JSON.stringify(updated, null, 2) + '\n';
    file.sha256 = hash(next);
    writes.set(file.path, next); writes.set('docs/' + file.path, next);
  }
  assert.equal(found.size, Object.keys(evidence.units).length, 'Not all reviewed vehicles were found');
  manifest.vehicleCosts = { version: evidence.version, commit: evidence.commit, scope: evidence.scope,
    ids: [...found].sort(), provenance: 'config/vehicle-cost-update.json', fullSnapshotUpgrade: false };
  writes.set('docs/database/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  if (write) for (const [file, bytes] of writes) fs.writeFileSync(path.join(root, file), bytes);
  return { applied: write, units: found.size, files: writes.size };
}
if (require.main === module) {
  try {
    const at = process.argv.indexOf('--source-dir');
    assert(at >= 0 && process.argv[at + 1], 'Provide --source-dir');
    console.log(JSON.stringify(apply(process.argv[at + 1], process.argv.includes('--apply'))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { patchCosts, restoreCosts, verifyDelta, verifySources };
