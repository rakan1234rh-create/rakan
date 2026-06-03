# Generates PNG home-screen icons (iOS / Android) from the Wefaq brand layout.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-WefaqIconPng {
    param([int]$Size, [string]$OutPath)

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::FromArgb(255, 30, 58, 95))

    $scale = $Size / 512.0
    $g.ScaleTransform($scale, $scale)

    $rect = New-Object System.Drawing.RectangleF 66, 56, 380, 380
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 78.0
    $path.AddArc($rect.X, $rect.Y, $r * 2, $r * 2, 180, 90)
    $path.AddArc($rect.Right - $r * 2, $rect.Y, $r * 2, $r * 2, 270, 90)
    $path.AddArc($rect.Right - $r * 2, $rect.Bottom - $r * 2, $r * 2, $r * 2, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $r * 2, $r * 2, $r * 2, 90, 90)
    $path.CloseFigure()

    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF 88, 70),
        (New-Object System.Drawing.PointF 424, 426),
        [System.Drawing.Color]::FromArgb(255, 30, 58, 95),
        [System.Drawing.Color]::FromArgb(255, 15, 37, 64)
    )
    $g.FillPath($brush, $path)

    $white = [System.Drawing.Color]::FromArgb(255, 248, 248, 245)
    $fontFamily = New-Object System.Drawing.FontFamily 'Arial'
    $font = New-Object System.Drawing.Font($fontFamily, 118, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textRect = New-Object System.Drawing.RectangleF 66, 170, 380, 130
    $g.DrawString('wefaq', $font, (New-Object System.Drawing.SolidBrush $white), $textRect, $sf)

    $pen = New-Object System.Drawing.Pen $white, 9
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawBezier($pen, 150, 318, 203, 360, 309, 360, 362, 318)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $white), 141, 309, 18, 18)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $white), 353, 309, 18, 18)

    $dir = Split-Path $OutPath -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $path.Dispose(); $pen.Dispose(); $font.Dispose()
    Write-Host "Wrote $OutPath"
}

$root = Split-Path $PSScriptRoot -Parent
$iconsDir = Join-Path $root 'icons'
New-WefaqIconPng -Size 512 -OutPath (Join-Path $iconsDir 'wefaq-512.png')
New-WefaqIconPng -Size 192 -OutPath (Join-Path $iconsDir 'wefaq-192.png')
New-WefaqIconPng -Size 180 -OutPath (Join-Path $iconsDir 'apple-touch-icon.png')
