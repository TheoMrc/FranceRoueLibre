"""AI assistant API of francerouelibre.fr (server/assistant/), behind nginx like search_api.py.

POST /api/assistant/ask          {"messages": [{"role": "user"|"assistant", "text": …}], "provider": "auto"|"gemini"|"claude",
                                  "signalement": {titre, lieu, …}, "piste": …}  (signalements.html: the form on screen,
                                  read and edited by the Loupe with lire_formulaire, remplir_signalement, modifier_champ;
                                  the piste pasted by the reader, 6 000 characters, insults and accusations refused)
                                  -> {"job": id}   the question is answered in the background
GET  /api/assistant/job/<id>?after=N  -> {"events": [...], "next": N, "done": bool, "result": {...}}
POST /api/assistant/job/<id>/cancel
POST /api/assistant/demande      {"job": id, "id": draft}  the reader asks the site to send the request drafted under
                                  that answer (assistant/demandes.py): sent, or waiting for the site's validation
GET  /api/assistant/demandes     -> the published requests and their replies (page demandes.html)
POST /api/assistant/admin        {"action": "liste"|"voir"|"valider"|"refuser"|"publier"|"cloturer", "ref", "texte"}
                                  127.0.0.1 only, never through nginx, with MAIL_ADMIN_TOKEN (--demandes below)
GET  /api/assistant/signalement/defi  -> a challenge for the « human » check of signalements.html
POST /api/assistant/signalement/relecture  {same fields, "preuve" or "passe", "consigne"?}  -> the Loupe's version and its jeton
POST /api/assistant/signalement  {"titre", "description", "siren", "lieu", "montant", "liens", "email", "charte", "jeton" | "preuve"}
                                  -> {"ok", "ref"} shown to all at once (« non relu »), unless "prive" (assistant/signalements.py)
POST /api/assistant/signalement/abus  {"ref", "motif"}  a reader flags a shown report
POST /api/assistant/signalement/vote  {"ref", "note"?, "sens": 1|-1|0}  thumbs on a report or on a note of the community
POST /api/assistant/signalement/note  {"ref", "texte", "liens", "preuve"}  a note of the community
POST /api/assistant/signalement/vue  {"ref", "type": "vue"|"clic"}  a distinct reader saw a report, or opened something in it
GET  /api/assistant/signalements -> every report shown to all, with their categories, keywords, votes and notes
GET  /api/assistant/signalements/recherche?q=…  -> the reports matching q (search box of the site, recherche.html)
GET  /api/assistant/status       -> which models can answer now (no amount of money is published), whether the site
                                    still has credits (else a message and the donation link), length of the queue

Questions wait in a bounded queue in front of ASSISTANT_MAX_JOBS workers: the job then reports its place in line
("queue": n). A full queue refuses new questions at once, a question waiting too long or no longer polled by its
page is dropped without spending anything.

Public safeguards, on top of the hard spending caps of assistant/budget.py: questions per address per hour and per
day, questions per day for everyone, questions answered at once, size of a request, browsers of other sites refused
(Origin). Questions are never written to disk; the ledger keeps tokens and costs only.

    python server/assistant_api.py [--port 8018]      serve (127.0.0.1 only)
    python server/assistant_api.py --usage            spending so far, by provider and by day
    python server/assistant_api.py --demandes liste|tout|voir|valider|refuser|modifier|destinataire|publier|cloturer [FRL-…] [--texte FICHIER]
    python server/assistant_api.py --mail liste|lire|apercu|repondre [UID] [--force]   the site's mailbox (assistant/boite.py)
    python server/assistant_api.py --signalements liste|voir|relu|masquer|afficher [S-…] [--texte FICHIER]   citizen reports
    python server/assistant_api.py --fake             fake models (assistant/fake.py): test the panel, no token spent
"""
from __future__ import annotations

import argparse
import collections
import json
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from assistant import boite, demandes, signalements  # noqa: E402
from assistant import faq  # noqa: E402
from assistant import fiche  # noqa: E402
from assistant import journal  # noqa: E402
from assistant import settings as S  # noqa: E402
from assistant.agent import answer, pick_provider  # noqa: E402
from assistant.budget import budget  # noqa: E402
from assistant.providers import CLIENTS  # noqa: E402
from assistant.tools import signalement_fields  # noqa: E402

MAX_BODY = 48_000
PISTE_CHARS = 6000   # the piste pasted on signalements.html, sent apart from the question (MAX_QUESTION_CHARS)
DEMO = {'on': False}
JOB_TTL = 60 * 60   # a reader may still vote on an answer during this hour

JOBS: dict = {}
JOBS_LOCK = threading.Lock()
HITS = collections.defaultdict(collections.deque)  # address -> times of its questions (last 24 h)
DAY = {'day': '', 'n': 0}
QUEUE: collections.deque = collections.deque()  # ids of the jobs waiting for a worker
WORK = threading.Condition(JOBS_LOCK)
WORKERS: list = []
BUSY = 'La Loupe est très demandée en ce moment : réessayez dans quelques minutes.'


def no_credits() -> str:
    """Message when no model can answer because of the spending caps (or the end of a trial period)."""
    reasons = [budget().refusal(p) or '' for p in S.ORDER if CLIENTS[p].configured()]
    if reasons and all('plafond du jour' in r for r in reasons):
        return ('La Loupe a dépensé tout son budget du jour : elle revient demain. FranceRoueLibre est gratuit, sans '
                'publicité et payé de sa poche par son auteur : un don permet de garder la Loupe ouverte plus longtemps.')
    return ('FranceRoueLibre n’a plus de crédits pour faire tourner la Loupe. Le site est gratuit, sans publicité et payé '
            'de sa poche par son auteur : si la Loupe vous est utile, un don permet de la relancer.')


def credits_info() -> dict | None:
    """None while a model can answer, else what the page shows instead of the question box."""
    if pick_provider()[0] is not None:
        return None
    return {'credits': False, 'error': no_credits(), 'donate': S.DONATE_URL}


def _gc() -> None:
    now = time.time()
    for jid in [j for j, job in JOBS.items() if now - job['t'] > JOB_TTL]:
        del JOBS[jid]
    for ip in [ip for ip, q in HITS.items() if not q or now - q[-1] > 86400]:
        del HITS[ip]


def admit(ip: str) -> str | None:
    """None if this address may ask now, else the reason (and the question is counted when admitted)."""
    now = time.time()
    with JOBS_LOCK:
        _gc()
        today = time.strftime('%Y-%m-%d')
        if DAY['day'] != today:
            DAY.update(day=today, n=0)
        if DAY['n'] >= S.DAILY_QUESTIONS:
            return 'L’assistant a reçu trop de questions aujourd’hui : revenez demain.'
        if len(QUEUE) >= S.QUEUE_MAX:
            return BUSY
        if any(j['ip'] == ip and not j['done'] for j in JOBS.values()):
            return 'Une question est déjà en cours : attendez sa réponse.'
        q = HITS[ip]
        while q and now - q[0] > 86400:
            q.popleft()
        if len(q) >= S.PER_IP_DAY:
            return f'Limite de {S.PER_IP_DAY} questions par jour atteinte : revenez demain.'
        if sum(1 for t in q if now - t < 3600) >= S.PER_IP_HOUR:
            return f'Limite de {S.PER_IP_HOUR} questions par heure atteinte : réessayez plus tard.'
        q.append(now)
        DAY['n'] += 1
    return None


def status() -> dict:
    providers = []
    for p in S.ORDER:
        cls = CLIENTS[p]
        why = None if cls.configured() else 'non configuré'
        why = why or budget().refusal(p)
        until = S.GEMINI_UNTIL if p == 'gemini' else S.CLAUDE_UNTIL
        providers.append({'id': p, 'label': cls.label, 'available': why is None, 'reason': why,
                          'until': until.isoformat() if until else None})
    configured = any(CLIENTS[p].configured() for p in S.ORDER)
    lack = credits_info()
    return {'enabled': configured, 'credits': lack is None, 'credits_message': lack['error'] if lack else None,
            'donate': S.DONATE_URL, 'queue': len(QUEUE), 'demo': DEMO['on'], 'providers': providers,
            'limits': {'per_hour': S.PER_IP_HOUR, 'per_day': S.PER_IP_DAY, 'question_chars': S.MAX_QUESTION_CHARS}}


def run_job(job: dict, messages: list, provider: str | None, form: dict | None = None) -> None:
    def emit(event: dict) -> None:
        job['events'].append(event)
    started = time.time()
    try:
        job['result'] = answer(messages, provider, on_event=emit, cancelled=lambda: job['cancel'], form=form)
    except Exception as exc:  # noqa: BLE001 - never a stack trace to the reader
        print(f'job failed: {type(exc).__name__}: {exc}', file=sys.stderr, flush=True)
        job['result'] = {'error': 'Erreur interne de l’assistant.'}
    if (job['result'] or {}).get('error') and not job['cancel']:
        lack = credits_info()  # the caps stopped every model: say so, with the donation link
        if lack:
            job['result'] = dict(job['result'], **lack)
    job['done'] = True
    if not job['cancel']:
        journal.write(S.STATE_DIR, journal.answer_entry(job['id'], journal.reader(job['ip']), messages, job['events'],
                                                        job['result'], time.time() - started))


def worker() -> None:
    while True:
        with WORK:
            while not QUEUE:
                WORK.wait()
            job = JOBS.get(QUEUE.popleft())
            if not job or job['done']:
                continue
            job['state'] = 'running'
        now = time.time()
        if job['cancel'] or now - job['seen'] > S.ABANDON:
            job.update(result={'error': 'Question abandonnée.'}, done=True)
        elif now - job['t'] > S.QUEUE_WAIT:
            job.update(result={'error': BUSY, 'busy': True}, done=True)
        else:
            run_job(job, job.pop('messages'), job['provider'], job.pop('form', None))


def start_workers() -> None:
    with JOBS_LOCK:
        while len(WORKERS) < S.MAX_JOBS:
            t = threading.Thread(target=worker, daemon=True)
            t.start()
            WORKERS.append(t)


def enqueue(ip: str, messages: list, provider: str | None, form: dict | None = None) -> str:
    start_workers()
    jid = secrets.token_urlsafe(18)
    now = time.time()
    job = {'id': jid, 't': now, 'seen': now, 'ip': ip, 'events': [], 'done': False, 'result': None, 'cancel': False,
           'state': 'queued', 'messages': messages, 'provider': provider, 'form': form}
    with WORK:
        JOBS[jid] = job
        QUEUE.append(jid)
        WORK.notify()
    return jid


def saved_job(ip: str, entry: dict, messages: list, result: dict = None) -> str:
    """A finished job holding a saved answer (faq.json) or a templated one (fiche.py): the page polls it like any
    other and gets it at once."""
    jid = secrets.token_urlsafe(18)
    now = time.time()
    result = dict(result) if result else faq.result(entry)
    events = result.pop('events', [])
    with JOBS_LOCK:
        JOBS[jid] = {'id': jid, 't': now, 'seen': now, 'ip': ip, 'events': events, 'done': True, 'result': result,
                     'cancel': False, 'state': 'done', 'messages': None, 'provider': None}
    journal.write(S.STATE_DIR, journal.answer_entry(jid, journal.reader(ip), messages, events, JOBS[jid]['result'], 0))
    return jid


def place(jid: str) -> int:
    """1 when this job is next in line, 0 when it is no longer waiting."""
    with JOBS_LOCK:
        try:
            return QUEUE.index(jid) + 1
        except ValueError:
            return 0


class Handler(BaseHTTPRequestHandler):
    server_version = 'frl-assistant'

    def client_ip(self) -> str:
        peer = self.client_address[0]
        if peer in ('127.0.0.1', '::1'):  # behind nginx (or local test): nginx sets X-Real-IP
            return self.headers.get('X-Real-IP') or peer
        return peer

    def send(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/api/assistant/status':
            return self.send(200, status())
        if url.path == '/api/assistant/demandes':
            return self.send(200, {'demandes': demandes.published(), 'delai_jours': demandes.DELAY_DAYS,
                                   'envoi': S.MAIL_CONFIGURED})
        if url.path == '/api/assistant/signalements':
            return self.send(200, {'signalements': signalements.published(), 'categories': signalements.CATEGORIES})
        if url.path == '/api/assistant/signalements/recherche':
            q = (parse_qs(url.query).get('q') or [''])[0][:200]
            return self.send(200, {'resultats': signalements.search(q, 8)})
        if url.path == '/api/assistant/signalement/defi':
            return self.send(200, signalements.challenge())
        if url.path.startswith('/api/assistant/job/'):
            jid = url.path.rsplit('/', 1)[-1]
            job = JOBS.get(jid)
            if not job:
                return self.send(404, {'error': 'question inconnue ou expirée'})
            job['seen'] = time.time()
            try:
                after = max(0, int((parse_qs(url.query).get('after') or ['0'])[0]))
            except ValueError:
                after = 0
            events = job['events'][after:]
            done = job['done']
            waiting = place(jid) if job['state'] == 'queued' and not done else 0
            return self.send(200, {'events': events, 'next': after + len(events), 'done': done, 'queue': waiting,
                                   'queue_total': len(QUEUE) if waiting else 0,
                                   'result': job['result'] if done else None})
        return self.send(404, {'error': 'not found'})

    def do_POST(self):
        url = urlparse(self.path)
        origin = self.headers.get('Origin')
        if origin and origin not in S.ALLOWED_ORIGINS:
            return self.send(403, {'error': 'origine refusée'})
        if url.path.startswith('/api/assistant/job/') and url.path.endswith('/cancel'):
            job = JOBS.get(url.path.split('/')[-2])
            if job and job['ip'] == self.client_ip():
                job['cancel'] = True
                if job['state'] == 'queued' and not job['done']:  # never reaches a worker: answered now
                    job.update(result={'error': 'Question annulée.'}, done=True)
            return self.send(200, {'ok': bool(job)})
        if url.path == '/api/assistant/feedback':  # 👍 / 👎 under an answer, once per answer
            try:
                size = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(size)) if 0 < size <= 2000 else {}
            except (ValueError, AttributeError):
                body = {}
            job = JOBS.get(str(body.get('job') or ''))
            vote = body.get('vote')
            if not job or not job['done'] or job['ip'] != self.client_ip() or vote not in (1, -1):
                return self.send(400, {'error': 'avis refusé'})
            if job.get('voted') is None:
                job['voted'] = vote
                journal.write(S.STATE_DIR, journal.vote_entry(job['id'], journal.reader(job['ip']), vote, body.get('note')))
            return self.send(200, {'ok': True})
        if url.path in ('/api/assistant/signalement/vote', '/api/assistant/signalement/note', '/api/assistant/signalement/vue'):
            try:
                size = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(size)) if 0 < size <= 12000 else {}
            except (ValueError, AttributeError):
                body = {}
            body = body if isinstance(body, dict) else {}
            who = signalements.voter(self.client_ip())
            res = (signalements.vote(body, who) if url.path.endswith('/vote')
                   else signalements.seen(body, who) if url.path.endswith('/vue')
                   else signalements.add_note(body, who, journal.reader(self.client_ip())))
            return self.send(200 if res.get('ok') else 400, res)
        if url.path == '/api/assistant/signalement/abus':
            try:
                size = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(size)) if 0 < size <= 2000 else {}
            except (ValueError, AttributeError):
                body = {}
            res = signalements.flag(body if isinstance(body, dict) else {}, journal.reader(self.client_ip()))
            return self.send(200 if res.get('ok') else 400, res)
        if url.path in ('/api/assistant/signalement', '/api/assistant/signalement/relecture'):
            try:
                size = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(size)) if 0 < size <= 60000 else {}
            except (ValueError, AttributeError):
                body = {}
            if not isinstance(body, dict) or not body:
                return self.send(400, {'error': 'signalement illisible'})
            res = (signalements.relecture if url.path.endswith('/relecture') else signalements.submit)(body, journal.reader(self.client_ip()))
            return self.send(200 if res.get('ok') else 400, res)
        if url.path in ('/api/assistant/demande', '/api/assistant/admin'):
            try:
                size = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(size)) if 0 < size <= 20000 else {}
            except (ValueError, AttributeError):
                body = {}
            if url.path == '/api/assistant/admin':  # local only: nginx always adds X-Real-IP
                local = self.client_address[0] in ('127.0.0.1', '::1') and not self.headers.get('X-Real-IP')
                if not (local and S.MAIL_ADMIN_TOKEN and secrets.compare_digest(
                        str(self.headers.get('X-Admin-Token') or ''), S.MAIL_ADMIN_TOKEN)):
                    return self.send(403, {'error': 'refusé'})
                action = str(body.get('action') or '')
                handler = boite.admin if action.startswith('mail_') else signalements.admin if action.startswith('sig_') else demandes.admin
                return self.send(200, handler(action, str(body.get('ref') or ''), str(body.get('texte') or '')))
            job = JOBS.get(str(body.get('job') or ''))
            draft = ((job or {}).get('result') or {}).get('demande') or {}
            if not job or job['ip'] != self.client_ip() or not draft or draft.get('id') != body.get('id'):
                return self.send(400, {'error': 'demande introuvable : reposez la question si la page est restée ouverte '
                                                'plus d’une heure'})
            res = demandes.request_send(draft['id'], journal.reader(job['ip']))
            if res.get('ok'):
                draft['envoyee'] = res['ref']
            return self.send(200 if res.get('ok') else 400, res)
        if url.path != '/api/assistant/ask':
            return self.send(404, {'error': 'not found'})
        try:
            size = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            size = MAX_BODY + 1
        if size <= 0 or size > MAX_BODY:
            return self.send(413, {'error': 'conversation trop longue : recommencez une discussion'})
        try:
            body = json.loads(self.rfile.read(size))
            messages = [m for m in body.get('messages', []) if isinstance(m, dict)][-(S.MAX_HISTORY + 1):]
        except (ValueError, AttributeError):
            return self.send(400, {'error': 'requête illisible'})
        question = str((messages[-1] if messages else {}).get('text') or '').strip()
        if not question or messages[-1].get('role') != 'user':
            return self.send(400, {'error': 'question vide'})
        if len(question) > S.MAX_QUESTION_CHARS:
            return self.send(400, {'error': f'question trop longue ({S.MAX_QUESTION_CHARS} caractères au plus)'})
        provider = body.get('provider') if body.get('provider') in CLIENTS else None
        # signalements.html: the report form on screen, for « ajoute… », « va chercher… » (always the model)
        form = signalement_fields(body['signalement']) if isinstance(body.get('signalement'), dict) else None
        if form is not None:
            form.pop('questions', None)
            # a long piste pasted by the reader (a dossier to start from, up to PISTE_CHARS): joined to the
            # question by the agent, as data; refused at once if it insults or accuses
            problem = signalements.wording_problem(question)   # what is asked here may end up in a public report
            if problem:
                return self.send(400, {'error': f'{problem[0].upper()}{problem[1:]}.'})
            piste = signalements._CONTROL.sub('', str(body.get('piste') or '')).strip()[:PISTE_CHARS]
            if piste:
                problem = signalements.wording_problem(piste)
                if problem:
                    return self.send(400, {'error': f'Votre piste : {problem}.'})
                form['_piste'] = piste
        # answered from the data or from faq.json, no model call, no credits: a SIREN, a commune and a question about it,
        # a saved answer, a public figure, a place alone; on a follow-up too when the message stands alone (fiche.answer)
        auto = None if form else fiche.answer(messages)
        if auto:
            return self.send(202, {'job': saved_job(self.client_ip(), None, messages, auto)})
        if body.get('auto'):  # opened by the site itself (a commune, a SIREN): only the answers that cost nothing
            return self.send(200, {'job': None, 'free': False})
        lack = credits_info()
        if lack:
            return self.send(402, lack)
        ip = self.client_ip()
        refused = admit(ip)
        if refused:
            return self.send(429 if refused != BUSY else 503, {'error': refused, 'busy': refused == BUSY})
        return self.send(202, {'job': enqueue(ip, messages, provider, form)})

    def log_message(self, *args):  # nginx logs the requests (without query strings)
        pass


def print_usage(as_json: bool = False) -> None:
    if as_json:   # read by scripts/frl_panel.py (frl-budget on the VPS): the caps really in force and the spending
        return print(json.dumps(budget().summary() | {'order': S.ORDER}, ensure_ascii=False))
    rows = []
    path = S.STATE_DIR / 'spend.jsonl'
    if path.is_file():
        rows = [json.loads(line) for line in path.open(encoding='utf-8') if line.strip()]
    s = budget().summary()
    for p in ('gemini', 'claude'):
        d = s[p]
        print(f'{p:7s} {d["spent_eur"]:8.3f} € sur {d["limit_eur"]:g} €'
              + (f', aujourd’hui {d["today_eur"]:.3f} € sur {d["daily_limit_eur"]:g} €' if d['daily_limit_eur'] else '')
              + (f' (enveloppe depuis le {d["envelope"]["since"]}, +{d["envelope"]["monthly_eur"]:g} € le {d["envelope"]["day"]} du mois, '
                 f'prochain crédit le {d["envelope"]["next"]} ; {d["envelope"]["total_spent_eur"]:.3f} € depuis le début)' if d.get('envelope') else '')
              + (f', jusqu’au {d["until"]}' if d['until'] else '') + (f'  [{d["refusal"]}]' if d['refusal'] else ''))
    print(f'aujourd’hui {s["today_eur"]:.3f} € (plafond {s["daily_limit_eur"]:g} €/jour) · registre : {path}')
    per_day = collections.defaultdict(lambda: [0, 0.0])
    for r in rows:
        k = (r.get('day'), r.get('provider'))
        per_day[k][0] += 1
        per_day[k][1] += float(r.get('eur') or 0)
    for (day, p), (n, eur) in sorted(per_day.items())[-20:]:
        print(f'  {day} {p:7s} {n:5d} appels {eur:8.3f} €')


def admin_cli(args) -> None:
    """The site's validation of requests, through the running service (which owns its state folder)."""
    import urllib.request
    action, ref = ((args.demandes or []) + ['', ''])[:2]
    text = Path(args.texte).read_text(encoding='utf-8') if args.texte else ''
    if args.signalements:  # liste | voir REF | relu REF [--texte F] | masquer REF | afficher REF | mots REF "a, b" ["cat,cat"] | note_masquer REF ID
        action, ref = ('sig_' + args.signalements[0], (args.signalements + [''])[1])
        extra = args.signalements[2:]
        if action == 'sig_mots':
            text = json.dumps({**({'mots': extra[0]} if extra else {}), **({'categories': extra[1]} if len(extra) > 1 else {})}, ensure_ascii=False)
        elif action in ('sig_note_masquer', 'sig_resume') and extra:
            text = extra[0]
    if args.mail:  # frl-mail liste [N] | lire UID | apercu UID | repondre UID [--force], the reply text on stdin
        action, ref = (args.mail + ['', ''])[:2]
        if action in ('apercu', 'repondre'):
            text = sys.stdin.read()
        ref += ':force' if args.force else ''
        action = 'mail_' + action
    req = urllib.request.Request(f'http://127.0.0.1:{args.port}/api/assistant/admin', method='POST',
                                 data=json.dumps({'action': action, 'ref': ref, 'texte': text}).encode(),
                                 headers={'Content-Type': 'application/json', 'X-Admin-Token': S.MAIL_ADMIN_TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print(json.dumps(json.loads(r.read()), ensure_ascii=False, indent=1))
    except OSError as exc:
        print(f'service injoignable ou refus : {exc} (MAIL_ADMIN_TOKEN renseigné ?)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8018)
    parser.add_argument('--usage', action='store_true')
    parser.add_argument('--json', action='store_true', help='--usage : les plafonds et la dépense en JSON')
    parser.add_argument('--demandes', nargs='+', metavar='ACTION', help='liste | tout | voir REF | valider REF | deposee REF [--texte F avec le lien du formulaire] | refuser REF | destinataire REF --texte F | '
                                                                       'publier REF [--texte F] | cloturer REF')
    parser.add_argument('--mail', nargs='+', metavar='ACTION', help='boîte du site : liste [N] | lire UID | apercu UID | '
                                                                   'repondre UID [--force] (texte de la réponse sur stdin)')
    parser.add_argument('--signalements', nargs='+', metavar='ACTION', help='signalements citoyens : liste | voir REF | '
                                                                           'relu REF [--texte F] | masquer REF | afficher REF | mots REF "mot, mot" ["categorie,categorie"] | resume REF "texte" | note_masquer REF ID')
    parser.add_argument('--force', action='store_true', help='--mail repondre : répondre à un message déjà répondu')
    parser.add_argument('--texte', help='texte publié de la réponse (sinon la réponse anonymisée automatiquement)')
    parser.add_argument('--fake', action='store_true', help='fake models, no network call, no token (tests)')
    args = parser.parse_args()
    if args.usage:
        return print_usage(args.json)
    if args.demandes or args.mail or args.signalements:
        return admin_cli(args)
    if args.fake:
        from assistant import fake
        fake.install()
        DEMO['on'] = True
        S.PER_IP_HOUR = S.PER_IP_DAY = 10_000
        print('assistant: FAUX MODÈLES (démo, aucun appel à Google ni à Anthropic)', flush=True)
    st = status()
    print('assistant: ' + ', '.join(f'{p["label"]} {"prêt" if p["available"] else p["reason"]}' for p in st['providers']),
          flush=True)
    start_workers()
    if S.MAIL_CONFIGURED and S.MAIL_IMAP_HOST:  # replies to the requests, every 15 minutes
        threading.Thread(target=demandes.poller, args=(threading.Event(),), daemon=True).start()
    ThreadingHTTPServer.daemon_threads = True
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
