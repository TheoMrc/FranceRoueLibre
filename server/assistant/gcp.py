"""Google Cloud side of Gemini (same approach as RevoFlow and TravelerStories).

* Access token: Application Default Credentials. On the PC, those of ``gcloud auth application-default login``
  (through the google-auth library if installed, else the gcloud command). On the VPS, a service account key passed
  by systemd (``GOOGLE_APPLICATION_CREDENTIALS``, read with google-auth). No key in the .env.
* Billing lock: before any paid call (then every 10 minutes) the project's billing account is read through the Cloud
  Billing API (free) and must be ``GEMINI_BILLING_ACCOUNT``, the free-trial account that cannot charge a card unless it
  is upgraded by hand. Anything else, or an unreadable status, refuses the call.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional

from . import settings as S
from .net import get_json

SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
_lock = threading.Lock()
_token = {'value': None, 'until': 0.0}
_billing = {'ok_until': 0.0}


class CloudError(RuntimeError):
    pass


def _gcloud() -> Optional[str]:
    local = Path(os.environ.get('LOCALAPPDATA', '')) / 'Google' / 'Cloud SDK' / 'google-cloud-sdk' / 'bin' / 'gcloud.cmd'
    for c in (str(local), shutil.which('gcloud.cmd') or '', shutil.which('gcloud') or ''):
        if c and Path(c).is_file():
            return c
    return None


def _from_library():
    try:
        import google.auth
        from google.auth.transport.requests import Request
    except ImportError:
        return None
    creds, _ = google.auth.default(scopes=[SCOPE])
    creds.refresh(Request())
    expiry = creds.expiry.timestamp() if getattr(creds, 'expiry', None) else time.time() + 1800
    return creds.token, expiry


def _from_cli():
    exe = _gcloud()
    if exe is None:
        return None
    proc = subprocess.run([exe, 'auth', 'application-default', 'print-access-token'], capture_output=True, text=True,
                          timeout=60, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    tok = proc.stdout.strip().splitlines()[-1] if proc.returncode == 0 and proc.stdout.strip() else ''
    return (tok, time.time() + 30 * 60) if tok else None


def access_token() -> str:
    with _lock:
        if _token['value'] and time.time() < _token['until'] - 120:
            return _token['value']
        try:
            got = _from_library() or _from_cli()
        except Exception as exc:  # noqa: BLE001 - reported below without details that could hold a secret
            raise CloudError(f'Aucun jeton Google Cloud ({type(exc).__name__}) : « gcloud auth application-default login » '
                             'sur le PC, ou GOOGLE_APPLICATION_CREDENTIALS sur le serveur.') from exc
        if not got:
            raise CloudError('Aucun jeton Google Cloud : installe gcloud puis « gcloud auth application-default login ».')
        _token['value'], _token['until'] = got
        return _token['value']


def assert_allowed_billing() -> None:
    project, account = S.GOOGLE_CLOUD_PROJECT, S.GEMINI_BILLING_ACCOUNT
    if not project:
        raise CloudError('GOOGLE_CLOUD_PROJECT manque (Vertex AI).')
    if not account:
        raise CloudError('Verrou de facturation : GEMINI_BILLING_ACCOUNT manque.')
    if time.time() < _billing['ok_until']:
        return
    status, info, _ = get_json(f'https://cloudbilling.googleapis.com/v1/projects/{project}/billingInfo',
                               {'Authorization': f'Bearer {access_token()}', 'x-goog-user-project': project}, timeout=20)
    if status != 200:
        raise CloudError(f'Verrou de facturation : facturation du projet illisible ({status}), appel refusé par prudence.')
    if info.get('billingAccountName') != f'billingAccounts/{account}':
        raise CloudError('Verrou de facturation : le projet n’est pas rattaché au compte de facturation prévu, appel refusé.')
    if not info.get('billingEnabled', False):
        raise CloudError('Verrou de facturation : facturation du projet désactivée.')
    _billing['ok_until'] = time.time() + 600
