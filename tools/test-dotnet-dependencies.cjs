const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateDotnet, validatePolicy, validateRuntime, readRuntimeMetadata, runDotnet, validateAssets,
  validateReport, validatePublishedRuntime, auditDotnet } = require('./audit-dotnet-dependencies.cjs');
const root = path.resolve(__dirname, '..');
test('desktop policy is wired into the launcher, source archives and both CI gates', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const source = read('tools/launcher/Program.cs');
  for (const call of ['LaunchPolicy.FindAppDirectory(AppContext.BaseDirectory)', 'LaunchPolicy.FindNode',
    'LaunchPolicy.ServerStartInfo', 'LaunchPolicy.CreateHealthClient', 'LaunchPolicy.IsCalculatorAsync']) assert(source.includes(call));
  assert(!source.includes('Environment.CurrentDirectory'));
  assert(read('tools/package-release.ps1').includes('tools\\\\launcher\\\\LaunchPolicy.cs'));
  for (const file of ['.github/workflows/security.yml', '.github/workflows/release.yml']) {
    assert(read(file).includes('npm run test:launcher-security'));
    assert(read(file).includes('npm run test:wiki-http'));
  }
});
const entry = JSON.parse(fs.readFileSync(path.join(root, 'config/dependency-inventory.json'), 'utf8')).entries.find(e => e.kind === 'nuget');
test('launcher pins the reviewed 10.0.14 runtime without restoring debug symbols', () => {
  const project = fs.readFileSync(path.join(root, entry.project), 'utf8');
  assert.match(project, /<RuntimeFrameworkVersion>10\.0\.14<\/RuntimeFrameworkVersion>/);
  assert.match(project, /<DebugType>none<\/DebugType>/);
  assert.match(project, /<DebugSymbols>false<\/DebugSymbols>/);
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'config/release-privacy-runtime-paths.json'), 'utf8'));
  assert.equal(registry.reviewedRuntime, '10.0.14');
  assert.deepEqual(registry.sources.map(source => source.package).sort(),
    ['microsoft.netcore.app.runtime.win-x64', 'microsoft.windowsdesktop.app.runtime.win-x64']);
  for (const source of registry.sources) {
    assert.equal(source.version, registry.reviewedRuntime);
    assert.equal(source.metadata, `https://api.nuget.org/v3/registration5-gz-semver2/${source.package}/${source.version}.json`);
    assert.equal(Buffer.from(source.sha512, 'base64').length, 64);
  }
  validateRuntime({ ...metadata(), 'latest-runtime': '10.0.14', releases: [
    { runtime: { version: '10.0.14' }, windowsdesktop: { version: '10.0.14' }, 'release-date': '2026-10-25' }
  ] }, '10.0.14', Date.parse('2026-10-26'));
  assert.throws(() => validateRuntime({ ...metadata(), 'latest-runtime': '10.0.14' }, '10.0.13'), /current patch/);
});
const policy = () => ({ Properties: { TargetFramework: 'net10.0-windows', RuntimeIdentifier: 'win-x64',
  RuntimeFrameworkVersion: '10.0.13', SelfContained: 'true', NuGetAudit: 'true', NuGetAuditMode: 'all',
  NuGetAuditLevel: 'low', RestorePackagesWithLockFile: 'true', NoWarn: '', WarningsNotAsErrors: '' },
Items: { NuGetAuditSuppress: [], PackageReference: [], ProjectReference: [] } });
const metadata = () => ({ 'channel-version': '10.0', 'latest-runtime': '10.0.13', 'support-phase': 'active', 'eol-date': '2028-11-14',
  releases: [{ runtime: { version: '10.0.13' }, windowsdesktop: { version: '10.0.13' }, 'release-date': '2026-10-13' }] });
const assets = () => ({ project: { frameworks: { 'net10.0-windows': { downloadDependencies:
  ['Microsoft.NETCore.App.Runtime.win-x64', 'Microsoft.WindowsDesktop.App.Runtime.win-x64'].map(name => ({ name, version: '[10.0.13, 10.0.13]' })) } } },
targets: { 'net10.0-windows7.0/win-x64': {} } });
const report = () => ({ version: 1, sources: ['https://api.nuget.org/v3/index.json'], projects: [
  { frameworks: [{ framework: 'net10.0-windows', topLevelPackages: [] }] }] });

test('NuGet inventory cannot downgrade coverage, omit lock/config or alter official source policy', () => {
  const read = file => fs.readFileSync(path.join(root, file));
  assert.equal(validateDotnet(entry, read).id, 'windows-launcher');
  assert.throws(() => validateDotnet({ ...entry, coverage: 'tracked-only' }, read), /cannot skip/);
  assert.throws(() => validateDotnet({ ...entry, files: [entry.project] }, read), /Register project, lockfile/);
  assert.throws(() => validateDotnet(entry, () => Buffer.from('<configuration />')), /source policy changed/);
});

test('evaluated .NET policy covers all severities, transitives, self-contained build and locked restore', () => {
  assert.equal(validatePolicy(policy()), '10.0.13');
  for (const key of ['NuGetAudit', 'NuGetAuditMode', 'NuGetAuditLevel', 'SelfContained', 'RestorePackagesWithLockFile', 'TargetFramework', 'RuntimeIdentifier']) {
    const p = policy(); p.Properties[key] = 'wrong';
    assert.throws(() => validatePolicy(p), /Unsafe .NET policy/);
  }
  for (const key of ['NoWarn', 'WarningsNotAsErrors']) {
    const p = policy(); p.Properties[key] = 'NU1900;NU1903';
    assert.throws(() => validatePolicy(p), /cannot be suppressed/);
  }
  for (const key of ['NuGetAuditSuppress', 'ProjectReference']) {
    const p = policy(); p.Items[key] = [{ Identity: 'ignore' }];
    assert.throws(() => validatePolicy(p));
  }
  const p = policy(); p.Items.PackageReference = [{ NoWarn: 'NU1904' }];
  assert.throws(() => validatePolicy(p), /cannot be suppressed/);
});

test('runtime gate rejects old, preview, unsupported, future or mismatched Desktop releases', () => {
  const now = Date.parse('2026-10-24');
  validateRuntime(metadata(), '10.0.13', now);
  assert.throws(() => validateRuntime(metadata(), '10.0.12', now), /current patch/);
  for (const edit of [m => m['support-phase'] = 'eol', m => m['eol-date'] = '2020-01-01',
    m => m['channel-version'] = '9.0', m => m.releases[0].windowsdesktop.version = '10.0.12',
    m => m.releases[0]['release-date'] = '2099-01-01']) {
    const m = metadata(); edit(m); assert.throws(() => validateRuntime(m, '10.0.13', now));
  }
  const p = policy(); p.Properties.RuntimeFrameworkVersion = '10.0.14-preview';
  assert.throws(() => validatePolicy(p), /stable/);
});

test('runtime metadata fails closed on network, redirect, malformed and oversized responses', async () => {
  await readRuntimeMetadata(async (url, options) => {
    assert.equal(new URL(url).hostname, 'builds.dotnet.microsoft.com'); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(metadata()));
  });
  for (const fetcher of [async () => { throw Error('offline'); }, async () => new Response('', { status: 403 }),
    async () => new Response('{'), async () => new Response('x'.repeat(4 * 1024 * 1024 + 1))])
    await assert.rejects(readRuntimeMetadata(fetcher));
});

test('dotnet execution rejects failure, unavailable SDK and audit warnings even with zero exit status', () => {
  for (const result of [{ status: 1 }, { status: null, error: Error('missing') }, { status: 0, signal: 'SIGTERM' },
    ...Array.from({ length: 6 }, (_, i) => ({ status: 0, stdout: 'warning NU190' + i }))])
    assert.throws(() => runDotnet(root, ['restore'], () => result));
  runDotnet(root, ['--version'], (exe, args, options) => {
    assert.equal(exe, 'dotnet'); assert.equal(options.shell, false); assert(options.timeout);
    return { status: 0, stdout: '10.0.402' };
  });
});

test('actual restored runtime packs must match the checked release', () => {
  validateAssets(assets(), '10.0.13');
  assert.throws(() => validateAssets(assets(), '10.0.12'), /Unaudited runtime pack/);
  const a = assets(); a.targets = {}; assert.throws(() => validateAssets(a, '10.0.13'), /Windows restore/);
  a.targets = assets().targets; a.logs = [{ code: 'NU1900' }]; assert.throws(() => validateAssets(a, '10.0.13'));
});

test('vulnerability JSON must be complete and clean, including transitive low-severity findings', () => {
  validateReport(report());
  for (const edit of [r => r.version = 2, r => r.projects = [], r => r.sources = [],
    r => r.problems = ['offline'], r => r.projects[0].problems = ['unavailable'], r => delete r.projects[0].frameworks,
    r => r.projects[0].frameworks[0].transitivePackages = [{ id: 'vulnerable', vulnerabilities: [{ severity: 'Low' }] }]]) {
    const r = report(); edit(r); assert.throws(() => validateReport(r));
  }
});

test('published launcher must bundle both checked runtime versions', () => {
  const config = { runtimeOptions: { includedFrameworks: ['Microsoft.NETCore.App', 'Microsoft.WindowsDesktop.App'].map(name => ({ name, version: '10.0.13' })) } };
  validatePublishedRuntime(config, '10.0.13');
  assert.throws(() => validatePublishedRuntime(config, '10.0.12'), /differs/);
  config.runtimeOptions.framework = {}; assert.throws(() => validatePublishedRuntime(config, '10.0.13'), /installed runtime/);
});

test('full audit invokes fresh locked restore and parses the real package report before passing', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-dotnet-audit-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'tools/launcher/obj'), { recursive: true });
  fs.writeFileSync(path.join(base, 'tools/launcher/obj/project.assets.json'), JSON.stringify(assets()));
  fs.writeFileSync(path.join(base, 'tools/launcher/packages.lock.json'), JSON.stringify({ version: 1, dependencies: {} }));
  const calls = [];
  const run = (exe, args) => {
    calls.push(args);
    const data = args[0] === '--version' ? '10.0.402' : args[0] === 'msbuild' ? JSON.stringify(policy()) : args[0] === 'list' ? JSON.stringify(report()) : 'Restored';
    return { status: 0, stdout: data };
  };
  const results = await auditDotnet(base, [{ id: entry.id, project: entry.project }], { run, fetcher: async () => new Response(JSON.stringify(metadata())) });
  assert.equal(results[0].runtime, '10.0.13');
  const restore = calls.find(args => args[0] === 'restore');
  for (const flag of ['--locked-mode', '--force', '--no-http-cache', '-warnaserror', '-p:NuGetAuditMode=all']) assert(restore.includes(flag));
  assert(calls.find(args => args[0] === 'list').includes('--include-transitive'));
});

test('CI and packaging use the same auditor and publish without an unaudited second restore', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(read('.github/workflows/security.yml'), /setup-dotnet@/);
  assert.match(read('.github/workflows/release.yml'), /npm run audit:dependencies/);
  assert.match(read('tools/package-release.ps1'), /node \.\/tools\/build-launcher.cjs/);
  assert.match(read('tools/build-launcher.cjs'), /await auditDotnet/);
  assert.match(read('tools/build-launcher.cjs'), /'--no-restore'/);
  assert.match(read('tools/build-launcher.cjs'), /IncludeNativeLibrariesForSelfExtract=true/);
});

test('source packages include the privacy regression script required by release CI', () => {
  const packaging = fs.readFileSync(path.join(root, 'tools/package-release.ps1'), 'utf8');
  assert(packaging.includes('tools\\\\test-release-privacy.ps1'), 'Source package omits privacy regression tests');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert(workflow.includes('"tools/test-release-privacy.ps1"'), 'Release contents must verify the privacy test script');
});
