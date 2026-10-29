const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { wikiUnits } = require('./audit-datamine-roster.cjs');
const { patchCosts, restoreCosts, verifyDelta, verifySources } = require('./apply-vehicle-cost-update.cjs');
const evidence = require('../config/vehicle-cost-update.json');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const tree = require('../docs/database/japan/japan_aviation.json');

test('October 29 vehicle RP and Silver Lion prices match the pinned game configuration', () => {
  const units = wikiUnits(tree);
  for (const [id, rp, sl] of [['p1y1_mod11', 26000, 76000], ['b7a2', 33000, 105000], ['ki_93_1_ko', 40000, 135000]]) {
    assert.equal(units.get(id).rp, rp, id + ': RP');
    assert.equal(units.get(id).sp, sl, id + ': SL');
  }
});

test('research already invested is preserved when the total cost changes', () => {
  const { remaining } = require('../public/research-progress.js');
  assert.equal(remaining(wikiUnits(tree).get('p1y1_mod11').rp, 10000), 16000);
  assert.equal(remaining(wikiUnits(tree).get('b7a2').rp, 40000), 0);
  assert.equal(remaining(null, 10000), null);
});

test('all 50 trees retain every field outside the three verified RP/SL corrections', () => {
  const manifest = read('docs/database/manifest.json');
  let changed = 0;
  assert.deepEqual(manifest.vehicleCosts.ids, Object.keys(evidence.units).sort());
  assert.equal(manifest.vehicleCosts.fullSnapshotUpgrade, false);
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, 'docs', file.path));
    assert(bytes.equals(fs.readFileSync(path.join(root, file.path))), file.path);
    assert.equal(hash(bytes), file.sha256);
    const current = JSON.parse(bytes), previous = restoreCosts(current);
    assert.equal(hash(JSON.stringify(previous, null, 2) + '\n'), evidence.trees[file.path], file.path);
    assert.deepEqual(patchCosts(previous), current);
    for (const [id, unit] of wikiUnits(current)) {
      if (!evidence.units[id]) { assert(!unit.game_costs); continue; }
      assert.deepEqual(unit.game_costs, { version: evidence.version, commit: evidence.commit,
        ...evidence.units[id].after, provenance: 'config/vehicle-cost-update.json' });
      changed++;
    }
    file.sha256 = evidence.trees[file.path];
  }
  delete manifest.vehicleCosts;
  assert.equal(hash(JSON.stringify(manifest, null, 2) + '\n'), evidence.manifestSha256);
  assert.equal(changed, 3);
});

test('historical modification baseline and Wiki evidence remain verifiable after the separate modification update', () => {
  const bytes = fs.readFileSync(path.join(root, 'docs/database/modifications/catalog.json'));
  const previous = require('./apply-modification-update.cjs').restoreCatalog(JSON.parse(bytes));
  assert.equal(hash(JSON.stringify(previous) + '\n'), evidence.modificationCatalogSha256);
  assert(bytes.equals(fs.readFileSync(path.join(root, 'public/database/modifications/catalog.json'))));
  for (const chunk of Object.values(JSON.parse(bytes).chunks)) {
    for (const prefix of ['docs/', 'public/']) assert.equal(hash(fs.readFileSync(path.join(root, prefix + chunk.path))), chunk.sha256);
  }
  for (const [id, entry] of Object.entries(evidence.units)) {
    const unit = wikiUnits(tree).get(id);
    assert.equal(Number(unit.wiki.research.replaceAll(',', '')), entry.before.rp);
    assert.equal(Number(unit.wiki.purchase.replaceAll(',', '')), entry.before.sl);
  }
});

test('updates reject unknown prices, non-SL purchases, special vehicles and already-patched data', () => {
  const previous = restoreCosts(tree);
  assert.deepEqual(restoreCosts(patchCosts(previous)), previous);
  assert.throws(() => patchCosts(tree), /already applied/);
  for (const mutate of [
    unit => { unit.rp = null; }, unit => { unit.sp = null; },
    unit => { unit.wiki.purchase_currency = 'GE'; },
    ...['is_premium', 'is_squadron', 'is_component'].map(key => unit => { unit[key] = true; })
  ]) {
    const invalid = structuredClone(previous);
    mutate(wikiUnits(invalid).get('p1y1_mod11'));
    assert.throws(() => patchCosts(invalid));
  }
  for (const invalid of [undefined, null, -1, '26000', 1.5, Infinity]) {
    const bad = structuredClone(evidence); bad.units.p1y1_mod11.after.rp = invalid;
    assert.throws(() => patchCosts(previous, bad), /invalid costs/);
  }
  assert(!wikiUnits(previous).get('p1y1_mod11').game_costs, 'Caller data is not mutated');
});

test('pinned cost delta rejects missing sources, price mismatches and unreviewed changes', () => {
  const source = side => Object.fromEntries(Object.entries(evidence.units).map(([id, item]) =>
    [id, { reqExp: item[side].rp, value: item[side].sl }]));
  const previous = source('before'), current = source('after');
  verifyDelta(previous, current, evidence);
  assert.throws(() => verifySources(null), /Provide/);
  for (const mutate of [
    data => { data.p1y1_mod11.reqExp++; }, data => { delete data.p1y1_mod11.value; },
    data => { delete data.b7a2; }, data => { data.extra.value++; }
  ]) {
    const old = { ...structuredClone(previous), extra: { reqExp: 100, value: 200 } };
    const next = { ...structuredClone(current), extra: { reqExp: 100, value: 200 } };
    mutate(next);
    assert.throws(() => verifyDelta(old, next, evidence));
  }
});
