@echo off
echo =========================================
echo   Starting GitHub Sync Process
echo =========================================
echo.

git add .

set /p msg="Enter commit message (Press Enter for 'Update'): "
if "%msg%"=="" set msg=Update

echo.
git commit -m "%msg%"
echo.

echo Pulling latest changes from GitHub...
git pull --rebase

echo.
echo Pushing to GitHub...
git push

echo.
echo =========================================
echo   Process Completed.
echo =========================================
pause
