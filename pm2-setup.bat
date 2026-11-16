@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   PM2 Setup for AUTOJIRA + ResourceLite
echo ============================================================
echo.

REM ---- Clean up any legacy autostart to avoid conflict with PM2 ----
echo [1/7] Removing legacy autostart entries...

REM Task Scheduler entries created by autostart-install.bat (mode 2)
schtasks /Delete /F /TN "AUTOJIRA-Server" >nul 2>&1

REM Startup folder shortcuts from earlier setups
set LNK1=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AUTOJIRA.lnk
set LNK2=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ResourceLite.lnk
if exist "%LNK1%" del "%LNK1%" >nul 2>&1
if exist "%LNK2%" del "%LNK2%" >nul 2>&1

REM ---- Kill any running servers on our ports ----
echo [2/7] Killing existing processes on ports 3000, 3100...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3100 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

REM ---- Ensure dependencies for both projects ----
echo [3/7] Checking dependencies...
if not exist "d:\AUTOJIRA\node_modules" (
    echo    Installing AUTOJIRA deps...
    pushd d:\AUTOJIRA & call npm install & popd
)
if not exist "d:\ResourceLite\node_modules" (
    echo    Installing ResourceLite deps...
    pushd d:\ResourceLite & call npm install & popd
)

REM ---- Install PM2 globally (if missing) ----
echo [4/7] Ensuring PM2 is installed...
where pm2 >nul 2>&1
if errorlevel 1 (
    echo    Installing PM2...
    call npm install -g pm2
    if errorlevel 1 (echo ERROR: npm install -g pm2 failed. & pause & exit /b 1)
) else (
    echo    PM2 already installed.
)

REM ---- Install pm2-windows-startup for auto-start on Windows logon ----
echo [5/7] Registering PM2 with Windows startup...
where pm2-startup >nul 2>&1
if errorlevel 1 (
    call npm install -g pm2-windows-startup
    if errorlevel 1 (echo ERROR: pm2-windows-startup install failed. & pause & exit /b 1)
)
call pm2-startup install
if errorlevel 1 (echo ERROR: pm2-startup install failed. & pause & exit /b 1)

REM ---- Start apps via ecosystem file ----
echo [6/7] Starting apps via ecosystem.config.js...
call pm2 delete all >nul 2>&1
call pm2 start "%~dp0ecosystem.config.js"
if errorlevel 1 (echo ERROR: pm2 start failed. & pause & exit /b 1)

REM ---- Save process list so PM2 resurrects them at boot ----
echo [7/7] Saving process list for auto-resurrection...
call pm2 save
if errorlevel 1 (echo ERROR: pm2 save failed. & pause & exit /b 1)

echo.
echo ============================================================
echo  Setup complete.
echo    - AUTOJIRA:     http://localhost:3000/
echo    - ResourceLite: http://localhost:3100/
echo    - Auto-restart on crash: yes (max 20 restarts, min uptime 10s)
echo    - Auto-start on Windows logon: yes
echo.
echo  Useful PM2 commands:
echo    pm2 status                 List running apps
echo    pm2 logs                   Tail live logs (all)
echo    pm2 logs autojira          Tail specific app
echo    pm2 restart all            Restart all
echo    pm2 restart autojira       Restart one
echo    pm2 stop all               Stop all (without removing)
echo    pm2 monit                  Interactive monitor
echo    pm2-remove.bat             Clean everything up
echo ============================================================
echo.
call pm2 status
echo.
pause
