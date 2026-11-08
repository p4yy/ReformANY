# Windows-only NSIS artwork: minimal, native-compatible and intentionally static.
# Uses the existing, owner-provided ReformANY icon; no stock or old GIFs.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "src-tauri\windows"
$mark = Join-Path $root "src-tauri\icons\icon.png"
if (!(Test-Path $mark)) { throw "ReformANY brand icon missing: $mark" }
New-Item -ItemType Directory -Force $out | Out-Null

function Color([int]$r, [int]$g, [int]$b) {
  return [System.Drawing.Color]::FromArgb($r,$g,$b)
}
function PaintImage([int]$w, [int]$h, [string]$target, [bool]$sidebar) {
  $img = [System.Drawing.Bitmap]::new($w,$h)
  $g = [System.Drawing.Graphics]::FromImage($img)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $bg = [System.Drawing.SolidBrush]::new((Color 246 247 249))
  $white = [System.Drawing.SolidBrush]::new((Color 31 42 55))
  $muted = [System.Drawing.SolidBrush]::new((Color 97 110 128))
  $accent = [System.Drawing.SolidBrush]::new((Color 45 115 220))
  $line = [System.Drawing.Pen]::new((Color 217 224 234), 1)
  $g.FillRectangle($bg, 0, 0, $w, $h)
  $fontBig = [System.Drawing.Font]::new("Segoe UI",15,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
  $fontSmall = [System.Drawing.Font]::new("Segoe UI",11,[System.Drawing.FontStyle]::Regular,[System.Drawing.GraphicsUnit]::Pixel)
  $fontMicro = [System.Drawing.Font]::new("Segoe UI",9,[System.Drawing.FontStyle]::Regular,[System.Drawing.GraphicsUnit]::Pixel)
  $logo = [System.Drawing.Image]::FromFile($mark)
  try {
    if ($sidebar) {
      $g.DrawImage($logo, 23, 41, 44, 44)
      $g.DrawString("ReformANY",$fontBig,$white,22,105)
      $g.DrawString("File tools for Windows",$fontSmall,$muted,22,139)
      $g.DrawString("Local by design",$fontSmall,$muted,22,155)
      $g.DrawLine($line, 22, 265, 142, 265)
      $g.DrawString("ReformANY 0.3",$fontMicro,$muted,22,277)
    } else {
      $g.DrawImage($logo,13,14,29,29)
      $g.DrawString("ReformANY",$fontBig,$white,49,20)
    }
    $img.Save($target,[System.Drawing.Imaging.ImageFormat]::Bmp)
  } finally {
    $logo.Dispose()
    $fontBig.Dispose();$fontSmall.Dispose();$fontMicro.Dispose()
    $line.Dispose();$accent.Dispose();$muted.Dispose();$white.Dispose();$bg.Dispose()
    $g.Dispose();$img.Dispose()
  }
}
PaintImage 164 314 (Join-Path $out "installer-sidebar.bmp") $true
PaintImage 150 57 (Join-Path $out "installer-header.bmp") $false
Write-Host "Generated ReformANY\'s native light NSIS artwork."
