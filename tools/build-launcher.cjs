const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { validateDotnet, auditDotnet, runDotnet, validatePublishedRuntime } = require('./audit-dotnet-dependencies.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const [output, requestedVersion] = process.argv.slice(2);
  const version = requestedVersion || JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  assert(output && /^\d+\.\d+\.\d+$/.test(version) && process.argv.length <= 4, 'Usage: node tools/build-launcher.cjs OUTPUT [VERSION]');
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'config/dependency-inventory.json'), 'utf8'));
  const entries = inventory.entries.filter(item => item.kind === 'nuget');
  assert.equal(entries.length, 1, 'Expected one launcher');
  assert.equal(entries[0].project, 'tools/launcher/WarThunderResearchLauncher.csproj', 'Unexpected launcher project');
  const dotnetProjects = entries.map(entry => validateDotnet(entry, file => fs.readFileSync(path.join(root, file))));
  const [report] = await auditDotnet(root, dotnetProjects);
  const project = dotnetProjects[0].project;
  console.log(runDotnet(root, ['publish', project, '--no-restore', '-c', 'Release', '-r', 'win-x64',
    '--self-contained', 'true', '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:EnableWindowsTargeting=true', '-p:Version=' + version, '-o', path.resolve(output)]));
  const runtimeConfig = path.join(root, path.dirname(project), 'bin/Release/net10.0-windows/win-x64/WarThunderResearchCalculator.runtimeconfig.json');
  validatePublishedRuntime(JSON.parse(fs.readFileSync(runtimeConfig, 'utf8')), report.runtime);
  assert(fs.statSync(path.join(output, 'WarThunderResearchCalculator.exe')).size > 0, 'Launcher output missing');
  console.log(JSON.stringify({ launcherVerified: true, version, ...report }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
