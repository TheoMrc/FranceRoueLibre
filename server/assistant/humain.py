"""Invisible « human » check in front of the questions that cost money (the model), on every page of the site.
No Google, no cookie, nothing kept on disk. Three parts, like the check of signalements.html whose bricks it reuses:

* a signed challenge used once (signalements.challenge), and a small proof of work on it: the reader's browser looks
  for a number whose SHA-256 with the challenge starts with DIFFICULTY zero bits (about 30 000 tries, a fraction of a
  second, done while the reader types). Free for one reader, a real cost for who sends thousands of questions;
* signals read by the page while the question is written, without any content: rhythm of the typing (gaps between
  inputs, never the keys), a short trace of the pointer, touches and scrolls. A hand leaves irregular ones;
* when the signals are too thin (a question pasted without moving), the page shows a box where the reader draws a loop
  with the mouse or the finger (same test as signalements.html) instead of refusing.

An accepted check gives a pass (« passe ») tied to the address, valid PASS_TTL and PASS_USES questions: the reader is
checked once, not at every question. The pass dies with a restart of the server: the page then checks again by itself.

It stops scripts that post to the API and makes mass sending slow and costly. It does not stop someone who drives
real browsers by hand or replays recorded gestures: the limits per address and the spending caps remain the last line.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import secrets
import statistics
import threading
import time
from typing import Optional, Tuple

from . import settings as S
from . import signalements as G

DIFFICULTY = 15            # leading zero bits: about 33 000 SHA-256, well under a second on a phone
MIN_AGE = 1.0              # seconds between the challenge and its answer (the page asks for it when the Loupe opens)
PASS_TTL = 2 * 3600
PASS_USES = 30
_lock = threading.Lock()
_passes: dict = {}         # pass id -> [expiry, questions left]


def ip_key(ip: str) -> str:
    """What the limits count: the address, or its /64 block in IPv6 (one subscriber holds a whole /64, so counting
    single addresses would let one machine take as many identities as it wants)."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if a.version == 6:
        if a.ipv4_mapped:
            return str(a.ipv4_mapped)
        return str(ipaddress.ip_network(f'{a}/64', strict=False).network_address) + '/64'
    return ip


def challenge() -> dict:
    return G.challenge() | {'difficulty': DIFFICULTY}


def _typed(gaps) -> bool:
    """Gaps in milliseconds between the inputs in the question box: a hand is slow enough and irregular."""
    try:
        g = [float(x) for x in gaps][:60]
    except (TypeError, ValueError):
        return False
    g = [x for x in g if 0 < x < 5000]
    return len(g) >= 4 and statistics.mean(g) >= 25 and statistics.pstdev(g) >= 12


def _moved(trace) -> bool:
    """Pointer positions [[x, y, t_ms], …] on a 0–1000 grid of the window: long enough, not instantaneous, uneven timing,
    not a perfect straight line."""
    try:
        pts = [(float(x), float(y), float(t)) for x, y, t in trace][:120]
    except (TypeError, ValueError):
        return False
    if len(pts) < 8:
        return False
    length = sum(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** .5 for a, b in zip(pts, pts[1:]))
    gaps = [b[2] - a[2] for a, b in zip(pts, pts[1:])]
    if length < 120 or pts[-1][2] - pts[0][2] < 200 or statistics.pstdev(gaps) < .5:
        return False
    (x0, y0, _), (x1, y1, _) = pts[0], pts[-1]
    chord = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** .5
    if chord < 1:
        return True
    off = max(abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / chord for x, y, _ in pts)
    return off >= 1.5 or chord / length < .98


def signals_ok(sig) -> bool:
    if not isinstance(sig, dict):
        return False
    try:
        touches, scrolls = int(sig.get('touches') or 0), int(sig.get('defilements') or 0)
    except (TypeError, ValueError):
        touches = scrolls = 0
    return _typed(sig.get('frappe')) or _moved(sig.get('pointeur')) or (touches >= 2 and scrolls >= 1) or touches >= 4


def _sign(pid: str, exp: int, who: str) -> str:
    return hmac.new(G._secret, f'passe:{pid}:{exp}:{who}'.encode(), hashlib.sha256).hexdigest()[:32]


def new_pass(who: str) -> str:
    pid, exp = secrets.token_hex(8), int(time.time()) + PASS_TTL
    with _lock:
        now = time.time()
        for k in [k for k, v in _passes.items() if v[0] < now]:
            del _passes[k]
        _passes[pid] = [exp, PASS_USES]
    return f'{pid}.{exp}.{_sign(pid, exp, who)}'


def use_pass(token, who: str) -> bool:
    """True when the pass is ours, for this address, not expired, with a question left (which it then spends)."""
    try:
        pid, exp, sig = str(token).split('.')
        exp = int(exp)
    except ValueError:
        return False
    if not hmac.compare_digest(sig, _sign(pid, exp, who)) or exp < time.time():
        return False
    with _lock:
        left = _passes.get(pid)
        if not left or left[1] <= 0:
            return False
        left[1] -= 1
    return True


def admit(body: dict, ip: str) -> Tuple[bool, dict]:
    """(True, {'passe': new pass} or {}) when the question may go to a model; else (False, what the page needs to check
    again: {'verifier': 'defi' | 'boucle', 'defi': a new challenge, 'error': shown if the page cannot})."""
    if not S.HUMAN_CHECK:
        return True, {}
    who = ip_key(ip)
    if body.get('passe') and use_pass(body['passe'], who):
        return True, {}
    proof = body.get('preuve') if isinstance(body.get('preuve'), dict) else None
    retry = {'verifier': 'defi', 'defi': challenge(), 'error': 'Vérification en cours : renvoyez votre question dans un instant.'}
    if not proof:
        return False, retry
    drawn = proof.get('boucle')
    if not drawn and not signals_ok(proof.get('signaux')):     # asked before the challenge is spent: it can be reused
        return False, {'verifier': 'boucle', 'error': 'Tracez une boucle dans le cadre, à la souris ou au doigt.'}
    bad = G.verify_human(dict(proof, trace=drawn), trace=bool(drawn), min_age=MIN_AGE, difficulty=DIFFICULTY)
    if bad and drawn and 'tracé' in bad:                        # the challenge is not spent by a loop too small
        return False, {'verifier': 'boucle', 'error': 'Tracez une boucle un peu plus ample dans le cadre.'}
    if bad:                                                     # challenge too old, already used, unfinished work
        return False, retry
    return True, {'passe': new_pass(who)}
