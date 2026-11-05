"""Signalements citoyens (page signalements.html): a reader points at a public spending that raises a question, with
its sources. Every report is shown to all readers as soon as it is sent, marked « non relu » until the site has read it,
unless its author chose « seulement à FranceRoueLibre ». Safeguards before showing it: insults and personal contact
details are refused; after showing it: any reader can flag an abuse (ABUSE_HIDE distinct readers hide it until the site
reads it), and the site can mark it read, shorten or anonymise it, or hide it.

* one file per report in STATE_DIR/signalements/<ref>.json
* GET  /api/assistant/signalement/defi  -> a challenge for the « human » check of the page (no Google, no cookie)
* POST /api/assistant/signalement       -> the report, with the answer to the challenge
* POST /api/assistant/signalement/abus  -> {ref, motif}: a reader flags a shown report
* GET  /api/assistant/signalements      -> every report shown to all
* admin (127.0.0.1, MAIL_ADMIN_TOKEN): sig_liste | sig_voir REF | sig_relu REF [texte] | sig_masquer REF | sig_afficher REF

The « human » check is made of three parts, verified here: a signed challenge used once and answered between 3 s and
20 min after it was given; a small proof of work done by the browser (a SHA-256 with DIFFICULTY leading zero bits);
the trace of the pointer or the finger drawn by the reader (enough points, length, turns, irregular timing). It stops
scripts that post blindly, not a determined attacker: the rate limits and the reading by the site do the rest.

Personal data: the e-mail address is optional, never shown, and erased once the site has read or hidden the report.
The IP address is never written: only a hash of the day counts the reports per reader, in memory.
"""
from __future__ import annotations

import collections
import datetime as dt
import hashlib
import hmac
import json
import re
import secrets
import threading
import time
import unicodedata
from pathlib import Path
from typing import Optional

from . import settings as S

DIFFICULTY = 16          # leading zero bits of sha256(nonce:counter): about 65 000 tries, under a second in a browser
CHALLENGE_MIN, CHALLENGE_MAX = 3, 20 * 60
PER_READER_HOUR, PER_READER_DAY, PER_DAY = 3, 6, 300
ABUSE_HIDE = 3           # distinct readers flagging a shown report hide it until the site has read it
LIMITS = {'titre': (8, 140), 'description': (40, 6000), 'lien': (0, 400), 'siren': (0, 20), 'lieu': (0, 120),
          'montant': (0, 40), 'email': (0, 160)}
MAX_LINKS = 12

_secret = secrets.token_bytes(32)          # challenges do not survive a restart: the page asks for a new one
_used: dict = {}                           # nonce -> expiry, a challenge is answered once
_hits = collections.defaultdict(collections.deque)
_day = {'day': '', 'n': 0}
_lock = threading.Lock()

# Words that make a report refused at once, before any reading: insults, not opinions. Accent- and case-insensitive,
# whole words. The reading by the site catches the rest (and defamation, which no list can).
INSULTS = set('''connard connards connasse connasses enculé enculés enculée salope salopes salaud salauds pute putes
batard batards bâtard bâtards fdp ntm pd pédé pédés tapette nazi nazis facho fachos gogol gogols mongol attardé attardés
débile débiles crevard crevards ordure ordures pourriture pourritures raclure raclures vermine'''.split())


def _norm(text: str) -> str:
    return unicodedata.normalize('NFD', str(text or '')).encode('ascii', 'ignore').decode().lower()


_INSULT_WORDS = {_norm(w) for w in INSULTS}


def _dir() -> Path:
    d = S.STATE_DIR / 'signalements'
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(ref: str) -> Path:
    if not re.fullmatch(r'S-\d{8}-[A-Z0-9]{4}', ref or ''):
        raise ValueError('référence invalide')
    return _dir() / f'{ref}.json'


def load(ref: str) -> Optional[dict]:
    try:
        return json.loads(_path(ref).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def save(d: dict) -> None:
    p = _path(d['ref'])
    tmp = p.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(p)


def all_reports() -> list:
    out = []
    for p in sorted(_dir().glob('S-*.json')):
        try:
            out.append(json.loads(p.read_text(encoding='utf-8')))
        except (OSError, ValueError):
            continue
    return out


# ------------------------------------------------------------------------------------------------ human check
def challenge() -> dict:
    nonce, ts = secrets.token_hex(16), int(time.time())
    sig = hmac.new(_secret, f'{nonce}:{ts}'.encode(), hashlib.sha256).hexdigest()
    return {'nonce': nonce, 'ts': ts, 'sig': sig, 'difficulty': DIFFICULTY}


def _leading_zero_bits(digest: bytes) -> int:
    bits = 0
    for byte in digest:
        if byte == 0:
            bits += 8
            continue
        return bits + 8 - byte.bit_length()
    return bits


def _trace_ok(trace) -> Optional[str]:
    """trace: [[x, y, t_ms], …] in the drawing box (0–1000 on each axis), as sent by the page."""
    try:
        pts = [(float(x), float(y), float(t)) for x, y, t in trace][:2000]
    except (TypeError, ValueError):
        return 'tracé illisible'
    if len(pts) < 25:
        return 'tracé trop court'
    duration = pts[-1][2] - pts[0][2]
    length = sum(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** .5 for a, b in zip(pts, pts[1:]))
    if duration < 600 or length < 900:
        return 'tracé trop court'
    chord = ((pts[-1][0] - pts[0][0]) ** 2 + (pts[-1][1] - pts[0][1]) ** 2) ** .5
    if chord / length > .9:   # almost a straight line
        return 'tracé trop régulier'
    turns, prev = 0, None
    for a, b in zip(pts, pts[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        if abs(dx) + abs(dy) < 4:
            continue
        sign = (dx > 0, dy > 0)
        if prev is not None and sign != prev:
            turns += 1
        prev = sign
    if turns < 4:
        return 'tracé trop régulier'
    gaps = [b[2] - a[2] for a, b in zip(pts, pts[1:])]
    mean = sum(gaps) / len(gaps)
    spread = (sum((g - mean) ** 2 for g in gaps) / len(gaps)) ** .5
    if spread < .5:           # perfectly even timing: a script
        return 'tracé trop régulier'
    return None


def verify_human(proof: dict) -> Optional[str]:
    """None when the answer to the challenge holds, else why not (shown to the reader)."""
    try:
        nonce, ts, sig, counter = str(proof['nonce']), int(proof['ts']), str(proof['sig']), str(proof['counter'])
    except (KeyError, TypeError, ValueError):
        return 'vérification manquante : rechargez la page'
    expected = hmac.new(_secret, f'{nonce}:{ts}'.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return 'vérification expirée : rechargez la page'
    age = time.time() - ts
    if age < CHALLENGE_MIN or age > CHALLENGE_MAX:
        return 'vérification expirée : rechargez la page' if age > CHALLENGE_MAX else 'un peu trop rapide : relisez votre texte'
    if not re.fullmatch(r'\d{1,12}', counter) or _leading_zero_bits(hashlib.sha256(f'{nonce}:{counter}'.encode()).digest()) < DIFFICULTY:
        return 'vérification incomplète : rechargez la page'
    bad = _trace_ok(proof.get('trace'))
    if bad:
        return f'{bad} : dessinez une boucle plus ample dans le cadre'
    with _lock:
        now = time.time()
        for n, exp in list(_used.items()):
            if exp < now:
                del _used[n]
        if nonce in _used:
            return 'vérification déjà utilisée : rechargez la page'
        _used[nonce] = now + CHALLENGE_MAX
    return None


def admit(reader: str) -> Optional[str]:
    with _lock:
        now, today = time.time(), dt.date.today().isoformat()
        if _day['day'] != today:
            _day.update(day=today, n=0)
            _hits.clear()
        q = _hits[reader]
        while q and now - q[0] > 86400:
            q.popleft()
        if _day['n'] >= PER_DAY:
            return 'beaucoup de signalements aujourd’hui : réessayez demain'
        if len(q) >= PER_READER_DAY or sum(1 for t in q if now - t < 3600) >= PER_READER_HOUR:
            return 'vous avez déjà envoyé plusieurs signalements : réessayez plus tard'
        q.append(now)
        _day['n'] += 1
    return None


# ------------------------------------------------------------------------------------------------------ report
def clean(text, limit: int) -> str:
    t = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', str(text or ''))
    t = re.sub(r'[ \t]+', ' ', t).strip()
    return t[:limit]


def check(fields: dict) -> Optional[str]:
    """Why the report cannot be taken, or None."""
    for key, (lo, hi) in LIMITS.items():
        if key == 'lien':
            continue
        value = fields.get(key, '')
        if len(value) < lo:
            return {'titre': 'donnez un titre à votre signalement', 'description': 'décrivez un peu plus ce qui interroge (40 caractères au moins)'}.get(key, f'{key} trop court')
        if len(value) > hi:
            return f'{key} trop long ({hi} caractères au plus)'
    if fields['siren'] and not re.fullmatch(r'\d{9}(\d{5})?', fields['siren'].replace(' ', '')):
        return 'le SIREN fait 9 chiffres (14 pour un SIRET)'
    if fields['email'] and not re.fullmatch(r'[^@\s]{1,64}@[^@\s]{1,120}\.[a-z]{2,}', fields['email'], re.I):
        return 'adresse e-mail invalide (elle est facultative)'
    for link in fields['liens']:
        if not re.fullmatch(r'https?://[^\s<>"]{3,400}', link):
            return f'lien invalide : {link[:80]}'
    words = set(re.findall(r'[a-z]+', _norm(fields['titre'] + ' ' + fields['description'])))
    if words & _INSULT_WORDS:
        return 'pas d’insulte : reformulez avec des faits, le signalement n’en sera que plus fort'
    text = fields['titre'] + ' ' + fields['description']
    if re.search(r'(?<!\d)(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}(?!\d)', text) or re.search(r'[^@\s]+@[^@\s]+\.[a-z]{2,}', text, re.I):
        return 'pas de coordonnées personnelles (téléphone, e-mail) dans le texte : il est visible par tous'
    if not fields['charte']:
        return 'cochez la case de la charte pour envoyer'
    return None


def submit(body: dict, reader: str) -> dict:
    if str(body.get('site') or ''):          # honeypot field, invisible on the page
        return {'ok': True, 'ref': None}
    fields = {k: clean(body.get(k), hi) for k, (_, hi) in LIMITS.items() if k != 'lien'}
    links = body.get('liens') or []
    fields['liens'] = [clean(x, LIMITS['lien'][1]) for x in (links if isinstance(links, list) else [])][:MAX_LINKS]
    fields['liens'] = [x for x in fields['liens'] if x]
    fields['charte'] = body.get('charte') is True
    fields['loupe'] = body.get('loupe') is True     # drafted with the Loupe
    fields['prive'] = body.get('prive') is True     # « seulement à FranceRoueLibre »
    bad = check(fields) or verify_human(body.get('preuve') or {})
    if bad:
        return {'ok': False, 'error': bad}
    refused = admit(reader)
    if refused:
        return {'ok': False, 'error': refused}
    now = dt.datetime.now()
    ref = f'S-{now:%Y%m%d}-{secrets.token_hex(2).upper()}'
    d = {'ref': ref, 'recu': now.isoformat(timespec='seconds'), 'statut': 'prive' if fields['prive'] else 'publie',
         'relu': False, 'abus': [], 'lecteur': reader,
         **{k: fields[k] for k in ('titre', 'description', 'siren', 'lieu', 'montant', 'email', 'liens', 'loupe')}}
    if not fields['prive']:
        d['publie'] = d['recu']
    save(d)
    try:   # the site is told there is a report to read (never the e-mail of the reader)
        from . import demandes
        demandes.notify(f'Signalement {ref} {"privé" if fields["prive"] else "visible par tous"} à relire',
                        f'{fields["titre"]}\n\n{fields["description"][:1500]}\n\nRelire : frl-signalements voir {ref}')
    except Exception:  # noqa: BLE001  a notification must never lose the report
        pass
    return {'ok': True, 'ref': ref, 'visible': not fields['prive']}


def flag(body: dict, reader: str) -> dict:
    """A reader flags a shown report (insult, defamation, private life, false…): hidden at ABUSE_HIDE readers."""
    try:
        d = load(str(body.get('ref') or ''))
    except ValueError:
        d = None
    if not d or d.get('statut') != 'publie':
        return {'ok': False, 'error': 'signalement introuvable'}
    with _lock:
        if reader not in d.setdefault('abus', []):
            d['abus'].append(reader)
            d.setdefault('motifs', []).append(clean(body.get('motif'), 300))
            if len(d['abus']) >= ABUSE_HIDE and not d.get('relu'):
                d['statut'] = 'masque_abus'
            save(d)
    if d['statut'] == 'masque_abus':
        try:
            from . import demandes
            demandes.notify(f'Signalement {d["ref"]} masqué après {len(d["abus"])} alertes', '\n'.join(d.get('motifs', [])))
        except Exception:  # noqa: BLE001
            pass
    return {'ok': True}


def public_view(d: dict) -> dict:
    return {k: d.get(k) for k in ('ref', 'titre', 'description', 'siren', 'lieu', 'montant', 'liens', 'loupe', 'publie', 'relu', 'reponse')}


def published() -> list:
    """Every report shown to all, newest first."""
    return [public_view(d) for d in sorted(all_reports(), key=lambda d: d.get('publie') or '', reverse=True)
            if d.get('statut') == 'publie']


def admin(action: str, ref: str, text: str) -> dict:
    """sig_liste: the reports not read yet (shown, private, hidden by readers); sig_voir; sig_relu (text: the shown
    description, else as received); sig_masquer; sig_afficher (a private or hidden report shown to all). Reading or
    hiding erases the e-mail address."""
    if action == 'sig_liste':
        return {'a_relire': [{k: d.get(k) for k in ('ref', 'recu', 'statut', 'titre', 'siren', 'lieu')} | {'alertes': len(d.get('abus') or [])}
                             for d in all_reports() if not d.get('relu') and d.get('statut') != 'masque']}
    try:
        d = load(ref)
    except ValueError as exc:
        return {'error': str(exc)}
    if not d:
        return {'error': 'signalement introuvable'}
    if action == 'sig_voir':
        return d
    if action in ('sig_relu', 'sig_masquer', 'sig_afficher'):
        if action == 'sig_relu':
            d['relu'] = True
            if text.strip():
                d['description'] = clean(text, LIMITS['description'][1])
        elif action == 'sig_masquer':
            d['statut'] = 'masque'
        else:
            d['statut'] = 'publie'
            d.setdefault('publie', dt.datetime.now().isoformat(timespec='seconds'))
        if action != 'sig_afficher':
            d['email'] = ''
        save(d)
        return {'ok': True, 'ref': ref, 'statut': d['statut'], 'relu': d.get('relu')}
    return {'error': 'action inconnue'}
