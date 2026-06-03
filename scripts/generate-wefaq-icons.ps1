# Resize wefaq-master.png into PWA / home-screen icon sizes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$iconsDir = Join-Path $root 'icons'
$master = Join-Path $iconsDir 'wefaq-master.png'
if (-not (Test-Path $master)) {
    throw "Missing wefaq-master.png in icons folder."
}

function Resize-WefaqIcon {
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

Resize-WefaqIcon -Size 512 -OutName 'wefaq-512.png'
Resize-WefaqIcon -Size 192 -OutName 'wefaq-192.png'
Resize-WefaqIcon -Size 180 -OutName 'apple-touch-icon.png'
