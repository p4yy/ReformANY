# Sign NSIS EXE only when actual Authenticode credentials are provided.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$bundle = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle\nsis"
if (!(Test-Path $bundle)) { throw "NSIS output directory not found" }
$installers = @(Get-ChildItem $bundle -Filter "*.exe" -File)
if ($installers.Count -eq 0) { throw "No Windows installer found" }
$certData = $env:REFORMANY_CERT_BASE64
$certPassword = $env:REFORMANY_CERT_PASSWORD
$hasCert = -not [string]::IsNullOrWhiteSpace($certData)
$hasPassword = -not [string]::IsNullOrWhiteSpace($certPassword)
if ($hasCert -xor $hasPassword) {
  throw "Both signing certificate and signing password must be supplied together"
}
$tool = $null
if ($hasCert) {
  $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
  if ($command) { $tool = $command.Source }
  if (-not $tool) {
    $kitPath = Join-Path ([Environment]::GetEnvironmentVariable("ProgramFiles(x86)")) "Windows Kits\10\bin"
    if (Test-Path $kitPath) {
      $possible = @(Get-ChildItem $kitPath -Recurse -File -Filter "signtool.exe" |
        Where-Object { $_.FullName -match '\\x64\\' } |
        Sort-Object FullName -Descending)
      if ($possible.Count -gt 0) { $tool = $possible[0].FullName }
    }
  }
  if (-not $tool) { throw "Windows Authenticode signtool.exe is unavailable" }
}
$certPath = Join-Path $env:TEMP ("reformany-signing-" + [guid]::NewGuid() + ".pfx")
try {
  if ($hasCert) { [IO.File]::WriteAllBytes($certPath, [Convert]::FromBase64String($certData)) }
  foreach ($installer in $installers) {
    if ($hasCert) {
      & $tool sign /v /fd SHA256 /f $certPath /p $certPassword /tr "http://timestamp.digicert.com" /td SHA256 $installer.FullName
      if ($LASTEXITCODE -ne 0) { throw "Authenticode signing failed for $($installer.Name)" }
      & $tool verify /pa /v $installer.FullName
      if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed for $($installer.Name)" }
    }
    $signature = Get-AuthenticodeSignature $installer.FullName
    $isSigned = $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid
    if ($hasCert -and -not $isSigned) {
      throw "Installer signature status is not valid: $($signature.Status)"
    }
    $hash = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($installer.Name)" | Set-Content -Encoding ASCII (Join-Path $bundle ($installer.Name + ".sha256"))
    $record = [ordered]@{
      filename = $installer.Name
      sha256 = $hash
      signed = $isSigned
      signature_status = $signature.Status.ToString()
      subject = if ($isSigned) { $signature.SignerCertificate.Subject } else { $null }
      thumbprint = if ($isSigned) { $signature.SignerCertificate.Thumbprint } else { $null }
    }
    $record | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $bundle ($installer.Name + ".signature.json"))
    if ($isSigned) { Write-Host "Valid signed installer: $($installer.Name)" }
    else { Write-Host "::notice::Unsigned Windows preview: $($installer.Name)" }
    Write-Host "SHA-256 $hash"
  }
} finally {
  if (Test-Path $certPath) { Remove-Item $certPath -Force }
}
