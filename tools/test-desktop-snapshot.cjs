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
const review = version.latestReview;
assert.equal(review.gameVersion, catalog.eventModifications.version);
assert.equal(review.gameDataCommit, catalog.eventModifications.commit);
assert.equal(review.fullSnapshotUpgrade, false);
assert(fs.readFileSync(path.join(root, review.provenance), 'utf8').includes(review.gameDataCommit));
const compareVersion = (a, b) => {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if ((aa[i] || 0) !== (bb[i] || 0)) return (aa[i] || 0) - (bb[i] || 0);
  }
  return 0;
};
for (const source of [version.gameVersion, correction.gameVersion, version.rosterAddition.version])
  assert(compareVersion(review.gameVersion, source) >= 0, 'Displayed review version must not lag published updates');
for (const [file, label] of [['README.md', '最新核对版本'], ['README.en.md', 'Latest reviewed version']]) {
  const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
  const current = lines.filter(line => line.startsWith(`- **${label}**`));
  assert.equal(current.length, 1, file + ': exactly one current review summary');
  assert.deepEqual(current[0].match(/\b\d+\.\d+\.\d+\.\d+\b/g), [review.gameVersion],
    file + ': current summary must match the reviewed data version');
}
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
    } else if (reviewed.scope === 'reviewed-modification-update') {
      const fixture = require('./fixtures/october-modifications.json');
      assert.equal(reviewed.gameDataCommit, fixture.datamineCommit);
      assert.deepEqual(vehicle, require('./update-october-modifications.cjs').correctOctober(fixture.vehicles[id].previous));
      assert.deepEqual(vehicle.t, reviewed.vehicleTotals[id]);
      assert.equal(recorded.provenance, reviewed.provenance);
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
  assert.equal($('[data-game-version]').text(), review.gameVersion);
  assert($('.game-version').attr('data-i18n-title').includes(review.gameVersion));
  assert($('.game-version').attr('title').includes('不代表全量升级'));
  assert($('[data-game-version]').closest('.topbar').length, 'Version must stay outside the scrollable tree');
  assert.equal($('[data-game-correction]').length, 0);
  assert.equal($('.game-version [data-i18n="游戏版本"]').length, 1);
  assert.equal($('.game-version [data-i18n="基础"]').length, 0);
  assert.equal($('.game-version [data-i18n="局部修正"]').length, 0);
  assert.equal($('[data-game-correction-scope]').length, 1);
  for (const name of ['Bf 109 E-3', 'Jagdpanther G2', 'S-706']) assert($('[data-game-correction-scope]').text().includes(name));
  assert($('[data-game-correction-scope]').text().includes(review.gameVersion));
  assert($('[data-game-correction-scope]').text().includes('仅更新这三辆，不改其他载具数据'));
  // Historical changelog entries retain their original source versions.
  $('script, style, #usageGuideChangelog').remove();
  const currentCopy = [$('body').text()];
  $('[title], [data-i18n-title]').each((_, element) => {
    currentCopy.push($(element).attr('title') || '', $(element).attr('data-i18n-title') || '');
  });
  const displayedVersions = currentCopy.join('\n').match(/\b\d+\.\d+\.\d+\.\d+\b/g) || [];
  assert(displayedVersions.length > 0, folder + ': current version must remain visible');
  assert.deepEqual([...new Set(displayedVersions)], [review.gameVersion],
    folder + ': current page copy must not display stale game versions');
}
assert.equal(require('../dict/unlock_quantity').get_unlock_quantity('israel', 'aviation', 'VIII'), 3);
console.log(JSON.stringify({ trees: manifest.files.length, units: units.size, gameVersion: version.gameVersion,
  desktopWebIdentical: true, costsAndExclusions: true, cornerLabel: true }));
