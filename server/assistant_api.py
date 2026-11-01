"""AI assistant API of francerouelibre.fr (server/assistant/), behind nginx like search_api.py.

POST /api/assistant/ask          {"messages": [{"role": "user"|"assistant", "text": …}], "provider": "auto"|"gemini"|"claude"}
                                  -> {"job": id}   the question is answered in the background
GET  /api/assistant/job/<id>?after=N  -> {"events": [...], "next": N, "done": bool, "result": {...}}
POST /api/assistant/job/<id>/cancel
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

from assistant import settings as S  # noqa: E402
from assistant.agent import answer, pick_provider  # noqa: E402
from assistant.budget import budget  # noqa: E402
from assistant.providers import CLIENTS  # noqa: E402

MAX_BODY = 48_000
DEMO = {'on': False}
JOB_TTL = 15 * 60

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


def run_job(job: dict, messages: list, provider: str | None) -> None:
    def emit(event: dict) -> None:
        job['events'].append(event)
    try:
        job['result'] = answer(messages, provider, on_event=emit, cancelled=lambda: job['cancel'])
    except Exception as exc:  # noqa: BLE001 - never a stack trace to the reader
        print(f'job failed: {type(exc).__name__}: {exc}', file=sys.stderr, flush=True)
        job['result'] = {'error': 'Erreur interne de l’assistant.'}
    if (job['result'] or {}).get('error') and not job['cancel']:
        lack = credits_info()  # the caps stopped every model: say so, with the donation link
        if lack:
            job['result'] = dict(job['result'], **lack)
    job['done'] = True


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
            run_job(job, job.pop('messages'), job['provider'])


def start_workers() -> None:
    with JOBS_LOCK:
        while len(WORKERS) < S.MAX_JOBS:
            t = threading.Thread(target=worker, daemon=True)
            t.start()
            WORKERS.append(t)


def enqueue(ip: str, messages: list, provider: str | None) -> str:
    start_workers()
    jid = secrets.token_urlsafe(18)
    now = time.time()
    job = {'t': now, 'seen': now, 'ip': ip, 'events': [], 'done': False, 'result': None, 'cancel': False,
           'state': 'queued', 'messages': messages, 'provider': provider}
    with WORK:
        JOBS[jid] = job
        QUEUE.append(jid)
        WORK.notify()
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
        lack = credits_info()
        if lack:
            return self.send(402, lack)
        ip = self.client_ip()
        refused = admit(ip)
        if refused:
            return self.send(429 if refused != BUSY else 503, {'error': refused, 'busy': refused == BUSY})
        return self.send(202, {'job': enqueue(ip, messages, provider)})

    def log_message(self, *args):  # nginx logs the requests (without query strings)
        pass


def print_usage() -> None:
    rows = []
    path = S.STATE_DIR / 'spend.jsonl'
    if path.is_file():
        rows = [json.loads(line) for line in path.open(encoding='utf-8') if line.strip()]
    s = budget().summary()
    for p in ('gemini', 'claude'):
        d = s[p]
        print(f'{p:7s} {d["spent_eur"]:8.3f} € sur {d["limit_eur"]:g} €'
              + (f', jusqu’au {d["until"]}' if d['until'] else '') + (f'  [{d["refusal"]}]' if d['refusal'] else ''))
    print(f'aujourd’hui {s["today_eur"]:.3f} € (plafond {s["daily_limit_eur"]:g} €/jour) · registre : {path}')
    per_day = collections.defaultdict(lambda: [0, 0.0])
    for r in rows:
        k = (r.get('day'), r.get('provider'))
        per_day[k][0] += 1
        per_day[k][1] += float(r.get('eur') or 0)
    for (day, p), (n, eur) in sorted(per_day.items())[-20:]:
        print(f'  {day} {p:7s} {n:5d} appels {eur:8.3f} €')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8018)
    parser.add_argument('--usage', action='store_true')
    parser.add_argument('--fake', action='store_true', help='fake models, no network call, no token (tests)')
    args = parser.parse_args()
    if args.usage:
        return print_usage()
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
    ThreadingHTTPServer.daemon_threads = True
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
