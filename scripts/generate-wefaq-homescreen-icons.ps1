# Home-screen icons only: transparent areas -> pure black (#000), export PWA sizes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$iconsDir = Join-Path $root 'icons'
$master = Join-Path $iconsDir 'wefaq-homescreen-master.png'
if (-not (Test-Path $master)) {
    throw 'Missing icons/wefaq-homescreen-master.png'
}

$Black = [System.Drawing.Color]::FromArgb(255, 0, 0, 0)

function Export-HomeScreenIcon {
    param([int]$Size, [string]$OutName)
    $src = [System.Drawing.Bitmap]::FromFile($master)
    $out = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.Clear($Black)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($src, 0, 0, $Size, $Size)
    $g.Dispose()
    $src.Dispose()
    $outPath = Join-Path $iconsDir $OutName
    $out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
    Write-Host "Wrote $outPath"
}

Export-HomeScreenIcon -Size 512 -OutName 'homescreen-512.png'
Export-HomeScreenIcon -Size 192 -OutName 'homescreen-192.png'
Export-HomeScreenIcon -Size 180 -OutName 'apple-touch-icon.png'

# Aliases used by manifest / head (home screen only)
Copy-Item (Join-Path $iconsDir 'homescreen-512.png') (Join-Path $iconsDir 'wefaq-512.png') -Force
Copy-Item (Join-Path $iconsDir 'homescreen-192.png') (Join-Path $iconsDir 'wefaq-192.png') -Force
