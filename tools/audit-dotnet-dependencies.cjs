const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const releaseUrl = 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json';
const properties = ['TargetFramework', 'RuntimeIdentifier', 'RuntimeFrameworkVersion', 'SelfContained',
  'NuGetAudit', 'NuGetAuditMode', 'NuGetAuditLevel', 'RestorePackagesWithLockFile', 'NoWarn', 'WarningsNotAsErrors'];

function validateDotnet(entry, readFile) {
  assert.equal(entry.coverage, 'nuget-audit', `${entry.id}: NuGet projects cannot skip auditing`);
  assert(typeof entry.project === 'string' && entry.project.endsWith('.csproj') && entry.files.includes(entry.project), 'Register the audited C# project');
  assert.deepEqual([...entry.files].sort(), [entry.project, path.posix.join(path.posix.dirname(entry.project), 'packages.lock.json'),
    path.posix.join(path.posix.dirname(entry.project), 'NuGet.Config')].sort(), 'Register project, lockfile and isolated NuGet.Config');
  // The small isolated policy must not inherit local sources or silently lose auditSources.
  const config = readFile(path.posix.join(path.posix.dirname(entry.project), 'NuGet.Config')).toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(config).digest('hex'),
    'c4518faa4c3d5b632f2f93eec07260100c2f47eafbe556abfbc9cd4c3d13e2c0', 'NuGet source policy changed; review before updating its fingerprint');
  return { id: entry.id, project: entry.project };
}

function validatePolicy(evaluated) {
  const p = evaluated.Properties, items = evaluated.Items;
  assert(p && items, 'Missing evaluated .NET audit policy');
  for (const [key, value] of Object.entries({ TargetFramework: 'net10.0-windows', RuntimeIdentifier: 'win-x64',
    SelfContained: 'true', NuGetAudit: 'true', NuGetAuditMode: 'all', NuGetAuditLevel: 'low', RestorePackagesWithLockFile: 'true' }))
    assert.equal(p[key], value, `Unsafe .NET policy: ${key}`);
  assert(/^10\.0\.\d+$/.test(p.RuntimeFrameworkVersion), 'Pin a stable .NET 10 runtime');
  assert(!/(?:NU)?190[0-5]/i.test(p.NoWarn + ';' + p.WarningsNotAsErrors), 'Audit warnings cannot be suppressed');
  assert(Array.isArray(items.NuGetAuditSuppress) && items.NuGetAuditSuppress.length === 0, 'Audit suppressions are not allowed');
  assert(Array.isArray(items.ProjectReference) && items.ProjectReference.length === 0, 'Register and audit project references before using them');
  assert(Array.isArray(items.PackageReference), 'Missing package references');
  for (const item of items.PackageReference)
    assert(!/(?:NU)?190[0-5]/i.test(item.NoWarn || ''), 'Package audit warnings cannot be suppressed');
  return p.RuntimeFrameworkVersion;
}

function validateRuntime(metadata, version, now = Date.now()) {
  assert.equal(metadata['channel-version'], '10.0', 'Unexpected runtime channel');
  assert(['active', 'maintenance'].includes(metadata['support-phase']), 'Unsupported .NET channel');
  assert(Date.parse(metadata['eol-date']) > now, '.NET channel has reached end of support');
  assert.equal(metadata['latest-runtime'], version, 'Pinned .NET runtime is not the current patch; review and update before release');
  const release = metadata.releases?.find(item => item.runtime?.version === version);
  assert(release && release.windowsdesktop?.version === version, 'Missing matching core and Windows Desktop runtime release');
  assert(Number.isFinite(Date.parse(release['release-date'])) && Date.parse(release['release-date']) <= now, 'Invalid runtime release date');
}

async function readRuntimeMetadata(fetcher = fetch) {
  const response = await fetcher(releaseUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert(response.ok && !response.redirected && response.body, 'Microsoft runtime metadata unavailable');
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      assert(length <= 4 * 1024 * 1024, 'Runtime metadata exceeds size limit');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function runDotnet(base, args, run = spawnSync) {
  const result = run('dotnet', args, { cwd: base, encoding: 'utf8', timeout: 300000,
    maxBuffer: 8 * 1024 * 1024, shell: false,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_CLI_UI_LANGUAGE: 'en' } });
  assert(!result.error && !result.signal && result.status === 0,
    `dotnet ${args[0]} failed: ${(result.stderr || result.stdout || result.error?.message || 'unavailable').slice(-4000)}`);
  assert(!/\bNU190[0-5]\b/.test((result.stdout || '') + (result.stderr || '')), 'NuGet audit failed or unavailable');
  return result.stdout.trim();
}

function validateAssets(assets, version) {
  const frameworks = Object.values(assets.project?.frameworks || {});
  assert.equal(frameworks.length, 1, 'Expected one restored framework');
  const downloads = frameworks[0].downloadDependencies;
  assert(Array.isArray(downloads), 'Missing restored runtime packs');
  for (const name of ['Microsoft.NETCore.App.Runtime.win-x64', 'Microsoft.WindowsDesktop.App.Runtime.win-x64'])
    assert(downloads.some(item => item.name === name && item.version === `[${version}, ${version}]`), `Unaudited runtime pack: ${name}`);
  assert(Object.keys(assets.targets || {}).some(target => target.endsWith('/win-x64')), 'Missing Windows restore target');
  assert(!(assets.logs || []).some(item => item.level === 'Error' || /^NU190/.test(item.code)), 'Restore contains audit failures');
}

function validateReport(report) {
  assert.equal(report.version, 1, 'Unsupported NuGet report format');
  assert(Array.isArray(report.projects) && report.projects.length === 1, 'Incomplete NuGet report');
  assert(!report.problems?.length, 'NuGet report contains problems');
  assert.deepEqual(report.sources, ['https://api.nuget.org/v3/index.json'], 'Unexpected NuGet advisory source');
  for (const project of report.projects) {
    assert(!project.problems?.length, 'NuGet project audit unavailable');
    assert(Array.isArray(project.frameworks) && project.frameworks.length === 1, 'Missing audited framework');
    for (const framework of project.frameworks) {
      assert.equal(framework.framework, 'net10.0-windows', 'Unexpected audited framework');
      for (const field of ['topLevelPackages', 'transitivePackages']) {
        assert(framework[field] === undefined || Array.isArray(framework[field]), 'Malformed NuGet package report');
        assert(!framework[field]?.length, 'NuGet reports vulnerable packages');
      }
    }
  }
}

function validatePublishedRuntime(config, version) {
  const options = config.runtimeOptions;
  assert(options && !options.framework && !options.frameworks, 'Launcher must not depend on an installed runtime');
  assert.deepEqual(options.includedFrameworks?.map(item => [item.name, item.version]).sort(),
    [['Microsoft.NETCore.App', version], ['Microsoft.WindowsDesktop.App', version]], 'Published runtime differs from audited runtime');
}

async function auditDotnet(base, projects, { run = spawnSync, fetcher = fetch } = {}) {
  if (!projects.length) return [];
  const sdk = runDotnet(base, ['--version'], run);
  assert(/^10\.0\.\d+$/.test(sdk), 'Use a stable .NET 10 SDK');
  const metadata = await readRuntimeMetadata(fetcher), results = [];
  for (const project of projects) {
    const common = [project.project, '-p:Configuration=Release', '-p:EnableWindowsTargeting=true'];
    const evaluated = JSON.parse(runDotnet(base, ['msbuild', ...common,
      '-getProperty:' + properties.join(','), '-getItem:NuGetAuditSuppress,PackageReference,ProjectReference'], run));
    const version = validatePolicy(evaluated);
    validateRuntime(metadata, version);
    const config = path.posix.join(path.posix.dirname(project.project), 'NuGet.Config');
    const lockPath = path.join(base, path.dirname(project.project), 'packages.lock.json');
    const locked = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    runDotnet(base, ['restore', ...common, '--configfile', config, '--locked-mode', '--force', '--no-http-cache',
      '-p:NuGetAudit=true', '-p:NuGetAuditMode=all', '-p:NuGetAuditLevel=low', '-p:NoWarn=', '-p:WarningsNotAsErrors=', '-warnaserror'], run);
    assert.deepEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')), locked, 'Locked restore changed the dependency graph');
    // NuGet rewrites CRLF on Windows even in locked mode; retain the repository's canonical JSON.
    fs.writeFileSync(lockPath, JSON.stringify(locked, null, 2) + '\n');
    const assets = JSON.parse(fs.readFileSync(path.join(base, path.dirname(project.project), 'obj/project.assets.json'), 'utf8'));
    validateAssets(assets, version);
    const report = JSON.parse(runDotnet(base, ['list', project.project, 'package', '--vulnerable', '--include-transitive',
      '--format', 'json', '--output-version', '1', '--no-restore', '--config', config], run));
    validateReport(report);
    results.push({ id: project.id, sdk, runtime: version, knownPackageVulnerabilities: 0, currentRuntimePatch: true });
  }
  console.log(JSON.stringify({ dotnetAuditPassed: true, checkedAt: new Date().toISOString(), results }));
  return results;
}

module.exports = { validateDotnet, validatePolicy, validateRuntime, readRuntimeMetadata, runDotnet, validateAssets, validateReport, validatePublishedRuntime, auditDotnet };
