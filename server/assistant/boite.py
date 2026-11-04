"""The site's mailbox (stonks@francerouelibre.fr) for the site's own team: read the messages received and answer them.

Run through the service that holds the mail password (systemd credential), like the requests to public bodies:

    frl-mail liste [N]            the last N messages of the inbox (20 by default), read or not
    frl-mail lire UID             one message in full (it is NOT marked as read)
    frl-mail apercu UID < texte   the reply as it would leave, nothing is sent
    frl-mail repondre UID < texte sends the reply to the sender of UID, copy in « Envoyés », UID marked answered

Safety: a reply only ever goes to the sender (Reply-To or From) of a message actually in the inbox, never to a typed
address; a message already answered is refused (repondre UID --force to answer again); at most MAIL_REPLY_DAILY replies
per day; every reply is logged in STATE_DIR/boite/envoyes.jsonl. Listing and reading never change the mailbox.
"""
from __future__ import annotations

import datetime as dt
import email
import email.policy
import email.utils
import imaplib
import json
import re
import smtplib
import ssl
from pathlib import Path

from . import settings as S
from .demandes import _message, _smtp, _text_of

REPLY_DAILY = 20
SKIP_SUBJECT = re.compile(r'^\[Loupe\]')   # the service's own notifications to this mailbox


def _box() -> imaplib.IMAP4_SSL:
    box = imaplib.IMAP4_SSL(S.MAIL_IMAP_HOST, S.MAIL_IMAP_PORT, ssl_context=ssl.create_default_context(), timeout=30)
    box.login(S.MAIL_USER, S.MAIL_PASSWORD)
    return box


def _close(box) -> None:
    try:
        box.logout()
    except (OSError, imaplib.IMAP4.error):
        pass


def _log() -> Path:
    d = S.STATE_DIR / 'boite'
    d.mkdir(parents=True, exist_ok=True)
    return d / 'envoyes.jsonl'


def _sent_today() -> int:
    today = dt.date.today().isoformat()
    try:
        return sum(1 for line in _log().read_text(encoding='utf-8').splitlines() if line[10:20] == today)
    except OSError:
        return 0


def _fetch(box, uid: str):
    """(message, flags) of one message of the inbox, read with BODY.PEEK so that it stays unread."""
    _, data = box.uid('FETCH', uid, '(FLAGS BODY.PEEK[])')
    raw = next((p for p in data or [] if isinstance(p, tuple)), None)
    if not raw:
        return None, ''
    flags = ' '.join(f.decode() for f in imaplib.ParseFlags(raw[0]))
    return email.message_from_bytes(raw[1], policy=email.policy.default), flags


def _who(msg) -> str:
    name, addr = email.utils.parseaddr(str(msg.get('From', '')))
    return f'{name} <{addr}>' if name else addr


def liste(n: int = 20) -> dict:
    box = _box()
    try:
        box.select('INBOX', readonly=True)
        _, data = box.uid('SEARCH', None, 'ALL')
        uids = (data[0] or b'').split()[-max(1, min(n, 100)):]
        rows = []
        for uid in reversed(uids):
            _, parts = box.uid('FETCH', uid, '(FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])')
            raw = next((p for p in parts or [] if isinstance(p, tuple)), None)
            if not raw:
                continue
            h = email.message_from_bytes(raw[1], policy=email.policy.default)
            flags = [f.decode() for f in imaplib.ParseFlags(raw[0])]
            subject = str(h.get('Subject', ''))
            rows.append({'uid': uid.decode(), 'date': str(h.get('Date', '')), 'de': _who(h), 'objet': subject,
                         'lu': '\\Seen' in flags, 'repondu': '\\Answered' in flags,
                         'notification_site': bool(SKIP_SUBJECT.match(subject)),
                         'demande': (re.search(r'FRL-\d{4}-\d{4}', subject) or [None])[0]})
        return {'boite': S.MAIL_USER, 'messages': rows}
    finally:
        _close(box)


def lire(uid: str) -> dict:
    box = _box()
    try:
        box.select('INBOX', readonly=True)
        msg, flags = _fetch(box, uid)
        if msg is None:
            return {'error': f'message {uid} introuvable'}
        text, files = _text_of(msg)
        return {'uid': uid, 'date': str(msg.get('Date', '')), 'de': _who(msg), 'repondre_a': _reply_to(msg),
                'objet': str(msg.get('Subject', '')), 'texte': text, 'pieces_jointes': files,
                'repondu': '\\Answered' in flags}
    finally:
        _close(box)


def _reply_to(msg) -> str:
    return email.utils.parseaddr(str(msg.get('Reply-To') or msg.get('From') or ''))[1]


def _sent_folder(box) -> str:
    _, rows = box.list()
    for row in rows or []:
        line = row.decode(errors='replace')
        if '\\Sent' in line:
            return line.rsplit(' ', 1)[-1].strip('"')
    return 'Sent'


def _compose(msg, body: str):
    to = _reply_to(msg)
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', to or ''):
        raise ValueError('adresse de l’expéditeur illisible')
    subject = str(msg.get('Subject', '')).strip()
    if not re.match(r'(?i)re\s*:', subject):
        subject = f'Re: {subject}'
    m = _message(to, subject, body, signed=True)
    parent = str(msg.get('Message-ID', '')).strip()
    if parent:
        m['In-Reply-To'] = parent
        m['References'] = (str(msg.get('References', '')).strip() + ' ' + parent).strip()
    return m


def repondre(uid: str, body: str, send: bool, force: bool = False) -> dict:
    body = body.replace('\r\n', '\n').strip()
    if len(body) < 20:
        return {'error': 'texte de réponse vide ou trop court'}
    box = _box()
    try:
        box.select('INBOX')
        msg, flags = _fetch(box, uid)
        if msg is None:
            return {'error': f'message {uid} introuvable'}
        try:
            m = _compose(msg, body)
        except ValueError as exc:
            return {'error': str(exc)}
        view = {'uid': uid, 'a': m['To'], 'objet': m['Subject'], 'texte': m.get_body(('plain',)).get_content()}
        if not send:
            return {'apercu': True, **view, 'deja_repondu': '\\Answered' in flags}
        if '\\Answered' in flags and not force:
            return {'error': f'message {uid} déjà répondu (ajouter --force pour répondre encore)'}
        if _sent_today() >= REPLY_DAILY:
            return {'error': f'{REPLY_DAILY} réponses par jour au plus'}
        try:
            with _smtp() as server:
                server.send_message(m)
        except (OSError, smtplib.SMTPException) as exc:
            return {'error': f'envoi impossible : {type(exc).__name__}'}
        copy = 'ok'
        try:
            box.append(_sent_folder(box), '(\\Seen)', imaplib.Time2Internaldate(dt.datetime.now().astimezone()),
                       m.as_bytes())
        except (OSError, imaplib.IMAP4.error) as exc:
            copy = f'copie dans Envoyés impossible : {type(exc).__name__}'
        box.uid('STORE', uid, '+FLAGS', '(\\Answered \\Seen)')
        with _log().open('a', encoding='utf-8') as f:
            f.write(dt.datetime.now().isoformat(timespec='seconds') + ' ' +
                    json.dumps({'uid': uid, 'a': m['To'], 'objet': m['Subject'], 'message_id': m['Message-ID']},
                               ensure_ascii=False) + '\n')
        return {'ok': True, 'envoye': True, **view, 'copie_envoyes': copy}
    finally:
        _close(box)


def admin(action: str, arg: str = '', text: str = '') -> dict:
    """mail_liste [N] | mail_lire UID | mail_apercu UID (text) | mail_repondre UID[:force] (text)"""
    if not (S.MAIL_CONFIGURED and S.MAIL_IMAP_HOST):
        return {'error': 'boîte non configurée : lancer mail_credentials.bat'}
    uid, _, opt = arg.partition(':')
    try:
        if action == 'mail_liste':
            return liste(int(arg) if arg.isdigit() else 20)
        if not uid.isdigit():
            return {'error': 'UID de message attendu (voir frl-mail liste)'}
        if action == 'mail_lire':
            return lire(uid)
        if action in ('mail_apercu', 'mail_repondre'):
            return repondre(uid, text, send=action == 'mail_repondre', force=opt == 'force')
    except (OSError, imaplib.IMAP4.error) as exc:
        return {'error': f'boîte injoignable : {type(exc).__name__}'}
    return {'error': f'action « {action} » inconnue'}
