const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkDatamineUpdates } = require('./check-datamine-updates.cjs');
const checkpoints = require('../config/data-review-checkpoints.json');
const sha = n => n.toString(16).padStart(40, '0');
const gistId = 'a'.repeat(32);

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
    const headVersion = options.dev ? '2.60.0.20' : '2.59.0.99';
    if (url.includes('/users/gszabi99/gists?')) return [{ id: gistId, files: { [`${options.stale ? '2.59.0.98' : headVersion}.md`]: {} } }];
    if (url.includes(`/gists/${gistId}`)) return {
      id: gistId, owner: { login: 'gszabi99' }, history: [{ version: sha(50) }],
      files: { [`${headVersion}.md`]: { truncated: false, content: options.channelText ??
        `Current dev version: ${headVersion}\nCurrent dev-stable version: 2.59.0.99\nCurrent WiP live version: 2.59.0.99\nCurrent regular live version: 2.59.0.99` } },
    };
    if (url.includes('/commits?')) return options.noLive ? [] : [{ sha: sha(3), commit: { message: '2.59.0.99' } }];
    if (url.endsWith('/commits/master')) return { sha: sha(2) };
    if (url.endsWith('/version')) {
      if (url.includes(sha(2))) return headVersion;
      if (url.includes(sha(3))) return options.wrongLive ? '2.59.0.98' : '2.59.0.99';
      const checkpoint = Object.values(checkpoints.scopes).find(scope => url.includes(scope.gameDataCommit));
      assert(checkpoint, 'Unknown fixture revision');
      return checkpoint.gameVersion;
    }
    if (url.includes('/compare/')) return { status: options.diverged ? 'diverged' : 'ahead', files: Array.from({ length: options.fileCount ?? 300 }, (_, i) => ({ filename: `aces.vromfs.bin_u/${i}.blkx`, status: 'modified' })) };
    if (url.includes('/commits/')) {
      const commit = url.split('/').at(-1);
      return { sha: commit, commit: { tree: { sha: sha(commit === sha(options.dev ? 3 : 2) ? 20 : 10) } } };
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
  assert.deepEqual(report.scopes.map(s => s.checkpoint.gameVersion), Object.values(checkpoints.scopes).map(s => s.gameVersion));
  assert.equal(report.applied, false);
  assert(fs.readFileSync(path.join(f.root, 'config/data-review-checkpoints.json')).equals(before));
  const trees = f.calls.filter(url => url.includes('/git/trees/'));
  assert.equal(new Set(trees).size, trees.length);
});

test('development head is informational; all review comparisons target regular live', async t => {
  const f = fixture(t, { dev: true });
  const before = fs.readFileSync(path.join(f.root, 'config/data-review-checkpoints.json'));
  const report = await checkDatamineUpdates(f);
  assert.deepEqual(report.upstream, { channel: 'regular-live', version: '2.59.0.99', commit: sha(3) });
  assert.deepEqual(report.repositoryHead, { version: '2.60.0.20', commit: sha(2), channels: ['dev'] });
  assert.equal(report.channels.dev, '2.60.0.20');
  assert.equal(report.channelEvidence.revision, sha(50));
  assert.equal(report.channelEvidence.type, 'datamine-maintainer-gist');
  assert(f.calls.includes(`https://api.github.com/gists/${gistId}/${sha(50)}`));
  assert(report.compareUrl.endsWith(`...${sha(3)}`));
  assert(!f.calls.some(url => url.includes('/compare/') && url.endsWith(sha(2))));
  assert(!f.calls.some(url => url.endsWith(`/commits/${sha(2)}`)));
  assert.deepEqual(report.scopes.map(s => s.requiresReview), [true, true, false, true]);
  assert(fs.readFileSync(path.join(f.root, 'config/data-review-checkpoints.json')).equals(before));
  assert.equal(report.applied, false);
});

test('a build can belong to both regular live and dev without version-number heuristics', async t => {
  const f = fixture(t);
  const report = await checkDatamineUpdates(f);
  assert.equal(report.upstream.channel, 'regular-live');
  assert.equal(report.upstream.commit, sha(2));
  assert.deepEqual(report.repositoryHead.channels, ['regular-live', 'dev', 'dev-stable', 'wip-live']);
  assert(!f.calls.some(url => url.includes('/commits?')));
});

test('dev-only changes do not request a live review when live is already current', async t => {
  const f = fixture(t, { dev: true, unchanged: true });
  fs.writeFileSync(path.join(f.root, 'config/data-version.json'), JSON.stringify({ gameDataCommit: sha(3), gameVersion: '2.59.0.99' }));
  const report = await checkDatamineUpdates(f);
  assert.equal(report.changed, false);
  assert.equal(report.requiresReview, false);
  assert.equal(report.comparisonStatus, 'identical');
  assert(!f.calls.some(url => url.includes('/compare/')));
});

test('an explicitly released even-minor build is accepted as live', async t => {
  const f = fixture(t);
  const read = async url => {
    const result = await f.read(url);
    return JSON.parse(JSON.stringify(result).replaceAll('2.59.0.99', '2.60.0.20'));
  };
  const report = await checkDatamineUpdates({ ...f, read });
  assert.equal(report.upstream.version, '2.60.0.20');
  assert.equal(report.upstream.commit, sha(2));
  assert(report.repositoryHead.channels.includes('regular-live'));
});

test('optional WiP and dev-stable declarations may be absent', async t => {
  const report = await checkDatamineUpdates(fixture(t, { dev: true,
    channelText: 'Current dev version: 2.60.0.20\nCurrent regular live version: 2.59.0.99' }));
  assert.deepEqual(report.channels, { 'regular-live': '2.59.0.99', dev: '2.60.0.20' });
});

test('WiP and dev-stable builds are not promoted to regular live', async t => {
  const f = fixture(t, { dev: true, channelText: 'Current dev version: 2.60.0.19\nCurrent dev-stable version: 2.60.0.20\nCurrent WiP live version: 2.60.0.20\nCurrent regular live version: 2.59.0.99' });
  const report = await checkDatamineUpdates(f);
  assert.equal(report.upstream.commit, sha(3));
  assert.deepEqual(report.repositoryHead.channels, ['dev-stable', 'wip-live']);
});

for (const [name, mutate] of Object.entries({
  'wrong owner': gist => { gist.owner.login = 'someone-else'; },
  'wrong identity': gist => { gist.id = 'b'.repeat(32); },
  'wrong revision': gist => { gist.history[0].version = sha(51); },
  'truncated content': gist => { gist.files['2.60.0.20.md'].truncated = true; },
  'invalid version': gist => { gist.files['2.60.0.20.md'].content = 'Current dev version: 2.60.0.20\nCurrent regular live version: unknown'; },
})) test(`${name} cannot establish release channels`, async t => {
  const f = fixture(t, { dev: true });
  const read = async url => {
    const result = await f.read(url);
    if (url.endsWith(`/gists/${gistId}/${sha(50)}`)) mutate(result);
    return result;
  };
  await assert.rejects(checkDatamineUpdates({ ...f, read }));
  assert.equal(JSON.parse(fs.readFileSync(f.output)).status, 'failed');
  assert(!f.calls.some(url => url.includes('/compare/')));
});

test('channel endpoint failures cannot reuse a successful report', async t => {
  const f = fixture(t);
  await checkDatamineUpdates(f);
  await assert.rejects(checkDatamineUpdates({ ...f, read: async url => {
    if (url.includes('/gists/')) throw new Error('channel source offline');
    return f.read(url);
  } }), /channel source offline/);
  assert.equal(JSON.parse(fs.readFileSync(f.output)).status, 'failed');
});

for (const [name, options] of Object.entries({
  'stale channel announcement': { stale: true },
  'missing regular live': { channelText: 'Current dev version: 2.60.0.20' },
  'duplicate regular live': { channelText: 'Current dev version: 2.60.0.20\nCurrent regular live version: 2.59.0.99\nCurrent regular live version: 2.59.0.99' },
  'unclassified head': { channelText: 'Current dev version: 2.60.0.19\nCurrent regular live version: 2.59.0.99' },
  'missing live commit': { noLive: true },
  'live commit version mismatch': { wrongLive: true },
  'diverged live history': { diverged: true },
})) test(`${name} fails closed without falling back to master`, async t => {
  const f = fixture(t, { dev: true, ...options });
  fs.mkdirSync(path.dirname(f.output));
  fs.writeFileSync(f.output, '{"criticalFilesComplete":true}');
  await assert.rejects(checkDatamineUpdates(f));
  const report = JSON.parse(fs.readFileSync(f.output));
  assert.equal(report.status, 'failed');
  assert.equal(report.criticalFilesComplete, false);
  assert.equal(report.applied, false);
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
