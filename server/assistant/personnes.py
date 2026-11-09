"""Public figures named in a question (« Combien nous coûte Gérard Larcher ? », « salaire Yaël Braun-Pivet », « camille
galtier maire de manosque »): who they are, from the Répertoire national des élus (mandates held today) and Wikidata
(careers, the data of the Wikipedia infoboxes), and what the law or the assemblies publish about the pay attached to
those functions. Answered without a model when the person is certain and the question asks nothing else; the site
never follows a person's own income, and says so. Data: dist/data/elus/ (scripts/elus-data.py,
scripts/personnalites-data.py).
"""
from __future__ import annotations

import json
import re
import threading
import unicodedata
import urllib.parse
from pathlib import Path
from typing import Optional

from . import settings as S

_lock = threading.Lock()
_cache: dict = {}
MONTHS = 'janvier février mars avril mai juin juillet août septembre octobre novembre décembre'.split()
NATIONAL = {'depute', 'senateur', 'europeen'}
# Words a question about a person may carry besides the name
ALLOWED = set('''combien coute coutent coutait couter coute-t-il cout couts coutera coutes nous me vous a t il elle ils elles a-t-il gagne gagnent
gagnait touche touchent touchait percoit percoivent recoit salaire salaires remuneration remunerations revenu revenus
indemnite indemnites traitement paye paie payee brut net par mois an annee mensuel mensuelle annuel qui est quel quelle
quels quelles le la les l de du des d un une son sa ses en au aux et ou pour sur avec depuis mandat mandats fonction
debut fin vie politique politiques ensemble tout toute
fonctions carriere parcours poste postes role combien coute argent public publique ca cela ce cet cette fait est c
etait sont ete total totale montant combien-coute est-ce que qu exactement vraiment au juste reellement aujourd hui actuel
actuellement maintenant france francais francaise contribuable contribuables chaque citoyen citoyens habitant habitants
dis donne moi peux tu savoir connaitre voir quoi ministre depute deputee senateur senatrice maire president presidente
premier conseiller conseillere regional regionale departemental departementale elu elue elus mr m mme monsieur madame
'''.split())
CUE = re.compile(r'\b(combien|cout|coute|coutent|salaire|remuneration|gagne|touche|percoit|indemnit|paye|paie|revenu|qui est|traitement)\w*', re.I)
DEFUNCT = set('''paris france etat ville maire president ministre depute senateur republique gouvernement commune region
departement martin bernard petit grand blanc noir rouge vert durand dubois moreau laurent simon michel leroy roux david
bertrand morel fournier girard bonnet dupont lambert fontaine rousseau vincent muller lefevre faure andre mercier blanc
'''.split())


def norm(text: str) -> str:
    s = unicodedata.normalize('NFD', str(text or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(re.findall(r'[a-z0-9]+', s))


def _date(iso: str) -> str:
    try:
        y, m, d = str(iso)[:10].split('-')
        return f'{int(d)}{"er" if int(d) == 1 else ""} {MONTHS[int(m) - 1]} {y}'
    except (ValueError, IndexError):
        return str(iso or '')


def _year(iso: str) -> str:
    return str(iso or '')[:4]


def _load() -> dict:
    base = Path(S.DATA_DIR) / 'elus'
    stamp = tuple((p.name, p.stat().st_mtime_ns) for p in sorted(base.glob('*.json'))) if base.is_dir() else ()
    with _lock:
        if _cache.get('stamp') == stamp:
            return _cache
        _cache.clear()
        _cache['stamp'] = stamp
        read = lambda n: json.loads((base / n).read_text(encoding='utf-8')) if (base / n).is_file() else {}
        _cache['maires'] = read('maires.json')
        rne = read('personnes.json')
        _cache['rne_head'] = {k: v for k, v in rne.items() if k != 'personnes'}
        wd = read('personnalites.json')
        _cache['wd_head'] = {k: v for k, v in wd.items() if k != 'personnes'}
        _cache['pay'] = read('remunerations.json')
        people = {}   # normalized full name -> {'nom', 'mandats': [...], 'wd': {...} | None}
        for name, mandates in rne.get('personnes', []):
            people.setdefault(norm(name), []).append({'nom': name, 'mandats': mandates, 'wd': None})
        for p in wd.get('personnes', []):
            key = norm(p.get('rne') or p['nom'])
            hits = people.get(key) or people.get(norm(p['nom']))
            if hits and len(hits) == 1:
                hits[0]['wd'] = p
                if norm(p['nom']) != key:
                    people.setdefault(norm(p['nom']), hits)
            elif not hits:
                people.setdefault(norm(p['nom']), []).append({'nom': p['nom'], 'mandats': [], 'wd': p})
        _cache['people'] = people
        compact = {}
        surnames = {}
        for key, entries in people.items():
            compact.setdefault(key.replace(' ', ''), []).extend(entries)
            for e in entries:
                if not _is_national(e):
                    continue
                words = key.split()
                for k in range(1, len(words)):
                    last = ' '.join(words[k:])
                    if len(last) >= 4:
                        surnames.setdefault(last, [])
                        if e not in surnames[last]:
                            surnames[last].append(e)
        _cache['compact'] = compact
        _cache['surnames'] = surnames
        _cache['national_keys'] = [k for k, es in people.items() if any(_is_national(e) for e in es)]
        return _cache


def _is_national(e: dict) -> bool:
    if e.get('wd'):
        return True
    return any(m[0] in NATIONAL or (m[0] in ('regional', 'departemental', 'assemblee') and str(m[4]).lower().startswith('président'))
               for m in e['mandats'])


# ===================================================================================================== mayors
def mayor_of(insee: str) -> Optional[dict]:
    d = _load().get('maires') or {}
    row = (d.get('communes') or {}).get(insee)
    if not row:
        return None
    return {'nom': row[0], 'depuis': _date(row[1]), 'source_date': d.get('miseAJourTexte') or d.get('miseAJour', '')}


def mayor_cap(population: float, role: str = 'mayor') -> Optional[dict]:
    """Highest gross monthly indemnity the law allows a mayor (or a deputy mayor) of a commune of this size."""
    from . import tools as T
    try:
        ref = T._json('emplois.json')['reference']['indemnities']
    except (OSError, ValueError, KeyError):
        return None
    table = ref.get(role) or []
    if not table or not population:
        return None
    rate = table[0][1]
    for threshold, value in table:
        if population >= threshold:
            rate = value
    texte = 'CGCT, art. L. 2123-23' if role == 'mayor' else 'CGCT, art. L. 2123-24'
    return {'taux': str(rate).replace('.', ','), 'mensuel_brut': ref['indexMonthly'] * rate / 100, 'texte': texte,
            'url': ref.get('url', '')}


# ===================================================================================================== matching
def _edits(a: str, b: str, limit: int) -> int:
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        best = cur[0]
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
            best = min(best, cur[j])
        if best > limit:
            return limit + 1
        prev = cur
    return prev[-1]


def _close(known: str, typed: str) -> bool:
    """A typo, not another person: same number of words, the surname one letter away at most (« larche »,
    « nune »), the first names two letters away at most (« yaelle »); « emmanuel macron » is not « emmanuel mandon »."""
    a, b = known.split(), typed.split()
    if len(a) != len(b) or len(a) < 2:
        return False
    last = _edits(a[-1], b[-1], 1)
    if last > (1 if len(a[-1]) >= 5 else 0):
        return False
    first = sum(_edits(x, y, 2) for x, y in zip(a[:-1], b[:-1]))
    return first <= 2 and last + first <= 2


QUOTED = re.compile(r'^\s*combien d[’\']argent public (?:re[çc]oit|touche|a re[çc]u)(?: ou d[ée]pense)?\s*[«"]\s*(.+?)\s*[»"]\s*\??\s*$', re.I)


def find(text: str) -> tuple:
    """([people], words of the question that are the name) for a question that names a public figure, else ([], set())."""
    c = _load()
    if not c.get('people'):
        return [], set()
    raw = str(text or '')
    m = QUOTED.match(raw)
    q = norm(m.group(1) if m else raw)
    words = q.split()
    cue = bool(CUE.search(norm(raw))) or bool(m)
    # 1. a full name, the longest first (« jean francois emmanuel beaunol », « gerard larcher »)
    for n in range(min(5, len(words)), 1, -1):
        for a in range(len(words) - n + 1):
            key = ' '.join(words[a:a + n])
            if all(w in ALLOWED or w in DEFUNCT for w in words[a:a + n]):
                continue   # « le maire », « le president »: words of the question
            hits = c['people'].get(key) or c['compact'].get(key.replace(' ', ''))
            if hits:
                return hits, set(words[a:a + n])
    # 2. a typo in a national figure's full name (« gerard larche », « laurent nune », « yaelle braun pivet »)
    if cue or len(words) <= 4:
        for n in range(min(4, len(words)), 1, -1):
            for a in range(len(words) - n + 1):
                key = ' '.join(words[a:a + n])
                if len(key) < 9:
                    continue
                near = [k for k in c['national_keys'] if k[:1] == key[:1] and _close(k, key)]
                if len(near) == 1:
                    return c['people'][near[0]], set(words[a:a + n])
    # 3. a surname alone, when one national figure bears it (« macron », « larcher », « bayrou »)
    if cue or len(words) <= 3:
        for n in (3, 2, 1):
            for a in range(len(words) - n + 1):
                key = ' '.join(words[a:a + n])
                if key in DEFUNCT or len(key) < 4 or all(w in ALLOWED or w in DEFUNCT for w in key.split()):
                    continue   # « le maire », « le president »: words of the question, not a surname
                hits = c['surnames'].get(key) or c['surnames'].get(key.replace(' ', ''))
                if hits and len(hits) == 1:
                    return hits, set(words[a:a + n])
                if hits and len({h['nom'] for h in hits}) == 1:
                    return hits[:1], set(words[a:a + n])
    return [], set()


# ===================================================================================================== answer
KIND = {'maire': 'Maire de {lieu}', 'adjoint': '{fonction} de {lieu}', 'depute': 'Député ({lieu})', 'senateur': 'Sénateur ({lieu})',
        'europeen': 'Député européen', 'departemental': '{fonction} ({lieu}, canton {detail})',
        'regional': '{fonction} ({lieu})', 'assemblee': '{fonction} ({lieu})', 'epci': '{fonction} ({lieu})'}


def _title(s: str) -> str:
    return re.sub(r"\b(De|Du|Des|La|Le|Les|Sur|Sous|En|Et|Aux|Au|D|L)\b", lambda m: m.group(0).lower(), str(s)).replace("d'", "d’")


def _mandate_text(m: list) -> str:
    kind, lieu, code, detail, fonction, since = m
    if kind == 'maire':
        from . import places
        try:
            c = places.by_insee(detail)
            lieu = f'{c["nom"]} ({c["dep_nom"]})' if c else _title(lieu)
        except Exception:  # noqa: BLE001
            lieu = _title(lieu)
    else:
        lieu = _title(lieu)
    text = KIND.get(kind, '{fonction} ({lieu})').format(lieu=lieu, fonction=fonction, detail=_title(detail))
    return text + (f', depuis le {_date(since)}' if since else '')


def _pay_lines(entry: dict) -> list:
    c = _load()
    pay = c.get('pay') or {}
    out, seen = [], set()
    for m in entry['mandats']:
        kind = m[0]
        if kind in ('depute', 'senateur') and 'parl' not in seen and pay.get('parlementaire'):
            seen.add('parl')
            p = pay['parlementaire']
            eur = lambda v: f'{v:,.2f}'.replace(',', ' ').replace('.', ',') + ' €'
            line = (f'- **{"Député" if kind == "depute" else "Sénateur"}** : indemnité parlementaire de **{eur(p["brut"])} brut par mois** '
                    f'({eur(p["base"])} de base, {eur(p["residence"])} de résidence, {eur(p["fonction"])} de fonction), '
                    f'soit {eur(p["net"])} net' + (f' ({p["depuis"]})' if p.get('depuis') else '') + '.')
            out.append(line)
            if kind == 'depute':
                extra = f'dotation de fonctionnement de {eur(p["dfp"])} par mois pour les frais de mandat'
                if p.get('collaborateurs'):
                    extra += f' et crédit de {eur(p["collaborateurs"])} par mois pour payer ses collaborateurs'
                out.append(f'  En plus, l’Assemblée met à disposition une {extra} : ces sommes ne sont pas versées au député.')
            else:
                out.append('  Même indemnité parlementaire que les députés (ordonnance n° 58-1210 du 13 décembre 1958). Les frais de '
                           'mandat et les collaborateurs sont payés en plus par le Sénat.')
        elif kind in ('maire', 'adjoint') and kind not in seen:
            seen.add(kind)
            from . import tools as T
            try:
                i, err = T._find_commune(f'insee:{m[3]}')
                pop = T._json('local/communes/_pop.json')['values'][-1][i] if i is not None else 0
            except Exception:  # noqa: BLE001
                pop = 0
            cap = mayor_cap(pop or 0, 'mayor' if kind == 'maire' else 'deputy')
            if cap:
                eur0 = f'{cap["mensuel_brut"]:,.0f}'.replace(',', ' ')
                role = 'maire' if kind == 'maire' else 'adjoint au maire'
                out.append(f'- **{role.capitalize()}** : au plus **{eur0} € brut par mois** pour un {role} d’une commune de '
                           f'{f"{pop:,.0f}".replace(",", " ")} habitants ({cap["taux"]} % de l’indice brut terminal de la '
                           f'fonction publique, {cap["texte"]}), hors majorations légales. Le montant réellement versé à chaque '
                           f'élu n’est pas publié.')
    wd = entry.get('wd') or {}
    now = [f for f in wd.get('fonctions', []) if not f[2] and f[1]]
    if any('président de la République' in f[0] for f in now) or any('Premier ministre' in f[0] for f in now) \
            or any(f[0].lower().startswith(('ministre', 'secrétaire d’état', "secrétaire d'état")) for f in now):
        g = pay.get('gouvernement') or {}
        out.append(f'- **Président de la République, Premier ministre ou ministre** : traitement fixé par le '
                   f'[{g.get("texte", "décret n° 2012-983 du 23 août 2012")}]({g.get("url", "")}).')
        if any('président de la République' in f[0] for f in now):
            budget = _presidency_budget()
            if budget:
                out.append(f'  Le budget de la Présidence de la République est de **{budget}** (crédits de paiement 2026 du budget de l’État, programme 501 « Présidence de la République »).')
    return out


def _presidency_budget() -> Optional[str]:
    from . import tools as T
    try:
        s = json.dumps(T._json('etat.json'), ensure_ascii=False)
    except (OSError, ValueError):
        return None
    m = re.search(r'"code":\s*"501",\s*"name":\s*"Présidence de la République".*?"cp26":\s*([\d.]+)', s)
    if not m:
        return None
    return f'{float(m.group(1)):.1f} M€ en 2026'.replace('.', ',')


def build(entries: list) -> Optional[dict]:
    if not entries:
        return None
    c = _load()
    if len(entries) > 1:
        lines = [f'Plusieurs élus s’appellent **{entries[0]["nom"]}** :', '']
        for e in entries[:8]:
            lines.append('- ' + '; '.join(_mandate_text(m) for m in e['mandats'][:3]))
        lines += ['', 'Précisez la commune ou la fonction (par exemple « ' + entries[0]['nom'] + ' maire de … »).']
        return _wrap(lines, entries[0]['nom'], [])
    e = entries[0]
    wd = e.get('wd') or {}
    name = e['nom']
    lines = [f'**{name}**' + (f' (décédé le {_date(wd["deces"])})' if wd.get('deces') else ''), '']
    if e['mandats']:
        head = c.get('rne_head') or {}
        lines.append(f'**Mandats en cours** (Répertoire national des élus, {head.get("miseAJourTexte", "")}) :')
        lines += [f'- {_mandate_text(m)}' for m in e['mandats'][:8]]
        lines.append('')
    fns = wd.get('fonctions') or []
    if fns:
        shown = []
        for f in fns:
            label = f[0][:1].upper() + f[0][1:]
            period = f'depuis {_year(f[1])}' if f[1] and not f[2] else f'{_year(f[1])}–{_year(f[2])}' if f[1] and f[2] else (f'jusqu’en {_year(f[2])}' if f[2] else '')
            text = f'- {label}' + (f' ({period})' if period else '')
            if text not in shown:
                shown.append(text)
        lines.append('**Parcours** (Wikidata, données des infobox de Wikipédia) :')
        lines += shown[:10]
        lines.append('')
    pay = _pay_lines(e)
    if pay:
        lines.append('**Ce que la loi prévoit pour ces fonctions** :')
        lines += pay
        lines.append('')
    lines += ['Le site ne suit pas les revenus d’une personne : il publie l’argent public par organisme, pas par élu. '
              'Les déclarations d’intérêts et de patrimoine des responsables publics sont publiées par la Haute Autorité pour '
              'la transparence de la vie publique (HATVP).']
    sources = []
    if e['mandats']:
        sources.append({'title': 'Répertoire national des élus', 'url': (c.get('rne_head') or {}).get('url', '')})
    if wd.get('wikipedia'):
        sources.append({'title': f'Wikipédia : {name}', 'url': wd['wikipedia']})
    if any(m[0] in ('depute', 'senateur') for m in e['mandats']):
        sources.append({'title': 'Assemblée nationale, la situation matérielle du député',
                        'url': ((c.get('pay') or {}).get('parlementaire') or {}).get('url', '')})
    sources.append({'title': 'HATVP, déclarations des responsables publics', 'url': 'https://www.hatvp.fr/consulter-les-declarations/'})
    lines += ['', 'Sources : ' + ' ; '.join(f'[{s["title"]}]({s["url"]})' for s in sources if s['url'])]
    return _wrap(lines, name, sources)


def _wrap(lines: list, name: str, sources: list) -> dict:
    return {'reply': '\n'.join(lines), 'sources': sources, 'searches': [], 'provider': 'faq',
            'label': 'Réponse sourcée automatique', 'saved': 'personne',
            'events': [{'type': 'tool_done', 'name': 'personnes', 'label': f'Mandats et parcours de « {name} »', 'ok': True,
                        'summary': 'Répertoire national des élus, Wikidata', 's': 0}]}


def tool(name: str) -> dict:
    """For the model (tools.personnalite): what the data says about a person, never a guess."""
    entries, _ = find(name)
    if not entries:
        return {'aucune': f'« {name} » ne figure ni au Répertoire national des élus (mandats en cours) ni parmi les '
                          'présidents, ministres et parlementaires de Wikidata : ne pas lui attribuer de fonction sans '
                          'source.'}
    out = []
    for e in entries[:5]:
        wd = e.get('wd') or {}
        out.append({'nom': e['nom'], 'mandats_en_cours': [_mandate_text(m) for m in e['mandats']],
                    'parcours': [f'{f[0]} ({f[1] or "?"} → {f[2] or "en cours"})' for f in (wd.get('fonctions') or [])[:15]],
                    'deces': wd.get('deces', ''), 'wikipedia': wd.get('wikipedia', ''),
                    'remuneration_des_fonctions': [x.strip() for x in _pay_lines(e)]})
    c = _load()
    return {'personnes': out, 'homonymes': len(entries) > 1,
            'sources': {'mandats': f'Répertoire national des élus, {(c.get("rne_head") or {}).get("miseAJourTexte", "")}',
                        'parcours': 'Wikidata (infobox Wikipédia)'},
            'note': 'Le site ne publie aucune dépense par personne. Pour les revenus et le patrimoine : déclarations de la HATVP.'}


def cards(text: str) -> list:
    """Short cards for the search page: the public figures a search names, with their mandates and recent functions."""
    entries, _ = find(text)
    out = []
    for e in entries[:3]:
        wd = e.get('wd') or {}
        fns = [f for f in wd.get('fonctions', []) if f[0]]
        parcours = []
        for f in fns:
            t = f[0][:1].upper() + f[0][1:] + (f' ({_year(f[1])}–{_year(f[2])})' if f[1] and f[2] else f' (depuis {_year(f[1])})' if f[1] else '')
            if t not in parcours:
                parcours.append(t)
        out.append({'nom': e['nom'], 'mandats': [_mandate_text(m) for m in e['mandats'][:4]], 'parcours': parcours[:4],
                    'wikipedia': wd.get('wikipedia', ''), 'deces': wd.get('deces', ''),
                    'question': f'Combien nous coûte {e["nom"]} ?'})
    return out


def answer(text: str) -> Optional[dict]:
    """The answer about the public figure the question names, or None when the person is uncertain or the question asks
    something more precise (his retirement, a trip, an affair...)."""
    if len(str(text or '')) > 160:
        return None
    try:
        entries, name_words = find(text)
    except Exception:  # noqa: BLE001
        return None
    if not entries:
        return None
    m = QUOTED.match(str(text or ''))
    q = norm(m.group(1) if m else text)
    place_words = set()
    for e in entries:
        for mm in e['mandats']:
            place_words |= set(norm(mm[1]).split()) | set(norm(mm[3]).split())
    leftover = [w for w in q.split() if w not in name_words and w not in ALLOWED and w not in place_words
                and not re.fullmatch(r'\d+', w)]
    if leftover:
        return None
    try:
        return build(entries)
    except Exception:  # noqa: BLE001 - any trouble: the model answers instead
        return None
