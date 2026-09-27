const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { gameRequirements } = require('./modification-requirements.cjs');

const revision = '510a793c2bdb01c51475118199c7b66b72935ff1';
const sourcePath = 'char.vromfs.bin_u/config/wpcost.blkx';
const protectedIds = ['ka_29', 'do_217j_2', 'ca_27_mk32_raaf', 'ca_27_mk32_malaysia'];
const reviewedCountermeasures = new Set([
  'countermeasures_belt_pack', 'MAW_system_heli_false_thermal_targets_large',
  'uk_ltc_bol', 'swd_ltc_bol', 'PIDS_false_thermal_targets',
  'uk_terma_mcp_false_thermal_targets', 'boz_false_thermal_targets',
  'chaff_pods', 'saab_f35_alq_162',
]);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const root = path.resolve(__dirname, '..');

function projections(chunk) {
  const other = structuredClone(chunk);
  const requirements = [];
  for (const id of Object.keys(other.v).sort()) {
    for (const m of [...other.v[id].m].sort((a, b) => a[0].localeCompare(b[0], 'en'))) {
      requirements.push([id, m[0], [...m[10]].sort()]);
      m[10] = [];
    }
  }
  return { requirementsSha256: hash(JSON.stringify(requirements)), otherFieldsSha256: hash(JSON.stringify(other)) };
}

function checkGraph(vehicle) {
  const mods = new Map(vehicle.m.map(m => [m[0], m]));
  const active = new Set(), done = new Set();
  function visit(id) {
    assert(mods.has(id), 'Dangling prerequisite: ' + vehicle.i + ':' + id);
    assert(!active.has(id), 'Cyclic prerequisites: ' + vehicle.i + ':' + id);
    if (done.has(id)) return;
    active.add(id);
    for (const required of mods.get(id)[10]) visit(required);
    active.delete(id);
    done.add(id);
  }
  for (const id of mods.keys()) visit(id);
}

function auditVehicle(vehicle, gameVehicle) {
  assert(gameVehicle?.modifications, 'Missing game vehicle: ' + vehicle.i);
  const mods = gameVehicle.modifications;
  const keys = new Map(Object.keys(mods).map(id => [id.toLowerCase(), id]));
  const visible = new Set(vehicle.m.map(m => m[0]));
  const after = structuredClone(vehicle), changes = [];
  for (const m of after.m) {
    const gameMod = mods[keys.get(m[0].toLowerCase())];
    const expected = gameRequirements(gameMod, visible);
    const removed = m[10].filter(id => !expected.includes(id));
    const added = expected.filter(id => !m[10].includes(id));
    // This migration only removes reviewed layout edges, never imports new rules.
    assert.equal(added.length, 0, 'Unexpected missing real prerequisite: ' + vehicle.i + ':' + m[0]);
    const previous = [gameMod.prevModification].flat().filter(Boolean).map(id => id.toLowerCase());
    assert(removed.every(id => previous.includes(id.toLowerCase())), 'Non-layout dependency requires review: ' + vehicle.i + ':' + m[0]);
    if (removed.length) changes.push({ mod: m[0], removed });
    m[10] = expected;
  }
  checkGraph(after);
  return { after, changes };
}

function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf('--datamine');
  const datamine = inputIndex >= 0 ? path.resolve(args[inputIndex + 1]) : path.join(root, 'logs/datamine');
  const apply = args.includes('--apply');
  const catalogPath = 'database/modifications/catalog.json';
  const bytes = fs.readFileSync(path.join(root, 'public', catalogPath));
  assert(bytes.equals(fs.readFileSync(path.join(root, 'docs', catalogPath))));
  const catalog = JSON.parse(bytes);
  assert.equal(catalog.sources.datamineCommit, revision, 'Snapshot changed; review migration');
  const gameBytes = execFileSync('git', ['show', revision + ':' + sourcePath], { cwd: datamine, maxBuffer: 64 * 1024 * 1024 });
  const game = JSON.parse(gameBytes);
  const gameKeys = new Map(Object.keys(game).map(id => [id.toLowerCase(), id]));
  const report = {
    gameVersion: '2.59.0.17', datamineCommit: revision, sourcePath,
    sourceSha256: hash(gameBytes), examinedVehicles: 0, examinedMods: 0,
    verifiedVehicles: 0, verifiedMods: 0, changedVehicles: 0, removedEdges: 0,
    preserved: [], changes: [], chunks: {}, countermeasures: [],
  };
  const writes = new Map();
  for (const [key, meta] of Object.entries(catalog.chunks)) {
    const beforeBytes = fs.readFileSync(path.join(root, 'public', meta.path));
    assert(beforeBytes.equals(fs.readFileSync(path.join(root, 'docs', meta.path))));
    assert.equal(hash(beforeBytes), meta.sha256, key + ': input checksum');
    const chunk = JSON.parse(beforeBytes), before = projections(chunk);
    let dirty = false;
    for (const vehicle of Object.values(chunk.v)) {
      report.examinedVehicles++;
      report.examinedMods += vehicle.m.length;
      if (protectedIds.includes(vehicle.i)) {
        report.preserved.push({ id: vehicle.i, reason: 'User-confirmed correction; preserved in full', sha256: hash(JSON.stringify(vehicle)) });
        continue;
      }
      const gameVehicle = game[gameKeys.get(vehicle.i.toLowerCase())];
      const { after, changes } = auditVehicle(vehicle, gameVehicle);
      if (key.endsWith('_aviation')) {
        const ids = new Map(Object.keys(gameVehicle.modifications).map(id => [id.toLowerCase(), id]));
        for (const m of after.m.filter(m => reviewedCountermeasures.has(m[0]))) {
          const source = gameVehicle.modifications[ids.get(m[0].toLowerCase())];
          assert.equal(m[2], source.tier, vehicle.i + ':' + m[0] + ': countermeasure tier differs');
          report.countermeasures.push([vehicle.i, m[0], m[2], m[10]]);
        }
      }
      report.verifiedVehicles++;
      report.verifiedMods += vehicle.m.length;
      if (changes.length) {
        dirty = true;
        report.changedVehicles++;
        report.removedEdges += changes.reduce((n, change) => n + change.removed.length, 0);
        report.changes.push({ vehicle: vehicle.i, changes });
      }
      chunk.v[vehicle.i] = after;
    }
    report.chunks[key] = projections(chunk);
    assert.equal(report.chunks[key].otherFieldsSha256, before.otherFieldsSha256, key + ': fields other than prerequisites changed');
    if (dirty) {
      const content = JSON.stringify(chunk) + '\n';
      writes.set(meta.path, content);
      meta.bytes = Buffer.byteLength(content);
      meta.sha256 = hash(content);
    }
  }
  assert.equal(report.preserved.length, protectedIds.length);
  const reportPath = path.join(root, 'logs/modification-prerequisite-audit.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  if (apply) {
    const { changes, ...proof } = report;
    fs.writeFileSync(path.join(root, 'tools/fixtures/modification-prerequisite-audit.json'), JSON.stringify(proof, null, 2) + '\n');
    catalog.prerequisiteAudit = {
      gameVersion: report.gameVersion, datamineCommit: revision, sourcePath,
      verifiedVehicles: report.verifiedVehicles, verifiedMods: report.verifiedMods,
      preservedVehicleIds: protectedIds,
      scope: 'Prerequisites only; costs, tiers, unlock counts and membership unchanged',
    };
    writes.set(catalogPath, JSON.stringify(catalog) + '\n');
    for (const folder of ['public', 'docs']) for (const [file, content] of writes) {
      fs.writeFileSync(path.join(root, folder, file), content);
    }
  }
  console.log(JSON.stringify({ apply, examinedVehicles: report.examinedVehicles, examinedMods: report.examinedMods,
    verifiedVehicles: report.verifiedVehicles, verifiedMods: report.verifiedMods,
    changedVehicles: report.changedVehicles, removedEdges: report.removedEdges, preserved: report.preserved.map(v => v.id) }));
}
if (require.main === module) main();
module.exports = { auditVehicle, projections, checkGraph, protectedIds };
