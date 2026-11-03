@echo off
rem Double-click: give the password of stonks@francerouelibre.fr (Zimbra OVH) once. It is checked on OVH's servers,
rem stored encrypted on biodevs-vps (systemd-creds) and never written in clear, then the site is redeployed.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mail_credentials.ps1"
pause
