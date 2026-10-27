$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$checker = Join-Path $PSScriptRoot 'check-release-privacy.ps1'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('wt-release-privacy-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
$version = '0.0.0-privacy-test'
$passed = 0

function Assert-Release([string]$Label, [string]$Name, [byte[]]$Bytes, [bool]$Blocked, [string]$PrivateValue = '', [string]$Suffix = '-portable') {
  foreach ($archiveSuffix in @('-portable', '')) {
    $file = Join-Path $temp "WarThunderResearchCalculator-v$version$archiveSuffix.zip"
    $output = [IO.File]::Create($file)
    $archive = $null
    try {
      $archive = [IO.Compression.ZipArchive]::new($output, [IO.Compression.ZipArchiveMode]::Create)
      if ($archiveSuffix -eq $Suffix) {
        $entry = $archive.CreateEntry($Name)
        $stream = $entry.Open()
        try { $stream.Write($Bytes, 0, $Bytes.Length) } finally { $stream.Dispose() }
      } else {
        $entry = $archive.CreateEntry('README.txt')
        $stream = [IO.StreamWriter]::new($entry.Open())
        try { $stream.Write('Safe fixture') } finally { $stream.Dispose() }
      }
    } finally { if ($archive) { $archive.Dispose() }; $output.Dispose() }
  }
  $failure = $null
  $messages = ''
  try { $messages = (& $checker -Version $version -ArtifactDirectory $temp 6>&1 | Out-String) }
  catch { $failure = $_.Exception.Message }
  if ($Blocked -ne [bool]$failure) { throw "Unexpected privacy result: $Label" }
  if ($Blocked -and $failure -notmatch '(path|secret|Sensitive filename)') { throw "Wrong failure category: $Label" }
  if ($PrivateValue -and (($messages + $failure).Contains($PrivateValue))) { throw "Privacy result exposed a fixture value: $Label" }
  $script:passed++
  Write-Host "Passed: $Label"
}

function Binary([string]$Text, [Text.Encoding]$Encoding = [Text.Encoding]::UTF8, [int]$Offset = 3) {
  $encoded = $Encoding.GetBytes($Text)
  $bytes = New-Object byte[] ($Offset + $encoded.Length + 2)
  if ($Offset -ge 2) { $bytes[0] = 0x4d; $bytes[1] = 0x5a }
  [Array]::Copy($encoded, 0, $bytes, $Offset, $encoded.Length)
  return ,$bytes
}

try {
  $personalPath = @('C:', 'Users', 'SyntheticUser', 'work', 'App.pdb') -join '\'
  $build = @('E:', 'fixture-workspace', 'tools', 'launcher', 'obj', 'Release', 'App.pdb') -join '\'
  $vendor = @('D:', 'a', '_work', '1', 's', 'src', 'runtime', 'artifacts', 'obj', 'coreclr', 'windows.x64.Release', 'Corehost.Static', 'singlefilehost.pdb') -join '\'
  Assert-Release 'safe executable' 'App.exe' (Binary 'Application version 1.0.0.0') $false
  Assert-Release 'safe DLL' 'lib/App.DLL' (Binary 'relative/path/App.pdb') $false
  Assert-Release 'UTF-8 home directory' 'App.exe' (Binary $personalPath) $true $personalPath
  Assert-Release 'custom-drive debug path' 'lib/App.dll' (Binary $build) $true $build
  Assert-Release 'source archive binary' 'App.exe' (Binary $build) $true $build ''
  foreach ($offset in @(2, 3)) {
    Assert-Release "UTF-16LE alignment $offset" 'App.exe' (Binary $build ([Text.Encoding]::Unicode) $offset) $true $build
  }
  Assert-Release 'dependency DLL is not exempt' 'node_modules/fixture/native.dll' (Binary $personalPath) $true $personalPath
  Assert-Release 'Unix home directory' 'App.dll' (Binary '/home/synthetic/project/App.pdb') $true '/home/synthetic/project/App.pdb'
  Assert-Release 'Unix build path' 'App.dll' (Binary '/build/synthetic/obj/App.pdb') $true '/build/synthetic/obj/App.pdb'
  Assert-Release 'UNC build path' 'App.dll' (Binary '\\fixture-server\build\App.pdb') $true '\\fixture-server\build\App.pdb'
  Assert-Release 'source file path' 'App.exe' (Binary ($build.Replace('.pdb', '.cs'))) $true
  Assert-Release 'forward-slash build path' 'App.dll' (Binary ($build.Replace('\', '/'))) $true
  $unicodePath = 'E:\' + [char]0x7814 + [char]0x53d1 + '\App.pdb'
  Assert-Release 'Unicode UTF-8 build path' 'App.exe' (Binary $unicodePath) $true $unicodePath
  Assert-Release 'Unicode UTF-16 build path' 'App.dll' (Binary $unicodePath ([Text.Encoding]::Unicode)) $true $unicodePath
  Assert-Release 'long debug path' 'App.exe' (Binary ('E:\' + ('segment\' * 100) + 'App.pdb')) $true
  foreach ($encoding in @([Text.Encoding]::UTF8, [Text.Encoding]::Unicode)) {
    Assert-Release "chunk boundary $($encoding.WebName)" 'App.exe' (Binary $build $encoding 262135) $true $build
  }
  Assert-Release 'binary larger than old size limit' 'App.exe' (Binary $build ([Text.Encoding]::UTF8) 12000001) $true $build
  Assert-Release 'exact reviewed runtime path' 'App.exe' (Binary $vendor) $false
  Assert-Release 'reviewed runtime plus private path' 'App.exe' (Binary ($vendor + [char]0 + $build)) $true $build
  Assert-Release 'runtime basename does not exempt another path' 'App.exe' (Binary 'E:\private-build\singlefilehost.pdb') $true
  Assert-Release 'unreviewed runtime path variant fails closed' 'App.exe' (Binary ($vendor.Replace('1\s', '2\s'))) $true
  Assert-Release 'URL is not a local build path' 'App.exe' (Binary 'https://example.test/src/App.cs') $false
  Assert-Release 'relative source path' 'App.exe' (Binary '../src/runtime/App.cpp') $false
  Assert-Release 'machine bytes are not source paths' 'App.exe' ([byte[]]@(0x4d, 0x5a, 0, 47, 1, 46, 72, 0)) $false
  Assert-Release 'embedded short prefix is not a credential' 'App.exe' (Binary ('prefixAKIA' + ('A' * 16) + 'suffix')) $false
  Assert-Release 'localized word is not a legacy token' 'App.exe' (Binary ('Petropavlovsk-' + ('example-' * 4)) ([Text.Encoding]::Unicode)) $false
  $token = 'ghp_' + ('x' * 36)
  Assert-Release 'UTF-8 binary credential' 'App.exe' (Binary $token) $true $token
  Assert-Release 'UTF-16 binary credential' 'App.dll' (Binary $token ([Text.Encoding]::Unicode)) $true $token
  Assert-Release 'credential across chunk boundary' 'App.exe' (Binary $token ([Text.Encoding]::Unicode) 262135) $true $token
  $aws = 'AKIA' + ('B' * 16)
  Assert-Release 'standalone legacy credential' 'App.exe' (Binary (' ' + $aws + ' ')) $true $aws
  Assert-Release 'existing text credential guard' 'config.txt' ([Text.Encoding]::UTF8.GetBytes($token)) $true $token
  Assert-Release 'existing debug-symbol filename guard' 'App.pdb' ([byte[]]@(1, 2)) $true
  Assert-Release 'existing text home-directory guard' 'config.txt' ([Text.Encoding]::UTF8.GetBytes($personalPath)) $true $personalPath
  $fixtureRoot = Join-Path $temp 'policy-fixture'
  New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'tools'), (Join-Path $fixtureRoot 'config') | Out-Null
  Copy-Item -LiteralPath $checker -Destination (Join-Path $fixtureRoot 'tools/check-release-privacy.ps1')
  $review = Get-Content -Raw -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'config/release-privacy-runtime-paths.json')
  $checker = Join-Path $fixtureRoot 'tools/check-release-privacy.ps1'
  foreach ($invalid in @('version', 'empty', 'wildcard', 'duplicate')) {
    $config = $review | ConvertFrom-Json
    switch ($invalid) {
      'version' { $config.schemaVersion = 99 }
      'empty' { $config.pathSha256 = @() }
      'wildcard' { $config.pathSha256 = @('*') }
      'duplicate' { $config.pathSha256 = @($config.pathSha256[0], $config.pathSha256[0]) }
    }
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'config/release-privacy-runtime-paths.json'), ($config | ConvertTo-Json -Depth 6))
    Assert-Release "invalid runtime registry: $invalid" 'App.exe' (Binary 'Safe fixture') $true
  }
  Write-Host "Release privacy regression passed: $passed cases"
} finally {
  $resolved = [IO.Path]::GetFullPath($temp)
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notmatch '^wt-release-privacy-[a-f0-9]{32}$') { throw 'Refusing unsafe test cleanup' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
