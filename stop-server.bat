@echo off
echo Stopping Python HTTP server on port 8080...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080 ^| findstr LISTENING') do (
    taskkill /F /PID %%a
    echo Server stopped.
)
pause










