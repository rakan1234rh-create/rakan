$ErrorActionPreference = 'Continue'
Write-Host ''
Write-Host '=== تشخيص مرصاد ===' -ForegroundColor Cyan
Write-Host ''

# 1 Local server
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/' -UseBasicParsing -TimeoutSec 8
  Write-Host "[OK] Local server:" $r.StatusCode "bytes:" $r.Content.Length
} catch {
  Write-Host "[FAIL] Local server:" $_.Exception.Message
}

# 2 Supabase key
$key = 'sb_publishable__nGAMUih_RNZ_6FMpwzDNw_116hvA7K'
$uri = 'https://rizoafuxmqsddjfhbsmf.supabase.co/rest/v1/regions?select=id&limit=1'
try {
  $r2 = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 15 -Headers @{
    apikey = $key
    Authorization = "Bearer $key"
  }
  Write-Host "[OK] Supabase REST:" $r2.StatusCode $r2.Content.Substring(0, [Math]::Min(80, $r2.Content.Length))
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $code = [int]$resp.StatusCode
    Write-Host "[FAIL] Supabase REST HTTP" $code
  } else {
    Write-Host "[FAIL] Supabase:" $_.Exception.Message
  }
}

# 3 LAN IP test hint
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)' } | ForEach-Object {
  Write-Host "[IP]" $_.IPAddress $_.InterfaceAlias
  if ($_.IPAddress -like '172.20.10.*') {
    Write-Host '     *** الخلل: hotspot الآيفون ***' -ForegroundColor Red
    Write-Host '     Safari على الآيفون لا يصل للابتوب عبر 172.20.10.x' -ForegroundColor Red
    Write-Host '     الحل: رابط-للجوال.bat (HTTPS) وليس IP المحلي' -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host '=== الخلاصة ===' -ForegroundColor Cyan
Write-Host 'السيرفر المحلي + Supabase على اللابتوب: OK اذا ظهر [OK] اعلاه'
Write-Host 'الجوال على hotspot: استخدم رابط-للجوال.bat فقط'
Write-Host ''
