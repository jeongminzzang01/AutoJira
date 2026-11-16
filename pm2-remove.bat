@echo off
cd /d "%~dp0"

echo ============================================================
echo   PM2 Cleanup
echo ============================================================
echo.

echo [1/3] Stopping and deleting all PM2 apps...
call pm2 delete all >nul 2>&1
call pm2 save --force >nul 2>&1

echo [2/3] Removing Windows startup registration...
where pm2-startup >nul 2>&1
if not errorlevel 1 (
    call pm2-startup uninstall >nul 2>&1
)

echo [3/3] Kill any leftover node processes on ports 3000, 3100...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3100 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

echo.
echo ============================================================
echo  Cleanup done.
echo  Note: PM2 itself is still installed globally.
echo        To remove PM2 entirely:  npm uninstall -g pm2 pm2-windows-startup
echo ============================================================
pause
