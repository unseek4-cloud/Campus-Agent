@echo off
REM ============================================================
REM  CampusAgent standalone frontend - Chinese-named entry point
REM  (double-click this file to start)
REM
REM  Identical job to start.bat: delegate to start.ps1, which owns
REM  every path and all launcher logic. Keep this file thin so the
REM  two entry points can never drift apart.
REM
REM  ASCII only on purpose: .bat parsing under code page 936 (GBK)
REM  mangles UTF-8 text, and the repo stores no absolute developer
REM  paths. The Chinese lives in the file name only.
REM ============================================================
setlocal
cd /d "%~dp0"

set "PS="
where pwsh >nul 2>nul && set "PS=pwsh"
if not defined PS where powershell >nul 2>nul && set "PS=powershell"
if not defined PS (
  echo [ERROR] PowerShell not found. Install PowerShell 7 or run start.ps1 manually.
  pause
  exit /b 1
)

echo Starting CampusAgent frontend launcher...
%PS% -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set "CODE=%ERRORLEVEL%"

if not "%CODE%"=="0" (
  echo.
  echo [ERROR] launcher exited with code %CODE%.
  echo         Read the messages above, or run:  start.ps1 -FrontendOnly
  pause
)
exit /b %CODE%
