@echo off
cd /d "%~dp0"

echo.
echo ============================================================
echo   AUTOJIRA Autostart Uninstaller
echo ============================================================
echo.

set LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AUTOJIRA.lnk
if exist "%LNK%" (
  del "%LNK%"
  echo [1] Login-autostart (Mode 1) removed.
) else (
  echo [1] No Mode 1 entry.
)

schtasks /Query /TN "AUTOJIRA-Server" >nul 2>&1
if not errorlevel 1 (
  schtasks /Delete /F /TN "AUTOJIRA-Server" >nul 2>&1
  if errorlevel 1 (
    echo [2] Mode 2 task removal failed - needs admin rights.
  ) else (
    echo [2] Always-on (Mode 2) removed.
  )
) else (
  echo [2] No Mode 2 task.
)

if exist "%~dp0task-runner.cmd" (
  del "%~dp0task-runner.cmd"
  echo [3] task-runner.cmd removed.
)

echo [4] Killing any running server on port 3000...
set KILLED=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
  set KILLED=1
)
if "%KILLED%"=="1" (echo      Killed.) else (echo      None running.)

echo.
echo ============================================================
echo  Uninstall complete. Use start.bat for manual run.
echo ============================================================
pause
