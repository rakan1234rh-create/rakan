@echo off
chcp 65001 >nul
title مرصاد - الخادم
cd /d "%~dp0"
set PORT=8080

where npx >nul 2>&1
if errorlevel 1 (
  echo.
  echo [خطأ] Node.js غير مثبت.
  echo حمّله من: https://nodejs.org
  echo ثم أعد تشغيل هذا الملف.
  echo.
  pause
  exit /b 1
)

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  taskkill /F /PID %%p >nul 2>&1
)

cls
echo.
echo ============================================
echo            منصة مرصاد - الخادم
echo ============================================
echo.
echo   الكمبيوتر:
echo   http://localhost:%PORT%
echo.
echo   الجوال ^(نفس شبكة Wi-Fi^):
powershell -NoProfile -Command "$ok=$false; $hot=$false; Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)' } | ForEach-Object { $ok=$true; if($_.IPAddress -like '172.20.10.*'){$hot=$true}; Write-Host ('   http://{0}:{1}  [{2}]' -f $_.IPAddress,%PORT%,$_.InterfaceAlias) }; if(-not $ok){ Write-Host '   ^(لا يوجد Wi-Fi^)' }; if($hot){ Write-Host ''; Write-Host '   *** تحذير: اللابتوب على hotspot الآيفون ***' -ForegroundColor Red; Write-Host '   Safari على نفس الآيفون لا يفتح اللابتوب عادة' -ForegroundColor Red; Write-Host '   الحل: رابط-للجوال.bat  او Wi-Fi راوتر مشترك' -ForegroundColor Yellow }"
echo.
echo   اذا الجوال لا يفتح LAN: شغّل رابط-للجوال.bat ^(HTTPS^)
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '172.20.10.*' } | Select-Object -First 1).IPAddress"') do set MR_HOTSPOT=%%i
if defined MR_HOTSPOT (
  echo.
  echo   >>> hotspot آيفون: فتح رابط HTTPS للجوال تلقائياً...
  timeout /t 2 >nul
  start "" "%~dp0رابط-للجوال.bat"
)
echo.
echo   --- اختبار على اللابتوب ---
echo   جرّب نفس رابط الجوال ^(ليس localhost فقط^):
echo   مثال: http://172.20.10.2:%PORT%
echo   - يفتح على اللابتوب ولا يفتح على الجوال = شبكة Wi-Fi تمنع الاتصال
echo   - لا يفتح حتى على اللابتوب = شغّل فتح-وصول-الجوال.bat كمسؤول
echo.
echo   اترك هذه النافذة مفتوحة - Ctrl+C للإيقاف
echo ============================================
echo.

REM لا تستخدم "%~dp0" هنا — الشرطة \ قبل " تكسر الأمر وتسبب 404
npx --yes http-server . -p %PORT% -a 0.0.0.0 -c-1

echo.
echo توقف الخادم.
pause
