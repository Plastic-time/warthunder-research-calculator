const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkDatamineUpdates } = require('./check-datamine-updates.cjs');
const checkpoints = require('../config/data-review-checkpoints.json');
const sha = n => n.toString(16).padStart(40, '0');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-update-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'));
  const baseline = { gameDataCommit: sha(1), gameVersion: '2.59.0.17' };
  fs.writeFileSync(path.join(root, 'config/data-version.json'), JSON.stringify(baseline));
  fs.writeFileSync(path.join(root, 'config/data-review-checkpoints.json'), JSON.stringify(checkpoints));
  const calls = [];
  const read = async url => {
    calls.push(url);
    if (url.endsWith('/commits/master')) return { sha: sha(2) };
    if (url.endsWith('/version')) return url.includes(sha(2)) ? '2.59.0.82' : '2.59.0.73';
    if (url.includes('/compare/')) return { status: 'ahead', files: Array.from({ length: options.fileCount ?? 300 }, (_, i) => ({ filename: `aces.vromfs.bin_u/${i}.blkx`, status: 'modified' })) };
    if (url.includes('/commits/')) {
      const commit = url.split('/').at(-1);
      return { sha: commit, commit: { tree: { sha: sha(commit === sha(2) ? 20 : 10) } } };
    }
    const tree = url.split('/').at(-1);
    const n = Number.parseInt(tree, 16);
    const level = n % 10;
    const result = { sha: tree, truncated: false, tree: level < 2
      ? [{ path: level === 0 ? 'char.vromfs.bin_u' : 'config', type: 'tree', sha: sha(n + 1) }]
      : ['wpcost', 'shop', 'rank'].map((file, i) => ({ path: `${file}.blkx`, type: 'blob', sha: sha(100 + i + (n === 22 && file === 'wpcost' && !options.unchanged ? 10 : 0)) })) };
    if (options.missing && n === 22) result.tree.pop();
    if (options.truncated && n === 22) result.truncated = true;
    return result;
  };
  return { root, read, calls, output: path.join(root, 'logs/datamine-update-check.json') };
}

test('critical files omitted from a truncated compare are checked at pinned scope revisions', async t => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.root, 'config/data-review-checkpoints.json'));
  const report = await checkDatamineUpdates(f);
  assert.equal(report.fileListMayBeTruncated, true);
  assert.equal(report.fullFileListComplete, false);
  assert.equal(report.criticalFilesComplete, true);
  assert.deepEqual(report.scopes.map(s => s.requiresReview), [true, true, false, true]);
  assert(report.scopes.every(s => s.checkpoint.gameVersion === '2.59.0.73'));
  assert.equal(report.applied, false);
  assert(fs.readFileSync(path.join(f.root, 'config/data-review-checkpoints.json')).equals(before));
  const trees = f.calls.filter(url => url.includes('/git/trees/'));
  assert.equal(new Set(trees).size, trees.length);
});

test('identical critical files do not hide unrelated upstream changes', async t => {
  const report = await checkDatamineUpdates(fixture(t, { unchanged: true, fileCount: 1 }));
  assert(report.scopes.every(s => !s.requiresReview));
  assert.equal(report.requiresReview, true);
  assert.equal(report.fullFileListComplete, true);
});

for (const condition of ['missing', 'truncated']) test(`${condition} metadata fails closed and replaces a stale success report`, async t => {
  const f = fixture(t, { [condition]: true });
  fs.mkdirSync(path.dirname(f.output));
  fs.writeFileSync(f.output, '{"criticalFilesComplete":true}');
  await assert.rejects(checkDatamineUpdates(f));
  const report = JSON.parse(fs.readFileSync(f.output));
  assert.equal(report.status, 'failed');
  assert.equal(report.criticalFilesComplete, false);
  assert.equal(report.applied, false);
});

test('invalid pins, version mismatches, and network failures cannot advance checkpoints', async t => {
  const f = fixture(t);
  const original = f.read;
  await assert.rejects(checkDatamineUpdates({ ...f, read: async url => url.endsWith('/version') ? '2.59.0.99' : original(url) }), /Checkpoint version/);
  await assert.rejects(checkDatamineUpdates({ ...f, read: async () => { throw new Error('offline'); } }), /offline/);
  const invalid = structuredClone(checkpoints);
  invalid.scopes['rank-unlocks'].gameDataCommit = 'master';
  fs.writeFileSync(path.join(f.root, 'config/data-review-checkpoints.json'), JSON.stringify(invalid));
  await assert.rejects(checkDatamineUpdates(f), /Invalid checkpoint revision/);
});
