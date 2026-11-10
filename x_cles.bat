@echo off
rem Saisie des 4 cles de l application X (console.x.com). Invite masquee, stockage chiffre pour ce compte Windows.
cd /d "%~dp0"
C:\Python\Python310\python.exe scripts\x_publish.py cles && C:\Python\Python310\python.exe scripts\x_publish.py verifier
pause
