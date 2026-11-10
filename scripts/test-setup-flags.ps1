# Verify that the premium React setup choices map to real NSIS behavior.
# Runs only on the isolated Windows CI machine.
param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Installer).Path
$folder = Join-Path $env:RUNNER_TEMP 'ReformANYFlagsSmoke'
if (Test-Path -LiteralPath $folder) { throw "Test target already exists: $folder" }
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ReformANY.lnk'
if (Test-Path -LiteralPath $shortcut) { throw "Desktop shortcut existed before option test: $shortcut" }
$keys = @(
  'Registry::HKEY_CURRENT_USER\Software\Classes\*\shell\ReformANYOrbit',
  'Registry::HKEY_CURRENT_USER\Software\Classes\Directory\shell\ReformANYOrbit',
  'Registry::HKEY_LOCAL_MACHINE\Software\Classes\*\shell\ReformANYOrbit',
  'Registry::HKEY_LOCAL_MACHINE\Software\Classes\Directory\shell\ReformANYOrbit'
)
foreach ($key in $keys) { if (Test-Path -LiteralPath $key) { throw "Stale context key before test: $key" } }
try {
  $proc = Start-Process -FilePath $source -ArgumentList @('/S', '/NO_CONTEXT', '/NO_DESKTOP', "/D=$folder") -Wait -PassThru
  if ($proc.ExitCode -ne 0) { throw "Installer failed: $($proc.ExitCode)" }
  if (-not (Test-Path -LiteralPath (Join-Path $folder 'ReformANY.exe'))) { throw 'Main binary not installed' }
  if (Test-Path -LiteralPath $shortcut) { throw 'Desktop shortcut ignored /NO_DESKTOP' }
  foreach ($key in $keys) { if (Test-Path -LiteralPath $key) { throw "Context menu ignored /NO_CONTEXT: $key" } }
  Write-Host 'Premium setup opt-out flags verified against real NSIS installation.'
} finally {
  $uninstall = Join-Path $folder 'uninstall.exe'
  if (Test-Path -LiteralPath $uninstall) {
    $result = Start-Process -FilePath $uninstall -ArgumentList '/S' -Wait -PassThru
    if ($result.ExitCode -ne 0) { throw "Uninstall failed: $($result.ExitCode)" }
  }
}
