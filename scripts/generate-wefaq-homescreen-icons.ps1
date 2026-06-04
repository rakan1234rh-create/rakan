# Home-screen icons: strip outer bg, tight crop, full-bleed on black (iOS/Android).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$Black = [System.Drawing.Color]::FromArgb(255, 0, 0, 0)

function Get-Luma([System.Drawing.Color]$c) {
    return 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
}

function Test-IsBackgroundPixel {
    param([System.Drawing.Color]$c, [System.Drawing.Color]$cornerRef)
    if ($c.A -lt 20) { return $true }
    if ((Get-Luma $c) -gt 215) { return $true }
    $dr = [Math]::Abs($c.R - $cornerRef.R)
    $dg = [Math]::Abs($c.G - $cornerRef.G)
    $db = [Math]::Abs($c.B - $cornerRef.B)
    if ($dr -le 45 -and $dg -le 45 -and $db -le 45) { return $true }
    return $false
}

function Clean-CornerFringe {
    param([System.Drawing.Bitmap]$Bmp)
    $w = $Bmp.Width; $h = $Bmp.Height
    $visited = New-Object 'bool[]' ($w * $h)
    $queue = [System.Collections.Generic.Queue[int]]::new()

    function EnqueueLight([int]$x, [int]$y) {
        if ($x -lt 0 -or $y -lt 0 -or $x -ge $w -or $y -ge $h) { return }
        $i = $y * $w + $x
        if ($visited[$i]) { return }
        if ((Get-Luma ($Bmp.GetPixel($x, $y))) -le 165) { return }
        $visited[$i] = $true
        $queue.Enqueue($x); $queue.Enqueue($y)
    }

    for ($x = 0; $x -lt $w; $x++) { EnqueueLight $x 0; EnqueueLight $x ($h - 1) }
    for ($y = 0; $y -lt $h; $y++) { EnqueueLight 0 $y; EnqueueLight ($w - 1) $y }

    while ($queue.Count -gt 0) {
        $x = $queue.Dequeue(); $y = $queue.Dequeue()
        EnqueueLight ($x - 1) $y; EnqueueLight ($x + 1) $y
        EnqueueLight $x ($y - 1); EnqueueLight $x ($y + 1)
    }

    for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
            if ($visited[$y * $w + $x]) { $Bmp.SetPixel($x, $y, $Black) }
        }
    }
}

function Get-VisibleBounds {
    param([System.Drawing.Bitmap]$Bmp, [int]$LumaMin = 22)
    $minX = $Bmp.Width; $minY = $Bmp.Height; $maxX = 0; $maxY = 0
    for ($y = 0; $y -lt $Bmp.Height; $y++) {
        for ($x = 0; $x -lt $Bmp.Width; $x++) {
            if ((Get-Luma ($Bmp.GetPixel($x, $y))) -gt $LumaMin) {
                if ($x -lt $minX) { $minX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    if ($maxX -lt $minX) { throw 'No visible icon content found.' }
    return @{ X = $minX; Y = $minY; W = ($maxX - $minX + 1); H = ($maxY - $minY + 1) }
}

function Remove-OuterBackground {
    param([System.Drawing.Bitmap]$Bmp)
    $w = $Bmp.Width; $h = $Bmp.Height
    $cornerRef = $Bmp.GetPixel([int]($w / 2), 0)
    $visited = New-Object 'bool[]' ($w * $h)
    $queue = [System.Collections.Generic.Queue[int]]::new()

    function Enqueue([int]$x, [int]$y) {
        if ($x -lt 0 -or $y -lt 0 -or $x -ge $w -or $y -ge $h) { return }
        $i = $y * $w + $x
        if ($visited[$i]) { return }
        if (-not (Test-IsBackgroundPixel ($Bmp.GetPixel($x, $y)) $cornerRef)) { return }
        $visited[$i] = $true
        $queue.Enqueue($x); $queue.Enqueue($y)
    }

    for ($x = 0; $x -lt $w; $x++) { Enqueue $x 0; Enqueue $x ($h - 1) }
    for ($y = 0; $y -lt $h; $y++) { Enqueue 0 $y; Enqueue ($w - 1) $y }

    while ($queue.Count -gt 0) {
        $x = $queue.Dequeue(); $y = $queue.Dequeue()
        Enqueue ($x - 1) $y; Enqueue ($x + 1) $y
        Enqueue $x ($y - 1); Enqueue $x ($y + 1)
    }

    $minX = $w; $minY = $h; $maxX = 0; $maxY = 0
    for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
            if ($visited[$y * $w + $x]) { continue }
            if ($x -lt $minX) { $minX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }

    $cw = $maxX - $minX + 1; $ch = $maxY - $minY + 1
    $side = [Math]::Max($cw, $ch)
    $stage = New-Object System.Drawing.Bitmap $side, $side, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($stage)
    $g.Clear($Black)
    $ox = [int][Math]::Floor(($side - $cw) / 2.0)
    $oy = [int][Math]::Floor(($side - $ch) / 2.0)
    $g.DrawImage($Bmp, $ox, $oy, (New-Object System.Drawing.Rectangle $minX, $minY, $cw, $ch), [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $Bmp.Dispose()
    Clean-CornerFringe -Bmp $stage

    $t = Get-VisibleBounds -Bmp $stage
    $tight = New-Object System.Drawing.Bitmap $t.W, $t.H, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g2 = [System.Drawing.Graphics]::FromImage($tight)
    $g2.DrawImage($stage, 0, 0, (New-Object System.Drawing.Rectangle $t.X, $t.Y, $t.W, $t.H), [System.Drawing.GraphicsUnit]::Pixel)
    $g2.Dispose()
    $stage.Dispose()
    return $tight
}

function Export-HomeScreenIcon {
    param([System.Drawing.Bitmap]$Content, [int]$Size, [string]$OutPath)
    $out = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.Clear($Black)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $pad = 0
    $inner = $Size - (2 * $pad)
    $scale = [Math]::Max($inner / $Content.Width, $inner / $Content.Height)
    $dw = [int][Math]::Round($Content.Width * $scale)
    $dh = [int][Math]::Round($Content.Height * $scale)
    $dx = [int][Math]::Floor(($Size - $dw) / 2.0)
    $dy = [int][Math]::Floor(($Size - $dh) / 2.0)
    $g.DrawImage($Content, $dx, $dy, $dw, $dh)
    $g.Dispose()
    Clean-CornerFringe -Bmp $out
    $out.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
    Write-Host "Wrote $OutPath"
}

$root = Split-Path $PSScriptRoot -Parent
$iconsDir = Join-Path $root 'icons'
$homeMaster = Join-Path $iconsDir 'wefaq-homescreen-master.png'
if (-not (Test-Path $homeMaster)) { throw 'Missing icons/wefaq-homescreen-master.png' }

$src = New-Object System.Drawing.Bitmap $homeMaster
$content = Remove-OuterBackground -Bmp $src
$content.Save((Join-Path $iconsDir 'wefaq-homescreen-clean.png'), [System.Drawing.Imaging.ImageFormat]::Png)

Export-HomeScreenIcon -Content $content -Size 512 -OutPath (Join-Path $iconsDir 'homescreen-512.png')
Export-HomeScreenIcon -Content $content -Size 192 -OutPath (Join-Path $iconsDir 'homescreen-192.png')
Export-HomeScreenIcon -Content $content -Size 180 -OutPath (Join-Path $iconsDir 'apple-touch-icon.png')
$content.Dispose()

Copy-Item (Join-Path $iconsDir 'homescreen-512.png') (Join-Path $iconsDir 'wefaq-512.png') -Force
Copy-Item (Join-Path $iconsDir 'homescreen-192.png') (Join-Path $iconsDir 'wefaq-192.png') -Force

$appMaster = Join-Path $iconsDir 'wefaq-app-master.png'
if (Test-Path $appMaster) {
    $appSrc = New-Object System.Drawing.Bitmap $appMaster
    $appContent = Remove-OuterBackground -Bmp $appSrc
    Export-HomeScreenIcon -Content $appContent -Size 512 -OutPath (Join-Path $iconsDir 'wefaq-app-512.png')
    $appContent.Dispose()
}
