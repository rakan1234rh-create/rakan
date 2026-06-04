# Home-screen PNGs from icons/wefaq-app-icon.svg (requires: npm install sharp)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$nodeScript = Join-Path $PSScriptRoot 'export-wefaq-homescreen-png.mjs'
if (-not (Test-Path $nodeScript)) { throw 'Missing export-wefaq-homescreen-png.mjs' }
& node $nodeScript
if ($LASTEXITCODE -ne 0) { throw 'SVG export failed. Run: npm install sharp' }
