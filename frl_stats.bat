@echo off
rem Statistiques de visites de francerouelibre.fr (server/frl_stats.py sur le VPS). Exemple : frl_stats.bat --days 30
ssh biodevs-vps sudo -n frl-stats %*
pause
