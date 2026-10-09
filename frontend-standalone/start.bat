@echo off
REM ============================================================
REM  CampusAgent standalone frontend - Windows double-click entry
REM  Delegates to start.ps1 (all logic and paths live there).
REM  ASCII only on purpose: this file must survive any code page.
REM ============================================================
setlocal
cd /d "%~dp0"

set "PS="
where pwsh >nul 2>nul && set "PS=pwsh"
if not defined PS where powershell >nul 2>nul && set "PS=powershell"
if not defined PS (
  echo [ERROR] PowerShell not found. Install PowerShell 7 or use start.ps1 manually.
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
