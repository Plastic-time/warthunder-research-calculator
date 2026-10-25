const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { candidateKind, repositoryFiles, validateInventory, auditProjects } = require('./check-dependency-inventory.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-dependency-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = [], inventory = { schemaVersion: 1, entries: [] };
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
    if (!files.includes(file)) files.push(file);
  };
  const project = (directory, id) => {
    const prefix = directory ? directory + '/' : '';
    const pkg = { name: id, version: '1.0.0', devDependencies: { example: '1.0.0' } };
    const entry = { id, kind: 'npm', coverage: 'npm-audit', files: [prefix + 'package.json', prefix + 'package-lock.json'] };
    write(entry.files[0], pkg);
    write(entry.files[1], { lockfileVersion: 3, packages: { '': pkg, 'node_modules/example': { version: '1.0.0', dev: true } } });
    inventory.entries.push(entry);
    return entry;
  };
  project('', 'main');
  return { root, files, inventory, write, project, check: () => validateInventory(root, inventory, files) };
}

test('registered npm projects produce audit directories; known non-npm gaps stay explicit', t => {
  const f = fixture(t);
  f.project('cloud/counter', 'counter');
  f.write('.github/workflows/test.yml', 'name: test');
  f.inventory.entries.push({ id: 'actions', kind: 'github-actions', coverage: 'tracked-only', files: ['.github/workflows/test.yml'], note: 'Action audit pending.' });
  const report = f.check();
  assert.deepEqual(report.npmProjects.map(p => p.directory), ['.', 'cloud/counter']);
  assert.equal(report.trackedOnly[0].id, 'actions');
  assert.equal(report.registeredFiles, 5);
});

test('new package manifests, orphan locks, workflows, licenses and binary files cannot be silently omitted', t => {
  for (const file of ['nested/package.json', 'nested/package-lock.json', '.github/workflows/new.yml', 'assets/LICENSE-new.txt', 'new.exe', 'vendor/new.js', 'new.min.js']) {
    const f = fixture(t);
    f.write(file, '{}');
    assert.throws(f.check, /not registered/, file);
  }
});

test('unsupported ecosystems and alternate lockfiles fail closed', t => {
  for (const file of ['requirements-dev.txt', 'vendor/requirements.txt', 'pyproject.toml', 'uv.lock', 'Cargo.lock', 'go.mod', 'Gemfile', 'composer.lock', 'pom.xml', 'Dockerfile', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', '.gitmodules']) {
    const f = fixture(t);
    f.write(file, '');
    assert.equal(candidateKind(file), 'unsupported');
    assert.throws(f.check, /unsupported dependency ecosystem/, file);
  }
});

test('npm coverage cannot be disabled or disguised as a pending non-npm entry', t => {
  const f = fixture(t), entry = f.inventory.entries[0];
  entry.coverage = 'tracked-only';
  assert.throws(f.check, /cannot skip auditing/);
  entry.kind = 'vendored'; entry.note = 'Not yet audited';
  assert.throws(f.check, /vendored packages cannot skip auditing/);
});

test('stale and incomplete lockfiles are rejected', t => {
  const f = fixture(t);
  f.write('package-lock.json', { lockfileVersion: 1 });
  assert.throws(f.check, /complete npm/);
  f.write('package-lock.json', { lockfileVersion: 3, packages: { '': { version: '1.0.0' } } });
  assert.throws(f.check, /stale lockfile devDependencies/);
  f.write('package-lock.json', { lockfileVersion: 3, packages: { '': { version: '1.0.0', devDependencies: { example: '1.0.0' } } } });
  assert.throws(f.check, /direct dependency missing from lockfile/);
  f.write('package-lock.json', '{');
  assert.throws(f.check, SyntaxError);
});

test('missing, duplicate and ignored inventory files cannot claim coverage', t => {
  const f = fixture(t);
  f.inventory.entries.push({ ...f.inventory.entries[0] });
  assert.throws(f.check, /duplicate inventory ID/);
  f.inventory.entries[1].id = 'duplicate-owner';
  assert.throws(f.check, /duplicate inventory ownership/);
  f.inventory.entries.pop();
  f.files.pop();
  assert.throws(f.check, /not a tracked/);
  f.files.push('package-lock.json');
  fs.unlinkSync(path.join(f.root, 'package-lock.json'));
  assert.throws(f.check, /ENOENT/);
});

test('manifest and lockfile must belong to the same directory; workspaces require explicit support', t => {
  const f = fixture(t);
  f.write('other/package-lock.json', '{}');
  f.inventory.entries[0].files[1] = 'other/package-lock.json';
  assert.throws(f.check, /directory mismatch/);
  f.inventory.entries[0].files[1] = 'package-lock.json';
  f.write('package.json', { version: '1.0.0', workspaces: ['packages/*'] });
  assert.throws(f.check, /workspaces need explicit audit support/);
});

test('pending audit entries require an explanation and cannot report automated coverage', t => {
  const f = fixture(t);
  f.write('.github/workflows/test.yml', 'name: test');
  const entry = { id: 'actions', kind: 'github-actions', coverage: 'tracked-only', files: ['.github/workflows/test.yml'] };
  f.inventory.entries.push(entry);
  assert.throws(f.check, /explain the remaining audit gap/);
  entry.note = 'Pending'; entry.coverage = 'npm-audit';
  assert.throws(f.check, /no automated auditor/);
});

test('inventory paths cannot escape the repository or follow directory links', t => {
  const f = fixture(t), entry = f.inventory.entries[0];
  for (const file of ['../package.json', '/package.json', 'C:/package.json', 'other\\package.json']) {
    entry.files[0] = file;
    assert.throws(f.check, /Unsafe inventory path/);
  }
  fs.mkdirSync(path.join(f.root, 'target'));
  fs.symlinkSync(path.join(f.root, 'target'), path.join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  entry.files[0] = 'linked/package.json';
  assert.throws(f.check, /Symlink not allowed/);
});

test('git discovery includes new manifests and tracked ignored files, but not generated installs', t => {
  const f = fixture(t);
  execFileSync('git', ['init', '-q'], { cwd: f.root });
  f.write('.gitignore', 'node_modules/\nignored/\n');
  f.write('node_modules/example/package.json', '{}');
  f.write('ignored/package.json', '{}');
  f.write('new-project/package.json', '{}');
  execFileSync('git', ['add', '-f', '--', 'ignored/package.json'], { cwd: f.root });
  const files = repositoryFiles(f.root);
  assert(files.includes('new-project/package.json'));
  assert(files.includes('ignored/package.json'));
  assert(!files.includes('node_modules/example/package.json'));
});

test('audit runner covers every registered project, includes all dependency types and propagates failures', t => {
  const f = fixture(t);
  f.project('extra project', 'extra');
  const projects = f.check().npmProjects, calls = [];
  const run = (command, args, options) => {
    calls.push(options.cwd);
    assert.equal(command, process.execPath);
    for (const kind of ['prod', 'dev', 'optional', 'peer']) assert(args.includes('--include=' + kind));
    assert(args.includes('--package-lock-only'));
    assert(args.includes('--audit-level=low'));
    assert(args.includes('--ignore-scripts'));
    assert(!args.includes('fix'));
    assert.equal(options.shell, false);
    return { status: calls.length === 1 ? 1 : 0 };
  };
  assert.throws(() => auditProjects(f.root, projects, __filename, run), /audit failed/);
  assert.deepEqual(calls, projects.map(p => path.resolve(f.root, p.directory)));
  assert.doesNotThrow(() => auditProjects(f.root, projects, __filename, () => ({ status: 0 })));
  assert.throws(() => auditProjects(f.root, projects, __filename, () => ({ status: null, error: new Error('network unavailable') })), /audit failed or unavailable/);
});

test('CLI rejects an unregistered project before starting audit and picks it up after registration', t => {
  const f = fixture(t);
  execFileSync('git', ['init', '-q'], { cwd: f.root });
  f.write('tools/check-dependency-inventory.cjs', fs.readFileSync(path.join(__dirname, 'check-dependency-inventory.cjs'), 'utf8'));
  f.write('tools/audit-vendored-dependencies.cjs', fs.readFileSync(path.join(__dirname, 'audit-vendored-dependencies.cjs'), 'utf8'));
  f.write('tools/audit-dotnet-dependencies.cjs', fs.readFileSync(path.join(__dirname, 'audit-dotnet-dependencies.cjs'), 'utf8'));
  f.write('config/dependency-inventory.json', f.inventory);
  const extra = f.project('new service', 'new-service');
  f.write('fake-npm.cjs', "require('node:fs').appendFileSync(process.env.AUDIT_LOG, process.cwd() + '\\n');");
  const log = path.join(f.root, 'audit.log');
  const options = { cwd: f.root, encoding: 'utf8', env: { ...process.env, npm_execpath: path.join(f.root, 'fake-npm.cjs'), AUDIT_LOG: log } };
  const args = [path.join(f.root, 'tools/check-dependency-inventory.cjs'), '--audit'];
  const missing = spawnSync(process.execPath, args, options);
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /not registered/);
  assert(!fs.existsSync(log), 'No audit should start with incomplete inventory');
  f.write('config/dependency-inventory.json', f.inventory);
  const complete = spawnSync(process.execPath, args, options);
  assert.equal(complete.status, 0, complete.stderr);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [f.root, path.join(f.root, path.dirname(extra.files[0]))]);
});
