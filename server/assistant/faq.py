"""Saved answers (faq.json, built by scripts/loupe-faq.py): a question that many readers ask is answered from this file,
at once and without calling a model, so it spends no credits. Only the first question of a conversation is matched (a
follow-up needs the context, so it goes to the model): an entry matches when, for one of its sets of word groups
(match_any), a word of every group appears in the question."""
import json
import re
import unicodedata
from pathlib import Path

FILE = Path(__file__).with_name('faq.json')
_entries = None


def norm(text: str) -> str:
    s = unicodedata.normalize('NFD', str(text or '')).encode('ascii', 'ignore').decode().lower()
    return ' ' + re.sub(r"[^a-z0-9]+", ' ', s).strip() + ' '


def entries() -> list:
    global _entries
    if _entries is None:
        try:
            _entries = json.loads(FILE.read_text(encoding='utf-8')).get('entries', [])
        except (OSError, ValueError):
            _entries = []
    return _entries


def find(messages: list) -> dict | None:
    """The saved answer for this conversation, or None."""
    if len([m for m in messages if m.get('role') == 'user']) != 1:
        return None
    q = norm(messages[-1].get('text'))
    for e in entries():
        for groups in e.get('match_any') or [e.get('match', [])]:
            if groups and all(any(norm(w).strip() in q for w in group) for group in groups):
                return e
    return None


def result(entry: dict) -> dict:
    """Same shape as an answer of agent.answer(), marked as saved."""
    return {'reply': entry['reply'], 'sources': entry.get('sources', []), 'searches': [], 'provider': 'faq',
            'label': 'Réponse sourcée automatique', 'saved': entry['id']}
