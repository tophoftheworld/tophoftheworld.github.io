@echo off
cd /d "%~dp0.."
echo Starting workshop admin at http://localhost:5190/admin/
echo.
npx --yes serve . -l 5190
pause
