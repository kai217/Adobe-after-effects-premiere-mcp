@echo off
setlocal
title KAI-AE-MCP installer (After Effects + Premiere Pro)
echo === KAI-AE-MCP: After Effects MCP for Claude ===
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Installing Node.js LTS with winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo.
  echo Node.js installed. Close this window and double-click install.bat again.
  pause
  exit /b
)
set "DEST=%USERPROFILE%\KAI-AE-MCP"
echo Copying to %DEST% ...
REM /XO: never overwrite newer files with older ones (running an old copy of install.bat must not roll the server back).
if /I not "%~dp0"=="%DEST%\" robocopy "%~dp0." "%DEST%" /E /XO /XD node_modules .git /XF config.json /NFL /NDL /NJH /NJS /NP >nul
cd /d "%DEST%"
echo Installing packages (one time)...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
node scripts\install.mjs
echo.
echo Done. Next:
echo  1) Fully quit the Claude desktop app (tray icon ^> Quit), After Effects and Premiere Pro, then open them again.
echo  2) In After Effects: Edit ^> Preferences ^> Scripting ^& Expressions ^> "Allow Scripts to Write Files and Access Network".
echo  3) In Claude, ask: "run kai_doctor" to confirm both apps are connected.
pause
