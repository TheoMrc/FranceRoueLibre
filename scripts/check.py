"""Vérifie tout le site sans dépenser un jeton : à lancer avant chaque déploiement (check.bat sur le PC).

Étapes (chacune dit OK ou ce qui a cassé) :
  unitaires   tests/test_assistant.py, tests/test_auto.py (réponses sans modèle) et tests/*.test.mjs
  lieux       places.find sur les cas de tests/lieux.json (fautes, codes postaux, lieu dans une phrase…)
  loupe       tests/loupe-scenarios.json rejoués par un faux modèle, au format Claude puis au format Gemini, dans le
              vrai code de la Loupe : boucle de l'agent, conversion des messages, outils, données. Aucun appel réseau
              sauf la machine elle-même : une connexion vers Anthropic ou Google ferait échouer l'étape.
  donnees     les fichiers lisibles par la Loupe existent et se lisent
  journal     (sur le PC, si _journal/ existe) toutes les recherches et questions réelles du journal passées dans
              places.find, la FAQ et les réponses automatiques ; les changements par rapport au dernier passage
              sont listés (photo dans _journal/check-photo.json, jamais versionnée : les questions restent privées)
  pages       chaque page de dist/ ouverte à 390 et 1366 px (Playwright, si installé) : erreurs JavaScript,
              défilement horizontal, fichiers introuvables

Rapidité : les tests unitaires et les pages tournent en même temps que le reste, les pages s'ouvrent six à la fois, et
une étape déjà passée dont rien n'a changé depuis (code, tests, données, pages : taille et date de chaque fichier) n'est
pas rejouée. Relancer sans avoir rien modifié répond donc tout de suite ; --tout rejoue tout quand même. Le journal ne
recalcule que les recherches et questions nouvelles tant que le code et les données n'ont pas bougé.

Options :
  --vite              sans les pages ni les tests Node
  --tout              rejoue chaque étape, même inchangée depuis son dernier passage réussi
  --accepter          enregistre la photo du journal telle quelle (après avoir lu les changements)
  --payant N          en plus, N questions de tests/loupe-eval.json au vrai modèle (≈ 0,003 € chacune avec Haiku)
  --seulement ETAPE   une seule étape

Sortie : 0 si tout passe, 1 sinon."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix='frl-check-'))
# before any import of the assistant: fake keys, a throwaway spending ledger, the repo's data
os.environ.update(ANTHROPIC_API_KEY='cle-de-test', GEMINI_API_KEY='cle-de-test', GEMINI_PROVIDER='api',
                  ASSISTANT_STATE_DIR=str(TMP / 'etat'), ASSISTANT_ENV_FILE=str(TMP / 'pas-de-env'),
                  MAIL_AUTO_SEND='0', ASSISTANT_SEARCH_API='http://127.0.0.1:9')
sys.path.insert(0, str(ROOT / 'server'))
FAILS: list = []


_out = threading.local()   # a step run beside the others keeps its lines together and prints them when it ends
_print_lock = threading.Lock()


def out(line: str = '') -> None:
    buf = getattr(_out, 'lines', None)
    if buf is None:
        with _print_lock:
            print(line, flush=True)
    else:
        buf.append(line)


def say(ok: bool, step: str, text: str = '') -> None:
    out(f'{"OK " if ok else "NON"} {step:10s} {text}')
    if not ok:
        FAILS.append(step)


# ================================================================ nothing changed: not played again
CACHE = ROOT / '.check-cache.json'   # {step: fingerprint of its inputs at its last pass}, never versioned
SKIP_DIRS = {'__pycache__', 'node_modules', '.git', 'db', 'raw', 'derived'}   # db: the search index cut in pieces
INPUTS = {   # what each step reads: a change in any of these files plays the step again
    'unitaires': ['server', 'scripts', 'tests', 'dist', 'sources', 'serve.mjs', 'build-data.mjs'],
    'lieux': ['server/assistant', 'tests/lieux.json', 'dist/data/web/communes-lookup.json', 'scripts/check.py'],
    'loupe': ['server', 'tests/loupe-scenarios.json', 'dist/data', 'scripts/check.py'],
    'donnees': ['server/assistant', 'dist/data', 'scripts/check.py'],
    'pages': ['dist', 'scripts/check-pages.mjs', 'scripts/check.py', 'serve.mjs', 'server/search_api.py'],
}


def fingerprint(paths: list) -> str:
    """Name, size and date of every file under these paths (not their content: a thousand files in a blink)."""
    h = hashlib.sha1()
    for rel in paths:
        base = ROOT / rel
        files = [base] if base.is_file() else sorted(f for f in base.rglob('*') if f.is_file()
                                                     and not SKIP_DIRS & set(f.relative_to(ROOT).parts)) if base.is_dir() else []
        for f in files:
            st = f.stat()
            h.update(f'{f.relative_to(ROOT).as_posix()}|{st.st_size}|{st.st_mtime_ns}\n'.encode())
    return h.hexdigest()


def cache_read() -> dict:
    try:
        return json.loads(CACHE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def cache_write(done: dict) -> None:
    try:
        CACHE.write_text(json.dumps({**cache_read(), **done}, indent=0), encoding='utf-8')
    except OSError:
        pass


# ================================================================ no network but this machine
_real_connect = socket.socket.connect
_real_create = socket.create_connection
_real_getaddr = socket.getaddrinfo
LLM_HOSTS = ('anthropic.com', 'googleapis.com', 'google.com')


def _local(addr) -> bool:
    host = addr[0] if isinstance(addr, tuple) else str(addr)
    return host in ('127.0.0.1', '::1', 'localhost')


def _guard_connect(self, addr):
    if not _local(addr):
        raise OSError(f'réseau interdit pendant la vérification ({addr})')
    return _real_connect(self, addr)


def _guard_create(addr, *a, **k):
    if not _local(addr):
        raise OSError(f'réseau interdit pendant la vérification ({addr})')
    return _real_create(addr, *a, **k)


def offline():
    socket.socket.connect = _guard_connect
    socket.create_connection = _guard_create
    def getaddr(host, *a, **k):
        if any(h in str(host) for h in LLM_HOSTS):
            raise OSError(f'appel à un modèle interdit pendant la vérification ({host})')
        return _real_getaddr(host, *a, **k)
    socket.getaddrinfo = getaddr


# ================================================================ unit tests
def step_unitaires(fast: bool) -> None:
    r = subprocess.run([sys.executable, '-m', 'unittest', '-q', 'tests.test_assistant', 'tests.test_auto'], cwd=ROOT,
                       capture_output=True, text=True, encoding='utf-8', errors='replace',
                       env={**os.environ, 'PYTHONPATH': str(ROOT / 'server')})
    tail = (r.stderr or r.stdout).strip().splitlines()[-1:] or ['']
    say(r.returncode == 0, 'unitaires', f'Python : {tail[0]}')
    if r.returncode:
        out('\n'.join((r.stderr or '').splitlines()[-40:]))
    if fast:
        return
    node = shutil.which('node')
    if not node:
        say(True, 'unitaires', 'Node absent : tests JavaScript sautés')
        return
    files = sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'tests').glob('*.test.mjs'))
    # two tests run a Python parser: with this interpreter, not a « python » that is not on the PATH of the PC
    r = subprocess.run([node, '--test', *files], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace',
                       env={**os.environ, 'PYTHON': sys.executable, 'PYTHONIOENCODING': 'utf-8'})
    passed = next((l for l in r.stdout.splitlines() if l.startswith('# pass')), '')
    failed = next((l for l in r.stdout.splitlines() if l.startswith('# fail')), '')
    say(r.returncode == 0, 'unitaires', f'Node : {passed[2:]}, {failed[2:]}')
    if r.returncode:
        out('\n'.join(l for l in r.stdout.splitlines() if 'not ok' in l or 'Error' in l)[:4000])


# ================================================================ places
def step_lieux() -> None:
    from assistant import places, settings as S
    places.load(S.DATA_DIR / 'web' / 'communes-lookup.json')
    cases = json.loads((ROOT / 'tests' / 'lieux.json').read_text(encoding='utf-8'))['cas']
    bad = []
    for q, want_type, want in cases:
        r = places.find(q)
        got = ((r.get('region') or {}).get('nom') or (r['communes'][0]['nom'] if r['communes'] else (r['departement'] or {}).get('nom'))) or None
        if (want_type and r['type'] != want_type) or got != want:
            bad.append(f'« {q} » : {r["type"] or "rien"} {got!r}, attendu {want_type or "?"} {want!r}')
    say(not bad, 'lieux', f'{len(cases) - len(bad)}/{len(cases)} cas')
    for b in bad:
        out(f'     {b}')


# ================================================================ the Loupe, scripted model
class Script:
    """Answers the providers' HTTP calls in place of Anthropic and Google: the n-th model turn of the question
    returns the n-th tool call of the scenario, then a final text."""

    def __init__(self, calls):
        self.calls, self.seen = calls, []

    def post(self, url, body, headers, timeout=120):
        self.seen.append(url)
        claude = 'anthropic' in url
        tools = body.get('tools') or []
        chat = any('input_schema' in t for t in tools) if claude else any('functionDeclarations' in t for t in tools)
        if not chat:  # web search or page reading
            text = 'Résultat de test : 987 160 € (comptes du Sénat 2025).'
            if claude:
                return 200, {'content': [{'type': 'text', 'text': text, 'citations': [{'url': 'https://www.senat.fr/', 'title': 'Sénat'}]},
                                         {'type': 'web_fetch_tool_result', 'content': {'type': 'web_fetch_result', 'url': 'https://www.senat.fr/'}}],
                             'stop_reason': 'end_turn', 'usage': {'input_tokens': 0, 'output_tokens': 0}}, {}
            return 200, {'candidates': [{'content': {'role': 'model', 'parts': [{'text': text}]},
                                         'groundingMetadata': {'groundingChunks': [{'web': {'uri': 'https://www.senat.fr/', 'title': 'Sénat'}}]},
                                         'urlContextMetadata': {'urlMetadata': [{'urlRetrievalStatus': 'URL_RETRIEVAL_STATUS_SUCCESS'}]}}],
                         'usageMetadata': {}}, {}
        if claude:
            done = sum(1 for m in body['messages'] for b in m['content'] if isinstance(b, dict) and b.get('type') == 'tool_result')
        else:
            done = sum(1 for c in body['contents'] for p in c.get('parts') or [] if 'functionResponse' in p)
        if done < len(self.calls):
            name, args = self.calls[done][0], self.calls[done][1]
            if claude:
                return 200, {'content': [{'type': 'tool_use', 'id': f'toolu_test{done}', 'name': name, 'input': args}],
                             'stop_reason': 'tool_use', 'usage': {'input_tokens': 0, 'output_tokens': 0}}, {}
            return 200, {'candidates': [{'content': {'role': 'model', 'parts': [{'functionCall': {'name': name, 'args': args}}]}}],
                         'usageMetadata': {}}, {}
        text = 'Réponse de test.\n\nPour aller plus loin :\n- Une autre question ?'
        if claude:
            return 200, {'content': [{'type': 'text', 'text': text}], 'stop_reason': 'end_turn',
                         'usage': {'input_tokens': 0, 'output_tokens': 0}}, {}
        return 200, {'candidates': [{'content': {'role': 'model', 'parts': [{'text': text}]}, 'finishReason': 'STOP'}],
                     'usageMetadata': {}}, {}


def step_loupe() -> None:
    from assistant import agent, providers, tools
    record = []
    real_call = tools.Toolbox.call

    def call(self, name, args):
        r = real_call(self, name, args)
        record.append((name, r))
        return r
    tools.Toolbox.call = call
    scenarios = json.loads((ROOT / 'tests' / 'loupe-scenarios.json').read_text(encoding='utf-8'))['scenarios']
    bad, n = [], 0
    for provider in ('claude', 'gemini'):
        for sc in scenarios:
            script = Script(sc['appels'])
            record.clear()
            original = providers.post_json
            providers.post_json = script.post
            try:
                events = []
                res = agent.answer([{'role': 'user', 'text': sc['q']}], provider, on_event=events.append)
            except Exception:  # noqa: BLE001
                bad.append(f'[{provider}] « {sc["q"]} » : exception\n{traceback.format_exc(limit=4)}')
                continue
            finally:
                providers.post_json = original
            n += 1
            if res.get('error') or not res.get('reply'):
                bad.append(f'[{provider}] « {sc["q"]} » : {res.get("error") or "réponse vide"}')
                continue
            if any(not u.startswith(('https://api.anthropic.com', 'https://generativelanguage.googleapis.com',
                                     'https://aiplatform.googleapis.com')) for u in script.seen):
                bad.append(f'[{provider}] adresse inattendue : {script.seen}')
            done = [e for e in events if e.get('type') == 'tool_done']
            if len(done) != len(sc['appels']):
                bad.append(f'[{provider}] « {sc["q"]} » : {len(done)} outils joués sur {len(sc["appels"])}')
            for i, call in enumerate(sc['appels']):
                name, _, want = call[0], call[1], call[2]
                must_fail = len(call) > 3 and call[3]
                r = record[i][1] if i < len(record) and record[i][0] == name else None
                text = json.dumps(r, ensure_ascii=False, default=str)
                failed = isinstance(r, dict) and bool(r.get('error'))
                if failed != bool(must_fail):
                    bad.append(f'[{provider}] {name} {call[1]} : {"erreur inattendue" if failed else "aurait dû refuser"} {text[:300]}')
                for w in want:
                    if w not in text:
                        bad.append(f'[{provider}] {name} {call[1]} : « {w} » absent de {text[:300]}')
    tools.Toolbox.call = real_call
    say(not bad, 'loupe', f'{n} conversations rejouées (Claude et Gemini), 0 € dépensé')
    for b in bad[:30]:
        out(f'     {b}')


# ================================================================ data files
def step_donnees() -> None:
    from assistant import tools, settings as S
    bad = []
    for rel in tools.FILES:
        p = S.DATA_DIR / rel
        try:
            json.loads(p.read_text(encoding='utf-8'))
        except (OSError, ValueError) as exc:
            bad.append(f'{rel} : {exc}')
    for rel in ('web/communes-lookup.json', 'web/communes-meta.json', 'site-index.json'):
        try:
            json.loads((S.DATA_DIR / rel).read_text(encoding='utf-8'))
        except (OSError, ValueError) as exc:
            bad.append(f'{rel} : {exc}')
    say(not bad, 'donnees', f'{len(tools.FILES)} fichiers de la Loupe lus')
    for b in bad:
        out(f'     {b}')


# ================================================================ real queries of the journal (PC only)
def step_journal(accept: bool, tout: bool = False) -> None:
    import csv
    j = ROOT / '_journal'
    if not (j / 'recherches.csv').is_file():
        say(True, 'journal', 'pas de _journal/ ici : étape sautée (elle tourne sur le PC)')
        return
    from assistant import places, faq, fiche, outils, settings as S
    places.load(S.DATA_DIR / 'web' / 'communes-lookup.json')
    outils._company = lambda *a, **k: None   # the business directory is online: the photo stays offline and stable

    def rows(name):
        with open(j / name, newline='', encoding='utf-8-sig') as h:
            return list(csv.DictReader(h))
    searches = sorted({r['q'].strip() for r in rows('recherches.csv') if r.get('q', '').strip()})
    # the 1 500 questions asked last (distinct): replaying the whole journal took more than ten minutes once it passed
    # 5 000 questions, and this step runs before every deployment
    asked = [r['question'].strip() for r in rows('loupe.csv') if r.get('question', '').strip()] if (j / 'loupe.csv').is_file() else []
    questions = sorted(list(dict.fromkeys(reversed(asked)))[:1500])
    # what the same code and data answered at the last pass is kept: only the new searches and questions are computed
    memo_path, key = j / 'check-memo.json', fingerprint(['server/assistant', 'dist/data/web', 'dist/data/site-index.json', 'scripts/check.py'])
    try:
        memo = json.loads(memo_path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        memo = {}
    if memo.get('cle') != key or tout:
        memo = {'cle': key, 'lieux': {}, 'faq': {}, 'auto': {}}
    new = 0
    photo = {'lieux': {}, 'faq': {}, 'auto': {}}
    for q in searches:
        if q not in memo['lieux']:
            r = places.find(q)
            memo['lieux'][q] = f'{r["type"]} {r["communes"][0]["insee"] if r["communes"] else (r["departement"] or {}).get("code", "")}'.strip()
            new += 1
        photo['lieux'][q] = memo['lieux'][q]
    for q in questions:
        if q not in memo['faq'] or q not in memo['auto']:
            hit = faq.find([{'role': 'user', 'text': q}])
            memo['faq'][q] = (hit or {}).get('saved') or (hit or {}).get('id') if hit else None
            auto = fiche.answer([{'role': 'user', 'text': q}])
            memo['auto'][q] = (auto or {}).get('reply', '')[:60] if auto else None
            new += 1
        photo['faq'][q], photo['auto'][q] = memo['faq'][q], memo['auto'][q]
    try:   # questions that left the last 1 500 are dropped with them
        memo_path.write_text(json.dumps({'cle': key, **photo}, ensure_ascii=False, indent=0), encoding='utf-8')
    except OSError:
        pass
    path = j / 'check-photo.json'
    old = json.loads(path.read_text(encoding='utf-8')) if path.is_file() else None
    changes = []
    if old:
        for part in photo:
            for q, v in photo[part].items():
                if q in old.get(part, {}) and old[part][q] != v:
                    changes.append(f'{part} « {q} » : {old[part][q]!r} → {v!r}')
    if accept or not old:
        path.write_text(json.dumps(photo, ensure_ascii=False, indent=0), encoding='utf-8')
    say(True, 'journal', f'{len(searches)} recherches et {len(questions)} questions réelles ({new} nouvelles rejouées) ; '
                         f'{len(changes)} changement(s) depuis la dernière photo' + (' (photo mise à jour)' if accept or not old else
                                                                                   ' : à relire, puis --accepter' if changes else ''))
    for c in changes[:60]:
        out(f'     {c}')


# ================================================================ pages
def step_pages() -> None:
    node = shutil.which('node')
    script = ROOT / 'scripts' / 'check-pages.mjs'
    if not node:
        say(True, 'pages', 'Node absent : étape sautée')
        return
    probe = subprocess.run([node, '-e', "require('playwright')"], cwd=ROOT, capture_output=True, text=True)
    if probe.returncode:
        say(True, 'pages', 'Playwright absent (npm i -D playwright puis npx playwright install chromium) : étape sautée')
        return
    with server():
        r = subprocess.run([node, str(script)], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
    lines = r.stdout.strip().splitlines()
    say(r.returncode == 0, 'pages', lines[-1] if lines else r.stderr[-300:])
    for l in lines[:-1][:60]:
        out(f'     {l}')


@contextlib.contextmanager
def server():
    """The site served locally (serve.mjs, port 4173), the search API too when its index is here."""
    procs = []
    node = shutil.which('node')
    procs.append(subprocess.Popen([node, 'serve.mjs'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    db = ROOT / 'dist' / 'data' / 'search' / 'frl-search.sqlite3'
    if db.is_file():
        procs.append(subprocess.Popen([sys.executable, 'server/search_api.py', '--db', str(db), '--port', '8017', '--data', 'dist/data'],
                                      cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    try:
        for _ in range(120):  # ready when both answer
            try:
                socket.create_connection(('127.0.0.1', 4173), timeout=1).close()
                if len(procs) > 1:
                    socket.create_connection(('127.0.0.1', 8017), timeout=1).close()
                break
            except OSError:
                time.sleep(0.5)
        yield
    finally:
        for p in procs:
            p.terminate()


# ================================================================ optional, billed
def step_payant(n: int) -> None:
    for k in ('ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'ASSISTANT_ENV_FILE', 'ASSISTANT_STATE_DIR'):
        os.environ.pop(k, None)
    r = subprocess.run([sys.executable, 'scripts/loupe-eval.py', '--only', str(n)], cwd=ROOT,
                       env={k: v for k, v in os.environ.items() if not k.startswith('GEMINI_PROVIDER')})
    say(r.returncode == 0, 'payant', f'{n} question(s) au vrai modèle')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--vite', action='store_true')
    ap.add_argument('--tout', action='store_true')
    ap.add_argument('--accepter', action='store_true')
    ap.add_argument('--payant', type=int, default=0)
    ap.add_argument('--seulement', default='')
    a = ap.parse_args()
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    offline()
    steps = {'unitaires': lambda: step_unitaires(a.vite), 'lieux': step_lieux, 'loupe': step_loupe,
             'donnees': step_donnees, 'journal': lambda: step_journal(a.accepter, a.tout), 'pages': step_pages}
    started = time.time()
    wanted = [n for n in steps if not (a.seulement and n != a.seulement) and not (a.vite and n == 'pages')]
    known, prints, passed = cache_read(), {}, {}
    for name in list(wanted):   # same inputs as at its last pass: the step is not played again
        if name in INPUTS:
            prints[name] = fingerprint(INPUTS[name]) + ('|vite' if a.vite and name == 'unitaires' else '')
            if not a.tout and known.get(name) == prints[name]:
                say(True, name, 'inchangé depuis le dernier passage réussi, pas rejoué (--tout pour le rejouer)')
                wanted.remove(name)

    def run(name: str, beside: bool = False) -> None:
        before = len(FAILS)
        if beside:
            _out.lines = []
        try:
            steps[name]()
        except Exception:  # noqa: BLE001
            say(False, name, 'exception :\n' + traceback.format_exc(limit=6))
        if beside:
            with _print_lock:
                print('\n'.join(_out.lines), flush=True)
        if name in prints and name not in FAILS[before:] and name not in FAILS:
            passed[name] = prints[name]

    # the steps that only wait for another program (tests, a browser) run beside the ones played here
    beside = [threading.Thread(target=run, args=(n, True)) for n in wanted if n in ('unitaires', 'pages')]
    for t in beside:
        t.start()
    for name in wanted:
        if name not in ('unitaires', 'pages'):
            run(name)
    for t in beside:
        t.join()
    cache_write(passed)
    if a.payant:
        socket.socket.connect, socket.create_connection, socket.getaddrinfo = _real_connect, _real_create, _real_getaddr
        step_payant(a.payant)
    shutil.rmtree(TMP, ignore_errors=True)
    print(f'\n{"Tout passe" if not FAILS else "À corriger : " + ", ".join(dict.fromkeys(FAILS))} ({round(time.time() - started)} s)')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
