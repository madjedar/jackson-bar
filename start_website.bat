@echo off
title Jackson Bar - Academy Web Server
color 0A
echo =====================================================================
echo                JACKSON BAR - COCKTAIL & BARISTA ACADEMY
echo =====================================================================
echo.
echo  [+] Launching local web server with database support on Port 8000...
echo  [+] Your browser will open automatically in a moment.
echo  [+] Press Ctrl+C in this window anytime to stop the server.
echo.
echo =====================================================================
timeout /t 2 /nobreak >nul
start "" http://localhost:8000/
python server.py 8000
pause
