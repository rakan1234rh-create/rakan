# Regenerate in-app icon only (same flatten rules as home-screen script).
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'generate-wefaq-homescreen-icons.ps1')
