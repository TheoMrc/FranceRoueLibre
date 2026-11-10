@echo off
rem Publication automatique : une tache Windows lance la file X toutes les 10 minutes quand le PC est allume.
rem A lancer une fois. Pour arreter : Planificateur de taches, tache FranceRoueLibre-X, Desactiver.
cd /d "%~dp0"
schtasks /Create /F /SC MINUTE /MO 10 /TN "FranceRoueLibre-X" /TR "cmd /c cd /d %~dp0 && C:\Python\Python310\python.exe scripts\x_publish.py lancer >> _transfer\x\auto.log 2>&1"
pause
