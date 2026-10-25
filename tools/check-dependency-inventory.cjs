const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { validateVendored, auditVendored } = require('./audit-vendored-dependencies.cjs');

const root = path.resolve(__dirname, '..');
const inventoryPath = 'config/dependency-inventory.json';
const kinds = new Set(['npm', 'nuget', 'github-actions', 'vendored', 'assets', 'binary']);
const unsupported = /^(?:yarn\.lock|pnpm-(?:lock\.yaml|workspace\.yaml)|bun\.lockb?|deno\.(?:jsonc?|lock)|requirements[^/]*\.txt|pyproject\.toml|uv\.lock|Pipfile(?:\.lock)?|poetry\.lock|Cargo\.(?:toml|lock)|go\.(?:mod|sum)|Gemfile(?:\.lock)?|composer\.(?:json|lock)|pom\.xml|build\.gradle(?:\.kts)?|Dockerfile(?:\..*)?|\.gitmodules)$/i;

function candidateKind(file) {
  const base = path.posix.basename(file);
  if (/^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json)$/.test(base)) return 'npm';
  if (/\.(?:csproj|fsproj|vbproj)$/i.test(base) || /^(?:packages\.(?:config|lock\.json)|Directory\.(?:Packages|Build)\.(?:props|targets)|NuGet\.config|global\.json)$/i.test(base)) return 'nuget';
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(file)) return 'github-actions';
  if (/\.(?:exe|dll|wasm|jar)$/i.test(base)) return 'binary';
  if (unsupported.test(base)) return 'unsupported';
  if (/license|^notice(?:\.|$)/i.test(base)) return 'license';
  if (/\.min\.js$/i.test(base) || /(?:^|\/)(?:vendor|third[-_]party)\//i.test(file)) return 'vendored';
  return null;
}

function safeFile(base, file) {
  assert(typeof file === 'string' && file && !file.includes('\\') && !file.includes(':') && !file.includes('\0')
    && !file.startsWith('/') && file.split('/').every(part => part && part !== '.' && part !== '..'),
  `Unsafe inventory path: ${file}`);
  let current = base;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    assert(!fs.lstatSync(current).isSymbolicLink(), `Symlink not allowed: ${file}`);
  }
  assert(fs.statSync(current).isFile(), `Not a regular file: ${file}`);
  return current;
}

function repositoryFiles(base) {
  return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: base, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean))];
}

function validateInventory(base, inventory, files) {
  assert.equal(inventory.schemaVersion, 1, 'Unsupported dependency inventory schema');
  assert(Array.isArray(inventory.entries) && inventory.entries.length, 'Inventory entries are required');
  const ids = new Set(), owners = new Map(), listed = new Set(files), npmProjects = [], vendoredPackages = [], trackedOnly = [];
  const read = file => JSON.parse(fs.readFileSync(safeFile(base, file), 'utf8'));
  for (const entry of inventory.entries) {
    assert(typeof entry.id === 'string' && /^[a-z0-9-]+$/.test(entry.id) && !ids.has(entry.id), 'Invalid or duplicate inventory ID');
    ids.add(entry.id);
    assert(kinds.has(entry.kind), `${entry.id}: unsupported inventory kind`);
    assert(Array.isArray(entry.files) && entry.files.length, `${entry.id}: files are required`);
    for (const file of entry.files) {
      safeFile(base, file);
      assert(listed.has(file), `${file}: not a tracked or non-ignored new repository file`);
      assert(!owners.has(file), `${file}: duplicate inventory ownership`);
      owners.set(file, entry);
    }
    if (entry.kind === 'vendored') {
      vendoredPackages.push(validateVendored(entry, file => fs.readFileSync(safeFile(base, file))));
      continue;
    }
    if (entry.kind !== 'npm') {
      assert.equal(entry.coverage, 'tracked-only', `${entry.id}: no automated auditor exists for this kind`);
      assert(typeof entry.note === 'string' && entry.note.trim(), `${entry.id}: explain the remaining audit gap`);
      trackedOnly.push({ id: entry.id, kind: entry.kind, note: entry.note });
      continue;
    }
    assert.equal(entry.coverage, 'npm-audit', `${entry.id}: npm projects cannot skip auditing`);
    assert.equal(entry.files.length, 2, `${entry.id}: require a package manifest and one npm lockfile`);
    const manifest = entry.files.find(file => path.posix.basename(file) === 'package.json');
    const lockfile = entry.files.find(file => ['package-lock.json', 'npm-shrinkwrap.json'].includes(path.posix.basename(file)));
    assert(manifest && lockfile && path.posix.dirname(manifest) === path.posix.dirname(lockfile), `${entry.id}: manifest/lockfile directory mismatch`);
    const pkg = read(manifest), lock = read(lockfile);
    assert(!pkg.workspaces, `${entry.id}: npm workspaces need explicit audit support before use`);
    assert([2, 3].includes(lock.lockfileVersion) && lock.packages?.[''], `${entry.id}: require a complete npm v2/v3 lockfile`);
    assert.equal(lock.packages[''].version, pkg.version, `${entry.id}: manifest/lockfile version mismatch`);
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])
      assert.deepEqual(lock.packages[''][field] || {}, pkg[field] || {}, `${entry.id}: stale lockfile ${field}`);
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (!Object.hasOwn(pkg.optionalDependencies || {}, name))
        assert(lock.packages['node_modules/' + name], `${entry.id}: direct dependency missing from lockfile: ${name}`);
    }
    npmProjects.push({ id: entry.id, directory: path.posix.dirname(manifest), manifest, lockfile });
  }
  for (const file of files) {
    const kind = candidateKind(file);
    if (!kind) continue;
    assert.notEqual(kind, 'unsupported', `${file}: unsupported dependency ecosystem; add audited support before introducing it`);
    const entry = owners.get(file);
    assert(entry, `${file}: dependency entry is not registered in ${inventoryPath}`);
    if (kind === 'license') assert(['vendored', 'assets'].includes(entry.kind), `${file}: invalid license classification`);
    else assert.equal(entry.kind, kind, `${file}: dependency kind mismatch`);
  }
  assert(npmProjects.length, 'No npm projects are audited');
  return { npmProjects, vendoredPackages, trackedOnly, registeredFiles: owners.size };
}

function auditProjects(base, projects, npmCli, run = spawnSync) {
  assert(npmCli && fs.existsSync(npmCli), 'Run auditing through npm run audit:dependencies');
  const failed = [];
  for (const project of projects) {
    console.log(`Auditing ${project.id}: ${project.directory}`);
    const result = run(process.execPath, [npmCli, 'audit', '--package-lock-only', '--include=prod', '--include=dev',
      '--include=optional', '--include=peer', '--audit-level=low', '--ignore-scripts'],
    { cwd: path.resolve(base, project.directory), stdio: 'inherit', timeout: 120000, shell: false });
    if (result.error || result.signal || result.status !== 0) failed.push(project.id);
  }
  assert.equal(failed.length, 0, `Dependency audit failed or unavailable: ${failed.join(', ')}`);
}

async function main() {
  try {
    const args = process.argv.slice(2);
    assert(args.length === 0 || (args.length === 1 && ['--audit', '--audit-vendored'].includes(args[0])), 'Only --audit or --audit-vendored is supported');
    const inventory = JSON.parse(fs.readFileSync(safeFile(root, inventoryPath), 'utf8'));
    const report = validateInventory(root, inventory, repositoryFiles(root));
    console.log(JSON.stringify({ inventoryValid: true, ...report }, null, 2));
    console.log('Tracked-only entries are NOT vulnerability-audited by this check.');
    if (args.includes('--audit')) auditProjects(root, report.npmProjects, process.env.npm_execpath);
    if (args.length) await auditVendored(report.vendoredPackages);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { candidateKind, repositoryFiles, validateInventory, auditProjects };
