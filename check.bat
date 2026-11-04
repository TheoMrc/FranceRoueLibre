@echo off
rem Verifie tout le site sans depenser un jeton (scripts\check.py) : tests, lieux, Loupe rejouee par un faux modele,
rem donnees, recherches reelles du journal, pages a 390 et 1366 px. A lancer avant deploy_vps.bat.
rem Options : --vite (sans les pages), --accepter (valide les changements du journal), --payant 3 (3 vraies questions)
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
C:\Python\Python310\python.exe scripts\check.py %*
set RC=%ERRORLEVEL%
if "%FRL_NOPAUSE%"=="" pause
exit /b %RC%
