"""Publication automatique des fils (threads) sur X pour @FranceRoueLibre, par l'API officielle (v2, paiement à l'usage).

Aucune dépendance : Python seul. Les clés ne sont jamais écrites en clair : elles sont chiffrées pour le compte
Windows courant (DPAPI) dans %APPDATA%\\FranceRoueLibre\\x_keys.bin.

    python scripts/x_publish.py cles                         saisir les 4 clés (invite masquée), une fois
    python scripts/x_publish.py verifier                     teste les clés (lit le compte, ne publie rien)
    python scripts/x_publish.py planifier DOSSIER --le "2026-11-12 18:30"
    python scripts/x_publish.py file                         ce qui est en file, avec le coût estimé
    python scripts/x_publish.py lancer [--a-blanc]           publie tout ce qui est arrivé à l'heure
    python scripts/x_publish.py annuler ID                   retire un fil non commencé de la file

Un DOSSIER contient un thread.md : un titre « ## Tweet N · <média> » par tweet, puis son texte. <média> vaut
« sans image », ou un type suivi d'un nom de fichier du dossier (« vidéo 01_accroche.mp4 », « image 02.png »,
« GIF 03.gif »). Les tweets d'un fil sont enchaînés en réponses. Un fil interrompu reprend où il s'est arrêté.

File et journal : _transfer/x/queue.json et _transfer/x/journal.jsonl (hors dépôt).
"""
import argparse, base64, datetime as dt, getpass, hashlib, hmac, json, mimetypes, os, pathlib, re, secrets, sys, time
import urllib.error, urllib.parse, urllib.request, uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
STATE = ROOT / '_transfer' / 'x'
QUEUE, JOURNAL = STATE / 'queue.json', STATE / 'journal.jsonl'
API = 'https://api.x.com'
KEYS = ('api_key', 'api_secret', 'access_token', 'access_secret')
PRIX_POST, PRIX_LIEN = 0.015, 0.20          # dollars par tweet, tarif public X (pay-per-use) relevé le 10/11/2026
MAX_PAR_JOUR = 60                           # garde-fou : jamais plus de tweets par 24 h
PAUSE = 3                                   # secondes entre deux tweets d'un même fil
CAT = {'.mp4': 'tweet_video', '.mov': 'tweet_video', '.gif': 'tweet_gif', '.png': 'tweet_image', '.jpg': 'tweet_image',
       '.jpeg': 'tweet_image', '.webp': 'tweet_image'}
LIMITE = {'tweet_image': 5 << 20, 'tweet_gif': 15 << 20, 'tweet_video': 512 << 20}
URL_RE = re.compile(r'https?://\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:fr|com|org|net|io|eu|gouv\.fr)\b(?:/\S*)?', re.I)


# ------------------------------------------------------------------ clés (DPAPI)
def _keyfile():
    base = pathlib.Path(os.environ.get('APPDATA') or pathlib.Path.home() / '.config') / 'FranceRoueLibre'
    base.mkdir(parents=True, exist_ok=True)
    return base / 'x_keys.bin'

def _dpapi(data, protect):
    import ctypes
    from ctypes import wintypes
    class BLOB(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('p', ctypes.POINTER(ctypes.c_char))]
    buf = ctypes.create_string_buffer(data, len(data)); src = BLOB(len(data), buf); dst = BLOB()
    fn = ctypes.windll.crypt32.CryptProtectData if protect else ctypes.windll.crypt32.CryptUnprotectData
    if not fn(ctypes.byref(src), None, None, None, None, 0, ctypes.byref(dst)):
        raise SystemExit('Chiffrement Windows (DPAPI) impossible.')
    out = ctypes.string_at(dst.p, dst.cb); ctypes.windll.kernel32.LocalFree(dst.p)
    return out

def save_keys(k):
    if os.name != 'nt': raise SystemExit('Le stockage des clés utilise le chiffrement de Windows : lancez cette commande sur le PC.')
    _keyfile().write_bytes(_dpapi(json.dumps(k).encode(), True))

def load_keys():
    if all(os.environ.get('X_' + n.upper()) for n in KEYS):           # pour un serveur : variables d'environnement
        return {n: os.environ['X_' + n.upper()] for n in KEYS}
    f = _keyfile()
    if os.name != 'nt' or not f.exists():
        raise SystemExit('Clés X absentes : lancez x_cles.bat (ou « x_publish.py cles ») une fois.')
    return json.loads(_dpapi(f.read_bytes(), False))


# ------------------------------------------------------------------ OAuth 1.0a (signature HMAC-SHA1)
def _q(s): return urllib.parse.quote(str(s), safe='-._~')

def oauth_header(method, url, k, extra=None, nonce=None, ts=None):
    """extra : paramètres de requête ou de formulaire urlencodé (les corps JSON et multipart ne sont pas signés)."""
    p = {'oauth_consumer_key': k['api_key'], 'oauth_nonce': nonce or secrets.token_hex(16), 'oauth_signature_method': 'HMAC-SHA1',
         'oauth_timestamp': str(ts or int(time.time())), 'oauth_token': k['access_token'], 'oauth_version': '1.0'}
    allp = sorted((_q(a), _q(b)) for a, b in {**p, **(extra or {})}.items())
    base = '&'.join([method.upper(), _q(url), _q('&'.join(f'{a}={b}' for a, b in allp))])
    key = f"{_q(k['api_secret'])}&{_q(k['access_secret'])}".encode()
    p['oauth_signature'] = base64.b64encode(hmac.new(key, base.encode(), hashlib.sha1).digest()).decode()
    return 'OAuth ' + ', '.join(f'{_q(a)}="{_q(b)}"' for a, b in sorted(p.items()))

def call(method, path, k, query=None, body=None, multipart=None):
    url = API + path
    h = {'Authorization': oauth_header(method, url, k, query), 'User-Agent': 'FranceRoueLibre-x_publish'}
    data = None
    if body is not None:
        data = json.dumps(body).encode(); h['Content-Type'] = 'application/json'
    if multipart is not None:
        b = uuid.uuid4().hex; parts = []
        for name, val in multipart.items():
            if isinstance(val, bytes):
                parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{name}"; filename="chunk"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + val + b'\r\n')
            else:
                parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{val}\r\n'.encode())
        data = b''.join(parts) + f'--{b}--\r\n'.encode(); h['Content-Type'] = f'multipart/form-data; boundary={b}'
    if query: url += '?' + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'X a répondu {e.code} sur {method} {path} : {e.read().decode(errors="replace")[:600]}')


# ------------------------------------------------------------------ médias et tweets
def upload(path, k):
    path = pathlib.Path(path); cat = CAT[path.suffix.lower()]; size = path.stat().st_size
    mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    init = call('POST', '/2/media/upload/initialize', k, body={'media_type': mime, 'total_bytes': size, 'media_category': cat})
    mid = init['data']['id']
    with open(path, 'rb') as f:
        i = 0
        while chunk := f.read(4 << 20):
            call('POST', f'/2/media/upload/{mid}/append', k, multipart={'segment_index': i, 'media': chunk}); i += 1
    info = call('POST', f'/2/media/upload/{mid}/finalize', k).get('data', {}).get('processing_info')
    t0 = time.time()
    while info and info.get('state') in ('pending', 'in_progress'):
        if time.time() - t0 > 900: raise RuntimeError(f'Traitement du média trop long : {path.name}')
        time.sleep(min(int(info.get('check_after_secs', 3)), 15))
        info = call('GET', '/2/media/upload', k, query={'command': 'STATUS', 'media_id': mid}).get('data', {}).get('processing_info')
    if info and info.get('state') == 'failed': raise RuntimeError(f'X refuse le média {path.name} : {info}')
    return mid

def post(text, k, media_id=None, reply_to=None):
    body = {'text': text}
    if media_id: body['media'] = {'media_ids': [media_id]}
    if reply_to: body['reply'] = {'in_reply_to_tweet_id': reply_to}
    return call('POST', '/2/tweets', k, body=body)['data']['id']


# ------------------------------------------------------------------ thread.md
def longueur(t):
    """Longueur comptée par X : 23 pour un lien, 2 pour un emoji ou un caractère hors plan de base."""
    n = 0; last = 0
    for m in URL_RE.finditer(t):
        n += sum(2 if ord(c) > 0xFFFF or 0x1100 <= ord(c) <= 0x11FF or 0x2E80 <= ord(c) <= 0xD7FF or 0x2190 <= ord(c) <= 0x27BF else 1 for c in t[last:m.start()]) + 23
        last = m.end()
    return n + sum(2 if ord(c) > 0xFFFF or 0x2190 <= ord(c) <= 0x27BF else 1 for c in t[last:])

def lire_fil(dossier):
    dossier = pathlib.Path(dossier).resolve(); md = (dossier / 'thread.md').read_text(encoding='utf-8')
    tweets = []
    for m in re.finditer(r'^## Tweet \d+ · ([^\n]*)\n(.*?)(?=^## |\Z)', md, re.S | re.M):
        head, text = m.group(1), m.group(2).strip()
        f = re.search(r'([\w.\-]+\.(?:mp4|mov|gif|png|jpe?g|webp))', head, re.I)
        media = None
        if f:
            media = dossier / f.group(1)
            if not media.exists(): raise SystemExit(f'Média introuvable : {media}')
            lim = LIMITE[CAT[media.suffix.lower()]]
            if media.stat().st_size > lim: raise SystemExit(f'{media.name} dépasse {lim >> 20} Mo.')
        if not text: raise SystemExit(f'Tweet vide dans {dossier.name}')
        if longueur(text) > 280: raise SystemExit(f'Tweet trop long ({longueur(text)}) dans {dossier.name} : {text[:60]}…')
        tweets.append({'text': text, 'media': str(media) if media else None, 'id': None})
    if not tweets: raise SystemExit(f'Aucun tweet trouvé dans {dossier / "thread.md"}')
    return tweets

def cout(tweets):
    return sum(PRIX_LIEN if URL_RE.search(t['text']) else PRIX_POST for t in tweets if not t['id'])


# ------------------------------------------------------------------ file d'attente
def lire_file():
    return json.loads(QUEUE.read_text(encoding='utf-8')) if QUEUE.exists() else []

def ecrire_file(q):
    STATE.mkdir(parents=True, exist_ok=True)
    tmp = QUEUE.with_suffix('.json.tmp'); tmp.write_text(json.dumps(q, ensure_ascii=False, indent=1), encoding='utf-8'); os.replace(tmp, QUEUE)

def journal(**kw):
    STATE.mkdir(parents=True, exist_ok=True)
    with open(JOURNAL, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'at': dt.datetime.now().astimezone().isoformat(timespec='seconds'), **kw}, ensure_ascii=False) + '\n')

def publies_24h():
    if not JOURNAL.exists(): return 0
    lim = dt.datetime.now().astimezone() - dt.timedelta(hours=24); n = 0
    for line in JOURNAL.read_text(encoding='utf-8').splitlines():
        e = json.loads(line)
        if e.get('evt') == 'tweet' and dt.datetime.fromisoformat(e['at']) > lim: n += 1
    return n


# ------------------------------------------------------------------ commandes
def cmd_cles(a):
    print('Clés de l\'application X (console.x.com, Applications, Clés et jetons). La saisie est masquée.')
    lab = {'api_key': 'Clé API (Consumer Key)', 'api_secret': 'Secret de la clé API (Consumer Secret)',
           'access_token': 'Jeton d\'accès (Access Token)', 'access_secret': 'Secret du jeton d\'accès (Access Token Secret)'}
    k = {n: getpass.getpass(lab[n] + ' : ').strip() for n in KEYS}
    if not all(k.values()): raise SystemExit('Une clé est vide : rien n\'est enregistré.')
    save_keys(k); print('Clés enregistrées, chiffrées pour ce compte Windows :', _keyfile())

def cmd_verifier(a):
    me = call('GET', '/2/users/me', load_keys())['data']
    print(f"Clés valides. Compte : @{me['username']} ({me['name']}).")

def cmd_planifier(a):
    tweets = lire_fil(a.dossier)
    quand = dt.datetime.strptime(a.le, '%Y-%m-%d %H:%M').astimezone() if a.le else dt.datetime.now().astimezone()
    q = lire_file(); ident = a.id or pathlib.Path(a.dossier).resolve().name
    if any(e['id'] == ident and e['etat'] != 'publie' for e in q): raise SystemExit(f'« {ident} » est déjà en file : annulez-le d\'abord.')
    q.append({'id': ident, 'dossier': str(pathlib.Path(a.dossier).resolve()), 'le': quand.isoformat(timespec='minutes'), 'etat': 'en_file', 'tweets': tweets})
    ecrire_file(q); journal(evt='planifie', id=ident, le=quand.isoformat(timespec='minutes'), tweets=len(tweets))
    print(f'« {ident} » : {len(tweets)} tweets, publication le {quand:%d/%m/%Y à %H:%M}, coût estimé {cout(tweets):.2f} $.')

def cmd_file(a):
    q = lire_file()
    if not q: print('File vide.'); return
    for e in sorted(q, key=lambda e: e['le']):
        fait = sum(1 for t in e['tweets'] if t['id'])
        ligne = f"{e['le'][:16].replace('T', ' ')}  {e['etat']:9}  {e['id']:28}  {fait}/{len(e['tweets'])} tweets  reste {cout(e['tweets']):.2f} $"
        if e.get('erreur'): ligne += f"\n    dernière erreur : {e['erreur'][:200]}"
        if fait: ligne += f"\n    https://x.com/i/status/{e['tweets'][0]['id']}"
        print(ligne)
    print(f"Tweets publiés sur 24 h : {publies_24h()} (plafond {MAX_PAR_JOUR}).")

def cmd_annuler(a):
    q = lire_file(); e = next((e for e in q if e['id'] == a.id and e['etat'] != 'publie'), None)
    if not e: raise SystemExit('Rien de tel en file.')
    if any(t['id'] for t in e['tweets']): raise SystemExit('Ce fil est déjà commencé sur X : il reprendra au prochain lancement.')
    e['etat'] = 'annule'; ecrire_file([x for x in q if x is not e]); journal(evt='annule', id=a.id); print('Retiré de la file.')

def cmd_lancer(a):
    q = lire_file(); now = dt.datetime.now().astimezone()
    dus = [e for e in sorted(q, key=lambda e: e['le']) if e['etat'] in ('en_file', 'en_cours') and dt.datetime.fromisoformat(e['le']) <= now]
    if not dus: print('Rien à publier pour le moment.'); return
    k = None if a.a_blanc else load_keys()
    for e in dus:
        print(f"== {e['id']} ({len(e['tweets'])} tweets)")
        e['etat'] = 'en_cours'; prev = None
        try:
            for i, t in enumerate(e['tweets'], 1):
                if t['id']: prev = t['id']; continue
                if a.a_blanc:
                    print(f"  [à blanc] {i}/{len(e['tweets'])} {longueur(t['text'])} car. média={pathlib.Path(t['media']).name if t['media'] else '-'} : {t['text'][:70]!r}")
                    continue
                if publies_24h() >= MAX_PAR_JOUR: raise RuntimeError(f'plafond de {MAX_PAR_JOUR} tweets par 24 h atteint')
                mid = upload(t['media'], k) if t['media'] else None
                t['id'] = post(t['text'], k, mid, prev); prev = t['id']
                ecrire_file(q); journal(evt='tweet', id=e['id'], n=i, tweet=t['id'], lien=bool(URL_RE.search(t['text'])))
                print(f"  {i}/{len(e['tweets'])} publié : https://x.com/i/status/{t['id']}")
                time.sleep(PAUSE)
            if not a.a_blanc:
                e['etat'] = 'publie'; e.pop('erreur', None); journal(evt='fil_publie', id=e['id'], premier=e['tweets'][0]['id'])
        except Exception as ex:                                  # on garde l'état : le fil reprendra au tweet suivant
            e['erreur'] = str(ex); journal(evt='erreur', id=e['id'], erreur=str(ex)[:500]); print('  ERREUR :', ex)
        if a.a_blanc: e['etat'] = 'en_file' if not any(t['id'] for t in e['tweets']) else 'en_cours'
        else: ecrire_file(q)

def main():
    for s in (sys.stdout, sys.stderr):
        try: s.reconfigure(encoding='utf-8')
        except Exception: pass
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter); sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('cles').set_defaults(f=cmd_cles); sub.add_parser('verifier').set_defaults(f=cmd_verifier)
    s = sub.add_parser('planifier'); s.add_argument('dossier'); s.add_argument('--le', help='"AAAA-MM-JJ HH:MM", heure du PC ; sinon dès le prochain lancement'); s.add_argument('--id'); s.set_defaults(f=cmd_planifier)
    sub.add_parser('file').set_defaults(f=cmd_file)
    s = sub.add_parser('lancer'); s.add_argument('--a-blanc', action='store_true', help='montre ce qui partirait, sans rien envoyer'); s.set_defaults(f=cmd_lancer)
    s = sub.add_parser('annuler'); s.add_argument('id'); s.set_defaults(f=cmd_annuler)
    a = p.parse_args(); a.f(a)

if __name__ == '__main__':
    main()
