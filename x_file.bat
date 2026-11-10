@echo off
rem File de publication X : ce qui est planifie, ce qui est publie, le cout restant.
cd /d "%~dp0"
C:\Python\Python310\python.exe scripts\x_publish.py file
echo.
C:\Python\Python310\python.exe scripts\x_publish.py lancer --a-blanc
pause
