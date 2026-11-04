"""Answers without a model when the question is only a place: a commune name (« Audenge », « Carcassone »), a postal
code (« 33980 », « 57700 Hayange »), a département (« 33 », « Gironde »), or the question the search boxes propose
(« Quelles sont les informations disponibles sur les dépenses d’Audenge (33) ? »). The text is built from the same
tools as the Loupe's (tools.dossier_commune, outils.comparer), so it costs nothing and comes at once. Anything else,
or any error, returns None and the question goes to the model as usual.
"""
from __future__ import annotations

import re
from typing import Optional

from . import outils as O
from . import places
from . import settings as S
from . import tools as T

ASKED = re.compile(r'^\s*quelles sont les informations disponibles sur les d[ée]penses\s+(de la |de l[’\']|de |d[’\']|du |des )?(.+?)\s*(?:\((\w{2,3})\))?\s*\?\s*$', re.I)
SOURCES = [{'title': 'OFGL, comptes des collectivités locales', 'url': 'https://data.ofgl.fr/'},
           {'title': 'DGCL, subventions d’investissement aux collectivités (DETR, DSIL, DPV, DSID)',
            'url': 'https://www.collectivites-locales.gouv.fr/'},
           {'title': 'La Poste, base officielle des codes postaux', 'url': 'https://www.data.gouv.fr/datasets/base-officielle-des-codes-postaux/'}]


def eur(v: float) -> str:
    a = abs(v)
    f = lambda x, d: f'{x:,.{d}f}'.replace(',', ' ').replace('.', ',')
    return f'{f(v / 1e9, 2)} Md€' if a >= 1e9 else f'{f(v / 1e6, 1)} M€' if a >= 1e6 else f'{f(v / 1e3, 0)} k€' if a >= 1e4 else f'{f(v, 0)} €'


def num(v: float) -> str:
    return f'{v:,.0f}'.replace(',', ' ')


def rank(text: str) -> str:
    """« 124e sur 1216 (1er = …) » → « 124e plus dépensière sur 1 216 »"""
    m = re.match(r'(\d+)e sur (\d+)', text or '')
    return f'{m.group(1)}e plus élevé sur {num(int(m.group(2)))}' if m else text


def prices(y0: int, y1: int) -> float:
    cpi = O._cpi()
    return 100 * (cpi[min(y1, max(cpi))] / cpi[y0] - 1) if y0 in cpi else 0.0


def place_of(text: str) -> Optional[str]:
    """The place a short question names, or None when the question says more than a place."""
    q = str(text or '').strip()
    m = ASKED.match(q)
    if m:
        article, name, code = m.group(1) or '', m.group(2), m.group(3) or ''
        name = {'du ': 'Le ', 'des ': 'Les '}.get(article.lower(), 'La ' if article.lower() == 'de la ' else '') + name
        return f'{name} {code}'.strip()
    if len(q) > 60 or '?' in q or len(q.split()) > 6:
        return None
    return q


def _commune(code: str) -> Optional[dict]:
    d = T.dossier_commune(f'insee:{code}')
    if not d.get('commune'):
        return None
    c, rows = d['commune'], d['comptes']['montants_eur']
    spend, debt = rows.get('Dépenses totales') or {}, rows.get('Encours de dette') or {}
    pop = d['comptes']['population']
    last, first = max(spend), min(spend)
    lines = [f'**{c["nom"]}** · {c["lieu"]} · {num(pop.get(last, 0))} habitants en {last}. Quatre échelons dépensent pour '
             f'ses habitants :', '']
    names = {'commune': 'Commune', 'intercommunalite': 'Intercommunalité', 'departement': 'Département', 'region': 'Région'}
    for e in d['echelons']:
        if e.get('depenses_totales_eur') is None:
            continue
        lines.append(f'- **{names[e["echelon"]]} : {e["nom"]}** : {eur(e["depenses_totales_eur"])} en {e["annee"]}, soit '
                     f'{num(e["par_habitant_eur"])} € par habitant ({e["sert_a"]})')
    lines += ['', 'Les montants par habitant ne s’additionnent pas exactement : chaque échelon a son périmètre et sa population.',
              '', f'**La commune en chiffres**']
    if first != last and spend.get(first):
        change = 100 * (spend[last] / spend[first] - 1)
        lines.append(f'- Dépenses : {eur(spend[first])} en {first}, {eur(spend[last])} en {last} '
                     f'({"+" if change >= 0 else ""}{change:.0f} %), pour {num(pop.get(first, 0))} puis {num(pop.get(last, 0))} habitants ; '
                     f'les prix ont augmenté de {prices(first, last):.0f} % sur la période.')
    cmp_ = O.comparer(c['code'])
    if cmp_.get('mediane_par_habitant_eur'):
        gap = cmp_.get('ecart_a_la_mediane_pct') or 0
        lines.append(f'- Par habitant : {num(cmp_["par_habitant_eur"])} €, {"au-dessus" if gap > 0 else "en dessous"} de la médiane des '
                     f'{cmp_["groupe"]} ({num(cmp_["mediane_par_habitant_eur"])} €, {abs(gap):.0f} % d’écart ; '
                     f'{rank(cmp_["rang"])}).')
    if debt.get(last) is not None and pop.get(last):
        lines.append(f'- Dette : {eur(debt[last])} fin {last}, soit {num(debt[last] / pop[last])} € par habitant.')
    p = d['projets_aides_etat']
    if p['nombre']:
        big = p['plus_gros'][0]
        lines.append(f'- Projets aidés par l’État : {eur(p["total_eur"])} pour {p["nombre"]} projet{"s" if p["nombre"] > 1 else ""} '
                     f'depuis {min(p["par_annee_eur"])} ; le plus gros : « {big["objet"].rstrip(".")} » ({eur(big["montant_eur"])}, {big["annee"]}).')
    if isinstance(d['signaux'], list) and d['signaux']:
        lines.append('- Signal du site : ' + '; '.join(s['signal'].split(' : ')[0] for s in d['signaux']) + '. À vérifier auprès de la commune.')
    lines += ['', 'Pour une question précise (une dépense, un service, une comparaison), posez-la à la suite.']
    return {'reply': '\n'.join(lines), 'sources': SOURCES,
            'liens': {'commune': c['nom'], 'liens': T._links(c['code'], '')}}


def _departement(code: str, name: str) -> Optional[dict]:
    r = T.comptes_collectivite(code, 'departements')
    if not r.get('entite'):
        return None
    spend = r['montants_eur'].get('Dépenses totales') or {}
    pop = r['population']
    last = max(spend)
    first = max(y for y in spend if y <= last - 10) if any(y <= last - 10 for y in spend) else min(spend)
    cmp_ = O.comparer(code, niveau='departements')
    meta = T._json('web/communes-meta.json')['departments'].get(code, ['', ''])
    lines = [f'**{name}** ({code}{", " + meta[1] if meta[1] else ""}) : le département a dépensé **{eur(spend[last])}** en {last}, '
             f'soit {num(spend[last] / pop[last])} € par habitant ({T.ROLES["departement"]}).', '']
    if spend.get(first):
        change = 100 * (spend[last] / spend[first] - 1)
        lines.append(f'- En {last - first} ans : {eur(spend[first])} en {first}, {eur(spend[last])} en {last} '
                     f'({"+" if change >= 0 else ""}{change:.0f} %), quand les prix ont augmenté de {prices(first, last):.0f} %.')
    if cmp_.get('mediane_par_habitant_eur'):
        lines.append(f'- Par habitant : {rank(cmp_["rang"])} départements (médiane {num(cmp_["mediane_par_habitant_eur"])} €).')
    debt = r['montants_eur'].get('Encours de dette') or {}
    if debt.get(last) is not None:
        lines.append(f'- Dette : {eur(debt[last])} fin {last}, soit {num(debt[last] / pop[last])} € par habitant.')
    lines += ['', 'Pour une commune du département, tapez son nom ou son code postal.']
    q = lambda v: re.sub(r'\s', '%20', v)
    links = [{'cle': 'departement', 'libelle': 'Dépenses du département', 'url': f'index.html?departement={code}&vue=departements#explorer'},
             {'cle': 'commune', 'libelle': 'Ses communes sur la carte', 'url': f'index.html?departement={code}#explorer'}]
    if meta[1]:
        links.append({'cle': 'region', 'libelle': meta[1], 'url': f'index.html?region={q(meta[1])}&vue=regions#explorer'})
    return {'reply': '\n'.join(lines), 'sources': SOURCES[:1], 'liens': {'commune': name, 'liens': links}}


def _homonyms(found: list) -> dict:
    lines = [f'Plusieurs communes s’appellent **{found[0]["nom"]}** :', '']
    lines += [f'- **{c["nom"]}** ({c["dep_nom"]}, {c["dep"]}) : {num(c["population"])} habitants' for c in found]
    lines += ['', 'Précisez le département ou le code postal (par exemple « ' + f'{found[0]["nom"]} {found[0]["dep"]}' + ' »).']
    return {'reply': '\n'.join(lines), 'sources': SOURCES[2:], 'liens': None}


def _postal(q: str, found: list) -> dict:
    code = next((w for w in q.split() if w.isdigit() and len(w) == 5), q)
    found = places.find(code, limit=40)['communes'] or found
    lines = [f'Le code postal **{code}** couvre {len(found)} communes :', '']
    lines += [f'- **{c["nom"]}** ({c["dep_nom"]}, {c["dep"]}) : {num(c["population"])} habitants' for c in found]
    lines += ['', 'Tapez le nom de la commune (par exemple « ' + f'{found[0]["nom"]}' + ' ») pour ses comptes.']
    return {'reply': '\n'.join(lines), 'sources': SOURCES[2:], 'liens': None}


def answer(messages: list) -> Optional[dict]:
    """The templated answer, or None (then the model answers)."""
    if len([m for m in messages if m.get('role') == 'user']) != 1:
        return None
    q = place_of(messages[-1].get('text'))
    if not q:
        return None
    try:
        places.load(S.DATA_DIR / 'web' / 'communes-lookup.json')
        found = places.find(q)
        communes = found['communes']
        if found['type'] == 'dans_la_phrase':  # a place inside a longer question: the model reads the rest
            return None
        exact = [c for c in communes if c['correspondance'] in ('nom', 'code_postal')]
        if found['type'] == 'departement' and not (exact and len(exact) == 1 and places.norm(exact[0]['nom']) == places.norm(q)):
            res = _departement(found['departement']['code'], found['departement']['nom'])
        elif found['type'] in ('nom', 'code_postal') and len(communes) > 1 and len({c['nom'] for c in communes}) == 1:
            res = _homonyms(communes)
        elif found['type'] == 'code_postal' and len(communes) > 1:
            res = _postal(q, communes)
        elif len(communes) == 1 or (found['type'] == 'approchant' and communes):
            res = _commune(communes[0]['insee'])
        else:
            return None
    except Exception:  # noqa: BLE001 - any trouble: the model answers instead
        return None
    if not res:
        return None
    # the steps shown under « Recherches » in the panel, as for a model's answer
    name = (res.get('liens') or {}).get('commune') or q
    steps = [('dossier_collectivite', f'Dossier de « {name} »', 'comptes, échelons, projets aidés, signaux'),
             ('comparer', f'Comparaison de « {name} » avec les collectivités de même taille', 'médiane et rang')]
    if 'Plusieurs communes' in res['reply'] or 'Le code postal' in res['reply']:
        steps = [('dossier_collectivite', f'Communes nommées « {q} »', 'homonymes')]
    events = [{'type': 'tool_done', 'name': n, 'label': l, 'ok': True, 'summary': sm, 's': 0} for n, l, sm in steps]
    return dict(res, searches=[], provider='faq', label='Réponse sourcée automatique', saved='lieu',
                events=events)
