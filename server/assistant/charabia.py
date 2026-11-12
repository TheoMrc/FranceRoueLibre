"""Messages without one understandable word (« fgbdgyaeuhijfbehzui », « 4fez4f4efez44f5ez45fze ») get a fixed answer at
once: no model call, no credit spent. A message goes to the model as soon as ONE of its words is understandable:

* a word of the site's vocabulary: the lexicon of the search index (dist/data/search/lexicon, every word of the published
  spending lines: French words, names of bodies, companies, communes, acronyms), plus a short list of everyday words;
* a word one typing error away from a frequent word of that vocabulary (« bordaux », « combein », « subvension ») ;
* a word that is written like a word (a name the data does not have: « Zemmour ») : every group of three letters in it
  is found in frequent words of the vocabulary. Random typing fails that test (« dbejou » : no word starts with « db »).

Place names, postal codes and SIREN are answered before this check (fiche.answer). Figures alone, words of four
letters or less (« LVMH », « bjr », « x ») and other alphabets are not judged: the model answers them.
Deliberately lenient: when in doubt the message goes through. Checked on the 5 301 distinct questions of the journal
(2026-11-12): none refused. Without the lexicon (static preview), or while it loads at start-up, nothing is refused.
"""
from __future__ import annotations

import json
import re
import threading
import unicodedata
from typing import Optional

from . import settings as S

EVERYDAY = set('''ok oui non si et ou le la les un une des de du au aux en a y il elle on je tu nous vous ils elles ce ca
cet cette ces mon ma mes ton ta tes son sa ses qui que quoi ou dont quel quelle est sont etait ete a ont avoir etre fait
faire dit dire va vont peut veux veut merci bonjour bonsoir salut hello coucou svp stp pourquoi comment combien quand
plus moins tres trop pas ne ni mais donc car par pour sur sous dans avec sans vers chez entre apres avant pendant
depuis alors aussi encore deja ici la bas haut tout tous toute toutes rien autre meme bien mal vrai faux bon cout prix
euro euros argent impot impots taxe taxes dette budget etat ville mairie maire region pays an ans annee mois jour
pib tva rsa smic csg crds ifsi caf cnrs sncf ratp edf ue onu otan ugap plf lfi ok d accord ah oh eh hein quoi test
why what how who where the is are and or of to in for money tax taxes cost'''.split())
ROWS = ('azertyuiop', 'qsdfghjklm', 'wxcvbn', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm')
FREQUENT = 20     # lines of spending: a word seen that often is a real word, good for the typo and the 3-letter tests
REPLY = ('Je n’ai reconnu aucun mot dans ce message. Posez votre question en quelques mots sur l’argent public : une '
         'commune, un impôt, une dépense, un organisme, une personnalité.\n\nPour aller plus loin :\n'
         '- À combien s’élève la dette publique par Français ?\n'
         '- Quand je paie 100 € d’impôts, comment sont-ils dépensés ?')
_lock = threading.Lock()
_voc: dict = {}


def _norm(text: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', str(text or '').lower()) if unicodedata.category(c) != 'Mn')


def warm() -> None:
    """Loads the vocabulary in the background (a few seconds, 675 small files): called once when the server starts."""
    threading.Thread(target=_load, daemon=True).start()


def _load() -> dict:
    """{'words': every word of the lexicon, 'frequent': the frequent ones by length, 'tri': their groups of 3 letters}."""
    with _lock:
        if _voc:
            return _voc
        words, frequent = set(), set()
        try:
            for path in (S.DATA_DIR / 'search' / 'lexicon').glob('*.json'):
                for row in json.loads(path.read_text(encoding='utf-8')):
                    w = row[0]
                    if w.isalpha():
                        words.add(w)
                        if row[1] >= FREQUENT and len(w) >= 4:
                            frequent.add(w)
        except (OSError, ValueError, IndexError, TypeError):
            words, frequent = set(), set()
        tri = set()
        for w in frequent | {w for w in EVERYDAY if len(w) >= 4}:
            p = f'^{w}$'
            tri.update(p[i:i + 3] for i in range(len(p) - 2))
        by_len: dict = {}
        for w in frequent:
            by_len.setdefault(len(w), set()).add(w)
        _voc.update(words=words, frequent=by_len, tri=tri, ready=bool(words))
        return _voc


def _near(w: str, voc: dict) -> bool:
    """One typing error away from a frequent word: a letter missing, added, changed, or two letters swapped."""
    if len(w) < 5:
        return False
    same, shorter, longer = voc['frequent'].get(len(w), ()), voc['frequent'].get(len(w) - 1, ()), voc['frequent'].get(len(w) + 1, ())
    letters = 'abcdefghijklmnopqrstuvwxyz'
    for i in range(len(w)):
        if w[:i] + w[i + 1:] in shorter:
            return True
        if i < len(w) - 1 and w[:i] + w[i + 1] + w[i] + w[i + 2:] in same:
            return True
        for c in letters:
            if w[:i] + c + w[i + 1:] in same or w[:i] + c + w[i:] in longer:
                return True
    return any(w + c in longer for c in letters)


def _wordlike(w: str, voc: dict) -> bool:
    if len(w) < 4 or len(w) > 24:
        return False
    p = f'^{w}$'
    return all(p[i:i + 3] in voc['tri'] for i in range(len(p) - 2))


def _mashed(w: str) -> bool:
    """A slide on the keyboard (« azerty », « qsdfgh ») or one key held (« aaaaa »)."""
    return len(w) >= 5 and (any(w in row or w[::-1] in row for row in ROWS) or len(set(w)) < 3)


def understood(word: str, voc: Optional[dict] = None) -> bool:
    voc = voc or _load()
    w = _norm(word)
    if not w.isalpha():   # letters and figures mixed: « a380 », « co2 », « plus1zest » yes, « 4fez4f4efez44f5 » no
        if len(re.findall(r'\d+', w)) > 2:
            return False
        return any(part in EVERYDAY or part in voc['words'] for part in re.findall(r'[a-z]{3,}', w))
    if _mashed(w):
        return False
    if w in EVERYDAY or w in voc['words']:
        return True
    return _near(w, voc) or _wordlike(w, voc)


def is_gibberish(text: str) -> bool:
    """True when the message has a word of five letters or more and not one understandable word."""
    if not _voc.get('ready'):   # still loading (warm), or no lexicon here: nothing is refused
        return False
    tokens = re.findall(r'[^\W_]+', _norm(text))
    lettered = [t for t in tokens if re.search(r'[a-z]', t)]
    if not any(len(re.sub(r'[^a-z]', '', t)) >= 5 for t in lettered):   # figures, short words, another alphabet: not judged
        return False
    return not any(understood(t, _voc) for t in lettered)


def answer(messages: list) -> Optional[dict]:
    """The fixed answer for a message without one understandable word, shaped like agent.answer(); else None."""
    text = str((messages[-1] if messages else {}).get('text') or '')
    if not is_gibberish(text):
        return None
    return {'reply': REPLY, 'sources': [], 'searches': [], 'provider': 'faq', 'label': 'Réponse automatique', 'saved': 'charabia'}
