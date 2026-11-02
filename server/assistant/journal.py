"""Journal of the Loupe's answers, to find the questions asked most often (future saved answers), check the quality of
the answers and the tools behind them, and follow the cost. Data kept to the minimum:

* one JSON line per question in STATE_DIR/journal/YYYY-MM-DD.jsonl (gzipped once the day is over): date, question,
  number of earlier messages, tool calls (name, label, success, short summary, seconds), answer, model, cost, seconds,
  and the readers' 👍 / 👎 votes, written as separate lines that point to the question;
* no IP address: only a keyed hash of it with a key drawn at random each day and never written to disk, enough to count
  distinct readers within a day, not to recognize anyone, nor the same reader from one day to the next;
* files older than RETENTION_DAYS are deleted.
Described to the readers in mentions.html#assistant. Read with scripts/loupe-review.py."""
from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import hmac
import json
import secrets
import shutil
import threading
from pathlib import Path

RETENTION_DAYS = 90
MAX_TEXT = 4000          # characters kept of a question or an answer
_lock = threading.Lock()
_key = {'day': None, 'key': b''}
_last_sweep = {'day': None}


def _today() -> str:
    return dt.date.today().isoformat()


def reader(ip: str) -> str:
    """Hash of the IP with a key of the day (kept in memory only): the same reader gets the same value during one day."""
    day = _today()
    if _key['day'] != day:
        _key.update(day=day, key=secrets.token_bytes(32))
    return hmac.new(_key['key'], ip.encode(), hashlib.sha256).hexdigest()[:12]


def _dir(base: Path) -> Path:
    d = base / 'journal'
    d.mkdir(parents=True, exist_ok=True)
    return d


def sweep(base: Path, today: dt.date | None = None) -> None:
    """Gzip the finished days, delete the files older than RETENTION_DAYS. Once a day is enough."""
    today = today or dt.date.today()
    d = _dir(base)
    for path in d.iterdir():
        try:
            day = dt.date.fromisoformat(path.name[:10])
        except ValueError:
            continue
        if (today - day).days > RETENTION_DAYS:
            path.unlink(missing_ok=True)
        elif path.suffix == '.jsonl' and day < today:
            with open(path, 'rb') as src, gzip.open(path.with_suffix('.jsonl.gz'), 'ab') as dst:
                shutil.copyfileobj(src, dst)
            path.unlink(missing_ok=True)


def write(base: Path, entry: dict) -> None:
    """Append one line to today's file; never raises (the journal must not break an answer)."""
    try:
        with _lock:
            day = _today()
            if _last_sweep['day'] != day:
                sweep(base)
                _last_sweep['day'] = day
            with open(_dir(base) / f'{day}.jsonl', 'a', encoding='utf-8') as h:
                h.write(json.dumps(entry, ensure_ascii=False, separators=(',', ':')) + '\n')
    except OSError:
        pass


def answer_entry(jid: str, who: str, messages: list, events: list, result: dict, seconds: float) -> dict:
    """The line written for one finished question."""
    question = str((messages[-1] if messages else {}).get('text') or '')[:MAX_TEXT]
    tools, running = [], {}
    for ev in events:
        if ev.get('type') == 'tool_start':
            running[ev.get('name')] = ev.get('label')
        elif ev.get('type') == 'tool_done':
            tools.append({'name': ev.get('name'), 'label': str(ev.get('label') or '')[:200], 'ok': bool(ev.get('ok')),
                          'summary': str(ev.get('summary') or '')[:160], 's': ev.get('s')})
    switches = [{'from': e.get('from'), 'to': e.get('to')} for e in events if e.get('type') == 'switch']
    result = result or {}
    return {'type': 'answer', 'id': jid[:12], 't': dt.datetime.now().isoformat(timespec='seconds'), 'reader': who,
            'question': question, 'earlier': max(0, len(messages) - 1), 'tools': tools, 'switches': switches,
            'reply': str(result.get('reply') or '')[:MAX_TEXT], 'error': result.get('error'),
            'provider': result.get('provider'), 'model': result.get('model'), 'saved': result.get('saved'),
            'cost_eur': result.get('cost_eur', 0), 'calls': result.get('calls'), 's': round(seconds, 1),
            'sources': [s.get('url') for s in result.get('sources') or []][:10]}


def vote_entry(jid: str, who: str, vote: int, note: str = '') -> dict:
    return {'type': 'vote', 'id': jid[:12], 't': dt.datetime.now().isoformat(timespec='seconds'), 'reader': who,
            'vote': 1 if vote > 0 else -1, 'note': str(note or '')[:500]}
