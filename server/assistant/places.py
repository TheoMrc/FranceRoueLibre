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
        _data.update(path=stamp, rows=rows, by_name=by_name, by_cp=by_cp, by_first=by_first, deps=deps)


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


def _view(i: int, match: str) -> dict:
    r = _data['rows'][i]
    v = {k: val for k, val in r.items() if not k.startswith('_')} | {'correspondance': match}
    v['liens'] = links(v)
    return v


def by_insee(code: str) -> Optional[dict]:
    """The commune of this INSEE code, with its links, or None."""
    i = next((k for k, r in enumerate(_data.get('rows', [])) if r['insee'] == code), None)
    return None if i is None else _view(i, 'code')


def find(query: str, limit: int = 6) -> dict:
    """{'communes': [...], 'departement': {...} | None, 'type': 'code_postal' | 'departement' | 'nom' | 'approchant' | ''}"""
    if not _data:
        raise RuntimeError('places.load() first')
    q = norm(query)
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
    if len(q) >= 3:
        pre = [i for i in _data['by_first'].get(q[:1], []) if rows[i]['_n'].startswith(q)]
        if pre:
            out.update(type='debut', communes=[_view(i, 'debut') for i in rank(pre)[:limit]])
            return out
    if len(q) >= 4:  # a typo: « Carcassone », « Le havrr », « Baumes les dames »
        tol = 1 if len(q) <= 6 else 2
        near = [(d, i) for i in _data['by_first'].get(q[:1], []) if (d := _edits(rows[i]['_n'], q, tol)) <= tol]
        if near:
            best = min(d for d, _ in near)
            ids = [i for d, i in near if d == best]
            out.update(type='approchant', communes=[_view(i, 'approchant') for i in rank(ids)[:limit]])
    return out
