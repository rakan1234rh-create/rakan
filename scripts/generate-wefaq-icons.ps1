# App icons (inside the UI) — separate from home-screen icons.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$iconsDir = Join-Path $root 'icons'
$master = Join-Path $iconsDir 'wefaq-app-master.png'
if (-not (Test-Path $master)) {
    $fallback = Join-Path $iconsDir 'wefaq-master.png'
    if (Test-Path $fallback) { Copy-Item $fallback $master -Force }
}
if (-not (Test-Path $master)) {
    throw 'Missing icons/wefaq-app-master.png'
}

function Resize-WefaqAppIcon {
    param([int]$Size, [string]$OutName)
    $bmp = [System.Drawing.Image]::FromFile($master)
    $out = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($bmp, 0, 0, $Size, $Size)
    $outPath = Join-Path $iconsDir $OutName
    $out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $out.Dispose(); $bmp.Dispose()
    Write-Host "Wrote $outPath"
}

Resize-WefaqAppIcon -Size 512 -OutName 'wefaq-app-512.png'
