# Tauri 2 Windows unit-test binaries lack the Common Controls v6 manifest
# needed for TaskDialogIndirect. Embed it in the TEST binary only, then run
# real tests. This does not modify the release app or installed software.
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifest = Join-Path $root "scripts/test-common-controls.manifest"
$kit = Join-Path "${env:ProgramFiles(x86)}" "Windows Kits/10/bin"
$mt = Get-ChildItem -Path $kit -Filter "mt.exe" -Recurse |
  Where-Object { $_.FullName -match '[\\/]x64[\\/]mt\.exe$' } |
  Sort-Object FullName -Descending | Select-Object -First 1
if (!$mt) { throw "Windows SDK mt.exe missing" }
# Cargo currently places this crate's Windows unit-test executable under
# target/debug/build/reformany/<build-hash>/out rather than target/debug/deps.
# Search the complete debug target tree so the manifest step follows Cargo's
# actual --no-run output instead of assuming one fixed layout.
$debugTarget = Join-Path $root "src-tauri/target/debug"
if (!(Test-Path -LiteralPath $debugTarget -PathType Container)) {
  throw "Cargo debug target directory missing: $debugTarget"
}
$tests = @(Get-ChildItem -LiteralPath $debugTarget -Filter "reformany_lib-*.exe" -File -Recurse |
  Where-Object { $_.DirectoryName -match '[\\\\/](deps|out)
foreach ($test in $tests) {
  Write-Host "Embedding Common Controls v6 test manifest in $($test.Name)"
  $resourceArgument = "-outputresource:$($test.FullName);#1"
  & $mt.FullName "-nologo" "-manifest" $manifest $resourceArgument
  if ($LASTEXITCODE -ne 0) { throw "Manifest embedding failed" }
  Write-Host "Running Windows Rust unit tests: $($test.Name)"
  & $test.FullName "--nocapture"
  if ($LASTEXITCODE -ne 0) { throw "Windows Rust unit tests failed with exit code $LASTEXITCODE" }
}
 } |
  Sort-Object FullName -Unique)
if ($tests.Count -eq 0) {
  throw "No compiled ReformANY library test executable found under $debugTarget"
}
foreach ($test in $tests) {
  Write-Host "Embedding Common Controls v6 test manifest in $($test.Name)"
  $resourceArgument = "-outputresource:$($test.FullName);#1"
  & $mt.FullName "-nologo" "-manifest" $manifest $resourceArgument
  if ($LASTEXITCODE -ne 0) { throw "Manifest embedding failed" }
  Write-Host "Running Windows Rust unit tests: $($test.Name)"
  & $test.FullName "--nocapture"
  if ($LASTEXITCODE -ne 0) { throw "Windows Rust unit tests failed with exit code $LASTEXITCODE" }
}
