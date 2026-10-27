param([string]$Version, [string]$ArtifactDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path -Parent $PSScriptRoot
if (-not $Version) { $Version = (Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json).version }
if (-not $ArtifactDirectory) { $ArtifactDirectory = $root }
$structuredTokenPattern = '(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|svcacct-)[A-Za-z0-9_-]{24,})'
$legacyTokenPattern = '(?:sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})'
$otherSecretPattern = '-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----|https?://[^\s/:"''<>]+:[^\s/@"''<>]+@'
$secretPattern = '\b(?:' + $structuredTokenPattern + '|' + $legacyTokenPattern + ')\b|' + $otherSecretPattern
$binaryOptions = [Text.RegularExpressions.RegexOptions]::CultureInvariant -bor [Text.RegularExpressions.RegexOptions]::Compiled
# Distinct token prefixes can follow binary length bytes; short prefixes still need boundaries.
$binarySecrets = [regex]::new($structuredTokenPattern + '|\b' + $legacyTokenPattern + '\b|' + $otherSecretPattern, $binaryOptions, [TimeSpan]::FromSeconds(5))
$binaryHomes = [regex]::new('[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s"''<>\x00]+|/(?:home|Users)/[^/\s"''<>\x00]+', $binaryOptions -bor [Text.RegularExpressions.RegexOptions]::IgnoreCase, [TimeSpan]::FromSeconds(5))
$binaryBuildPaths = [regex]::new('(?:[A-Za-z]:[\\/](?!/)|\\\\|(?<![\w.:/\\])/(?=[\p{L}\p{N}_.-]+/))[^\x00-\x1f\x7f-\x9f\ufffd"<>|?*]{1,32768}?\.(?:pdb|cs|csproj|vb|fs|cpp|cc|c|h|hpp|rs)(?![\w.])', $binaryOptions -bor [Text.RegularExpressions.RegexOptions]::IgnoreCase, [TimeSpan]::FromSeconds(5))
# Exact UTF-8 path hashes only; no whole binary, prefix or basename is exempted.
$runtimeReview = Get-Content -Raw -LiteralPath (Join-Path $root 'config/release-privacy-runtime-paths.json') | ConvertFrom-Json
$reviewedRuntimePaths = @($runtimeReview.pathSha256)
if ($runtimeReview.schemaVersion -ne 1 -or $reviewedRuntimePaths.Count -eq 0 -or
    @($reviewedRuntimePaths | Where-Object { $_ -cnotmatch '^[a-f0-9]{64}$' }).Count -gt 0 -or
    @($reviewedRuntimePaths | Sort-Object -Unique).Count -ne $reviewedRuntimePaths.Count) {
  throw 'Invalid reviewed runtime path registry; refusing to publish'
}

function Test-BinaryPrivacy([IO.Stream]$Stream, [string]$Name) {
  $chunkSize = 262144
  $overlap = 131072 # Retain a full long Windows path, including UTF-8 multibyte characters.
  $buffer = New-Object byte[] ($chunkSize + $overlap)
  $carry = 0
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    while ($true) {
      $read = 0
      # Deflate streams can return short reads; fill a block before rescanning the overlap.
      while ($read -lt $chunkSize) {
        $part = $Stream.Read($buffer, $carry + $read, $chunkSize - $read)
        if ($part -eq 0) { break }
        $read += $part
      }
      if ($read -eq 0) { break }
      $length = $carry + $read
      # Both UTF-16LE alignments are needed for strings embedded at odd byte offsets.
      $texts = @(
        [Text.Encoding]::UTF8.GetString($buffer, 0, $length),
        [Text.Encoding]::Unicode.GetString($buffer, 0, $length - ($length % 2))
      )
      if ($length -gt 1) { $texts += [Text.Encoding]::Unicode.GetString($buffer, 1, ($length - 1) - (($length - 1) % 2)) }
      foreach ($text in $texts) {
        try {
          if ($binarySecrets.IsMatch($text)) { throw "Possible secret in binary: $Name (value redacted)" }
          if ($binaryHomes.IsMatch($text)) { throw "Personal path in binary: $Name (value redacted)" }
          foreach ($match in $binaryBuildPaths.Matches($text)) {
            $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($match.Value))).Replace('-', '').ToLowerInvariant()
            if ($reviewedRuntimePaths -notcontains $hash) { throw "Unreviewed build path in binary: $Name (value redacted)" }
          }
        } catch [Text.RegularExpressions.RegexMatchTimeoutException] {
          throw "Binary privacy scan timed out: $Name (content redacted); refusing to publish"
        }
      }
      $carry = [Math]::Min($overlap, $length)
      [Array]::Copy($buffer, $length - $carry, $buffer, 0, $carry)
    }
  } finally { $sha.Dispose() }
}

foreach ($suffix in @('-portable', '')) {
  $file = Join-Path $ArtifactDirectory "WarThunderResearchCalculator-v$Version$suffix.zip"
  $archive = [System.IO.Compression.ZipFile]::OpenRead($file)
  $count = 0
  $binaryCount = 0
  try {
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace('\', '/')
      if ($name -match '(^|/)(\.git|\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\.json)?)($|/)|\.(pem|pfx|key|pdb)$') {
        throw "Sensitive filename in release: $name"
      }
      if ($name -match '\.(exe|dll)$') {
        $stream = $entry.Open()
        try { Test-BinaryPrivacy -Stream $stream -Name $name } finally { $stream.Dispose() }
        $binaryCount++
        continue
      }
      if ($entry.Length -eq 0 -or $entry.Length -gt 12000000 -or $name -match '\.(png|jpg|jpeg|ttf|woff2?|ico|gif|webp)$') { continue }
      $reader = [System.IO.StreamReader]::new($entry.Open())
      try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
      if ($content.IndexOf([char]0) -ge 0) { continue }
      $count++
      if ([regex]::IsMatch($content, $secretPattern)) { throw "Possible secret in release: $name (value redacted)" }
      if ($name -notmatch '^node_modules/' -and [regex]::IsMatch($content, '[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'']+')) {
        throw "Personal path in release: $name (value redacted)"
      }
    }
    Write-Host "Release privacy scan passed: $([System.IO.Path]::GetFileName($file)), $count text entries, $binaryCount binaries"
  } finally { $archive.Dispose() }
}
