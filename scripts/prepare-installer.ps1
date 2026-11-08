# Windows-only NSIS artwork: dark, quiet, original and intentionally static.
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
  $bg = [System.Drawing.SolidBrush]::new((Color 17 21 27))
  $white = [System.Drawing.SolidBrush]::new((Color 244 248 252))
  $muted = [System.Drawing.SolidBrush]::new((Color 157 174 193))
  $accent = [System.Drawing.SolidBrush]::new((Color 73 143 242))
  $line = [System.Drawing.Pen]::new((Color 47 63 83), 1)
  $g.FillRectangle($bg, 0, 0, $w, $h)
  $fontBig = [System.Drawing.Font]::new("Segoe UI",16,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
  $fontSmall = [System.Drawing.Font]::new("Segoe UI",10,[System.Drawing.FontStyle]::Regular,[System.Drawing.GraphicsUnit]::Pixel)
  $fontMicro = [System.Drawing.Font]::new("Segoe UI",9,[System.Drawing.FontStyle]::Regular,[System.Drawing.GraphicsUnit]::Pixel)
  $logo = [System.Drawing.Image]::FromFile($mark)
  try {
    if ($sidebar) {
      $g.FillRectangle($accent,23,22,3,22)
      $g.DrawImage($logo, 23, 61, 48, 48)
      $g.DrawString("ReformANY",$fontBig,$white,22,126)
      $g.DrawString("A simpler way to",$fontSmall,$muted,23,162)
      $g.DrawString("work with files.",$fontSmall,$muted,23,177)
      $g.DrawLine($line, 23, 220, 141, 220)
      $g.DrawString("LOCAL",$fontMicro,$white,23,240)
      $g.DrawString("PRIVATE",$fontMicro,$white,23,254)
      $g.DrawString("EFFORTLESS",$fontMicro,$white,23,268)
      $g.FillEllipse($accent,123,268,6,6)
    } else {
      $g.DrawImage($logo,13,13,31,31)
      $g.DrawString("ReformANY",$fontBig,$white,50,15)
      $g.FillRectangle($accent,49,40,65,2)
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
Write-Host "Generated ReformANY's dark branded NSIS artwork."
