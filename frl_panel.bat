@echo off
rem Tableau de bord local : visites (frl-stats), questions a la Loupe et recherches (frl_journal), en graphiques.
rem Ecrit _journal\panel.html (ignore par git) et l ouvre dans le navigateur. Sans VPS : frl_panel.bat --offline
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
C:\Python\Python310\python.exe scripts\frl_panel.py %*
if errorlevel 1 pause
