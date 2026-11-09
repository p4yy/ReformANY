# Applies an owner-provided PNG to the ONE canonical ReformANY logo location
# and regenerates Windows icon.ico without redrawing or altering the logo artwork.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/apply-official-logo.ps1 -ImagePath "C:\...\official.png"
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ImagePath)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing
$Root = Split-Path -Parent $PSScriptRoot
$InputPath = (Resolve-Path -LiteralPath $ImagePath).Path
$IconDir = Join-Path $Root "src-tauri\icons"
$PublicDir = Join-Path $Root "public\brand"
New-Item -ItemType Directory -Path $IconDir, $PublicDir -Force | Out-Null
$Image = [System.Drawing.Image]::FromFile($InputPath)
try {
  if ($Image.RawFormat.Guid -ne [System.Drawing.Imaging.ImageFormat]::Png.Guid) {
    throw "Provide a PNG export of the official logo. This script never recreates the brand mark."
  }
  if ($Image.Width -lt 256 -or $Image.Height -lt 256) {
    throw "A PNG at least 256 x 256 px is required for a crisp Windows icon."
  }
  $Canonical = Join-Path $IconDir "icon.png"
  $Public = Join-Path $PublicDir "reformany-icon.png"
  if ($InputPath -ne $Canonical) { Copy-Item -LiteralPath $InputPath -Destination $Canonical -Force }
  Copy-Item -LiteralPath $Canonical -Destination $Public -Force

  $Sizes = @(16, 24, 32, 48, 64, 128, 256)
  $PngEntries = [System.Collections.Generic.List[byte[]]]::new()
  foreach ($Size in $Sizes) {
    $Canvas = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $G = [System.Drawing.Graphics]::FromImage($Canvas)
    try {
      $G.Clear([System.Drawing.Color]::Transparent)
      $G.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $G.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $G.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $Scale = [Math]::Min($Size / $Image.Width, $Size / $Image.Height)
      $W = [int][Math]::Round($Image.Width * $Scale)
      $H = [int][Math]::Round($Image.Height * $Scale)
      $X = [int][Math]::Floor(($Size - $W) / 2)
      $Y = [int][Math]::Floor(($Size - $H) / 2)
      $G.DrawImage($Image, $X, $Y, $W, $H)
      $Stream = [System.IO.MemoryStream]::new()
      try {
        $Canvas.Save($Stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $PngEntries.Add($Stream.ToArray())
      } finally { $Stream.Dispose() }
    } finally { $G.Dispose(); $Canvas.Dispose() }
  }

  $IcoFile = Join-Path $IconDir "icon.ico"
  $Stream = [System.IO.File]::Open($IcoFile, [System.IO.FileMode]::Create)
  $Writer = [System.IO.BinaryWriter]::new($Stream)
  try {
    $Writer.Write([UInt16]0)
    $Writer.Write([UInt16]1)
    $Writer.Write([UInt16]$Sizes.Count)
    $Offset = [UInt32](6 + 16 * $Sizes.Count)
    for ($Index=0; $Index -lt $Sizes.Count; $Index++) {
      $Size = $Sizes[$Index]
      $Entry = $PngEntries[$Index]
      $Writer.Write([byte]($Size % 256))
      $Writer.Write([byte]($Size % 256))
      $Writer.Write([byte]0)
      $Writer.Write([byte]0)
      $Writer.Write([UInt16]1)
      $Writer.Write([UInt16]32)
      $Writer.Write([UInt32]$Entry.Length)
      $Writer.Write([UInt32]$Offset)
      $Offset += [UInt32]$Entry.Length
    }
    foreach ($Entry in $PngEntries) { $Writer.Write($Entry) }
  } finally { $Writer.Dispose() }
  Write-Host "Official logo updated in main UI, Orbit, HoveR, welcome and Windows/installer resources."
  Write-Host "Run npm run tauri build on Windows to package the updated app and installer."
} finally { $Image.Dispose() }
