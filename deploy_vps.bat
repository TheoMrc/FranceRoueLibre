@echo off
rem Double-click: push main to GitHub, then update https://francerouelibre.fr on biodevs-vps
rem (git pull of the repo, nginx config, HTTPS certificate if missing, live check). See deploy\vps.sh.
cd /d "%~dp0"
echo === git push (main to GitHub)
git push || (echo Push failed: commit your changes first. & pause & exit /b 1)
echo.
echo === Updating biodevs-vps
ssh -o BatchMode=yes biodevs-vps "bash -s" < deploy\vps.sh || (echo VPS update failed. & pause & exit /b 1)
echo.
echo Done: https://francerouelibre.fr/ (Ctrl+F5)
pause
