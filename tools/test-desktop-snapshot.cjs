const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { wikiUnits } = require('./audit-datamine-roster.cjs');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const manifest = read('docs/database/manifest.json');
const version = read('config/data-version.json');
const catalog = read('public/database/modifications/catalog.json');
const correction = version.latestCorrection;
assert.equal(correction.fullSnapshotUpgrade, false);
assert.notEqual(correction.gameVersion, version.gameVersion);
assert.equal(catalog.version, version.gameVersion);
assert.equal(catalog.sources.datamineCommit, version.gameDataCommit);
for (const reviewed of [...(version.previousCorrections || []), correction]) {
  assert.equal(reviewed.fullSnapshotUpgrade, false);
  for (const id of reviewed.vehicleIds) {
    const recorded = catalog.corrections[id];
    assert.equal(recorded.gameVersion, reviewed.gameVersion);
    assert.equal(recorded.datamineCommit, reviewed.gameDataCommit);
    const meta = catalog.chunks[catalog.vehicles[id]];
    const vehicle = read('public/' + meta.path).v[id];
    if (reviewed.scope === 'modification-purchase-cost') {
      assert.equal(recorded.modificationId, reviewed.modificationId);
      assert.equal(recorded.sl, reviewed.silverLions);
      assert.equal(vehicle.m.find(m => m[0] === reviewed.modificationId)[8], reviewed.silverLions);
    } else {
      assert.equal(reviewed.scope, 'modification-costs-tiers-and-unlock-counts');
      assert.deepEqual(vehicle.t, [reviewed.researchPoints, reviewed.silverLions]);
      assert.deepEqual(vehicle.t, vehicle.m.reduce((sum, m) => [sum[0] + m[7], sum[1] + m[8]], [0, 0]));
      assert.equal(recorded.provenance, reviewed.provenance);
    }
  }
  assert(fs.readFileSync(path.join(root, reviewed.provenance), 'utf8').includes(reviewed.gameDataCommit));
}
const units = new Map();
for (const entry of manifest.files) {
  const desktop = fs.readFileSync(path.join(root, entry.path));
  const web = fs.readFileSync(path.join(root, 'docs', entry.path));
  assert(desktop.equals(web), entry.path + ': desktop and web snapshots must match');
  assert.equal(crypto.createHash('sha256').update(web).digest('hex'), entry.sha256);
  for (const [id, unit] of wikiUnits(JSON.parse(desktop))) {
    assert(!units.has(id), id + ': duplicate');
    units.set(id, unit);
    if (unit.is_premium || unit.is_squadron || unit.is_component) {
      assert.equal(unit.rp, 0); assert.equal(unit.sp, 0);
    }
  }
}
assert.equal(units.size, version.vehicleCount);
assert.equal(manifest.files.length, version.treeCount);
assert.equal(units.get('us_m1a2_abrams').rp, 350000);
assert.equal(units.get('us_m1a2_abrams').sp, 950000);
assert.equal(units.get('jp_type_5_ho_ri_production').rp, null);
assert.equal(units.get('jp_type_5_ho_ri_production').sp, null);
assert(units.has('j_16'));
assert(units.has('rafale_eg_greece'));
for (const folder of ['public', 'docs']) {
  const $ = cheerio.load(fs.readFileSync(path.join(root, folder, 'index.html'), 'utf8'));
  assert.equal($('[data-game-version]').length, 1);
  assert.equal($('[data-game-version]').text(), correction.gameVersion);
  assert($('[data-game-version]').closest('.topbar').length, 'Version must stay outside the scrollable tree');
  assert.equal($('[data-game-correction]').length, 0);
  assert.equal($('.game-version [data-i18n="游戏版本"]').length, 1);
  assert.equal($('.game-version [data-i18n="基础"]').length, 0);
  assert.equal($('.game-version [data-i18n="局部修正"]').length, 0);
  assert.equal($('[data-game-correction-scope]').length, 1);
  assert($('[data-game-correction-scope]').text().includes('F4U-7'));
  assert($('[data-game-correction-scope]').text().includes(correction.gameVersion));
  assert($('[data-game-correction-scope]').text().includes('不代表全量升级'));
}
assert.equal(require('../dict/unlock_quantity').get_unlock_quantity('israel', 'aviation', 'VIII'), 3);
console.log(JSON.stringify({ trees: manifest.files.length, units: units.size, gameVersion: version.gameVersion,
  desktopWebIdentical: true, costsAndExclusions: true, cornerLabel: true }));
