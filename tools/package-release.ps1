param(
  [string]$Version
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

foreach ($testDependency in @('playwright', 'playwright-core')) {
  if (Test-Path -LiteralPath (Join-Path $root "node_modules/$testDependency")) {
    throw "Test dependencies must not ship. Run npm prune --omit=dev --ignore-scripts before packaging."
  }
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  $package = Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json
  $Version = $package.version
}

$releaseRoot = Join-Path $root "dist-package\\v$Version"
if (Test-Path -LiteralPath $releaseRoot) {
  throw "Release staging directory already exists: $releaseRoot"
}

$launcherOutput = Join-Path $releaseRoot "launcher"
$portableRoot = Join-Path $releaseRoot "WarThunderResearchCalculator-v$Version-portable"
$portableZip = Join-Path $root "WarThunderResearchCalculator-v$Version-portable.zip"
$sourceRoot = Join-Path $releaseRoot "WarThunderResearchCalculator-v$Version"
$sourceZip = Join-Path $root "WarThunderResearchCalculator-v$Version.zip"

New-Item -ItemType Directory -Path $launcherOutput, $portableRoot, $sourceRoot -Force | Out-Null

Push-Location $root
try {
  node ./tools/build-launcher.cjs $launcherOutput $Version
  if ($LASTEXITCODE -ne 0) { throw "Failed to build the Windows launcher." }
} finally {
  Pop-Location
}

$portableItems = @("config", "database", "dict", "public", "src", "node_modules", "main.js", "package.json", "package-lock.json", "README.md", "README.en.md", "node.exe")
foreach ($item in $portableItems) {
  if ($item -eq "node.exe") {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $runtimeVersion = (& $nodePath --version).TrimStart('v')
    if ([version]$runtimeVersion -lt [version]'24.21.0' -or [version]$runtimeVersion -ge [version]'25.0.0') {
      throw "Packaging requires current Node.js 24 LTS (at least 24.21.0)."
    }
    Copy-Item -LiteralPath $nodePath -Destination (Join-Path $portableRoot "node.exe") -Force
    continue
  }
  Copy-Item -LiteralPath (Join-Path $root $item) -Destination $portableRoot -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $launcherOutput "WarThunderResearchCalculator.exe") -Destination $portableRoot -Force
# Axios documentation contains illustrative URL credentials and is not needed at runtime.
foreach ($name in @('CHANGELOG.md', 'README.md')) {
  $documentation = Join-Path $portableRoot "node_modules\\axios\\$name"
  if (Test-Path -LiteralPath $documentation) { Remove-Item -LiteralPath $documentation }
}

$sourceItems = @("config", "database", "dict", "doc", "docs", "public", "src", ".github", ".githooks", ".gitattributes", ".gitignore", "AGENTS.md", "main.js", "package.json", "package-lock.json", "README.md", "README.en.md")
foreach ($item in $sourceItems) {
  Copy-Item -LiteralPath (Join-Path $root $item) -Destination $sourceRoot -Recurse -Force
}

$sourceLauncherRoot = Join-Path $sourceRoot "tools\\launcher"
New-Item -ItemType Directory -Path $sourceLauncherRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root "tools\\package-release.ps1") -Destination (Join-Path $sourceRoot "tools") -Force
Copy-Item -LiteralPath (Join-Path $root "tools\\check-release-privacy.ps1") -Destination (Join-Path $sourceRoot "tools") -Force
Copy-Item -LiteralPath (Join-Path $root "tools\\launcher\\WarThunderResearchLauncher.csproj") -Destination $sourceLauncherRoot -Force
Copy-Item -LiteralPath (Join-Path $root "tools\\launcher\\Program.cs") -Destination $sourceLauncherRoot -Force
Copy-Item -LiteralPath (Join-Path $root "tools\\launcher\\app.manifest") -Destination $sourceLauncherRoot -Force
Copy-Item -LiteralPath (Join-Path $root "tools\\launcher\\NuGet.Config") -Destination $sourceLauncherRoot -Force
Copy-Item -LiteralPath (Join-Path $root "tools\\launcher\\packages.lock.json") -Destination $sourceLauncherRoot -Force
Get-ChildItem -LiteralPath (Join-Path $root "tools") -Filter '*.cjs' | Copy-Item -Destination (Join-Path $sourceRoot "tools")
Copy-Item -LiteralPath (Join-Path $root "tools\\fixtures") -Destination (Join-Path $sourceRoot "tools") -Recurse

Compress-Archive -Path (Join-Path $portableRoot "*") -DestinationPath $portableZip -CompressionLevel Optimal
Compress-Archive -Path (Join-Path $sourceRoot "*") -DestinationPath $sourceZip -CompressionLevel Optimal

$checksums = @($portableZip, $sourceZip) | ForEach-Object {
  $stream = [System.IO.File]::OpenRead($_)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
  "$hash  $([System.IO.Path]::GetFileName($_))"
}
$checksums | Set-Content -LiteralPath (Join-Path $root "WarThunderResearchCalculator-v$Version-SHA256SUMS.txt") -Encoding ascii

Write-Host "Created $portableZip"
Write-Host "Created $sourceZip"
