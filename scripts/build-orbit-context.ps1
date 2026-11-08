# Build/validate the native Windows 11 Orbit COM extension and sparse identity.
# Compiles on the x64 MSVC developer command prompt. An unsigned MSIX is
# ONLY for CI schema validation: Windows will not register it for users.
param(
  [string] $Output = "target/orbit-context"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$out = Join-Path $repo $Output
$layout = Join-Path $out "layout"
New-Item -ItemType Directory -Force -Path $layout, (Join-Path $layout "Assets") | Out-Null

$source = Join-Path $repo "src-tauri/windows/orbit/OrbitExplorerCommand.cpp"
$manifest = Join-Path $repo "src-tauri/windows/orbit/AppxManifest.xml"
$icon = Join-Path $repo "src-tauri/icons/icon.png"
if (!(Get-Command cl.exe -ErrorAction SilentlyContinue)) {
  throw "MSVC cl.exe not found. Run from an x64 developer command prompt."
}
Copy-Item -LiteralPath $manifest -Destination (Join-Path $layout "AppxManifest.xml") -Force
Copy-Item -LiteralPath $icon -Destination (Join-Path $layout "Assets/icon.png") -Force

$dll = Join-Path $layout "OrbitExplorerCommand.dll"
& cl.exe /nologo /std:c++17 /EHsc /W4 /LD /DUNICODE /D_UNICODE $source /link "/OUT:$dll" shlwapi.lib shell32.lib ole32.lib
if ($LASTEXITCODE -ne 0 -or !(Test-Path $dll)) {
  throw "Could not compile OrbitExplorerCommand.dll"
}

$windowsKit = Join-Path "${env:ProgramFiles(x86)}" "Windows Kits/10/bin"
if (!(Test-Path $windowsKit)) { throw "Windows SDK was not found" }
$makeappx = Get-ChildItem $windowsKit -Filter MakeAppx.exe -Recurse |
  Where-Object { $_.FullName -match '[\\/]x64[\\/]MakeAppx\.exe$' } |
  Sort-Object -Property FullName -Descending | Select-Object -First 1
if (!$makeappx) { throw "MakeAppx.exe was not found in Windows SDK" }
$unsigned = Join-Path $out "ReformANY-Orbit-UNSIGNED-TEST-ONLY.msix"
& $makeappx.FullName pack /o /nv /d $layout /p $unsigned
if ($LASTEXITCODE -ne 0 -or !(Test-Path $unsigned)) { throw "Could not validate the MSIX manifest" }

Write-Host "Compiled: $dll"
Write-Host "Unsigned identity package for schema checks ONLY: $unsigned"
Write-Host "Production installer integration is blocked until a trusted code-signing certificate is configured."
