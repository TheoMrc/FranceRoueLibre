"""Find a commune or a département from what a reader types: a name (with or without accents, hyphens, « St »),
a name with a typo, a postal code (33980), a département number (33, 2A, 974), or a mix (« 57700 Hayange »,
« laurens 34480 », « Lignerolles allier »). Used by the search API (GET /api/lieux, for the search boxes and the map)
and by the Loupe's tools. Data: dist/data/web/communes-lookup.json (scripts/communes-lookup.py).
"""
from __future__ import annotations

import json
import re
import threading
import unicodedata
import urllib.parse
from pathlib import Path
from typing import Dict, List, Optional

_lock = threading.Lock()
_data: Dict[str, object] = {}

ABBR = {'st': 'saint', 'ste': 'sainte', 'sts': 'saints', 'stes': 'saintes', 'mt': 'mont', 'ss': 'sous', 's': 'sur'}
DEPT = re.compile(r'^(?:\d{2}|2a|2b|97[1-6])$')
POSTAL = re.compile(r'^\d{5}$')
# Words that never name a commune alone: a query made only of them is not a place
GENERIC = set('la le les l de des du d en et a au aux sur sous saint sainte mise place'.split())
# Words around a place in a sentence (« Mairie Evian », « Analyse les dépenses à Alès »): never taken alone as a commune,
# even when a commune bears that name (Ville, École, Bus...)
FILLER = GENERIC | set('mairie mairies ville villes commune communes depense depenses budget budgets analyse analyser cout '
                       'couts combien impot impots taxe region metropole departement agglomeration communaute ecole eau '
                       'bus police culture sport zoo musee piscine stade gare port hopital lycee college marche marches'.split())
# « Paris 12 », « Lyon 3e », « Marseille 1er arrondissement »: the arrondissement belongs to the commune's accounts
ARROND = re.compile(r'^(paris|lyon|marseille) (\d{1,2})(?: ?(?:e|er|eme|ieme|em))?(?: arrondissement)?$')


def norm(text: str) -> str:
    s = unicodedata.normalize('NFD', str(text or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').replace('œ', 'oe').replace('æ', 'ae')
    words = re.findall(r'[a-z0-9]+', s)
    return ' '.join(ABBR.get(w, w) if i or len(words) > 1 else w for i, w in enumerate(words))


def load(path: Path) -> None:
    """Reads the lookup once (thread-safe); later calls are free."""
    with _lock:
        stamp = f'{path}:{Path(path).stat().st_mtime_ns}'
        if _data.get('path') == stamp:
            return
        d = json.loads(Path(path).read_text(encoding='utf-8'))
        rows = []
        by_name: Dict[str, List[int]] = {}
        by_cp: Dict[str, List[int]] = {}
        by_first: Dict[str, List[int]] = {}
        for i, (code, name, dep, pop, cps, last) in enumerate(d['rows']):
            n = norm(name)
            rows.append({'insee': code, 'nom': name, 'dep': dep, 'dep_nom': d['deps'].get(dep, ''), 'population': pop,
                         'codes_postaux': cps.split(), 'projets_annee': last or None, '_n': n})
            by_name.setdefault(n, []).append(i)
            by_first.setdefault(n[:1], []).append(i)
            for cp in cps.split():
                by_cp.setdefault(cp, []).append(i)
        deps = {k: {'code': k, 'nom': v, '_n': norm(v)} for k, v in d['deps'].items()}
        # the intercommunality and the region of each commune (OFGL members, communes-meta)
        local = Path(path).parent.parent / 'local'
        try:
            members = json.loads((local / 'gfp' / '_communes.json').read_text(encoding='utf-8'))['members']
            ents = json.loads((local / 'gfp' / '_entities.json').read_text(encoding='utf-8'))
            names = dict(zip(ents['codes'], ents['names']))
            for siren, idx in members.items():
                for i in idx:
                    if i < len(rows):
                        rows[i]['interco'] = {'code': siren, 'nom': names.get(siren, siren)}
        except (OSError, ValueError, KeyError):
            pass
        try:
            meta = json.loads((Path(path).parent / 'communes-meta.json').read_text(encoding='utf-8'))['departments']
            for r in rows:
                r['region'] = (meta.get(r['dep']) or ['', ''])[1]
        except (OSError, ValueError, KeyError):
            pass
        # former communes (merged, absorbed or renamed): scripts/communes-anciennes.py
        old: Dict[str, List[tuple]] = {}
        index = {r['insee']: i for i, r in enumerate(rows)}
        try:
            for name, code, now, year in json.loads((Path(path).parent / 'communes-anciennes.json').read_text(encoding='utf-8'))['rows']:
                n = norm(name)
                if now in index and n != rows[index[now]]['_n']:
                    old.setdefault(n, []).append((index[now], name, year))
        except (OSError, ValueError, KeyError):
            pass
        _data.update(path=stamp, rows=rows, by_name=by_name, by_cp=by_cp, by_first=by_first, deps=deps, old=old)


def _edits(a: str, b: str, limit: int) -> int:
    """Damerau-Levenshtein distance, stopped once above limit."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev2, prev = None, list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
            if prev2 is not None and i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        if min(cur) > limit:
            return limit + 1
        prev2, prev = prev, cur
    return prev[-1]


def _dept_of(words: List[str]) -> Optional[str]:
    """A département named by these words (« allier », « 33 », « haute savoie »), or None."""
    if not words:
        return None
    text = ' '.join(words)
    if DEPT.match(text):
        code = text.upper()
        return code if code in _data['deps'] else None
    hits = [k for k, d in _data['deps'].items() if d['_n'] == text]
    return hits[0] if hits else None


def links(c: dict, base: str = '') -> list:
    """Where the site shows a commune, level by level: its spending on the map, its intercommunality, its
    département, its region, the projects funded by the State, its elected officials and staff. Paths relative to
    the site (or absolute with base). Shared by the search boxes, the results page and the Loupe."""
    q = urllib.parse.quote
    out = [{'cle': 'commune', 'libelle': 'Dépenses de la commune', 'url': f'index.html?commune={c["insee"]}#explorer'}]
    if c.get('interco'):
        out.append({'cle': 'interco', 'libelle': c['interco']['nom'], 'url': f'index.html?interco={c["interco"]["code"]}&commune={c["insee"]}#explorer'})
    out.append({'cle': 'departement', 'libelle': c.get('dep_nom') or c['dep'], 'url': f'index.html?departement={q(c["dep"])}&vue=departements&commune={c["insee"]}#explorer'})
    if c.get('region'):
        out.append({'cle': 'region', 'libelle': c['region'], 'url': f'index.html?region={q(c["region"])}&vue=regions&commune={c["insee"]}#explorer'})
    if c.get('projets_annee'):
        out.append({'cle': 'projets', 'libelle': 'Projets aidés par l’État', 'url': f'index.html?commune={c["insee"]}&vue=projets&annee={c["projets_annee"]}#explorer'})
    out.append({'cle': 'elus', 'libelle': 'Élus et employés', 'url': f'emplois.html?commune={c["insee"]}#commune'})
    if base:
        for l in out:
            l['url'] = f'{base.rstrip("/")}/{l["url"]}'
    return out


def _view(i: int, match: str, former: str = '', year: int = 0) -> dict:
    r = _data['rows'][i]
    v = {k: val for k, val in r.items() if not k.startswith('_')} | {'correspondance': match}
    if former:  # « Champ-sur-Layon » is part of Bellevigne-en-Layon since 2019
        v.update(ancien_nom=former, ancienne_depuis=year)
    v['liens'] = links(v)
    return v


def by_insee(code: str) -> Optional[dict]:
    """The commune of this INSEE code, with its links, or None."""
    i = next((k for k, r in enumerate(_data.get('rows', [])) if r['insee'] == code), None)
    return None if i is None else _view(i, 'code')


def find(query: str, limit: int = 6) -> dict:
    """{'communes': [...], 'departement': {...} | None,
        'type': 'code_postal' | 'departement' | 'nom' | 'ancienne_commune' | 'debut' | 'approchant' | 'arrondissement' |
                'dans_la_phrase' | ''}"""
    if not _data:
        raise RuntimeError('places.load() first')
    out = _find(norm(query), limit)
    if out['type']:
        return out
    q = norm(query)
    rows = _data['rows']
    m = ARROND.match(q)
    if m:  # the accounts are published for the whole city: the arrondissement leads to it
        ids = [i for i in _data['by_name'].get(m.group(1), []) if rows[i]['dep'] in ('75', '69', '13')]
        if ids:
            return out | {'type': 'arrondissement', 'arrondissement': int(m.group(2)), 'communes': [_view(ids[0], 'arrondissement')]}
    words = q.split()
    if len(words) < 2:
        return out
    # a place inside a sentence: the longest run of words that names a commune exactly, else that starts a commune name
    rank = lambda ids: sorted(set(ids), key=lambda i: -(rows[i]['population'] or 0))
    runs = [' '.join(words[a:a + n]) for n in range(len(words) - 1, 0, -1) for a in range(len(words) - n + 1)]
    runs = [r for r in runs if not all(w in FILLER for w in r.split()) and len(r.replace(' ', '')) >= 3
            and (r.split()[0] not in GENERIC - {'saint', 'sainte'} or (r.startswith(('le ', 'la ', 'les ')) and len(r.split()) > 1))]
    for r in runs:
        if r.split()[0] in FILLER - {'saint', 'sainte', 'le', 'la', 'les'}:
            continue
        ids = _data['by_name'].get(r, [])
        if ids:
            return out | {'type': 'dans_la_phrase', 'communes': [_view(i, 'dans_la_phrase') for i in rank(ids)[:limit]]}
    for r in runs:
        if r.split()[0] in FILLER - {'saint', 'sainte', 'le', 'la', 'les'} or len(r) < 5:
            continue
        ids = [i for i in _data['by_first'].get(r[:1], []) if rows[i]['_n'].startswith(r + ' ')]
        if ids:
            return out | {'type': 'dans_la_phrase', 'communes': [_view(i, 'dans_la_phrase') for i in rank(ids)[:limit]]}
    return out


def _former(q: str, limit: int, fuzzy: bool = False) -> list:
    """The commune of today for a former name: exact, then a name cut short (« Saint Félix de Reilhac et »), then one
    or two typos (« Champ sur layons »)."""
    old = _data.get('old') or {}
    hits = old.get(q) or []
    if fuzzy and not hits and len(q) >= 10:
        hits = [h for n, hs in old.items() if n.startswith(q + ' ') for h in hs]
    if fuzzy and not hits and len(q) >= 8:
        tol = 1 if len(q) <= 10 else 2
        near = [(d, h) for n, hs in old.items() if n[:1] == q[:1] and (d := _edits(n, q, tol)) <= tol for h in hs]
        if near:
            best = min(d for d, _ in near)
            hits = [h for d, h in near if d == best]
    seen, out = set(), []
    for i, name, year in sorted(hits, key=lambda h: -(_data['rows'][h[0]]['population'] or 0)):
        if i not in seen:
            seen.add(i)
            out.append(_view(i, 'ancienne_commune', name, year))
    return out[:limit]


def _find(q: str, limit: int) -> dict:
    """The whole query read as one place."""
    words = q.split()
    out = {'communes': [], 'departement': None, 'type': ''}
    if not words:
        return out
    rows = _data['rows']
    rank = lambda ids: sorted(set(ids), key=lambda i: -(rows[i]['population'] or 0))
    cps = [w for w in words if POSTAL.match(w)]
    rest = [w for w in words if not POSTAL.match(w)]
    # a département alone: « 33 », « Gironde », « 2A »
    dep = _dept_of(words)
    if dep:
        out.update(departement={'code': dep, 'nom': _data['deps'][dep]['nom']}, type='departement')
        same = _data['by_name'].get(q, [])  # a département that is also a commune name (« Paris »)
        out['communes'] = [_view(i, 'nom') for i in rank(same)[:limit]]
        return out
    if cps:
        ids = [i for cp in cps for i in _data['by_cp'].get(cp, [])]
        if rest:  # « 57700 Hayange »: the name picks among the communes of the postal code
            name = ' '.join(rest)
            picked = [i for i in ids if rows[i]['_n'] == name or rows[i]['_n'].startswith(name)]
            ids = picked or [i for i in ids if _edits(rows[i]['_n'], name, 2) <= 2] or ids
        out.update(type='code_postal', communes=[_view(i, 'code_postal') for i in rank(ids)[:limit]])
        if not ids and cps[0][:2] in _data['deps'] and not rest:
            d = cps[0][:3] if cps[0].startswith('97') else ('2A' if cps[0].startswith('20') else cps[0][:2])
            if d in _data['deps']:
                out['departement'] = {'code': d, 'nom': _data['deps'][d]['nom']}
        return out
    if all(w in GENERIC for w in words) or len(q) < 2:
        return out
    exact = _data['by_name'].get(q, [])
    if exact:
        out.update(type='nom', communes=[_view(i, 'nom') for i in rank(exact)[:limit]])
        return out
    # « Lignerolles allier », « saint priest 69 »: a commune name followed by its département
    for k in range(len(words) - 1, 0, -1):
        name, dep = ' '.join(words[:k]), _dept_of(words[k:])
        if dep:
            ids = [i for i in _data['by_name'].get(name, []) if rows[i]['dep'] == dep]
            ids = ids or [i for i in _data['by_first'].get(name[:1], []) if rows[i]['dep'] == dep and _edits(rows[i]['_n'], name, 2) <= 2]
            if ids:
                out.update(type='nom', communes=[_view(i, 'nom') for i in rank(ids)[:limit]])
                return out
    former = _former(q, limit)
    pre = [i for i in _data['by_first'].get(q[:1], []) if rows[i]['_n'].startswith(q)] if len(q) >= 3 else []
    if pre:  # « Ivry » : Ivry-sur-Seine first, the former commune of that exact name after it
        shown = [_view(i, 'debut') for i in rank(pre)[:limit]]
        shown += [c for c in former if c['insee'] not in {x['insee'] for x in shown}]
        out.update(type='debut', communes=shown[:limit])
        return out
    if former:
        out.update(type='ancienne_commune', communes=former)
        return out
    if len(q) >= 4:  # a typo: « Carcassone », « Le havrr », « Baumes les dames »
        tol = 1 if len(q) <= 6 else 2
        near = [(d, i) for i in _data['by_first'].get(q[:1], []) if (d := _edits(rows[i]['_n'], q, tol)) <= tol]
        if near:
            best = min(d for d, _ in near)
            ids = [i for d, i in near if d == best]
            out.update(type='approchant', communes=[_view(i, 'approchant') for i in rank(ids)[:limit]])
            return out
    if len(q) >= 12:  # cut short with a typo: « Saint Félix de reilhac et » (Saint-Félix-de-Reillac-et-Mortemart)
        near = [(d, i) for i in _data['by_first'].get(q[:1], []) if len(rows[i]['_n']) > len(q)
                and (d := _edits(rows[i]['_n'][:len(q)], q, 2)) <= 2]
        if near:
            best = min(d for d, _ in near)
            out.update(type='approchant', communes=[_view(i, 'approchant') for i in rank([i for d, i in near if d == best])[:limit]])
            return out
    former = _former(q, limit, fuzzy=True)  # a former name cut short or misspelt
    if former:
        out.update(type='ancienne_commune', communes=former)
    return out
