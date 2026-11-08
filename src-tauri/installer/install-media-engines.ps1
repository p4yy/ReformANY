# Media engine install runs only after the user opts in to the installer component.
# FFmpeg and FFprobe are downloaded as one reviewed release package.
# No PATH changes, no admin-wide installation, and no network access at application runtime.
[CmdletBinding()]
param(
  [string]$Archive,
  [Parameter(Mandatory=$true)][string]$TargetDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Version = '9.0.2'
$ExpectedSha256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
$Source = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip'
$ReleasePage = 'https://www.gyan.dev/ffmpeg/builds/'
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ('reformany-media-' + [Guid]::NewGuid().ToString('N'))

try {
  if ([string]::IsNullOrWhiteSpace($Archive)) {
    $Archive = Join-Path $TempDir 'ffmpeg.zip'
    New-Item -Path $TempDir -ItemType Directory -Force | Out-Null
    $downloaded = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      try {
        Write-Output "Downloading media engines (attempt $attempt of 3)..."
        Invoke-WebRequest -Uri $Source -OutFile $Archive -MaximumRedirection 5 -TimeoutSec 180 -ErrorAction Stop
        if ((Get-Item -LiteralPath $Archive).Length -lt 1048576) { throw 'Downloaded archive is unexpectedly small' }
        $downloaded = $true
        break
      } catch {
        Write-Warning ("FFmpeg download attempt $attempt failed: " + $_.Exception.Message)
        Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
        if ($attempt -lt 3) { Start-Sleep -Seconds (5 * $attempt) }
      }
    }
    if (-not $downloaded) { throw 'Could not download media engines after three attempts' }
  }
  if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) {
    throw 'Media engine download was not found'
  }
  $Hash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Hash -ne $ExpectedSha256) {
    throw 'FFmpeg download failed integrity verification (SHA-256 mismatch)'
  }
  New-Item -Path $TempDir -ItemType Directory -Force | Out-Null
  Write-Output 'Verified media engine archive. Extracting...'
  Expand-Archive -LiteralPath $Archive -DestinationPath $TempDir -Force
  $Matches = @(Get-ChildItem -LiteralPath $TempDir -Filter 'ffmpeg.exe' -Recurse -File |
    Where-Object { $_.Directory.Name -eq 'bin' })
  if ($Matches.Count -ne 1) {
    throw 'Unexpected FFmpeg package contents'
  }
  $BinDir = $Matches[0].Directory.FullName
  $RootDir = Split-Path -Parent $BinDir
  $ProbeSource = Join-Path $BinDir 'ffprobe.exe'
  if (-not (Test-Path -LiteralPath $ProbeSource -PathType Leaf)) {
    throw 'The FFmpeg package does not contain FFprobe'
  }
  $LicenseSource = Join-Path $RootDir 'LICENSE'
  if (-not (Test-Path -LiteralPath $LicenseSource -PathType Leaf)) {
    throw 'The FFmpeg license file was not included in this package'
  }
  # Sanity-check only the integrity-verified binaries, never arbitrary downloaded files.
  & (Join-Path $BinDir 'ffmpeg.exe') -version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'FFmpeg failed its startup check' }
  & $ProbeSource -version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'FFprobe failed its startup check' }

  if (-not (Test-Path -LiteralPath $TargetDir -PathType Container)) {
    New-Item -Path $TargetDir -ItemType Directory -Force | Out-Null
  }
  Copy-Item -LiteralPath (Join-Path $BinDir 'ffmpeg.exe') -Destination (Join-Path $TargetDir 'ffmpeg.exe') -Force
  Copy-Item -LiteralPath $ProbeSource -Destination (Join-Path $TargetDir 'ffprobe.exe') -Force
  Copy-Item -LiteralPath $LicenseSource -Destination (Join-Path $TargetDir 'LICENSE') -Force
  @(
    "FFmpeg release: $Version",
    "Source: $Source",
    "Release info: $ReleasePage",
    "Verified SHA-256: $ExpectedSha256",
    'Binaries are provided by the third-party distributor named above.',
    'FFmpeg licensing details: https://ffmpeg.org/legal.html'
  ) | Set-Content -LiteralPath (Join-Path $TargetDir 'SOURCE.txt') -Encoding UTF8
  Write-Output 'FFmpeg and FFprobe installed privately for ReformANY.'
  exit 0
} catch {
  Write-Error ('Media engine setup failed: ' + $_.Exception.Message)
  exit 1
} finally {
  Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
