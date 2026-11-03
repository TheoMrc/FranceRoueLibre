@echo off
rem Tableau de bord local : visites (frl-stats), questions a la Loupe et recherches (frl_journal), en graphiques,
rem et demandes aux administrations a relire. Ouvre http://127.0.0.1:8765 : laisser cette fenetre ouverte. Sans VPS : frl_panel.bat --offline
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
C:\Python\Python310\python.exe scripts\frl_panel.py %*
if errorlevel 1 pause
