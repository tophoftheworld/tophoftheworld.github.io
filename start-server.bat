@echo off
cd /d D:\Users\toph\Documents\tophoftheworld.github.io
start /min cmd /c "node matchanese-hub\dev-server.mjs"
timeout /t 2 /nobreak >nul
start http://127.0.0.1:8080/
