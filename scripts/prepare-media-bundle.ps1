# Stage a pinned, verified FFmpeg/FFprobe Windows distribution into the
# Tauri resource folder BEFORE cargo test/build and NSIS packaging.
# This script runs on GitHub's Windows build runner, never on the user's PC.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$version = '9.0.2'
$source = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip'
$expected = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$bundle = Join-Path $root 'src-tauri\installer\media-bundle'
$workspace = Join-Path ([IO.Path]::GetTempPath()) ('reformany-build-media-' + [Guid]::NewGuid().ToString('N'))
$archive = Join-Path $workspace 'ffmpeg.zip'
$extracted = Join-Path $workspace 'extracted'
try {
  New-Item -ItemType Directory -Path $workspace, $extracted, $bundle -Force | Out-Null
  $ok = $false
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Write-Host "Downloading pinned FFmpeg $version for offline installer (attempt $attempt of 3)"
      Invoke-WebRequest -Uri $source -OutFile $archive -MaximumRedirection 5 -TimeoutSec 240 -UseBasicParsing
      $sha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($sha -ne $expected) { throw "SHA256 mismatch; expected $expected but got $sha" }
      $ok = $true
      break
    } catch {
      Write-Warning ("FFmpeg archive download/verification failed: " + $_.Exception.Message)
      Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
      if ($attempt -lt 3) { Start-Sleep -Seconds (5 * $attempt) }
    }
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
    "Source: $source",
    "SHA256 (source archive): $expected",
    'Distribution: https://www.gyan.dev/ffmpeg/builds/',
    'License: see LICENSE and https://ffmpeg.org/legal.html',
    'FFmpeg and FFprobe are third-party programs; ReformANY is not affiliated with the FFmpeg project.',
    'Bundled binaries are installed locally. No download is required during app setup or media conversion.'
  ) | Set-Content -LiteralPath (Join-Path $bundle 'SOURCE.txt') -Encoding UTF8
  Write-Host 'Verified private FFmpeg/FFprobe bundle staged for the offline Windows installer.'
} finally {
  Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
}
