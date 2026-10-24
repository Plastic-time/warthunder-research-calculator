const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { protectModifications } = require('./modification-refresh-guard.cjs');
const { refreshModifications, parsePresentation } = require('./build-modifications.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const vehicle = () => ({ i: 'test_jet', n: ['Jet', 'Jet'], v: 'jet.png', r: [1, 1, 1],
  c: [['Flight', 'Flight', 1]], t: [100, 200], m: [['engine', 0, 1, 0, 'Engine', 'Engine', 'engine.png', 100, 200, 30, [], 0]] });
const economy = () => ({ needBuyToOpenNextInTier1: 1, needBuyToOpenNextInTier2: 1, needBuyToOpenNextInTier3: 1,
  modifications: { engine: { tier: 1, reqExp: 100, value: 200 } } });
const presentation = () => [{ id: 'engine', en: 'New name', icon: 'new_engine.png', rp: 999, sl: 999, tier: 4, requires: ['invented'] }];

test('only names and icons can refresh, never Wiki prices, tier, prerequisites or layout', () => {
  const old = vehicle(), frozen = structuredClone(old);
  const result = protectModifications(old, presentation(), economy());
  const expected = vehicle(); expected.m[0][5] = 'New name'; expected.m[0][6] = 'new_engine.png';
  assert.deepEqual(result.vehicle, expected);
  assert.deepEqual(old, frozen);
  assert.equal(result.report.updated.length, 2);
});

test('missing or conflicting game fields preserve every reviewed field without Wiki fallback', () => {
  for (const kind of ['missing', 'changed', 'invalid', 'missing-entry', 'missing-tier-gate', 'unknown-prerequisite']) {
    const source = economy();
    if (kind === 'missing') delete source.modifications.engine.reqExp;
    if (kind === 'changed') source.modifications.engine.value = 999;
    if (kind === 'invalid') source.modifications.engine.tier = 0;
    if (kind === 'missing-entry') delete source.modifications.engine;
    if (kind === 'missing-tier-gate') delete source.needBuyToOpenNextInTier2;
    if (kind === 'unknown-prerequisite') source.modifications.engine.reqModification = 'missing';
    const result = protectModifications(vehicle(), presentation(), source);
    assert.deepEqual(result.vehicle, vehicle(), kind);
    assert(result.report.requiresReview, kind);
  }
  const unknown = vehicle(); unknown.m[0][7] = null;
  const result = protectModifications(unknown, presentation(), economy());
  assert.deepEqual(result.vehicle, unknown);
});

test('game and Wiki additions, removals and absent Wiki tables cannot change membership', () => {
  const source = economy(); source.modifications.new_missile = { tier: 3, reqExp: 0, value: 0 };
  for (const incoming of [null, [], [...presentation(), { id: 'invented' }]]) {
    const result = protectModifications(vehicle(), incoming, source);
    assert.deepEqual(result.vehicle, vehicle());
    assert(result.report.requiresReview);
  }
  const result = protectModifications(vehicle(), presentation(), source);
  assert(result.report.conflicts.some(c => c.field === 'new-game-entry'));
  assert.deepEqual(result.vehicle, vehicle());
});

test('explicit zero values stay zero; ordering hints do not become prerequisites', () => {
  const old = vehicle(); old.m[0][7] = 0; old.m[0][8] = 0; old.t = [0, 0];
  const source = economy(); source.modifications.engine = { tier: 1, reqExp: 0, value: 0, prevModification: 'not-a-prerequisite' };
  const result = protectModifications(old, [], source);
  assert.deepEqual(result.vehicle, old);
  assert(!result.report.conflicts.some(c => c.field === 'requires'));
});

test('manual corrections are immutable and invalid presentation cannot introduce remote scripts', () => {
  assert.deepEqual(protectModifications(vehicle(), presentation(), economy(), true).vehicle, vehicle());
  assert.equal(protectModifications(vehicle(), [{ id: 'engine', icon: 'https://untrusted.invalid/a.png' }], economy()).vehicle.m[0][6], 'engine.png');
  assert.throws(() => protectModifications(vehicle(), [...presentation(), ...presentation()], economy()), /Duplicate/);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-mod-refresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, 'source');
  const wikiDirectory = path.join(root, 'wiki');
  fs.mkdirSync(sourceDirectory); fs.mkdirSync(wikiDirectory);
  const cost = JSON.stringify({ test_jet: economy() });
  const commit = 'a'.repeat(40), file = 'char.vromfs.bin_u/config/wpcost.blkx';
  fs.writeFileSync(path.join(sourceDirectory, 'current-wpcost.json'), cost);
  fs.writeFileSync(path.join(sourceDirectory, 'sources.json'), JSON.stringify({ upstream: { commit, version: '2.59.0.73' }, sources: [
    { label: 'current', commit, file, url: `https://raw.githubusercontent.com/gszabi99/War-Thunder-Datamine/${commit}/${file}`, bytes: Buffer.byteLength(cost), sha256: sha(cost) },
  ] }));
  const html = `<table class="game-unit_mods-table"><tr><td><button class="game-unit_mod" data-mod-id="engine" data-feature-popover="&lt;div class='game-unit_popover-header'&gt;&lt;span&gt;New engine&lt;/span&gt;&lt;/div&gt;"></button></td></tr></table>`;
  fs.writeFileSync(path.join(wikiDirectory, 'test_jet.html'), html);
  const bytes = JSON.stringify({ s: 2, k: 'usa_aviation', v: { test_jet: vehicle() } }) + '\n';
  const catalog = { schema: 2, version: 'reviewed-version', sources: { retained: true }, corrections: {},
    stats: { vehicles: 1, modifications: 1, chunks: 1 }, vehicles: { test_jet: 'usa_aviation' },
    chunks: { usa_aviation: { path: 'database/modifications/usa_aviation.json', bytes: Buffer.byteLength(bytes), sha256: sha(bytes), vehicles: 1, modifications: 1 } } };
  const originals = new Map();
  for (const side of ['public', 'docs']) {
    const dir = path.join(root, side, 'database/modifications'); fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of [['usa_aviation.json', bytes], ['catalog.json', JSON.stringify(catalog) + '\n']]) {
      const target = path.join(dir, name); fs.writeFileSync(target, text); originals.set(target, text);
    }
  }
  const unchanged = () => { for (const [file, text] of originals) assert.equal(fs.readFileSync(file, 'utf8'), text); };
  return { root, sourceDirectory, wikiDirectory, originals, unchanged };
}

test('dry run writes only a report; explicit apply retains provenance and synchronized hashes', t => {
  const f = fixture(t);
  assert.equal(refreshModifications(f).applied, false); f.unchanged();
  const report = refreshModifications({ ...f, apply: true });
  assert(report.applied);
  const catalog = JSON.parse(fs.readFileSync(path.join(f.root, 'docs/database/modifications/catalog.json')));
  assert.equal(catalog.version, 'reviewed-version'); assert.deepEqual(catalog.sources, { retained: true });
  for (const name of ['catalog', 'usa_aviation']) assert(fs.readFileSync(path.join(f.root, `docs/database/modifications/${name}.json`)).equals(fs.readFileSync(path.join(f.root, `public/database/modifications/${name}.json`))));
  const bytes = fs.readFileSync(path.join(f.root, catalog.chunks.usa_aviation.path.replace('database/', 'docs/database/')));
  assert.equal(sha(bytes), catalog.chunks.usa_aviation.sha256);
  assert.equal(JSON.parse(bytes).v.test_jet.m[0][7], 100);
  assert.equal(refreshModifications({ ...f, apply: true }).changedFiles, 0, 'Refresh is idempotent');
});

test('missing Wiki preserves existing vehicles; damaged source or snapshot fails before writes', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.wikiDirectory, 'test_jet.html'));
  assert(refreshModifications({ ...f, apply: true }).requiresReview); f.unchanged();
  fs.appendFileSync(path.join(f.sourceDirectory, 'current-wpcost.json'), ' ');
  assert.throws(() => refreshModifications({ ...f, apply: true }), /source size/); f.unchanged();
});

test('partial write failure rolls back both application copies', t => {
  const f = fixture(t), rename = fs.renameSync;
  let calls = 0;
  t.mock.method(fs, 'renameSync', (...args) => { if (++calls === 3) throw new Error('simulated I/O failure'); return rename(...args); });
  assert.throws(() => refreshModifications({ ...f, apply: true }), /simulated I\/O failure/);
  f.unchanged();
});

test('mismatched copies fail before writes and persistent rollback failure is explicit', t => {
  const f = fixture(t);
  const file = path.join(f.root, 'public/database/modifications/usa_aviation.json');
  fs.appendFileSync(file, ' ');
  assert.throws(() => refreshModifications({ ...f, apply: true }), /copies differ/);
  fs.writeFileSync(file, f.originals.get(file));
  const rename = fs.renameSync; let calls = 0;
  t.mock.method(fs, 'renameSync', (...args) => { if (++calls >= 3) throw new Error('persistent I/O failure'); return rename(...args); });
  assert.throws(() => refreshModifications({ ...f, apply: true }), /rollback incomplete/);
  const report = JSON.parse(fs.readFileSync(path.join(f.root, 'logs/modifications-refresh-review.json')));
  assert.equal(report.applied, false); assert.equal(report.rollbackIncomplete, true);
});

test('all shipped vehicles and recorded corrections survive empty/untrusted refresh input', () => {
  const root = path.resolve(__dirname, '..');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/database/modifications/catalog.json')));
  let count = 0;
  for (const meta of Object.values(catalog.chunks)) {
    const chunk = JSON.parse(fs.readFileSync(path.join(root, 'docs', meta.path)));
    for (const [id, raw] of Object.entries(chunk.v)) {
      assert.deepEqual(protectModifications(raw, null, null, Object.hasOwn(catalog.corrections, id)).vehicle, raw);
      count++;
    }
  }
  assert.equal(count, catalog.stats.vehicles);
  assert.equal(count, 3228);
  assert.equal(parsePresentation('<html>unavailable</html>', 'usa_aviation'), null);
});
