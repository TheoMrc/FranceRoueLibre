"""JSON over HTTPS with the standard library (no requests needed). Honours HTTPS_PROXY like urllib does."""
from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request


class NetworkError(RuntimeError):
    pass


def _send(req: urllib.request.Request, timeout: float):
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            status, headers = r.status, {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        raw, status, headers = e.read(), e.code, {k.lower(): v for k, v in (e.headers or {}).items()}
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as e:
        raise NetworkError(type(e).__name__) from e
    try:
        payload = json.loads(raw or b'{}')
    except ValueError:
        payload = {'_text': raw[:300].decode('utf-8', 'replace')}
    return status, payload, headers


def post_json(url: str, body: dict, headers: dict, timeout: float = 120):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST', headers={**headers, 'Content-Type': 'application/json'})
    return _send(req, timeout)


def get_json(url: str, headers: dict | None = None, timeout: float = 30):
    return _send(urllib.request.Request(url, headers=headers or {}), timeout)


def error_message(payload: dict) -> str:
    err = payload.get('error')
    if isinstance(err, dict):
        return str(err.get('message') or '')[:300]
    return str(payload.get('_text') or err or '')[:300]
