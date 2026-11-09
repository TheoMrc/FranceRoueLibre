"""Answers without a model when the question is only a place: a commune name (« Audenge », « Carcassone »), a postal
code (« 33980 », « 57700 Hayange »), a département (« 33 », « Gironde »), or the question the search boxes propose
(« Quelles sont les informations disponibles sur les dépenses d’Audenge (33) ? »), and the same question about a
département, a region or an intercommunality (« … du département Gironde (33) ? », « … de la région Occitanie ? »). The text is built from the same
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
from . import intents

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


LEVEL_Q = re.compile(r'^\s*quelles sont les informations disponibles sur les d[ée]penses\s+'
                     r'(du d[ée]partement|de la r[ée]gion|de l[’\']intercommunalit[ée])\s+(.+?)\s*(?:\((\w{2,9})\))?\s*\?\s*$', re.I)
LEVEL_WORDS = {'departements': ('département', 'départements', 'departement'), 'regions': ('région', 'régions', 'region'),
               'gfp': ('intercommunalité', 'intercommunalités', 'intercommunalite')}


def level_of(text: str) -> Optional[tuple]:
    """(level, code or name) for the question the map and the search boxes ask about a département, a region or an
    intercommunality, else None."""
    m = LEVEL_Q.match(str(text or ''))
    if not m:
        return None
    word = places.norm(m.group(1))
    level = 'departements' if 'depart' in word else 'regions' if 'region' in word else 'gfp'
    return level, (m.group(3) if level != 'regions' and m.group(3) else m.group(2)).strip()


def _level(level: str, key: str) -> Optional[dict]:
    """A département, a region or an intercommunality: what it spent, over ten years, against its peers, its debt."""
    r = T.comptes_collectivite(key, level)
    if not r.get('entite'):
        return None
    code, name = r['entite']['code'], r['entite']['nom']
    one, many, role = LEVEL_WORDS[level]
    spend = r['montants_eur'].get('Dépenses totales') or {}
    pop = r['population']
    if not spend:
        return None
    last = max(spend)
    first = max(y for y in spend if y <= last - 10) if any(y <= last - 10 for y in spend) else min(spend)
    cmp_ = O.comparer(code, niveau=level)
    meta = T._json('web/communes-meta.json')['departments'].get(code, ['', '']) if level == 'departements' else ['', '']
    label = {'departements': f'**{name}** ({code}{", " + meta[1] if meta[1] else ""}) : le département',
             'regions': f'**{name}** : la région', 'gfp': f'**{name}** : l’intercommunalité'}[level]
    head = f'soit {num(spend[last] / pop[last])} € par habitant ' if pop.get(last) else ''
    lines = [f'{label} a dépensé **{eur(spend[last])}** en {last}, {head}({T.ROLES[role]}).', '']
    if spend.get(first) and first != last:
        change = 100 * (spend[last] / spend[first] - 1)
        lines.append(f'- En {last - first} ans : {eur(spend[first])} en {first}, {eur(spend[last])} en {last} '
                     f'({"+" if change >= 0 else ""}{change:.0f} %), quand les prix ont augmenté de {prices(first, last):.0f} %.')
    if cmp_.get('mediane_par_habitant_eur'):
        lines.append(f'- Par habitant : {rank(cmp_["rang"])} {many} (médiane {num(cmp_["mediane_par_habitant_eur"])} €).')
    debt = r['montants_eur'].get('Encours de dette') or {}
    if debt.get(last) is not None and pop.get(last):
        lines.append(f'- Dette : {eur(debt[last])} fin {last}, soit {num(debt[last] / pop[last])} € par habitant.')
    if level == 'gfp':
        lines += ['', 'Une communauté de communes et une métropole n’exercent pas les mêmes compétences : la comparaison '
                  'avec toutes les intercommunalités n’est qu’un repère.']
    lines += ['', {'departements': 'Pour une commune du département, tapez son nom ou son code postal.',
                   'regions': 'Pour un département ou une commune de la région, tapez son nom.',
                   'gfp': 'Pour une commune de l’intercommunalité, tapez son nom.'}[level],
              'Pour une question précise (une dépense, un service, une comparaison), posez-la à la suite.']
    q = lambda v: re.sub(r'\s', '%20', v)
    links = {'departements': [{'cle': 'departement', 'libelle': 'Dépenses du département', 'url': f'index.html?departement={code}&vue=departements#explorer'},
                              {'cle': 'commune', 'libelle': 'Ses communes sur la carte', 'url': f'index.html?departement={code}#explorer'}],
             'regions': [{'cle': 'region', 'libelle': 'Dépenses de la région', 'url': f'index.html?region={q(name)}&vue=regions#explorer'}],
             'gfp': [{'cle': 'interco', 'libelle': 'L’intercommunalité sur la carte', 'url': f'index.html?interco={code}#explorer'}]}[level]
    if meta[1]:
        links.append({'cle': 'region', 'libelle': meta[1], 'url': f'index.html?region={q(meta[1])}&vue=regions#explorer'})
    return {'reply': '\n'.join(lines), 'sources': SOURCES[:1], 'liens': {'commune': name, 'liens': links}}


def _departement(code: str, name: str) -> Optional[dict]:
    return _level('departements', code)


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


# ============================================================================== a SIREN: what it received, by source
# « 433122397 », « SIREN 433 122 397 », or the question the search page proposes:
# « Combien d'argent public reçoit ou dépense « 433122397 » ? »
SIREN_Q = re.compile(r'^\s*(?:combien d[’\']argent public (?:re[çc]oit|touche|a re[çc]u)(?: ou d[ée]pense)?\s*[«"]?\s*|'
                     r'(?:le )?siren\s*:?\s*)?(\d{3}\s?\d{3}\s?\d{3})\s*[»"]?\s*\??\s*$', re.I)
SOURCE_TEXT = {1: 'Subventions de l’État', 2: 'Marchés publics', 3: 'Projets aidés par l’État (DGCL)', 4: 'Fonds vert',
               5: 'Aides de minimis'}
STATE_YEARS = 'les subventions de l’État aux associations sont publiées pour 2010 à 2021 et 2023 (l’annexe de 2022 n’a pas de liste exploitable)'


def siren_of(text: str) -> Optional[str]:
    m = SIREN_Q.match(str(text or ''))
    return re.sub(r'\s', '', m.group(1)) if m else None


def _years(amounts: dict) -> str:
    ys = sorted(amounts)
    if len(ys) <= 8:
        return ' ; '.join(f'{y} : {money(amounts[y])}' for y in ys)
    top = sorted(ys, key=lambda y: -amounts[y])[:4]
    return f'de {ys[0]} à {ys[-1]}, surtout ' + ' ; '.join(f'{y} : {money(amounts[y])}' for y in sorted(top))


def _beneficiary(siren: str) -> Optional[dict]:
    """Every published line under this SIREN (search index), the organisation from the official directory when it
    answers (recherche-entreprises, free and without a model). None when nothing is published: the model then
    explains and looks further."""
    if len(set(siren)) == 1:  # 999999999, 000000000: placeholders the annexes give to bodies without a SIREN
        return None
    with T._sql_lock:
        db = T._sql_connection()
        rows = db.execute('SELECT src, year, amount, fw, title, who, extra, dept FROM doc WHERE siren = ? ORDER BY year', [siren]).fetchall()
    if not rows:
        return None
    try:
        org = O._company(siren=siren) or {}
    except Exception:  # noqa: BLE001 - the directory is a plus, the figures come from the site
        org = {}
    if org.get('siren') != siren:
        org = {}
    names = {}
    for r in rows:
        names[r[5]] = names.get(r[5], 0) + 1
    name = org.get('nom') or max(names, key=names.get) or f'SIREN {siren}'
    assoc = str(org.get('nature_juridique') or '').startswith('92') or (not org and {r[0] for r in rows} == {1})
    by = {}
    for src, year, amount, fw, title, who, extra, dept in rows:
        b = by.setdefault(src, {'n': 0, 'total': 0.0, 'years': {}, 'prog': {}, 'fw': 0})
        b['n'] += 1
        if fw:  # framework agreements: a ceiling, not a payment
            b['fw'] += 1
            continue
        b['total'] += amount or 0
        b['years'][year] = b['years'].get(year, 0) + (amount or 0)
        if extra:
            b['prog'][extra] = b['prog'].get(extra, 0) + (amount or 0)
    got = {k: b for k, b in by.items() if k != 2}          # received: grants, aid, Fonds vert, DGCL projects
    total = sum(b['total'] for b in got.values())
    bought = by.get(2)                                      # contracts are indexed under the buyer's SIREN: spent
    who = f'l’association **{name}**' if assoc else f'**{name}**'
    place = f', dont le siège est à {org["commune_du_siege"].title()}' if org.get('commune_du_siege') else ''
    state = ''
    if org.get('etat') == 'fermée':
        state = f' Elle est fermée{" depuis le " + _date(org["fermeture"]) if org.get("fermeture") else ""} selon l’annuaire des entreprises.'
    head = [f'Le SIREN {siren} correspond à {who}{place}.']
    if got:
        n = sum(b['n'] for b in got.values())
        head.append(f'Le site publie **{money(total)}** d’argent public reçu, en {num(n)} ligne{"s" if n > 1 else ""}.')
    if bought:
        head.append(f'Comme acheteur public, ce SIREN a aussi passé des marchés pour **{money(bought["total"])}**.'
                    if got else f'Comme acheteur public, ce SIREN a passé des marchés pour **{money(bought["total"])}** '
                                f'({num(bought["n"] - bought["fw"])} ligne{"s" if bought["n"] - bought["fw"] > 1 else ""}).')
    lines = [' '.join(head) + state, '']
    for src in sorted(by, key=lambda k: (k == 2, -by[k]['total'])):
        b = by[src]
        label = 'Marchés publics passés comme acheteur' if src == 2 else SOURCE_TEXT.get(src, T.SRC.get(src, str(src)))
        text = f'- **{label} : {money(b["total"])}**'
        if b['years']:
            text += f' ({_years(b["years"])})'
        if b['fw']:
            text += f', plus {num(b["fw"])} accord{"s" if b["fw"] > 1 else ""}-cadre{"s" if b["fw"] > 1 else ""} dont le montant est un plafond, non additionné'
        progs = sorted(b['prog'].items(), key=lambda kv: -kv[1])[:3]
        if progs and src in (1, 4, 5):
            text += '. ' + ('Programme' if src == 1 else 'Dispositif') + (' : ' if len(progs) == 1 else 's : ') + \
                    ' ; '.join(f'{k.replace("Programme ", "")} ({money(v)})' for k, v in progs)
        lines.append(text + '.')
    missing = [SOURCE_TEXT[k].replace('Fonds vert', 'Fonds vert').lower().replace('l’état', 'l’État').replace('fonds vert', 'Fonds vert')
               for k in (1, 5, 4) if k not in by]
    if missing:
        lines.append(f'- **Rien de publié** pour ce SIREN : {", ".join(missing)}.')
    limits = []
    if 1 in by:
        limits.append(STATE_YEARS)
    limits.append('les subventions des communes, départements et régions ne figurent pas dans ces données')
    if not assoc:
        limits.append('les marchés remportés comme titulaire ne sont pas rattachés au SIREN dans ces données')
    lines += ['', f'Limites : {" ; ".join(limits)}. L’argent public réellement reçu peut donc être plus élevé.']
    more = ['Qu’est-ce que le FONJEP ?'] if any('FONJEP' in (r[4] or '').upper() for r in rows) else []
    if org.get('commune_du_siege'):
        more.insert(0, f'Quelles associations de {org["commune_du_siege"].title()} reçoivent le plus de subventions de l’État ?')
    if more:
        lines += ['', 'Pour aller plus loin :'] + [f'- {m}' for m in more[:2]]
    sources = [{'title': f'Recherche du SIREN {siren} sur le site', 'url': f'{S.SITE_URL}/recherche.html?q={siren}'},
               {'title': 'Aides et subventions', 'url': f'{S.SITE_URL}/aides.html'}]
    if org.get('fiche'):
        sources.append({'title': 'Annuaire des entreprises', 'url': org['fiche']})
    lines += ['', 'Sources : ' + ' ; '.join(f'[{x["title"]}]({x["url"]})' for x in sources)]
    return {'reply': '\n'.join(lines), 'sources': sources, 'beneficiaire': {'siren': siren, 'nom': name, 'total_eur': round(total)}}


def money(v: float) -> str:
    """31 156 € to the euro below a million (the published lines are exact), 1,76 M€ above."""
    v = v or 0
    if abs(v) < 1e6:
        return f'{round(v):,} €'.replace(',', '\u202f')
    return f'{v / 1e6:,.2f} M€'.replace('.', ',') if abs(v) < 1e9 else f'{v / 1e9:,.2f} Md€'.replace('.', ',')


def _date(iso: str) -> str:
    try:
        y, m, d = str(iso)[:10].split('-')
        return f'{int(d)} {"janvier février mars avril mai juin juillet août septembre octobre novembre décembre".split()[int(m) - 1]} {y}'
    except (ValueError, IndexError):
        return str(iso)


# Single words that name a topic, not a place, even when a commune starts with them (« culture » → Cultures)
TOPICS = set('''culture cultures sport sports recette recettes direction directions association associations dette dettes
budget budgets ecole ecoles sante social police securite transport transports eau dechets ordures voirie logement logements
emploi travail tourisme jeunesse education environnement energie agriculture assiciation oui non merci bonjour salut ok
taxe taxes impot impots salaire salaires president ministre depute senateur maire elus personnel subvention subventions
marche marches piscine stade cantine musee theatre hopital creche ministres deputes senateurs maires presidents prefets
les ministres les deputes les senateurs les maires les elus'''.split()) | {'les ministres', 'les deputes', 'les senateurs', 'les maires', 'les elus'}
REFERS = ('ca', 'cela', 'ceci', 'meme', 'aussi', 'pareil', 'idem', 'celle', 'celui', 'ceux', 'leur', 'leurs', 'il', 'elle',
          'ils', 'elles', 'precedent', 'precedente', 'dessus', 'cette', 'ces', 'son', 'sa', 'ses')


def standalone(text: str) -> bool:
    """A follow-up that can be read without the conversation (« Combien nous a coûté Bruno Le Maire ? »), not one that
    refers to it (« et la dette ? », « combien ça coûte par habitant ? »)."""
    words = places.norm(text).split()
    return len(words) >= 4 and words[0] not in ('et', 'mais', 'donc', 'alors', 'ok', 'oui', 'non') and not set(words) & set(REFERS)


def answer(messages: list) -> Optional[dict]:
    """Every answer given without a model, in this order: a SIREN, the accounts of a département, a region or an
    intercommunality, a question about one commune that intents.py understands entirely, a saved answer (faq.json), a
    public figure (personnes.py), a place alone. On a follow-up, the same, when the message stands alone or names a new
    commune for sure (« 94450 », « et Vallauris ? »). None: the model answers."""
    from . import faq, intents, personnes
    users = [m for m in messages if m.get('role') == 'user']
    first = len(users) == 1
    text = str(messages[-1].get('text') or '')
    res = _siren_or_level(text)
    if res:
        return res
    res = intents.answer(messages)
    if res:
        return res
    hit = faq.find(messages) if first else faq.find([{'role': 'user', 'text': text}], strict=True) if standalone(text) else None
    if hit:
        return faq.result(hit)
    res = personnes.answer(text)
    if res:
        return res
    if not first:
        return intents.follow_up(messages) or _follow_place(text)
    return _place_answer(text)


def _follow_place(text: str) -> Optional[dict]:
    """« Tarbes », « 94450 », « et Montbéliard ? », « la ville de Carquefou » in a conversation: the new commune's
    dossier, when the message is a place and nothing else and the place is certain."""
    m = intents.FOLLOW.match(' ' + text.strip()) if len(text) <= 80 else None
    name = (m.group(1) if m else text).strip()
    q = places.norm(name)
    if not q or re.fullmatch(r'\d{1,3}', q) or q in TOPICS or len(q) < 3:
        return None
    places.load(S.DATA_DIR / 'web' / 'communes-lookup.json')
    found = places.find(name)
    if found['type'] not in ('nom', 'code_postal', 'ancienne_commune', 'arrondissement'):
        return None
    return _place_answer(name)


def _siren_or_level(text: str) -> Optional[dict]:
    siren = siren_of(text)
    if siren:
        try:
            res = _beneficiary(siren)
        except Exception:  # noqa: BLE001 - any trouble: the model answers instead
            return None
        if not res:
            return None
        events = [{'type': 'tool_done', 'name': 'dossier_beneficiaire', 'label': f'Dossier du SIREN {siren}', 'ok': True,
                   'summary': 'lignes publiées par source', 's': 0}]
        return dict(res, searches=[], provider='faq', label='Réponse sourcée automatique', saved='siren', events=events)
    lv = level_of(text)
    if lv:
        try:
            res = _level(*lv)
        except Exception:  # noqa: BLE001 - any trouble: the model answers instead
            return None
        if not res:
            return None
        name = res['liens']['commune']
        events = [{'type': 'tool_done', 'name': 'comptes_collectivite', 'label': f'Comptes de « {name} »', 'ok': True,
                   'summary': 'dépenses, dette, population', 's': 0},
                  {'type': 'tool_done', 'name': 'comparer', 'label': f'Comparaison de « {name} »', 'ok': True,
                   'summary': 'médiane et rang', 's': 0}]
        return dict(res, searches=[], provider='faq', label='Réponse sourcée automatique', saved='lieu', events=events)
    return None


def _place_answer(text: str) -> Optional[dict]:
    q = place_of(text)
    if not q:
        return None
    if places.norm(q) in TOPICS:
        return None
    try:
        places.load(S.DATA_DIR / 'web' / 'communes-lookup.json')
        found = places.find(q)
        communes = found['communes']
        if found['type'] == 'dans_la_phrase':  # a place inside a longer question: the model reads the rest
            return None
        exact = [c for c in communes if c['correspondance'] in ('nom', 'code_postal')]
        if found['type'] == 'region':
            res = _level('regions', found['region']['nom'])
        elif found['type'] == 'departement' and not (exact and len(exact) == 1 and places.norm(exact[0]['nom']) == places.norm(q)):
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
