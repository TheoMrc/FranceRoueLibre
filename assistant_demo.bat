@echo off
rem Double-click: the site with a FAKE assistant (server\assistant\fake.py) to test the panel and its animations
rem without calling Google or Anthropic: no key needed, no token spent. Words in a question pick a scenario:
rem "erreur" (Gemini fails, Claude takes over), "panne" (both fail), "long", "commune Rennes", "web".
cd /d "%~dp0"
set PY=C:\Python\Python310\python.exe
set PYTHONIOENCODING=utf-8
if not exist dist\data\search\frl-search.sqlite3 (
  echo Reconstitution de l'index de recherche a partir de ses morceaux...
  copy /b dist\data\search\db\frl-search.sqlite3.0* dist\data\search\frl-search.sqlite3 >/dev/null || (echo Echec. & pause & exit /b 1)
)
start "FRL search API" "%PY%" server\search_api.py --db dist\data\search\frl-search.sqlite3 --port 8017
start "FRL assistant API (demo)" "%PY%" server\assistant_api.py --port 8018 --fake
start "FRL site" node serve.mjs
timeout /t 3 >nul
start "" http://127.0.0.1:4173/
