@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   AUTOJIRA Autostart Installer
echo ============================================================
echo.
echo  Pick install mode:
echo.
echo  [1] Run on user LOGIN (simple)
echo      - Starts when you log in to your PC (hidden background)
echo      - Stops when you log out
echo      - No admin rights needed
echo.
echo  [2] Run on Windows BOOT (always-on)  ^<-- recommended
echo      - Starts at Windows boot as SYSTEM account
echo      - Stays alive even after you log out
echo      - Requires admin rights
echo.
echo  [0] Cancel
echo.
set /p MODE=Select (0/1/2):

if "%MODE%"=="1" goto :mode1
if "%MODE%"=="2" goto :mode2
echo Cancelled.
pause
exit /b 0

:mode1
echo.
echo [1/3] Checking dependencies...
if not exist "node_modules" (
  echo       Installing... (first run only)
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed. Check Node.js installation.
    pause
    exit /b 1
  )
)

echo [2/3] Killing any existing server on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
)

echo [3/3] Registering startup folder shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$wsh=New-Object -ComObject WScript.Shell; $sc=$wsh.CreateShortcut([Environment]::GetFolderPath('Startup')+'\AUTOJIRA.lnk'); $sc.TargetPath='%~dp0run-silent.vbs'; $sc.WorkingDirectory='%~dp0'; $sc.IconLocation='%SystemRoot%\System32\imageres.dll,109'; $sc.Description='AUTOJIRA background proxy'; $sc.Save()"

wscript.exe "%~dp0run-silent.vbs"
timeout /t 2 /nobreak >nul
start "" http://localhost:3000/

echo.
echo ============================================================
echo  [MODE 1] Login-autostart installed.
echo  - Runs in background each time you log in.
echo  - URL: http://localhost:3000/
echo  - LAN IP for coworkers: see server.log
echo  - For always-on (works after logout), re-run with mode 2.
echo ============================================================
pause
exit /b 0

:mode2
echo.
net session >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Admin rights required.
    echo Right-click this .bat -^> "Run as administrator".
    pause
    exit /b 1
)

echo [1/5] Checking dependencies...
if not exist "node_modules" (
  echo       Installing... (first run only)
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

echo [2/5] Detecting node.exe path...
set NODE_EXE=
for /f "delims=" %%a in ('where node 2^>nul') do (
  if not defined NODE_EXE set NODE_EXE=%%a
)
if "%NODE_EXE%"=="" (
    echo [ERROR] node.exe not found.
    echo Node.js must be installed and on system PATH.
    pause
    exit /b 1
)
echo       node path: %NODE_EXE%

echo [3/5] Writing task-runner.cmd wrapper...
(
echo @echo off
echo cd /d "%%~dp0"
echo "%NODE_EXE%" server.js ^>^> server.log 2^>^&1
) > "%~dp0task-runner.cmd"
if not exist "%~dp0task-runner.cmd" (
    echo [ERROR] Failed to write task-runner.cmd
    pause
    exit /b 1
)

echo [4/5] Killing any existing server...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
)
schtasks /End /TN "AUTOJIRA-Server" >nul 2>&1
schtasks /Delete /F /TN "AUTOJIRA-Server" >nul 2>&1

echo [5/5] Registering Task Scheduler entry (ONSTART, SYSTEM)...
schtasks /Create /F /SC ONSTART /RL HIGHEST /RU SYSTEM /TN "AUTOJIRA-Server" /TR "%~dp0task-runner.cmd"
if errorlevel 1 (
    echo [ERROR] Task registration failed.
    pause
    exit /b 1
)

schtasks /Run /TN "AUTOJIRA-Server" >nul 2>&1
timeout /t 3 /nobreak >nul
start "" http://localhost:3000/

echo.
echo ============================================================
echo  [MODE 2] Always-on mode installed.
echo  - Starts at Windows boot as SYSTEM (survives logout).
echo  - Task name: AUTOJIRA-Server
echo  - Wrapper:   %~dp0task-runner.cmd
echo  - Log file:  %~dp0server.log
echo  - URL:       http://localhost:3000/
echo.
echo  Tips:
echo    - Disable PC Sleep (Control Panel -^> Power Options)
echo    - For LAN access from coworkers, also run firewall-allow.bat
echo ============================================================
pause
exit /b 0
