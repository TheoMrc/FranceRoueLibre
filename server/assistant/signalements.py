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
* POST /api/assistant/signalement/vote  {"ref", "note"?, "sens"}  a thumb up or down (or taken back) on a report or a note
* POST /api/assistant/signalement/note  {"ref", "texte", "liens", "preuve"}  a note of the community under a report
* GET  /api/assistant/signalements/recherche?q=…  the published reports matching q (search box, recherche.html, Loupe)
* admin (127.0.0.1, MAIL_ADMIN_TOKEN): sig_liste | sig_voir REF | sig_relu REF [texte] | sig_masquer REF | sig_afficher REF
  | sig_mots REF {"mots", "categories"} | sig_note_masquer REF ID (REF may be a word of the title naming one report)

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

# The categories of a report (several per report), in three groups. The page has the same list (signalements.js,
# CATEGORIES: a test checks they match); the Loupe ticks them at the end of a draft (remplir_signalement).
CATEGORIES = {
    # échelon
    'commune': 'Commune', 'intercommunalite': 'Intercommunalité', 'departement': 'Département', 'region': 'Région',
    'etat': 'État', 'operateur': 'Opérateur ou agence de l’État', 'secu': 'Sécurité sociale', 'europe': 'Union européenne',
    # nature de la dépense
    'association': 'Association financée', 'marche-public': 'Marché public', 'subvention': 'Subvention',
    'projet-aide': 'Projet aidé', 'niche-fiscale': 'Niche fiscale', 'remunerations': 'Emplois et rémunérations publics',
    'elus': 'Élus et anciens élus', 'train-de-vie': 'Train de vie de l’État', 'communication': 'Communication et événementiel',
    'conseil': 'Cabinets de conseil et études', 'immobilier': 'Immobilier public', 'audiovisuel': 'Audiovisuel public',
    # ce qui interroge
    'depense-inutile': 'Dépense inutile', 'depense-abusive': 'Dépense abusive', 'risque-fraude': 'Risque de fraude',
    'conflit-interets': 'Conflit d’intérêts possible', 'cout-disproportionne': 'Coût disproportionné',
    'derive': 'Dérive de coût ou de délai', 'doublon': 'Doublon entre échelons', 'opacite': 'Donnée manquante, opacité',
}
MAX_CATEGORIES, MAX_MOTS, MOT_CHARS = 8, 8, 40
_CONTROL = re.compile(r'[\x00-\x08\x0b-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069]')

# Words that state a crime or a verdict about someone (« escroc », « corrompu »…): diffamation without a court
# decision. Refused too, with a way to say it better: the facts, the conditional, the question.
ACCUSATIONS = set('''escroc escrocs escroque escroquent voleur voleurs voleuse voleuses voleurs voyou voyous truand truands
mafieux mafieuse mafieuses corrompu corrompus corrompue corrompues pourri pourris pourrie pourries ripou ripoux
magouilleur magouilleurs magouilleuse racaille racailles criminel criminels criminelle criminelles delinquant delinquants
bandit bandits gangster gangsters escroquerie detourneur detourneurs'''.split())
_ACCUSATION_WORDS = {_norm(w) for w in ACCUSATIONS}


def wording_problem(text: str) -> str | None:
    """Why a text cannot go on as it is (insult, accusation, personal contact), or None. For the reports and for
    the piste a reader pastes for the Loupe on signalements.html."""
    words = set(re.findall(r'[a-z]+', _norm(text)))
    if words & _INSULT_WORDS:
        return 'pas d’insulte : reformulez avec des faits, le signalement n’en sera que plus fort'
    found = sorted(words & _ACCUSATION_WORDS)
    if found:
        return (f'« {found[0]} » accuse sans jugement, c’est de la diffamation : décrivez les faits et les montants, au '
                'conditionnel (« aurait reçu », « semble »), et posez la question')
    if re.search(r'(?<!\d)(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}(?!\d)', text) or re.search(r'[^@\s]+@[^@\s]+\.[a-z]{2,}', text, re.I):
        return 'pas de coordonnées personnelles (téléphone, e-mail) dans le texte : il est visible par tous'
    return None


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
    _index_one(d)   # this report alone, never the others


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


def verify_human(proof: dict, trace: bool = True) -> Optional[str]:
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
    bad = _trace_ok(proof.get('trace')) if trace else None
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
    problem = wording_problem(' '.join([fields['titre'], fields['description'], *fields.get('mots', [])]))
    if problem:
        return problem
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
    fields['categories'] = categories_of(body.get('categories'))
    fields['mots'] = mots_of(body.get('mots'))
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
         'votes': {'up': [], 'down': []}, 'notes': [],
         **{k: fields[k] for k in ('titre', 'description', 'siren', 'lieu', 'montant', 'email', 'liens', 'loupe', 'categories', 'mots')}}
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
    out = {k: d.get(k) for k in ('ref', 'titre', 'description', 'siren', 'lieu', 'montant', 'liens', 'loupe', 'publie', 'relu', 'reponse')}
    out['categories'] = [c for c in d.get('categories') or [] if c in CATEGORIES]
    out['mots'] = list(d.get('mots') or [])
    out['votes'] = _counts(d.get('votes'))
    out['notes'] = [{'id': n['id'], 'texte': n['texte'], 'liens': n.get('liens') or [], 'recu': n['recu'], 'votes': _counts(n.get('votes'))}
                    for n in d.get('notes') or [] if n.get('statut', 'publie') == 'publie']
    return out


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
    if ref and not ref.startswith('S-'):   # a word of the title instead of the reference: must name one report
        found = [r for r in all_reports() if _norm(ref) in _norm(r.get('titre', '') + ' ' + r.get('description', ''))]
        if len(found) != 1:
            return {'error': f'{len(found)} signalements contiennent « {ref} » : donnez la référence',
                    'refs': [(r['ref'], r.get('titre')) for r in found[:10]]}
        ref = found[0]['ref']
    try:
        d = load(ref)
    except ValueError as exc:
        return {'error': str(exc)}
    if not d:
        return {'error': 'signalement introuvable'}
    if action == 'sig_voir':
        return d
    if action == 'sig_mots':   # text: {"mots": [...], "categories": [...]} (replaces both when given)
        try:
            tags = json.loads(text or '{}')
        except ValueError:
            return {'error': 'mots illisibles'}
        if 'mots' in tags:
            d['mots'] = mots_of(tags['mots'])
        if 'categories' in tags:
            d['categories'] = categories_of(tags['categories'])
        save(d)
        return {'ok': True, 'ref': d['ref'], 'mots': d.get('mots'), 'categories': d.get('categories')}
    if action == 'sig_note_masquer':   # text: the id of the note
        for n in d.get('notes') or []:
            if n['id'] == text.strip():
                n['statut'] = 'masque'
                save(d)
                return {'ok': True}
        return {'error': 'note introuvable'}
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



# ------------------------------------------------------------------------------------------- categories, keywords
def categories_of(value) -> list:
    items = value.split(',') if isinstance(value, str) else value if isinstance(value, list) else []
    out = []
    for c in items:
        c = str(c).strip().lower()
        if c in CATEGORIES and c not in out:
            out.append(c)
    return out[:MAX_CATEGORIES]


def mots_of(value) -> list:
    """Free keywords: short, plain, no insult nor accusation (they are shown and searched), no duplicates."""
    items = re.split(r'[,;\n]', value) if isinstance(value, str) else value if isinstance(value, list) else []
    out, seen = [], set()
    for m in items:
        m = re.sub(r"[^\w’' \-.€]", '', clean(m, MOT_CHARS)).strip(' -.')
        if len(m) < 2 or _norm(m) in seen or wording_problem(m):
            continue
        seen.add(_norm(m))
        out.append(m)
    return out[:MAX_MOTS]


# Keywords for reports sent before they existed (applied once, at the first index, to a report that has none).
SEED = [
    {'cherche': 'macron', 'avant': '2026-11-10', 'mots': ['Emmanuel Macron', 'anciens présidents', 'Élysée', 'après-mandat', 'budget 2027', 'bureaux', 'sécurité'],
     'categories': ['etat', 'elus', 'train-de-vie', 'opacite']},
]


def _seed(d: dict) -> bool:
    if d.get('mots') or d.get('categories'):
        return False
    text = _norm(f"{d.get('titre', '')} {d.get('description', '')}")
    for s in SEED:
        if s['cherche'] in text and str(d.get('recu') or d.get('publie') or '') < s['avant']:
            d['mots'], d['categories'] = mots_of(s['mots']), categories_of(s['categories'])
            return True
    return False


# ----------------------------------------------------------------------------------------------- the search
# Every published report in memory, words normalised, for the search box of the site (api/assistant/signalements/
# recherche) and for the Loupe (chercher_signalements). Built once from the files, then one report at a time at
# each save (a new report, a vote, a note…): the others are never read again.
_index: dict = {}
_index_ready = {'done': False}


def _words(text: str) -> list:
    return re.findall(r'[a-z0-9]+', _norm(text).replace('’', ' ').replace("'", ' '))


def _index_one(d: dict) -> None:
    ref = d.get('ref')
    if not ref:
        return
    if d.get('statut') != 'publie':
        _index.pop(ref, None)
        return
    _index[ref] = {
        'titre': set(_words(d.get('titre', ''))),
        'mots': set(_words(' '.join(d.get('mots') or []) + ' ' + ' '.join(CATEGORIES.get(c, '') for c in d.get('categories') or []))),
        'lieu': set(_words(f"{d.get('lieu', '')} {d.get('siren', '')}")),
        'texte': set(_words(d.get('description', '') + ' ' + ' '.join(n.get('texte', '') for n in d.get('notes') or [] if n.get('statut', 'publie') == 'publie'))),
        'vue': public_view(d),
    }


def _ensure_index() -> None:
    if _index_ready['done']:
        return
    with _lock:
        if _index_ready['done']:
            return
        for d in all_reports():
            if _seed(d):
                save(d)
            else:
                _index_one(d)
        _index_ready['done'] = True


def search(q: str, limit: int = 8) -> list:
    """Published reports matching every word of q (the last one may be unfinished), best first."""
    _ensure_index()
    words = [w for w in _words(q) if len(w) > 1 and w not in _STOP][:8]
    if not words:
        return []
    found = []
    for ref, e in list(_index.items()):
        score = 0
        for i, w in enumerate(words):
            last = i == len(words) - 1 and len(w) >= 3
            hit = (lambda bag: w in bag or (last and any(x.startswith(w) for x in bag)))
            best = 3 if hit(e['titre']) or hit(e['mots']) else 2 if hit(e['lieu']) else 1 if hit(e['texte']) else 0
            if not best:
                break
            score += best
        else:
            v = e['vue']
            found.append((score + .1 * (v['votes']['up'] - v['votes']['down']) + (.5 if v.get('relu') else 0), v))
    found.sort(key=lambda x: (-x[0], x[1].get('publie') or ''))
    return [{'ref': v['ref'], 'titre': v['titre'], 'extrait': v['description'][:220], 'lieu': v.get('lieu'), 'montant': v.get('montant'),
             'categories': [CATEGORIES[c] for c in v['categories']], 'mots': v['mots'], 'relu': v.get('relu'), 'publie': v.get('publie'),
             'votes': v['votes'], 'url': f"signalements.html#{v['ref']}"} for _, v in found[:limit]]


_STOP = set('le la les l de des du d un une et en a au aux pour par sur dans est ce que qui quoi quel quelle ou on il elle se sa son ses leur leurs y'.split())


# ------------------------------------------------------------------------------- votes and community notes
# A thumb up or down on a report (« Ce signalement est-il légitime, objectif, ou permet-il de mieux comprendre nos
# dépenses publiques ? ») and on each note of the community (same question about the note). One vote per reader, which
# they can change or take back. The reader is a key derived from the IP address with a secret kept on the server
# (never the address itself), so that a vote counts once across days.
NOTE_CHARS, MAX_NOTES = 1000, 30
VOTES_PER_HOUR, NOTES_PER_HOUR, NOTES_PER_DAY = 120, 5, 15
NOTE_SHOWN_UP, NOTE_HIDDEN_NET = 3, -3   # a note « retenue » from 3 thumbs up and twice as many up as down
_votes_hits = collections.defaultdict(collections.deque)
_notes_hits = collections.defaultdict(collections.deque)


def _voter_secret() -> bytes:
    p = _dir() / '.cle-votes'
    try:
        return p.read_bytes()
    except OSError:
        key = secrets.token_bytes(32)
        p.write_bytes(key)
        try:
            p.chmod(0o600)
        except OSError:
            pass
        return key


def voter(ip: str) -> str:
    return hmac.new(_voter_secret(), ip.encode(), hashlib.sha256).hexdigest()[:16]


def _counts(votes) -> dict:
    votes = votes or {}
    return {'up': len(votes.get('up') or []), 'down': len(votes.get('down') or [])}


def _too_many(hits: dict, who: str, per_hour: int, per_day: int = 0) -> bool:
    now = time.time()
    q = hits[who]
    while q and now - q[0] > 86400:
        q.popleft()
    if sum(1 for t in q if now - t < 3600) >= per_hour or (per_day and len(q) >= per_day):
        return True
    q.append(now)
    return False


def vote(body: dict, who: str) -> dict:
    """{"ref", "note"?, "sens": 1 | -1 | 0} -> the counts after the vote."""
    try:
        d = load(str(body.get('ref') or ''))
    except ValueError:
        d = None
    if not d or d.get('statut') != 'publie':
        return {'ok': False, 'error': 'signalement introuvable'}
    sens = body.get('sens')
    if sens not in (1, -1, 0):
        return {'ok': False, 'error': 'vote illisible'}
    with _lock:
        if _too_many(_votes_hits, who, VOTES_PER_HOUR):
            return {'ok': False, 'error': 'beaucoup de votes en peu de temps : réessayez plus tard'}
        d = load(d['ref'])
        target = d
        if body.get('note'):
            target = next((n for n in d.get('notes') or [] if n['id'] == str(body['note']) and n.get('statut', 'publie') == 'publie'), None)
            if target is None:
                return {'ok': False, 'error': 'note introuvable'}
        v = target.setdefault('votes', {'up': [], 'down': []})
        for side in ('up', 'down'):
            v[side] = [x for x in v.get(side) or [] if x != who]
        if sens:
            v['up' if sens > 0 else 'down'].append(who)
        save(d)
    return {'ok': True, 'votes': _counts(v)}


def add_note(body: dict, who: str, reader: str) -> dict:
    """A note of the community under a published report: plain text with its sources, the same checks as a report
    (human check without the drawing, words), shown at once, hidden by the site when it must be."""
    try:
        d = load(str(body.get('ref') or ''))
    except ValueError:
        d = None
    if not d or d.get('statut') != 'publie':
        return {'ok': False, 'error': 'signalement introuvable'}
    if str(body.get('site') or ''):       # honeypot
        return {'ok': True}
    texte = clean(body.get('texte'), NOTE_CHARS + 1)
    if len(texte) < 30:
        return {'ok': False, 'error': 'une note explique, avec ses sources : 30 caractères au moins'}
    if len(texte) > NOTE_CHARS:
        return {'ok': False, 'error': f'note trop longue ({NOTE_CHARS} caractères au plus)'}
    liens = [clean(x, 400) for x in (body.get('liens') if isinstance(body.get('liens'), list) else [])][:5]
    liens = [x for x in liens if re.fullmatch(r'https?://[^\s<>"]{3,400}', x)]
    problem = wording_problem(texte) or verify_human(body.get('preuve') or {}, trace=False)
    if problem:
        return {'ok': False, 'error': problem}
    with _lock:
        if _too_many(_notes_hits, reader, NOTES_PER_HOUR, NOTES_PER_DAY):
            return {'ok': False, 'error': 'vous avez déjà écrit plusieurs notes : réessayez plus tard'}
        d = load(d['ref'])
        notes = d.setdefault('notes', [])
        if len([n for n in notes if n.get('statut', 'publie') == 'publie']) >= MAX_NOTES:
            return {'ok': False, 'error': 'ce signalement a déjà beaucoup de notes'}
        note = {'id': secrets.token_hex(4), 'texte': texte, 'liens': liens, 'recu': dt.datetime.now().isoformat(timespec='seconds'),
                'statut': 'publie', 'votes': {'up': [who], 'down': []}}
        notes.append(note)
        save(d)
    try:
        from . import demandes
        demandes.notify(f'Note de la communauté sur {d["ref"]}', f'{texte}\n\n' + '\n'.join(liens)
                        + f'\n\nMasquer : frl-signalements note_masquer {d["ref"]} --texte (id {note["id"]})')
    except Exception:  # noqa: BLE001
        pass
    return {'ok': True, 'id': note['id']}
