"""Requests to public bodies (« Demandes aux instances publiques »): when the site's data and the web do not answer a
question, the Loupe drafts a request for administrative documents (code des relations entre le public et
l'administration, articles L. 300-1 and following) to the body that holds them.

* the recipient comes from the official directory of public services (Annuaire de l'administration, DILA,
  api-lannuaire.service-public.fr), never from the model: only those addresses can be written to by the site;
* the letter is a fixed, polite template: the model only fills the subject, the documents asked and one or two
  sentences of context, cleaned and checked (no insult, accusation, capitals, link, e-mail or phone number);
* the reader either copies it and sends it himself, or asks FranceRoueLibre to send it from MAIL_FROM. With
  MAIL_AUTO_SEND=0 (default) it then waits for the site's validation (``assistant_api.py --demandes``);
* replies are read from the mailbox (IMAP) and published only once validated; the agents' names are not published;
* one file per request in STATE_DIR/demandes/<ref>.json; GET /api/assistant/demandes lists the published ones
  (page demandes.html).
"""
from __future__ import annotations

import datetime as dt
import email
import email.policy
import email.utils
import html
import imaplib
import json
import re
import secrets
import smtplib
import ssl
import threading
import unicodedata
import urllib.parse
from email.message import EmailMessage
from pathlib import Path
from typing import Optional

from . import settings as S
from .net import NetworkError, get_json

ANNUAIRE = 'https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records'
PAGE = 'demandes.html'
DELAY_DAYS = 30           # silence for one month = implicit refusal (CRPA, R. 311-13); the CADA can then be seized
DRAFT_HOURS = 48          # unsent drafts are deleted after this
LIMITS = {'objet': 140, 'documents': 900, 'contexte': 600}
_lock = threading.Lock()

# Words that make a request impolite or accusatory: the model is asked to rewrite it neutrally.
RUDE = re.compile(r"\b(con|cons|connard\w*|conne|salaud\w*|salop\w*|enfoir\w*|putain|merde\w*|bordel|voleur\w*|"
                  r"escroc\w*|escroquerie\w*|corrompu\w*|corruption|mafi\w*|pourri\w*|menteur\w*|mensonge\w*|honte\w*|"
                  r"scandal\w*|gaspill\w*|incompet\w*|crimin\w*|delinquan\w*|racket\w*|magouill\w*|detourn\w*|"
                  r"fraud\w*|vol|vols|traitre\w*|imbecil\w*|idiot\w*|nul|nuls|exig\w*|immediatement|sinon|plainte)\b")


def norm(text: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', str(text or '').lower()) if unicodedata.category(c) != 'Mn')


def _dir() -> Path:
    d = S.STATE_DIR / 'demandes'
    d.mkdir(parents=True, exist_ok=True)
    return d


# ------------------------------------------------------------------------------------------------------- directory
def _json_field(value):
    try:
        return json.loads(value) if isinstance(value, str) else value
    except ValueError:
        return None


def _record(r: dict) -> dict:
    site = _json_field(r.get('site_internet')) or []
    return {'nom': r.get('nom'), 'email': (r.get('adresse_courriel') or '').split(';')[0].strip() or None,
            'formulaire': r.get('formulaire_contact'), 'site': site[0].get('valeur') if site else None,
            'fiche': r.get('url_service_public'), 'siret': r.get('siret')}


def annuaire(code_insee: str = '', nom: str = '') -> list:
    """Official contacts: the town hall of a commune (INSEE code), else a full-text search on the body's name."""
    if code_insee:
        where = f'code_insee_commune="{code_insee}" and pivot like "mairie"'
    else:
        words = [w for w in re.findall(r'[a-z0-9]+', norm(nom)) if len(w) > 2 and w not in ('les', 'des', 'aux', 'pour')]
        if not words:
            return []
        where = ' and '.join(f'search(nom, "{w}")' for w in words[:6])
    # 100 records: « Métropole de Lyon » matches 71 offices (each « Maison de la Métropole de Lyon - … ») and the
    # body itself, « Métropole de Lyon - Rhône », comes last in the API's order
    url = ANNUAIRE + '?' + urllib.parse.urlencode({'where': where, 'limit': 8 if code_insee else 100, 'select': 'nom,'
                                                   'adresse_courriel,formulaire_contact,site_internet,url_service_public,'
                                                   'siret,pivot'})
    status, res, _ = get_json(url, timeout=15)
    if status != 200:
        raise NetworkError(f'annuaire : HTTP {status}')
    rows = res.get('results', [])
    if not code_insee:  # the closest name first: « Conseil départemental de la Gironde » before « Conseil départemental
        asked = set(words)   # d'accès au droit de Gironde », which holds the same words and others; then the body
        extra = lambda r: len([w for w in re.findall(r'[a-z0-9]+', norm(r.get('nom') or '')) if len(w) > 2  # itself
                               and w not in asked and w not in ('les', 'des', 'aux', 'pour')])  # before its local offices
        wanted = {k for w, k in WANTED.items() if w in asked}   # « Région … » asks the regional council, not the
        rows.sort(key=lambda r: (0 if _kind(r) in wanted else 1 if _kind(r) in INSTITUTIONS else 2, extra(r)))  # prefecture
    return [_record(r) for r in rows[:8]]


# the bodies themselves in the directory (« type_service_local »), before their local offices and branches
INSTITUTIONS = {'mairie', 'epci', 'cg', 'cr', 'prefecture', 'prefecture_region', 'rectorat', 'ars', 'drfip', 'ddfip',
                'dreal', 'dreets', 'drac', 'sous_pref', 'caf', 'cpam', 'urssaf', 'crc'}

WANTED = {'region': 'cr', 'regional': 'cr', 'departement': 'cg', 'departemental': 'cg', 'metropole': 'epci',
          'communaute': 'epci', 'agglomeration': 'epci', 'rectorat': 'rectorat', 'academie': 'rectorat',
          'prefecture': 'prefecture', 'mairie': 'mairie', 'ville': 'mairie', 'commune': 'mairie'}


def _kind(r: dict) -> str:
    pivot = _json_field(r.get('pivot')) or []
    return (pivot[0].get('type_service_local') or '') if pivot and isinstance(pivot[0], dict) else ''


# ------------------------------------------------------------------------------------------------------- letter
def clean(text: str, limit: int) -> str:
    """One field of the letter: no link, e-mail or phone number, no capitals shouting, bounded."""
    s = re.sub(r'https?://\S+|www\.\S+', '', str(text or ''))
    s = re.sub(r'[\w.+-]+@[\w-]+\.[\w.]+', '', s)
    s = re.sub(r'(\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}', '', s)
    s = re.sub(r'[!?]{2,}', lambda m: m.group(0)[0], s).replace('—', ',')
    lines = [re.sub(r'[ \t]+', ' ', l).strip(' -•*') for l in s.splitlines()]
    return '\n'.join(l for l in lines if l)[:limit].strip()


def check(fields: dict) -> Optional[str]:
    """None when the fields can go in a letter, else what to fix (sent back to the model)."""
    for k in ('objet', 'documents'):
        if not fields.get(k):
            return f'« {k} » manquant'
    blob = ' '.join(fields.values())
    bad = sorted(set(RUDE.findall(norm(blob))))
    if bad:
        return ('formulation refusée (' + ', '.join(bad) + ') : une demande de documents reste neutre et polie, sans '
                'reproche, accusation ni mise en demeure ; décrire seulement les documents voulus.')
    for value in fields.values():
        letters = [c for c in value if c.isalpha()]
        if len(letters) >= 15 and sum(c.isupper() for c in letters) > .5 * len(letters):
            return 'pas de texte en capitales'
    return None


def letter(to_name: str, fields: dict, ref: str = '', by_site: bool = True) -> tuple:
    """(subject, body). by_site: sent by FranceRoueLibre (signed by the site, published); else signed by the reader."""
    docs = '\n'.join(f'- {d}' for d in fields['documents'].splitlines())
    subject = f'Demande de communication de documents administratifs : {fields["objet"]}' + (f' [{ref}]' if ref else '')
    parts = ['Madame, Monsieur,', '',
             'En application des articles L. 300-1 et suivants du code des relations entre le public et '
             'l’administration, je vous serais reconnaissant de bien vouloir me communiquer, par courrier électronique, '
             'les documents suivants :', '', docs, '']
    if fields.get('contexte'):
        parts += [fields['contexte'], '']
    parts += ['Si ces documents sont déjà publiés en ligne, il suffit de m’en indiquer l’adresse. Si certains '
              'contiennent des mentions protégées (données personnelles, secret des affaires), je vous remercie de me '
              'les transmettre après occultation de ces mentions (article L. 311-7 du même code).', '']
    if by_site:
        parts += ['FranceRoueLibre est un site indépendant qui présente les comptes publics à partir des données '
                  f'ouvertes. Cette demande et votre réponse seront publiées sur {S.SITE_URL}/{PAGE}, sans le nom des '
                  'agents.', '',
                  'Je vous remercie par avance et vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations '
                  'distinguées.']   # the signature (logo, address, site) is added when the mail is sent
    else:
        parts += ['Je vous remercie par avance et vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations '
                  'distinguées.', '', '[Votre nom]']
    return subject, '\n'.join(parts)


# ------------------------------------------------------------------------------------------------------- store
def _path(ref: str) -> Path:
    if not re.fullmatch(r'FRL-\d{4}-\d{4}|B-[A-Za-z0-9_-]{8,30}', ref or ''):
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


def all_requests() -> list:
    out = []
    for p in sorted(_dir().glob('FRL-*.json')):
        try:
            out.append(json.loads(p.read_text(encoding='utf-8')))
        except (OSError, ValueError):
            continue
    return out


def _next_ref() -> str:
    year = dt.date.today().year
    n = max([int(p.stem[-4:]) for p in _dir().glob(f'FRL-{year}-*.json')] or [0]) + 1
    return f'FRL-{year}-{n:04d}'


def sweep_drafts() -> None:
    now = dt.datetime.now()
    for p in _dir().glob('B-*.json'):
        try:
            if now - dt.datetime.fromtimestamp(p.stat().st_mtime) > dt.timedelta(hours=DRAFT_HOURS):
                p.unlink()
        except OSError:
            pass


# ------------------------------------------------------------------------------------------------------- tool
def prepare(organisme: str, code_insee: str = '', objet: str = '', documents: str = '', contexte: str = '',
            question: str = '') -> dict:
    """The tool preparer_demande: finds the official contact, builds the letter, keeps a draft for the reader."""
    fields = {'objet': clean(objet, LIMITS['objet']), 'documents': clean(documents, LIMITS['documents']),
              'contexte': clean(contexte, LIMITS['contexte'])}
    why = check(fields)
    if why:
        return {'error': why}
    code = re.sub(r'\s', '', str(code_insee or ''))[:5]
    try:
        contacts = annuaire(code_insee=code) if re.fullmatch(r'\d[\dAB]\d{3}', code) else annuaire(nom=organisme)
    except NetworkError as exc:
        return {'error': f'annuaire de l’administration indisponible ({exc}) ; réessayer plus tard'}
    if not contacts:
        return {'error': f'« {organisme} » introuvable dans l’annuaire de l’administration ; donner le code Insee pour '
                         'une mairie ou le nom exact de l’organisme (ex. « Conseil départemental du Nord »)'}
    # a town hall: the first record with an address (annexes come without); a named body: the closest match even
    # without an address (its contact form then), never another office that merely publishes one (FRL Vaulx-en-Velin:
    # « Maison de la Métropole de Lyon - Limonest » instead of the Métropole)
    to = next((c for c in contacts if c['email']), contacts[0]) if re.fullmatch(r'\d[\dAB]\d{3}', code) else contacts[0]
    sweep_drafts()
    draft_id = 'B-' + secrets.token_urlsafe(12)
    subject, body = letter(to['nom'], fields, by_site=False)
    d = {'ref': draft_id, 'status': 'brouillon', 'created': dt.datetime.now().isoformat(timespec='seconds'),
         'to': to, 'fields': fields, 'question': str(question or '')[:500]}
    save(d)
    return {'demande': {'id': draft_id, 'destinataire': to['nom'], 'email': to['email'], 'formulaire': to['formulaire'],
                        'fiche': to['fiche'], 'objet': subject, 'texte': body,
                        # an address: the site e-mails the letter; only a contact form: the site's team pastes it in
                        'envoi_par_le_site': bool((to['email'] or to['formulaire']) and S.MAIL_CONFIGURED),
                        'depot_formulaire': bool(not to['email'] and to['formulaire'])},
            'autres_contacts': [c['nom'] for c in contacts if c is not to][:5],
            'note': 'Le lecteur voit la lettre sous ta réponse, avec deux boutons : la faire envoyer par FranceRoueLibre '
                    '(par courriel, ou déposée dans le formulaire de contact quand l’organisme n’a pas d’adresse) ou la '
                    'copier pour l’envoyer lui-même. Ne recopie pas la lettre '
                    'dans ta réponse : dis en une phrase à qui elle s’adresse et pourquoi, et le délai d’un mois.'}


def public_view(d: dict) -> dict:
    sent = d.get('sent')
    due = (dt.datetime.fromisoformat(sent) + dt.timedelta(days=DELAY_DAYS)).date().isoformat() if sent else None
    return {'ref': d['ref'], 'status': d['status'], 'organisme': d['to']['nom'], 'objet': d['fields']['objet'],
            'documents': d['fields']['documents'], 'contexte': d['fields'].get('contexte'), 'envoyee': sent,
            'echeance': due, 'fiche': d['to'].get('fiche'), 'canal': d.get('mode') or 'courriel',
            'reponses': [{'date': r['date'], 'texte': r['public_text'], 'pieces': r.get('public_files', [])}
                         for r in d.get('replies', []) if r.get('public_text')]}


def published() -> list:
    rows = [public_view(d) for d in all_requests() if d['status'] in ('envoyee', 'repondue', 'close')]
    return sorted(rows, key=lambda r: r['envoyee'] or '', reverse=True)


# ------------------------------------------------------------------------------------------------------- sending
def _sent_today() -> int:
    today = dt.date.today().isoformat()
    return sum(1 for d in all_requests() if (d.get('sent') or '').startswith(today))


def request_send(draft_id: str, reader: str) -> dict:
    """The reader asks the site to send the draft: refused, waiting for validation, or sent."""
    with _lock:
        d = load(draft_id)
        if not d or d['status'] != 'brouillon':
            return {'error': 'brouillon inconnu ou déjà envoyé'}
        form = not d['to'].get('email')   # only a contact form: FranceRoueLibre pastes the letter in it by hand
        if form and not d['to'].get('formulaire'):
            return {'error': 'cet organisme ne publie ni adresse électronique ni formulaire : copiez la lettre et envoyez-la par courrier'}
        if not S.MAIL_CONFIGURED:
            return {'error': 'l’envoi par le site n’est pas encore ouvert : copiez la lettre et envoyez-la vous-même'}
        key = lambda x: x['to'].get('email') or x['to'].get('nom')
        recent = [x for x in all_requests() if key(x) == key(d) and x['ref'] != d['ref'] and x['status'] != 'refusee'
                  and (dt.datetime.now() - dt.datetime.fromisoformat(x['created'])).days < 30]
        if any(x['fields']['objet'] == d['fields']['objet'] for x in recent):
            return {'error': 'la même demande a déjà été faite à cet organisme ce mois-ci', 'ref': recent[0]['ref']}
        if len(recent) >= S.MAIL_PER_BODY_MONTH:
            return {'error': 'FranceRoueLibre a déjà écrit à cet organisme ce mois-ci : copiez la lettre pour l’envoyer vous-même'}
        if sum(1 for x in all_requests() if x.get('reader') == reader and x['created'][:10] == dt.date.today().isoformat()) >= 2:
            return {'error': 'deux demandes par jour au plus : copiez la lettre pour l’envoyer vous-même'}
        ref = _next_ref()
        old = _path(draft_id)
        d.update(ref=ref, reader=reader, requested=dt.datetime.now().isoformat(timespec='seconds'))
        d['subject'], d['body'] = letter(d['to']['nom'], d['fields'], ref, by_site=True)
        d['status'] = 'a_valider'
        if form:
            d['mode'] = 'formulaire'
        save(d)
        old.unlink(missing_ok=True)
    if form:
        notify(f'Demande {ref} à déposer dans un formulaire', f'{d["to"]["nom"]} : {d["to"]["formulaire"]}\n\n'
                                                          f'{d["subject"]}\n\n{d["body"]}\n\n'
                                                          f'Question du lecteur : {d.get("question")}\n\n'
                                                          f'Coller la lettre dans le formulaire (avec {ref} dans l’objet), '
                                                          f'puis : assistant_api.py --demandes deposee {ref}')
        return {'ok': True, 'ref': ref, 'status': 'a_valider', 'mode': 'formulaire',
                'message': f'Demande {ref} enregistrée : FranceRoueLibre la relit et la dépose dans le formulaire de '
                           f'l’organisme, puis la publie sur la page des demandes avec sa réponse.'}
    if S.MAIL_AUTO_SEND and _sent_today() < S.MAIL_DAILY:
        return send(ref)
    notify(f'Demande {ref} à valider', f'{d["to"]["nom"]} <{d["to"]["email"]}>\n\n{d["subject"]}\n\n{d["body"]}\n\n'
                                      f'Question du lecteur : {d.get("question")}\n\n'
                                      f'Valider : assistant_api.py --demandes valider {ref}')
    return {'ok': True, 'ref': ref, 'status': 'a_valider',
            'message': f'Demande {ref} enregistrée : FranceRoueLibre la relit et l’envoie, puis la publie sur la page '
                       f'des demandes avec la réponse de l’organisme.'}


def _smtp() -> smtplib.SMTP:
    ctx = ssl.create_default_context()
    if S.MAIL_SMTP_PORT == 465:
        server = smtplib.SMTP_SSL(S.MAIL_SMTP_HOST, 465, context=ctx, timeout=30)
    else:
        server = smtplib.SMTP(S.MAIL_SMTP_HOST, S.MAIL_SMTP_PORT, timeout=30)
        server.starttls(context=ctx)
    server.login(S.MAIL_USER, S.MAIL_PASSWORD)
    return server


# ------------------------------------------------------------------------------------------------------- signature
LOGO = Path(__file__).with_name('signature-logo.png')   # the site's logo, 104 px (shown at 52 px)
INK, TEAL, GREY = '#0d1b2a', '#0e7490', '#6b7c8d'


def strip_signature(body: str) -> str:
    """The letter without a signature typed at its end (older drafts ended with the site's name and address)."""
    lines = body.rstrip().split('\n')
    while lines and lines[-1].strip() in ('', S.MAIL_FROM_NAME, S.MAIL_FROM, S.SITE_URL, '--'):
        lines.pop()
    return '\n'.join(lines).rstrip()


def signature_text() -> str:
    return '\n'.join(['-- ', S.MAIL_FROM_NAME, S.MAIL_SIG_TAGLINE, S.MAIL_FROM, S.SITE_URL])


def signature_html(logo_src: Optional[str]) -> str:
    e = html.escape
    name = (f'<a href="{e(S.SITE_URL)}" style="text-decoration:none;font-weight:bold;font-size:11pt">'
            f'<span style="color:{INK}">France</span><span style="color:{TEAL}">RoueLibre</span></a>')
    rows = [name, f'<span style="color:{GREY}">{e(S.MAIL_SIG_TAGLINE)}</span>',
            f'<a href="mailto:{e(S.MAIL_FROM)}" style="color:{INK};text-decoration:none">{e(S.MAIL_FROM)}</a>',
            f'<a href="{e(S.SITE_URL)}" style="color:{TEAL};text-decoration:none">{e(S.SITE_URL.replace("https://", ""))}</a>']
    logo = (f'<td style="vertical-align:middle;padding:0 14px 0 0"><a href="{e(S.SITE_URL)}"><img src="{e(logo_src)}" '
            f'width="52" height="52" alt="FranceRoueLibre" style="display:block;border:0;width:52px;height:52px"></a></td>'
            if logo_src else '')
    return (f'<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:20px;'
            f'border-collapse:collapse;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:10pt;line-height:1.5;'
            f'color:{INK}"><tr>{logo}<td style="vertical-align:middle;padding:0 0 0 14px;border-left:2px solid {TEAL}">'
            f'{"<br>".join(rows)}</td></tr></table>')


def letter_html(body: str, logo_src: Optional[str]) -> str:
    paras = [p for p in re.split(r'\n\s*\n', body.strip()) if p.strip()]
    text = ''.join('<p style="margin:0 0 14px 0">' + '<br>'.join(html.escape(l) for l in p.split('\n')) + '</p>'
                   for p in paras)
    return ('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0">'
            '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1f2328;'
            f'max-width:680px">{text}{signature_html(logo_src)}</div></body></html>')


def _message(to: str, subject: str, body: str, ref: str = '', signed: bool = False) -> EmailMessage:
    """signed: plain text + HTML with the site's signature, the logo inline (CID) so that no image is fetched."""
    m = EmailMessage()
    m['From'] = email.utils.formataddr((S.MAIL_FROM_NAME, S.MAIL_FROM))
    m['To'] = to
    m['Subject'] = subject
    m['Date'] = email.utils.formatdate(localtime=True)
    m['Message-ID'] = email.utils.make_msgid(idstring=ref or None, domain=S.MAIL_FROM.split('@')[-1])
    if not signed:
        m.set_content(body)
        return m
    body = strip_signature(body)
    m.set_content(body + '\n\n' + signature_text() + '\n')
    logo = LOGO.read_bytes() if LOGO.is_file() else None
    cid = email.utils.make_msgid(domain=S.MAIL_FROM.split('@')[-1])
    m.add_alternative(letter_html(body, f'cid:{cid[1:-1]}' if logo else None), subtype='html')
    if logo:
        m.get_payload()[1].add_related(logo, 'image', 'png', cid=cid, filename='francerouelibre.png', disposition='inline')
    return m


def notify(subject: str, body: str) -> None:
    """A message to the site's own mailbox (validation needed, reply received). Never raises."""
    if not S.MAIL_CONFIGURED:
        return
    try:
        with _smtp() as server:
            server.send_message(_message(S.MAIL_NOTIFY, f'[Loupe] {subject}', body))
    except (OSError, smtplib.SMTPException):
        pass


def send(ref: str) -> dict:
    """Sends a validated request (status a_valider) from MAIL_FROM, with a copy to the site's mailbox."""
    with _lock:
        d = load(ref)
        if not d or d['status'] != 'a_valider':
            return {'error': 'demande inconnue ou pas à valider'}
        if d.get('mode') == 'formulaire':
            return {'error': f'pas d’adresse : coller la lettre dans {d["to"]["formulaire"]}, puis --demandes deposee {ref}'}
        if _sent_today() >= S.MAIL_DAILY:
            return {'error': f'{S.MAIL_DAILY} envois par jour au plus : réessayer demain'}
        m = _message(d['to']['email'], d['subject'], d['body'], ref, signed=True)
        m['Bcc'] = S.MAIL_NOTIFY
        try:
            with _smtp() as server:
                server.send_message(m)
        except (OSError, smtplib.SMTPException) as exc:
            return {'error': f'envoi impossible : {type(exc).__name__}'}
        d.update(status='envoyee', sent=dt.datetime.now().isoformat(timespec='seconds'), message_id=m['Message-ID'])
        save(d)
    return {'ok': True, 'ref': ref, 'status': 'envoyee',
            'message': f'Demande {ref} envoyée à {d["to"]["nom"]}. Elle est suivie sur la page des demandes.'}


# ------------------------------------------------------------------------------------------------------- replies
def _text_of(msg) -> tuple:
    """(plain text without the quoted letter, attachment names)."""
    text, files = '', []
    for part in msg.walk():
        if part.get_content_disposition() == 'attachment':
            files.append(part.get_filename() or 'pièce jointe')
        elif part.get_content_type() == 'text/plain' and not text:
            text = part.get_content()
        elif part.get_content_type() == 'text/html' and not text:
            text = re.sub(r'<[^>]+>', ' ', part.get_content())
    cut = re.split(r'\n(?:>|Le .{5,80} a écrit|-----\s*Original|De\s*:|From\s*:)', text, maxsplit=1)[0]
    return re.sub(r'\n{3,}', '\n\n', cut).strip()[:8000], files


def poll_replies() -> int:
    """Reads the unseen messages whose subject holds a request reference; stores them for validation."""
    if not (S.MAIL_CONFIGURED and S.MAIL_IMAP_HOST):
        return 0
    found = 0
    box = imaplib.IMAP4_SSL(S.MAIL_IMAP_HOST, S.MAIL_IMAP_PORT, ssl_context=ssl.create_default_context(), timeout=30)
    try:
        box.login(S.MAIL_USER, S.MAIL_PASSWORD)
        box.select('INBOX')
        _, data = box.search(None, '(UNSEEN SUBJECT "FRL-")')
        for num in (data[0] or b'').split():
            _, parts = box.fetch(num, '(RFC822)')
            msg = email.message_from_bytes(parts[0][1], policy=email.policy.default)
            m = re.search(r'FRL-\d{4}-\d{4}', str(msg.get('Subject', '')))
            d = load(m.group(0)) if m else None
            if not d or d['status'] not in ('envoyee', 'repondue'):
                continue
            text, files = _text_of(msg)
            sender = email.utils.parseaddr(str(msg.get('From', '')))[1]
            d.setdefault('replies', []).append({'date': dt.datetime.now().isoformat(timespec='seconds'),
                                                'from_domain': sender.split('@')[-1], 'text': text, 'files': files,
                                                'public_text': None})
            d['status'] = 'repondue'
            save(d)
            box.store(num, '+FLAGS', '\\Seen')
            found += 1
            notify(f'Réponse à {d["ref"]}', f'{d["to"]["nom"]} a répondu :\n\n{text}\n\nPièces : {", ".join(files) or "aucune"}'
                                            f'\n\nPublier : assistant_api.py --demandes publier {d["ref"]}')
    finally:
        try:
            box.logout()
        except (OSError, imaplib.IMAP4.error):
            pass
    return found


def poller(stop: threading.Event, every: int = 900) -> None:
    while not stop.wait(every):
        try:
            poll_replies()
        except (OSError, imaplib.IMAP4.error, ValueError):
            pass


# ------------------------------------------------------------------------------------------------------- moderation
def anonymize(text: str) -> str:
    """What is published of a reply: no e-mail address, phone number or signature block."""
    s = re.sub(r'[\w.+-]+@[\w-]+\.[\w.]+', '[adresse]', text)
    s = re.sub(r'(\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}', '[téléphone]', s)
    s = re.split(r'\n(?:--\s*\n|Cordialement|Bien cordialement|Salutations|Respectueusement)', s, maxsplit=1)[0]
    return s.strip()


def mail_test() -> dict:
    """Logs in to SMTP and IMAP without sending anything."""
    if not S.MAIL_CONFIGURED:
        return {'error': 'pas de mot de passe : lancer mail_credentials.bat'}
    out = {'utilisateur': S.MAIL_USER}
    try:
        with _smtp():
            out['smtp'] = f'{S.MAIL_SMTP_HOST}:{S.MAIL_SMTP_PORT} OK'
    except (OSError, smtplib.SMTPException) as exc:
        out['smtp'] = f'échec : {type(exc).__name__}'
    try:
        box = imaplib.IMAP4_SSL(S.MAIL_IMAP_HOST, S.MAIL_IMAP_PORT, ssl_context=ssl.create_default_context(), timeout=30)
        box.login(S.MAIL_USER, S.MAIL_PASSWORD)
        box.logout()
        out['imap'] = f'{S.MAIL_IMAP_HOST}:{S.MAIL_IMAP_PORT} OK'
    except (OSError, imaplib.IMAP4.error) as exc:
        out['imap'] = f'échec : {type(exc).__name__}'
    return out


def admin(action: str, ref: str = '', text: str = '') -> dict:
    """liste | tout | voir | valider | deposee (a letter pasted in the body's contact form) | refuser | modifier (JSON subject and body in text) | destinataire (name or INSEE code in text) | publier (the last reply, anonymized or the given text) | cloturer | test."""
    if action == 'test':
        return mail_test()
    if action == 'tout':  # every request in full, for the review panel (frl_panel.bat), with its deadline
        rows = []
        for d in all_requests():
            if d['status'] == 'brouillon':
                continue
            view = {k: v for k, v in d.items() if k != 'reader'}
            if d['status'] == 'a_valider':  # the signature is added when sending: not shown in the editable text
                view['body'] = strip_signature(d['body'])
            rows.append({**view, 'echeance': public_view(d)['echeance'],
                         'meme_organisme_30j': sum(1 for x in all_requests() if x is not d and x['to'].get('email')
                                                   and x['to'].get('email') == d['to'].get('email')
                                                   and x['status'] not in ('brouillon', 'refusee')),
                         'reponse_anonymisee': anonymize(d['replies'][-1]['text']) if d.get('replies') else None})
        return {'demandes': rows, 'signature': {'texte': signature_text(), 'html': signature_html(f'{S.SITE_URL}/logo-512.png')},
                'delai_jours': DELAY_DAYS, 'envoi_auto': bool(S.MAIL_AUTO_SEND),
                'envois_par_jour': S.MAIL_DAILY, 'envoyes_aujourdhui': _sent_today()}
    if action == 'liste':
        return {'demandes': [{'ref': d['ref'], 'status': d['status'], 'organisme': d['to']['nom'],
                              'objet': d['fields']['objet'], 'reponses': len(d.get('replies', []))}
                             for d in all_requests()]}
    d = load(ref)
    if not d:
        return {'error': 'demande inconnue'}
    if action == 'voir':
        return d
    if action == 'valider':
        return send(ref)
    if action == 'modifier':  # the site's own edit of the letter before it is sent: text = {"subject", "body"} (JSON)
        if d['status'] != 'a_valider':
            return {'error': f'lettre modifiable seulement avant l’envoi (demande {d["status"]})'}
        try:
            new = json.loads(text)
        except ValueError:
            return {'error': 'texte illisible'}
        subject = re.sub(r'\s+', ' ', str(new.get('subject') or '')).strip()[:250]
        body = str(new.get('body') or '').replace('\r\n', '\n').strip()[:8000]
        if not subject or len(body) < 40:
            return {'error': 'objet ou texte vide'}
        if ref not in subject:  # the reference in the subject is how the reply is found in the mailbox
            subject = f'{subject} [{ref}]'
        with _lock:
            if (subject, body) != (d['subject'], d['body']):
                d.setdefault('historique', []).append({'date': dt.datetime.now().isoformat(timespec='seconds'),
                                                       'objet_precedent': d['subject'], 'texte_precedent': d['body']})
                d['subject'], d['body'] = subject, body
                d['modifiee'] = True
                save(d)
        return {'ok': True, 'ref': ref, 'status': d['status'], 'subject': subject}
    if action == 'destinataire':  # another official recipient for a request not sent yet: its name (or INSEE code)
        if d['status'] != 'a_valider':  # is looked up in the directory, never typed as an address
            return {'error': f'destinataire modifiable seulement avant l’envoi (demande {d["status"]})'}
        q = text.strip()
        try:
            found = annuaire(code_insee=q) if re.fullmatch(r'\d[\dAB]\d{3}', q) else annuaire(nom=q)
        except NetworkError as exc:
            return {'error': f'annuaire indisponible ({exc})'}
        exact = [c for c in found if norm(c['nom']) == norm(q) and c['email']]
        to = (exact or [c for c in found if c['email']] or [None])[0]
        if not to:
            return {'error': f'aucun organisme avec une adresse électronique pour « {q} »', 'trouves': [c['nom'] for c in found]}
        with _lock:
            old = d['to']
            d['to'] = to
            d['subject'], d['body'] = letter(to['nom'], d['fields'], d['ref'], by_site=True)
            d.setdefault('historique', []).append({'date': dt.datetime.now().isoformat(timespec='seconds'),
                                                   'destinataire_precedent': old})
            save(d)
        return {'ok': True, 'ref': ref, 'status': d['status'], 'destinataire': to,
                'autres': [c['nom'] for c in found if c is not to][:6]}
    with _lock:
        if action == 'refuser' and d['status'] == 'a_valider':
            d['status'] = 'refusee'
        elif action == 'deposee' and d['status'] == 'a_valider' and d.get('mode') == 'formulaire':
            d.update(status='envoyee', sent=dt.datetime.now().isoformat(timespec='seconds'))
        elif action == 'publier' and d.get('replies'):
            d['replies'][-1]['public_text'] = text.strip() or anonymize(d['replies'][-1]['text'])
        elif action == 'cloturer':
            d['status'] = 'close'
        else:
            return {'error': f'action « {action} » impossible pour une demande {d["status"]}'}
        save(d)
    return {'ok': True, 'ref': ref, 'status': d['status']}
