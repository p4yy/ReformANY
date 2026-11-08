# Real Windows installer smoke test for ReformANY Orbit registry hooks.
# Runs only in an isolated Windows CI runner, never on the user's machine.
param([Parameter(Mandatory = $true)][string] $Installer)
$ErrorActionPreference = "Stop"

$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$destination = Join-Path $env:RUNNER_TEMP "ReformANYOrbitSmoke"
if (Test-Path -LiteralPath $destination) {
  throw "Smoke-test installation folder already exists: $destination"
}

Write-Host "Installing preview silently into $destination"
$install = Start-Process -FilePath $installerPath -ArgumentList @("/S", "/D=$destination") -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "NSIS installation failed ($($install.ExitCode))" }
$binary = Join-Path $destination "ReformANY.exe"
$uninstallPath = Join-Path $destination "uninstall.exe"
if (!(Test-Path -LiteralPath $binary -PathType Leaf)) { throw "ReformANY.exe missing after installation" }
if (!(Test-Path -LiteralPath $uninstallPath -PathType Leaf)) { throw "Uninstaller missing after installation" }

$roots = @(
  'Registry::HKEY_CURRENT_USER\Software\Classes',
  'Registry::HKEY_LOCAL_MACHINE\Software\Classes'
)
function Find-RegisteredVerb([string] $kind) {
  $hits = @()
  foreach ($root in $roots) {
    $key = "$root\$kind\shell\ReformANYOrbit"
    if (Test-Path -LiteralPath $key) { $hits += $key }
  }
  return ,$hits
}
$installedKeys = @()
foreach ($kind in @('*', 'Directory')) {
  $hits = @(Find-RegisteredVerb $kind)
  if ($hits.Count -ne 1) { throw "Expected exactly one Orbit $kind menu registration; found $($hits.Count)" }
  $installedKeys += $hits[0]
  $name = (Get-Item -LiteralPath $hits[0]).GetValue("MUIVerb")
  $icon = (Get-Item -LiteralPath $hits[0]).GetValue("Icon")
  $command = (Get-Item -LiteralPath "$($hits[0])\command").GetValue("")
  if ($name -ne "ReformANY Orbit") { throw "Incorrect menu label for $kind" }
  if ($icon -ne "$binary,0") { throw "Incorrect Orbit icon path for $kind : $icon" }
  if (!$command -or !$command.Contains('orbit "%1"') -or !$command.StartsWith('"' + $binary + '" ')) {
    throw "Incorrect quoted Orbit launch command for $kind : $command"
  }
  Write-Host "OK: $kind -> $name / $icon"
}

Write-Host "Checking silent removal..."
$remove = Start-Process -FilePath $uninstallPath -ArgumentList "/S" -Wait -PassThru
if ($remove.ExitCode -ne 0) { throw "NSIS uninstall failed ($($remove.ExitCode))" }
foreach ($key in $installedKeys) {
  if (Test-Path -LiteralPath $key) { throw "Orbit menu entry remains after uninstall: $key" }
}
Write-Host "Passed: install, file/folder menu entries, icon, quoted launch command and uninstall cleanup."
