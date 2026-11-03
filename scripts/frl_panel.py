"""Tableau de bord local de francerouelibre.fr : visites (frl-stats sur le VPS), questions à la Loupe et recherches
(journaux du VPS, comme frl_journal.py), demandes aux administrations à relire (frl-demandes), réunis dans une page HTML
avec des graphiques, ouverte dans le navigateur. Rien n'est publié : la page est écrite dans _journal/panel.html
(ignoré par git). Lancé par frl_panel.bat.

  python scripts/frl_panel.py [--offline] [--no-open] [--no-serve]

Par défaut, la page est servie sur http://127.0.0.1:8765 tant que la fenêtre reste ouverte : les boutons des demandes
(envoyer, refuser, publier la réponse, clôturer) appellent alors frl-demandes sur le VPS par ssh. Seule cette page peut
les utiliser (jeton tiré à chaque lancement, écoute sur 127.0.0.1 seulement).
--offline : sans appeler le VPS, avec les CSV de _journal/ et la dernière copie des visites (_journal/stats.json).
--no-serve : écrit seulement le fichier (boutons des demandes inactifs)."""
import argparse
import csv
import datetime as dt
import json
import http.server
import re
import secrets
import subprocess
import sys
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import frl_journal as J  # noqa: E402

ROOT, OUT = J.ROOT, J.OUT
TEMPLATE = Path(__file__).resolve().parent / 'frl_panel.html'


def visits(offline: bool):
    """Daily visits {day: {views, visitors, searches, pages, refs}} from frl-stats --json, kept in _journal/stats.json."""
    cache = OUT / 'stats.json'
    if not offline:
        try:
            r = subprocess.run(['ssh', '-o', 'BatchMode=yes', 'biodevs-vps', 'sudo -n frl-stats --json'],
                               capture_output=True, timeout=300)
            if r.returncode == 0 and r.stdout.strip():
                data = json.loads(r.stdout.decode('utf-8'))
                OUT.mkdir(exist_ok=True)
                cache.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
                return data, None
            why = r.stderr.decode('utf-8', 'replace').strip()[:200] or f'code {r.returncode}'
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            why = str(exc)[:200]
    else:
        why = 'mode hors ligne'
    try:
        return json.loads(cache.read_text(encoding='utf-8')), f'Visites non rafraîchies ({why}) : dernière copie.'
    except (OSError, ValueError):
        return {}, f'Visites indisponibles ({why}).'


def journals(offline: bool):
    """Refreshes _journal/loupe.csv and recherches.csv from the VPS (like frl_journal.bat), then reads them whole."""
    note = None
    if offline:
        note = 'Journaux non rafraîchis (mode hors ligne).'
    else:
        try:
            loupe, searches = J.fetch()
            J.save(OUT / 'loupe.csv', J.LOUPE_COLS, loupe, lambda r: r['id'])
            J.save(OUT / 'recherches.csv', J.SEARCH_COLS, searches, lambda r: f'{r["t"]}|{r["q"]}|{r["cache"]}')
        except SystemExit as exc:  # fetch() exits with a message when the VPS cannot be read
            note = f'Journaux non rafraîchis ({str(exc)[:160]}) : CSV déjà enregistrés.'
        except (OSError, subprocess.SubprocessError) as exc:
            note = f'Journaux non rafraîchis ({str(exc)[:160]}) : CSV déjà enregistrés.'

    def read(name):
        try:
            with open(OUT / name, newline='', encoding='utf-8-sig') as h:
                return list(csv.DictReader(h))
        except OSError:
            return []
    return read('loupe.csv'), read('recherches.csv'), note


REF = re.compile(r'^FRL-\d{4}-\d{4}$')
ACTIONS = ('valider', 'refuser', 'publier', 'cloturer')


def frl_demandes(action: str, ref: str = '', text: str = '') -> dict:
    """Runs frl-demandes on the VPS (server/assistant_api.py --demandes) and returns its JSON."""
    if action != 'tout' and (action not in ACTIONS or not REF.match(ref)):
        return {'error': 'action ou référence refusée'}
    if action == 'publier' and text.strip():
        remote = f't=$(mktemp) && cat > "$t" && frl-demandes publier {ref} --texte "$t"; rm -f "$t"'
    else:
        remote = f'frl-demandes {action} {ref}'.strip()
    try:
        r = subprocess.run(['ssh', '-o', 'BatchMode=yes', 'biodevs-vps', remote], input=text.encode('utf-8'),
                           capture_output=True, timeout=120)
        out = r.stdout.decode('utf-8', 'replace')
        return json.loads(out[out.index('{'):]) if '{' in out else {'error': (out or r.stderr.decode('utf-8', 'replace'))[:300]}
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        return {'error': f'VPS injoignable : {str(exc)[:200]}'}


def serve(page: Path, token: str, port: int = 8765) -> None:
    """The panel and its request buttons, on 127.0.0.1 only, until the window is closed."""
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *args):
            pass

        def reply(self, code: int, obj: dict):
            body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def allowed(self) -> bool:
            return secrets.compare_digest(self.headers.get('X-Panel-Token') or '', token)

        def do_GET(self):
            if self.path in ('/', '/panel'):
                self.send_response(302)
                self.send_header('Location', '/_journal/panel.html')
                self.end_headers()
                return
            if self.path == '/api/demandes':
                return self.reply(200, frl_demandes('tout')) if self.allowed() else self.reply(403, {'error': 'refusé'})
            if not (self.path.startswith('/_journal/panel.html') or self.path.startswith('/dist/vendor/fonts/')):
                return self.reply(404, {'error': 'introuvable'})
            return super().do_GET()

        def do_POST(self):
            if self.path != '/api/demandes' or not self.allowed():
                return self.reply(403, {'error': 'refusé'})
            try:
                body = json.loads(self.rfile.read(min(int(self.headers.get('Content-Length') or 0), 60000)))
            except ValueError:
                return self.reply(400, {'error': 'requête illisible'})
            res = frl_demandes(str(body.get('action') or ''), str(body.get('ref') or ''), str(body.get('texte') or ''))
            print(f'  {body.get("action")} {body.get("ref")} : {res.get("status") or res.get("error") or "ok"}', flush=True)
            return self.reply(200, res)

    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'Panneau : http://127.0.0.1:{port}/  (fermez cette fenêtre pour l’arrêter)', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def caps():
    """The spending caps written in server/assistant/settings.py (defaults; the VPS may override them)."""
    s = (ROOT / 'server' / 'assistant' / 'settings.py').read_text(encoding='utf-8')
    get = lambda pat, d=None: (re.search(pat, s) or [None, d])[1]
    return {'claude_usd': num(get(r'CLAUDE_MAX_USD\s*=\s*([\d.]+)')),
            'claude_eur': num(get(r"_float\('CLAUDE_BUDGET_EUR',\s*([\d.]+)\)")),
            'gemini_eur': num(get(r"_float\('GEMINI_BUDGET_EUR',\s*([\d.]+)\)")),
            'gemini_until': get(r"_date\('GEMINI_UNTIL',\s*'([\d-]*)'\)", ''),
            'daily_eur': num(get(r"_float\('ASSISTANT_DAILY_EUR',\s*([\d.]+)\)")),
            'order': get(r"_str\('ASSISTANT_ORDER',\s*'([a-z,]+)'\)", '')}


def payload(stats, loupe, searches, notes, requests=None):
    q = []
    for r in loupe:
        tools = [m.group(1) for m in re.finditer(r'(?:^|\| )([a-z_]+) \(', r.get('tools') or '')]
        q.append({'t': r.get('heure_paris') or J.local(r.get('t')), 'q': (r.get('question') or '')[:400],
                  'p': r.get('provider') or '', 'm': r.get('model') or '', 'c': num(r.get('cost_eur')) or 0,
                  's': num(r.get('s')), 'n': int(num(r.get('calls')) or 0), 'sv': r.get('saved') or '',
                  'tl': tools, 'e': (r.get('error') or '')[:300], 'v': r.get('vote') or '', 'd': bool(r.get('demande')),
                  'rd': r.get('reader') or '', 'f': int(num(r.get('earlier')) or 0), 'a': (r.get('reply') or '')[:2500],
                  'src': (r.get('sources') or '').split()[:6]})
    s = [{'t': r.get('heure_paris') or J.local(r.get('t')), 'q': (r.get('q') or '')[:160],
          'n': None if r.get('lines') in (None, '') else int(num(r.get('lines')) or 0), 'c': r.get('cache') or '',
          'p': bool(r.get('prefix'))} for r in searches]
    return {'generated': dt.datetime.now().strftime('%Y-%m-%d %H:%M'), 'visits': stats, 'loupe': q, 'searches': s,
            'caps': caps(), 'notes': [n for n in notes if n], 'demandes': requests or {'demandes': []}}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--offline', action='store_true')
    ap.add_argument('--no-open', action='store_true')
    ap.add_argument('--no-serve', action='store_true')
    ap.add_argument('--port', type=int, default=8765)
    a = ap.parse_args()
    print('Visites (frl-stats sur le VPS)...', flush=True)
    stats, n1 = visits(a.offline)
    print('Questions à la Loupe et recherches...', flush=True)
    loupe, searches, n2 = journals(a.offline)
    requests, n3 = None, None
    if not a.offline:
        print('Demandes aux administrations (frl-demandes)...', flush=True)
        requests = frl_demandes('tout')
        if requests.get('error'):
            n3, requests = f'Demandes non lues : {requests["error"]}', None
    serving = not a.no_serve
    token = secrets.token_urlsafe(24) if serving else ''
    data = payload(stats, loupe, searches, [n1, n2, n3], requests) | {'live': token}
    html = TEMPLATE.read_text(encoding='utf-8').replace(
        '/*__DATA__*/null', json.dumps(data, ensure_ascii=False).replace('</', '<\\/'))
    OUT.mkdir(exist_ok=True)
    out = OUT / 'panel.html'
    out.write_text(html, encoding='utf-8')
    print(f'{out} : {len(stats)} jours de visites, {len(loupe)} questions, {len(searches)} recherches')
    for n in data['notes']:
        print('  ' + n)
    todo = sum(1 for d in (requests or {}).get('demandes', []) if d['status'] in ('a_valider', 'repondue'))
    if todo:
        print(f'  {todo} demande(s) à relire')
    if serving:
        if not a.no_open:
            webbrowser.open(f'http://127.0.0.1:{a.port}/')
        serve(out, token, a.port)
    elif not a.no_open:
        webbrowser.open(out.as_uri())


if __name__ == '__main__':
    main()
