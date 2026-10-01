@echo off
title GUG-cli
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   GUG-cli needs Node.js 20 or newer. Opening the download page...
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo   First run: installing GUG-cli. This takes a minute...
  call npm install || goto :fail
)
if not exist web\dist\index.html (
  echo   Building the app...
  call npm run build || goto :fail
)
if not exist dist\cli.js (
  call npm run build || goto :fail
)
node bin\gug.mjs serve %*
exit /b 0
:fail
echo.
echo   Something went wrong above. Copy the red text and ask Forge or Atlas for help.
pause
exit /b 1
