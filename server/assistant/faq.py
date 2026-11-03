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
    s = unicodedata.normalize('NFD', re.sub(r"[’'`]", ' ', str(text or ''))).encode('ascii', 'ignore').decode().lower()
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
            if groups and all(any(norm(w).strip() in q for w in group) for group in groups) \
                    and not _narrower(q, e, groups, messages[-1].get('text')):
                return e
    return None


# Words that change nothing to what is asked
COMMON = set('''quel quelle quels quelles combien comment pourquoi quand dans pour avec sans sont etre etait cela cette
ces ceux celle leur leurs nous vous elle elles plus moins tres tout tous toute toutes depuis entre chaque annee annees
france francais francaise publique publiques public montant total exactement environ vraiment donc alors aussi
recu recus recues donne donnes donner ete fait faire peut peux veux savoir dire bercy etat gouvernement'''.split())


def _narrower(q: str, entry: dict, groups: list, raw: str = '') -> bool:
    """True when the question asks about something more precise than the saved answer (« associations financées par
    l'Éducation nationale » is not « les associations les plus subventionnées ») : more than one significant word of
    the question is neither in the saved question nor in the matched word groups, or the question quotes a name."""
    if re.search(r'["«»“”]', str(raw or '')):
        return True
    known = set(norm(entry.get('question', '')).split()) | COMMON
    stems = [norm(w).strip() for group in groups for w in group]
    extra = [w for w in q.split() if len(w) >= 4 and not w.isdigit() and w not in known
             and not any(w.startswith(s) or s.startswith(w[:5]) for s in stems if s)
             and not any(k.startswith(w[:5]) for k in known if len(k) >= 5)]
    names = [norm(w).strip() for w in re.findall(r"[^\W\d_][\w-]*", str(raw or ''))[1:] if w[:1].isupper()]
    if any(n and n in extra for n in names):   # a proper name the saved answer does not cover (« Article 1 »)
        return True
    return len(extra) > 1


def result(entry: dict) -> dict:
    """Same shape as an answer of agent.answer(), marked as saved."""
    return {'reply': entry['reply'], 'sources': entry.get('sources', []), 'searches': [], 'provider': 'faq',
            'label': 'Réponse sourcée automatique', 'saved': entry['id']}
