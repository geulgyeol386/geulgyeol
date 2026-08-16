@echo off
cd /d "%~dp0"
start "Geulgyeol Server" cmd /k "node server.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3210/index.html"
