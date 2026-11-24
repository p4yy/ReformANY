# Stage a pinned, verified FFmpeg/FFprobe Windows distribution into the
# Tauri resource folder BEFORE cargo test/build and NSIS packaging.
# This script runs on GitHub's Windows build runner, never on the user's PC.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$version = '9.0.2'
# The GitHub release is the publisher's own mirror of the exact same pinned archive.
# Both URLs MUST match the same hard-coded SHA256 digest below.
$sources = @(
  'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip',
  'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip'
)
$expected = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$bundle = Join-Path $root 'src-tauri\installer\media-bundle'
$workspace = Join-Path ([IO.Path]::GetTempPath()) ('reformany-build-media-' + [Guid]::NewGuid().ToString('N'))
$archive = Join-Path $workspace 'ffmpeg.zip'
$extracted = Join-Path $workspace 'extracted'
try {
  New-Item -ItemType Directory -Path $workspace, $extracted, $bundle -Force | Out-Null
  $ok = $false
  $usedSource = $null
  # On a 503 from the primary host, immediately try the official GitHub mirror
  # before another retry. A checksum mismatch never bypasses verification.
  for ($attempt = 1; $attempt -le 3 -and -not $ok; $attempt++) {
    foreach ($source in $sources) {
      try {
        Write-Host "Downloading pinned FFmpeg $version from $source (attempt $attempt of 3)"
        Invoke-WebRequest -Uri $source -OutFile $archive -MaximumRedirection 5 -TimeoutSec 240 -UseBasicParsing
        $sha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($sha -ne $expected) { throw "SHA256 mismatch; expected $expected but got $sha" }
        $usedSource = $source
        $ok = $true
        break
      } catch {
        Write-Warning ("FFmpeg archive download/verification failed from " + $source + ": " + $_.Exception.Message)
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
      }
    }
    if (-not $ok -and $attempt -lt 3) { Start-Sleep -Seconds (5 * $attempt) }
  }
  if (-not $ok) { throw 'Unable to download and verify the pinned FFmpeg release' }

  Expand-Archive -LiteralPath $archive -DestinationPath $extracted -Force
  $binaries = @(Get-ChildItem -LiteralPath $extracted -Filter 'ffmpeg.exe' -Recurse -File |
    Where-Object { $_.Directory.Name -eq 'bin' })
  if ($binaries.Count -ne 1) { throw "Expected exactly one FFmpeg executable, got $($binaries.Count)" }
  $bin = $binaries[0].Directory.FullName
  $ffmpeg = Join-Path $bin 'ffmpeg.exe'
  $ffprobe = Join-Path $bin 'ffprobe.exe'
  $license = Join-Path (Split-Path -Parent $bin) 'LICENSE'
  foreach ($file in @($ffmpeg, $ffprobe, $license)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Pinned archive missing required file: $file" }
  }
  # Start-Process provides a reliable explicit exit code under StrictMode;
  # $LASTEXITCODE is not guaranteed to be initialized after a piped native call.
  $ffmpegCheck = Start-Process -FilePath $ffmpeg -ArgumentList @('-version') -Wait -PassThru -NoNewWindow
  if ($ffmpegCheck.ExitCode -ne 0) { throw 'Bundled FFmpeg failed execution test' }
  $ffprobeCheck = Start-Process -FilePath $ffprobe -ArgumentList @('-version') -Wait -PassThru -NoNewWindow
  if ($ffprobeCheck.ExitCode -ne 0) { throw 'Bundled FFprobe failed execution test' }
  $encoderList = Join-Path $workspace 'encoders.txt'
  $encoderCheck = Start-Process -FilePath $ffmpeg -ArgumentList @('-hide_banner','-encoders') -Wait -PassThru -NoNewWindow -RedirectStandardOutput $encoderList
  if ($encoderCheck.ExitCode -ne 0) { throw 'Cannot inspect bundled encoder support' }
  $encoders = Get-Content -LiteralPath $encoderList
  foreach ($encoder in @('libx264','libx265','libvpx-vp9','libopus','libmp3lame','aac')) {
    if (-not ($encoders | Select-String -Pattern ("\b" + [regex]::Escape($encoder) + "\b") -Quiet)) {
      throw "Pinned FFmpeg build lacks required encoder: $encoder"
    }
  }
  Copy-Item -LiteralPath $ffmpeg -Destination (Join-Path $bundle 'ffmpeg.exe') -Force
  Copy-Item -LiteralPath $ffprobe -Destination (Join-Path $bundle 'ffprobe.exe') -Force
  Copy-Item -LiteralPath $license -Destination (Join-Path $bundle 'LICENSE') -Force
  @(
    "ReformANY private media engine payload: FFmpeg $version / FFprobe",
    "Source: $usedSource",
    "SHA256 (source archive): $expected",
    'Distribution: https://www.gyan.dev/ffmpeg/builds/',
    'License: see LICENSE and https://ffmpeg.org/legal.html',
    'FFmpeg and FFprobe are third-party programs; ReformANY is not affiliated with the FFmpeg project.',
    'Bundled binaries are installed locally. No download is required during app setup or media conversion.'
  ) | Set-Content -LiteralPath (Join-Path $bundle 'SOURCE.txt') -Encoding UTF8
  # Stage the full 64-bit 7-Zip command-line engine and its matching DLL.
  # Administrative MSI extraction copies files only; it does not install 7-Zip.
  $sevenMsi = Join-Path $workspace '7zip-x64.msi'
  $sevenExtracted = Join-Path $workspace '7zip-extracted'
  $sevenUrl = 'https://github.com/ip7z/7zip/releases/download/26.06/7z2606-x64.msi'
  $sevenSha = '6dc822569e777d9a3ecd5ffcbc22b55600af87e6c5d9810a64e8566cf5a4af9f'
  Invoke-WebRequest -Uri $sevenUrl -OutFile $sevenMsi -TimeoutSec 120 -UseBasicParsing
  if ((Get-FileHash -LiteralPath $sevenMsi -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sevenSha) {
    throw '7-Zip MSI SHA256 mismatch'
  }
  New-Item -ItemType Directory -Path $sevenExtracted -Force | Out-Null
  $msi = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/a', ('"' + $sevenMsi + '"'), '/qn', ('TARGETDIR="' + $sevenExtracted + '"')) -Wait -PassThru
  if ($msi.ExitCode -ne 0) { throw "7-Zip administrative extraction failed: $($msi.ExitCode)" }
  $seven = @(Get-ChildItem -LiteralPath $sevenExtracted -Filter '7z.exe' -File -Recurse)
  if ($seven.Count -ne 1) { throw 'Expected exactly one 7-Zip executable in pinned MSI' }
  $sevenDir = $seven[0].Directory.FullName
  foreach ($name in @('7z.exe', '7z.dll', 'License.txt')) {
    $source = Join-Path $sevenDir $name
    if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "7-Zip distribution missing $name" }
    $target = if ($name -eq 'License.txt') { '7zip-LICENSE.txt' } else { $name }
    Copy-Item -LiteralPath $source -Destination (Join-Path $bundle $target) -Force
  }
  @(
    '7-Zip 26.06 by Igor Pavlov; see 7zip-LICENSE.txt.',
    "Source binary: $sevenUrl",
    "SHA256: $sevenSha",
    'Corresponding source: https://github.com/ip7z/7zip/releases/download/26.06/7z2606-src.tar.xz',
    '7-Zip project: https://www.7-zip.org/'
  ) | Set-Content -LiteralPath (Join-Path $bundle '7zip-SOURCE.txt') -Encoding UTF8
  $sevenCheck = Start-Process -FilePath (Join-Path $bundle '7z.exe') -ArgumentList 'i' -Wait -PassThru -NoNewWindow
  if ($sevenCheck.ExitCode -ne 0) { throw 'Bundled 7-Zip failed execution test' }
  Write-Host 'Verified FFmpeg, FFprobe and 7-Zip staged for offline Windows conversion.'
} finally {
  Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
}
