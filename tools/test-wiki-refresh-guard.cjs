const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { protectWikiTree } = require('../src/wiki-refresh-guard');
const { applyWikiPresentation } = require('./apply-wiki-presentation.cjs');

const unit = (id, extra = {}) => ({ type: 'single', data_unit_id: id, title: 'Existing name',
  vehicle_icon: 'https://static.encyclopedia.warthunder.com/slots/old.png', main_role: 'Fighter',
  rp: 12000, sp: 14000, required_unit_id: '', rank: 'I', br: '1.0', details: true, ...extra });
const tree = (...units) => [{ rank: 'I', unlock_quantity: 6, source: 'reviewed',
  researchable_vehicles: [units], premium_vehicles: [] }];
const first = value => value[0].researchable_vehicles[0][0];
const sha = content => createHash('sha256').update(content).digest('hex');

test('Wiki can only refresh allowed presentation fields, never reviewed gameplay or provenance', () => {
  const previous = tree(unit('ca_27_mk32_raaf', { wiki: { purchase: '14,000', fetched_at: 'old' }, correction: { source: 'in-game' } }));
  const frozen = structuredClone(previous);
  const incoming = tree(unit('ca_27_mk32_raaf', { title: 'Updated name', vehicle_icon: 'https://static.encyclopedia.warthunder.com/slots/new.png', main_role: 'Jet fighter',
    rp: 0, sp: 90000, rank: 'IV', br: '14.7', required_unit_id: 'invented_parent', is_premium: true, is_component: true, details: false,
    wiki: { purchase: '90,000' }, correction: null }));
  incoming[0].unlock_quantity = 0;
  const { tree: result, report } = protectWikiTree(previous, incoming);
  const expected = structuredClone(previous);
  for (const field of ['title', 'vehicle_icon', 'main_role']) first(expected)[field] = first(incoming)[field];
  assert.deepEqual(result, expected);
  assert.deepEqual(previous, frozen);
  assert.equal(report.updated.length, 3);
  assert(report.requiresReview);
  assert(report.conflicts.some(c => c.field === 'required_unit_id'));
  assert(report.conflicts.some(c => c.field === 'unlock_quantity'));
});

test('missing, new and moved units cannot change tree membership, folder order or dependencies', () => {
  const previous = tree({ type: 'multiple', data_unit_id: 'folder', title: 'Folder', rp: null, sp: null,
    required_unit_id: '', items: [unit('a', { rp: null }), unit('b', { required_unit_id: 'a' })] }, unit('missing'));
  const incoming = tree(unit('b'), unit('new'), { type: 'multiple', data_unit_id: 'folder', title: 'Renamed folder',
    rp: 24000, sp: 28000, items: [unit('a')] });
  const { tree: result, report } = protectWikiTree(previous, incoming);
  assert.equal(first(result).title, 'Renamed folder');
  assert.deepEqual(first(result).items, first(previous).items);
  assert.equal(first(result).rp, null);
  assert.equal(result[0].researchable_vehicles[0][1].data_unit_id, 'missing');
  assert.deepEqual(report.added, ['single:new']);
  assert.deepEqual(report.missing, ['single:missing']);
  assert(report.conflicts.some(c => c.field === 'position'));
});

test('missing and unknown costs stay unknown, including when Wiki supplies zero', () => {
  const previous = tree(unit('a', { rp: null, sp: null }), unit('b', { rp: 0, sp: 0 }));
  delete previous[0].researchable_vehicles[0][1].sp;
  const result = protectWikiTree(previous, tree(unit('a', { rp: 0, sp: 0 }), unit('b', { rp: 900, sp: 200 }))).tree;
  assert.deepEqual(result, previous);
});

test('same numeric cost in Wiki string form is not a price conflict', () => {
  const { report } = protectWikiTree(tree(unit('a')), tree(unit('a', { rp: '12,000', sp: '14 000' })));
  assert.equal(report.requiresReview, false);
});

test('untrusted images and empty metadata cannot replace known presentation', () => {
  const credentialUrl = new URL('https://wiki.warthunder.com/a.png');
  credentialUrl.username = 'fixture'; credentialUrl.password = 'fixture';
  for (const image of ['', 'javascript:alert(1)', 'file:///image.png', 'https://untrusted.invalid/a.png',
    'https://wiki.warthunder.com.evil.invalid/a.png', credentialUrl.href]) {
    const previous = tree(unit('a'));
    const { tree: result, report } = protectWikiTree(previous, tree(unit('a', { title: '', vehicle_icon: image })));
    assert.deepEqual(result, previous);
    assert(report.rejectedPresentation.length >= 1);
  }
});

test('malformed/duplicate nodes fail closed; folders may share the basic-unit ID', () => {
  assert.throws(() => protectWikiTree(null, tree(unit('a'))));
  assert.throws(() => protectWikiTree(tree(unit('a')), tree(unit('a'), unit('a'))));
  assert.throws(() => protectWikiTree(tree(unit('a')), tree({ type: 'single' })));
  const shared = tree({ type: 'multiple', data_unit_id: 'a', items: [unit('a')] });
  assert.deepEqual(protectWikiTree(shared, shared).tree, shared);
  assert.deepEqual(protectWikiTree(tree(unit('a')), []).tree, tree(unit('a')));
  assert.deepEqual(protectWikiTree([], tree(unit('a'))).tree, []);
});

function snapshotFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-wiki-guard-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), root);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const entries = ['usa_ground', 'usa_aviation'].map(name => {
    const file = `database/usa/${name}.json`;
    const content = JSON.stringify(tree(unit(name)), null, 2) + '\n';
    fs.mkdirSync(path.dirname(path.join(root, 'docs', file)), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', file), content);
    return { file, content };
  });
  const manifest = { tree_count: 2, unit_count: 2, gameVersion: 'reviewed',
    verified_at: 'original', corrections: { retained: true },
    files: entries.map(e => ({ path: e.file, sha256: sha(e.content), units: 1, tree_source_sha256: 'original' })) };
  const manifestPath = path.join(root, 'docs/database/manifest.json');
  const manifestBytes = JSON.stringify(manifest);
  fs.writeFileSync(manifestPath, manifestBytes);
  const candidates = entries.map(e => {
    const data = JSON.parse(e.content);
    first(data).title = 'Updated'; first(data).rp = 99999;
    return { file: e.file, content: JSON.stringify(data) };
  });
  const unchanged = () => {
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifestBytes);
    for (const entry of entries) assert.equal(fs.readFileSync(path.join(root, 'docs', entry.file), 'utf8'), entry.content);
  };
  return { root, entries, candidates, unchanged };
}

test('snapshot apply preserves game provenance and updates only presentation hashes', t => {
  const f = snapshotFixture(t);
  const result = applyWikiPresentation(f.root, f.candidates, { verified_at: 'fresh', failures: 0 });
  assert.equal(result.verified_at, 'original');
  assert.equal(result.gameVersion, 'reviewed');
  assert.deepEqual(result.corrections, { retained: true });
  assert(result.wiki_presentation_refresh.requires_review);
  for (const entry of result.files) {
    const bytes = fs.readFileSync(path.join(f.root, 'docs', entry.path), 'utf8');
    assert.equal(entry.sha256, sha(bytes));
    assert.equal(entry.tree_source_sha256, 'original');
    assert.equal(first(JSON.parse(bytes)).rp, 12000);
    assert.equal(first(JSON.parse(bytes)).title, 'Updated');
  }
  const report = JSON.parse(fs.readFileSync(path.join(f.root, 'logs/wiki-refresh/presentation-review.json')));
  assert(report.applied && report.requiresReview);
});

test('snapshot validation fails before writes on malformed, incomplete or duplicate candidates', t => {
  const f = snapshotFixture(t);
  for (const candidates of [f.candidates.slice(0, 1), [f.candidates[0], f.candidates[0]],
    [f.candidates[0], { file: '../outside.json', content: '[]' }],
    [f.candidates[0], { ...f.candidates[1], content: 'invalid json' }]]) {
    assert.throws(() => applyWikiPresentation(f.root, candidates, {}));
    f.unchanged();
  }
});

test('snapshot I/O failure rolls back files already written', t => {
  const f = snapshotFixture(t);
  const rename = fs.renameSync;
  let calls = 0;
  t.mock.method(fs, 'renameSync', (...args) => {
    if (++calls === 3) throw new Error('Simulated disk failure');
    return rename(...args);
  });
  assert.throws(() => applyWikiPresentation(f.root, f.candidates, {}), /Simulated disk failure/);
  f.unchanged();
});

test('snapshot rollback failure is explicit and cannot be reported as success', t => {
  const f = snapshotFixture(t);
  const rename = fs.renameSync;
  let calls = 0;
  t.mock.method(fs, 'renameSync', (...args) => {
    if (++calls >= 3) throw new Error('Persistent disk failure');
    return rename(...args);
  });
  assert.throws(() => applyWikiPresentation(f.root, f.candidates, {}), /rollback is incomplete/);
  const report = JSON.parse(fs.readFileSync(path.join(f.root, 'logs/wiki-refresh/presentation-review.json')));
  assert.equal(report.applied, false);
});

test('all shipped trees survive conflicting Wiki fields without gameplay changes', () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/database/manifest.json')));
  let units = 0;
  for (const entry of manifest.files) {
    const previous = JSON.parse(fs.readFileSync(path.join(root, 'docs', entry.path)));
    const candidate = structuredClone(previous);
    for (const rank of candidate) {
      rank.unlock_quantity = 0;
      for (const column of [...rank.researchable_vehicles, ...rank.premium_vehicles]) {
        for (const parent of column) for (const node of [parent, ...(parent.items || [])]) {
          node.rp = 999999; node.sp = 999999; node.required_unit_id = 'invented_parent';
          if (node.type === 'single') units++;
        }
      }
    }
    assert.deepEqual(protectWikiTree(previous, candidate).tree, previous, entry.path);
  }
  assert.equal(units, manifest.unit_count);
});
