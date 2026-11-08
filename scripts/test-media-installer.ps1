# End-to-end Windows smoke: run the actual NSIS installer with /MEDIA=1,
# verify private FFmpeg and FFprobe, transcode real inputs, then uninstall.
param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$Target = Join-Path $env:RUNNER_TEMP 'ReformANYMediaInstallSmoke'
$Samples = Join-Path $env:RUNNER_TEMP 'ReformANYMediaSamples'
if (Test-Path -LiteralPath $Target) { throw "Existing media test install path: $Target" }
New-Item -ItemType Directory -Path $Samples -Force | Out-Null
try {
  Write-Host 'Installing ReformANY with optional FFmpeg component enabled...'
  $process = Start-Process -FilePath $Installer -ArgumentList @('/S', '/MEDIA=1', "/D=$Target") -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    $log = Join-Path $env:TEMP 'reformany-media-install.log'
    if (Test-Path -LiteralPath $log) {
      Write-Host '=== FFmpeg installer diagnostic transcript ==='
      Get-Content -LiteralPath $log | Select-Object -Last 160 | ForEach-Object { Write-Host $_ }
      Write-Host '=== End diagnostic transcript ==='
    } else { Write-Warning "Media installation transcript not found at $log" }
    throw "Installer failed: $($process.ExitCode)"
  }
  $FFmpeg = Join-Path $Target 'engines\ffmpeg.exe'
  $FFprobe = Join-Path $Target 'engines\ffprobe.exe'
  if (-not (Test-Path -LiteralPath $FFmpeg -PathType Leaf) -or
      -not (Test-Path -LiteralPath $FFprobe -PathType Leaf)) {
    throw 'Installer did not deploy both media engines'
  }
  & $FFmpeg -version | Select-Object -First 1
  if ($LASTEXITCODE -ne 0) { throw 'Installed FFmpeg is not executable' }
  & $FFprobe -version | Select-Object -First 1
  if ($LASTEXITCODE -ne 0) { throw 'Installed FFprobe is not executable' }

  $Source = Join-Path $Samples 'sample.mp4'
  $Audio = Join-Path $Samples 'sample.mp3'
  $Video = Join-Path $Samples 'sample.webm'
  & $FFmpeg -v error -y -f lavfi -i 'testsrc2=size=160x90:rate=10' -f lavfi -i 'sine=frequency=440:sample_rate=44100' -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac $Source
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Source)) { throw 'Could not make sample MP4' }
  & $FFmpeg -v error -y -i $Source -map '0:a:0' -vn -c:a libmp3lame $Audio
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Audio)) { throw 'MP4 -> MP3 failed' }
  & $FFmpeg -v error -y -i $Source -c:v libvpx-vp9 -b:v 0 -crf 35 -c:a libopus $Video
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Video)) { throw 'MP4 -> WebM failed' }
  $Kinds = @(& $FFprobe -v error -show_entries stream=codec_type -of csv=p=0 $Video)
  if ($LASTEXITCODE -ne 0 -or $Kinds -notcontains 'video' -or $Kinds -notcontains 'audio') {
    throw 'FFprobe could not verify transcoded WebM streams'
  }
  Write-Host 'Media engine setup and sample transcodes passed.'
} finally {
  $Uninstaller = Join-Path $Target 'uninstall.exe'
  if (Test-Path -LiteralPath $Uninstaller) {
    $removal = Start-Process -FilePath $Uninstaller -ArgumentList '/S' -Wait -PassThru
    if ($removal.ExitCode -ne 0) { throw "Uninstaller failed: $($removal.ExitCode)" }
    foreach ($name in @('ffmpeg.exe','ffprobe.exe')) {
      if (Test-Path -LiteralPath (Join-Path $Target "engines\$name")) {
        throw "Media engine was not removed on uninstall: $name"
      }
    }
  }
  Remove-Item -LiteralPath $Samples -Recurse -Force -ErrorAction SilentlyContinue
}
