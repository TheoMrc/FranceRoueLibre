@echo off
rem Same as deploy_vps.bat but without scripts\check.py: for small front-end changes (HTML, CSS, JS) when time counts.
rem Use deploy_vps.bat for anything touching data, scripts or the server.
cd /d "%~dp0"
set FRL_SKIP_CHECK=1
call deploy_vps.bat
