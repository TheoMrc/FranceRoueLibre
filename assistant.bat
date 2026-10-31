@echo off
rem Double-click: the site with its AI assistant on this PC (http://127.0.0.1:4173), using the keys of .env
rem (same keys as RevoFlow; Gemini through Vertex AI needs "gcloud auth application-default login" once).
rem Three windows: search API (8017), assistant API (8018), site preview (4173). Close them to stop.
rem Spending so far: C:\Python\Python310\python.exe server\assistant_api.py --usage
cd /d "%~dp0"
set PY=C:\Python\Python310\python.exe
set PYTHONIOENCODING=utf-8
if not exist .env (echo .env manquant : copier celui de RevoFlow a la racine du repo. & pause & exit /b 1)
if not exist dist\data\search\frl-search.sqlite3 (
  echo Reconstitution de l'index de recherche a partir de ses morceaux...
  copy /b dist\data\search\db\frl-search.sqlite3.0* dist\data\search\frl-search.sqlite3 >nul || (echo Echec. & pause & exit /b 1)
)
start "FRL search API" "%PY%" server\search_api.py --db dist\data\search\frl-search.sqlite3 --port 8017
start "FRL assistant API" "%PY%" server\assistant_api.py --port 8018
start "FRL site" node serve.mjs
timeout /t 3 >nul
start "" http://127.0.0.1:4173/
