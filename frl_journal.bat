@echo off
rem Questions posees a la Loupe et recherches du site (journaux du VPS, sans adresse IP) : nombre par jour,
rem les dernieres, et tout garde dans _journal\loupe.csv et _journal\recherches.csv (ignores par git).
rem Exemple : frl_journal.bat --days 30 --last 40
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
C:\Python\Python310\python.exe scripts\frl_journal.py %*
pause
