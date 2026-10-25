const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-launcher-tests-'));
try {
  // Compile the production policy with a framework-only harness, without NuGet packages.
  fs.copyFileSync(path.join(root, 'tools/launcher/LaunchPolicy.cs'), path.join(scratch, 'LaunchPolicy.cs'));
  fs.copyFileSync(path.join(root, 'tools/fixtures/launcher-policy-tests.cs'), path.join(scratch, 'Program.cs'));
  fs.writeFileSync(path.join(scratch, 'test.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable><TreatWarningsAsErrors>true</TreatWarningsAsErrors></PropertyGroup></Project>');
  fs.writeFileSync(path.join(scratch, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>');
  const run = args => execFileSync('dotnet', args, { cwd: scratch, stdio: 'inherit', timeout: 120000, shell: false });
  run(['restore', 'test.csproj', '--configfile', 'NuGet.Config']);
  run(['run', '--project', 'test.csproj', '--no-restore', '--configuration', 'Release']);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
