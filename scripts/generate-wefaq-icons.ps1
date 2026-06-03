# Crop light margins from wefaq-master.png, flatten corners, export PWA sizes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$iconsDir = Join-Path $root 'icons'
$master = Join-Path $iconsDir 'wefaq-master.png'
if (-not (Test-Path $master)) {
    throw 'Missing wefaq-master.png in icons folder.'
}

$Bg = [System.Drawing.Color]::FromArgb(255, 20, 20, 20)

function Get-Luma([System.Drawing.Color]$c) {
    return [int](0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)
}

function Get-IconBounds {
    param([System.Drawing.Bitmap]$Bmp, [int]$LumaMax = 118)
    $minX = $Bmp.Width; $minY = $Bmp.Height; $maxX = 0; $maxY = 0
    for ($y = 0; $y -lt $Bmp.Height; $y++) {
        for ($x = 0; $x -lt $Bmp.Width; $x++) {
            $c = $Bmp.GetPixel($x, $y)
            if ($c.A -lt 16) { continue }
            if ((Get-Luma $c) -le $LumaMax) {
                if ($x -lt $minX) { $minX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    if ($maxX -lt $minX) { throw 'Could not detect logo bounds.' }
    return @{ X = $minX; Y = $minY; W = ($maxX - $minX + 1); H = ($maxY - $minY + 1) }
}

function Flatten-LightPixels {
    param([System.Drawing.Bitmap]$Bmp, [int]$LumaCutoff = 168)
    for ($y = 0; $y -lt $Bmp.Height; $y++) {
        for ($x = 0; $x -lt $Bmp.Width; $x++) {
            $c = $Bmp.GetPixel($x, $y)
            if ((Get-Luma $c) -gt $LumaCutoff) {
                $Bmp.SetPixel($x, $y, $Bg)
            }
        }
    }
}

function Export-WefaqCroppedMaster {
    $src = [System.Drawing.Bitmap]::FromFile($master)
    $b = Get-IconBounds -Bmp $src
    $side = [Math]::Max($b.W, $b.H)
    $cx = $b.X + ($b.W / 2.0)
    $cy = $b.Y + ($b.H / 2.0)
    $x0 = [Math]::Max(0, [int][Math]::Floor($cx - ($side / 2.0)))
    $y0 = [Math]::Max(0, [int][Math]::Floor($cy - ($side / 2.0)))
    if ($x0 + $side -gt $src.Width) { $x0 = $src.Width - $side }
    if ($y0 + $side -gt $src.Height) { $y0 = $src.Height - $side }
    if ($x0 -lt 0) { $x0 = 0 }
    if ($y0 -lt 0) { $y0 = 0 }

    $crop = New-Object System.Drawing.Bitmap $side, $side
    $g = [System.Drawing.Graphics]::FromImage($crop)
    $g.Clear($Bg)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, 0, 0, (New-Object System.Drawing.Rectangle $x0, $y0, $side, $side), [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $src.Dispose()

    Flatten-LightPixels -Bmp $crop
    $croppedPath = Join-Path $iconsDir 'wefaq-cropped.png'
    $crop.Save($croppedPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $crop.Dispose()
    Write-Host "Wrote $croppedPath"
    return $croppedPath
}

function Resize-WefaqIcon {
    param([string]$Source, [int]$Size, [string]$OutName)
    $bmp = [System.Drawing.Bitmap]::FromFile($Source)
    $out = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.Clear($Bg)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($bmp, 0, 0, $Size, $Size)
    $g.Dispose()
    Flatten-LightPixels -Bmp $out
    $outPath = Join-Path $iconsDir $OutName
    $out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose(); $bmp.Dispose()
    Write-Host "Wrote $outPath"
}

$cropped = Export-WefaqCroppedMaster
Resize-WefaqIcon -Source $cropped -Size 512 -OutName 'wefaq-512.png'
Resize-WefaqIcon -Source $cropped -Size 192 -OutName 'wefaq-192.png'
Resize-WefaqIcon -Source $cropped -Size 180 -OutName 'apple-touch-icon.png'
