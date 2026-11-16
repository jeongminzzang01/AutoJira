@echo off
echo.
echo ============================================================
echo   AUTOJIRA Firewall Allow (TCP port 3000 inbound)
echo ============================================================
echo.

net session >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Admin rights required.
    echo Right-click this .bat -^> "Run as administrator".
    pause
    exit /b 1
)

netsh advfirewall firewall delete rule name="AUTOJIRA Node 3000" >nul 2>&1
netsh advfirewall firewall add rule name="AUTOJIRA Node 3000" dir=in action=allow protocol=TCP localport=3000 profile=any
if errorlevel 1 (
    echo [ERROR] Failed to add firewall rule.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Done. Coworkers can now reach http://[your-PC-IP]:3000/
echo  Check your IP: run "ipconfig" or open server.log
echo ============================================================
pause
