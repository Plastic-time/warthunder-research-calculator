const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, relative, isAbsolute } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const checker = join(__dirname, 'check-commit-privacy.cjs');
const safe = 'test@users.noreply.github.com';
const personal = 'private@example.test';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'wt-privacy-'));
  t.after(() => {
    const child = relative(resolve(tmpdir()), resolve(cwd));
    assert(child && !child.startsWith('..') && !isAbsolute(child));
    rmSync(cwd, { recursive: true, force: true });
  });
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: safe,
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: safe, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key];
  const git = (args, extra = {}) => execFileSync('git', args, {
    cwd, env: { ...env, ...extra }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(['init', '--initial-branch=main']);
  git(['config', 'core.hooksPath', join(cwd, 'no-hooks')]);
  git(['config', 'commit.gpgsign', 'false']);
  const commit = extra => {
    git(['-c', 'user.name=Test', '-c', `user.email=${safe}`, 'commit', '--allow-empty', '-m', 'fixture'], extra);
    return git(['rev-parse', 'HEAD']);
  };
  const check = (args, extra = {}, input) => spawnSync(process.execPath, [checker, ...args], {
    cwd, env: { ...env, ...extra }, input, encoding: 'utf8' });
  const scan = (file, content) => {
    mkdirSync(join(cwd, 'tools'), { recursive: true });
    writeFileSync(join(cwd, file), content);
    git(['add', '--', file]);
    return spawnSync(process.execPath, [join(__dirname, 'check-publish-privacy.cjs'), '--staged'], {
      cwd, env, encoding: 'utf8' });
  };
  return { git, commit, check, scan };
}

test('accept private history and exact GitHub no-reply committer', t => {
  const f = fixture(t);
  f.commit();
  f.commit({ GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com' });
  assert.equal(f.check(['--current']).status, 0);
  assert.equal(f.check(['--all']).status, 0);
});

for (const [label, identity] of [
  ['personal author', { GIT_AUTHOR_EMAIL: personal }],
  ['personal committer', { GIT_COMMITTER_EMAIL: personal }],
  ['lookalike bot domain', { GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com.example.test' }],
  ['non-GitHub committer', { GIT_COMMITTER_EMAIL: 'noreply@github.com' }],
  ['personal author with GitHub committer', { GIT_AUTHOR_EMAIL: personal, GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com' }],
]) test(`reject ${label} without printing addresses`, t => {
  const f = fixture(t);
  f.commit(identity);
  const result = f.check(['--current']);
  assert.equal(result.status, 1);
  for (const value of Object.values(identity)) {
    if (value.includes('@')) assert(!`${result.stdout}${result.stderr}`.includes(value));
  }
});

test('current history excludes unrelated branches; full audit and push still reject them', t => {
  const f = fixture(t);
  const good = f.commit();
  f.git(['checkout', '-b', 'unrelated']);
  const bad = f.commit({ GIT_AUTHOR_EMAIL: personal });
  f.git(['checkout', 'main']);
  assert.equal(f.check(['--current']).status, 0);
  assert.equal(f.check(['--all']).status, 1);
  const push = sha => `refs/heads/test ${sha} refs/heads/test ${'0'.repeat(40)}\n`;
  assert.equal(f.check(['--pre-push'], {}, push(good)).status, 0);
  assert.equal(f.check(['--pre-push'], {}, push(bad)).status, 1);
  assert.equal(f.check(['--pre-push'], {}, push('0'.repeat(40))).status, 0);
  f.git(['merge', '--no-ff', '--no-edit', 'unrelated']);
  assert.equal(f.check(['--current']).status, 1, 'Ancestors must still be checked');
});

test('local identity requirements stay strict and invalid revisions fail closed', t => {
  const f = fixture(t);
  f.commit();
  assert.equal(f.check(['--identity']).status, 0);
  assert.equal(f.check(['--identity'], { GIT_COMMITTER_EMAIL: personal }).status, 1);
  assert.equal(f.check(['--identity'], { GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com' }).status, 1);
  assert.equal(f.check(['--unknown']).status, 1);
  assert.equal(f.check([]).status, 1);
});

test('publish scanner limits reviewed literals to their exact files', t => {
  const f = fixture(t);
  assert.equal(f.scan('tools/check-commit-privacy.cjs', 'noreply@github.com').status, 0);
  assert.equal(f.scan('tools/test-commit-privacy.cjs', personal).status, 0);
  assert.equal(f.scan('tools/check-commit-privacy.cjs', 'unreviewed@example.test').status, 1);
  assert.equal(f.scan('tools/check-commit-privacy.cjs', 'noreply@github.com').status, 0);
  assert.equal(f.scan('other.txt', personal).status, 1);
  assert.equal(f.scan('other.txt', 'noreply@github.com').status, 1);
});
