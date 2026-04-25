@echo off
cd /d "%~dp0"
echo Pulling latest updates from GitHub...
git pull
echo.
echo Installing any new dependencies...
npm install
echo.
echo Done.
pause
