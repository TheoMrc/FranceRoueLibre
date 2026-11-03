"""The Loupe's shortcuts: each one answers in a single call what would otherwise take several reads of the data files,
so that the model reaches the right figure fast, with its year and its source.

* ``indicateur``: a catalog of key series (public spending by function, revenue, deficit, debt, GDP, ratios to GDP,
  population, prices, tax burden), each returned as {year: value};
* ``calcul``: arithmetic done by the server (share, change, per inhabitant, euros of another year), never by the model;
* ``comparer``: an entity against those of the same level and size (median, quartiles, rank, per inhabitant);
* ``dossier_beneficiaire``: everything paid to one organisation (subsidies, contracts, de minimis aid, Fonds vert),
  by SIREN or name, with its record in the national company directory;
* ``chercher_fiche``: keyword lookup in the big files (State budget programmes, tax expenditures, taxes, operators);
* ``page_du_site``: the exact section of the site to link to;
* ``jeux_ouverts``: datasets published on data.gouv.fr (before asking a public body for a document);
* ``suivi_demandes``: the requests already sent to public bodies and their replies.
"""
from __future__ import annotations

import ast
import json
import operator
import re
import statistics
import urllib.parse
from typing import Any, Dict, List, Optional

from . import settings as S
from .net import NetworkError, get_json

# tools.py imports this module lazily; the helpers below come from it
from . import tools as T


# =========================================================================================== indicateur
SYNONYMS = {
    'GF1002': 'retraite retraites pension pensions vieillesse',
    'GF10': 'protection sociale social prestations sociales',
    'GF07': 'sante hopital hopitaux medecine assurance maladie',
    'GF09': 'education enseignement ecole ecoles college lycee universite',
    'GF02': 'defense armee armees militaire',
    'GF03': 'police justice securite prisons pompiers ordre public',
    'GF0107': 'interets dette charge de la dette',
    'GF1005': 'chomage',
    'GF1004': 'famille familles enfants allocations familiales',
    'GF04': 'economie affaires economiques transports energie agriculture emploi',
    'GF05': 'environnement dechets pollution',
    'GF06': 'logement equipements collectifs eau',
    'GF08': 'culture sport loisirs cultes',
}


def _series_catalog() -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    f = T._json('national-functions.json')
    years = f['years']
    for code, label in f['functions'].items():
        if code in f['data']['TE']:
            name = 'Dépense publique totale' if code == 'TOTAL' else f'Dépense publique : {label}'
            out[f'fonction-{code}'] = {'label': name, 'unit': 'Md€', 'source': f['source'], 'url': f['url'],
                                       'words': f'{label} {SYNONYMS.get(code, "")} depense depenses',
                                       'values': dict(zip(years, f['data']['TE'][code]))}
    nat = {'D62': 'prestations sociales en argent', 'D1': 'rémunération des agents publics', 'P2': 'achats (consommations intermédiaires)',
           'D4': 'intérêts', 'P51G': 'investissement'}
    for code, label in nat.items():
        if code in f['data'] and 'TOTAL' in f['data'][code]:
            out[f'nature-{code}'] = {'label': f'Dépense publique par nature : {label}', 'unit': 'Md€', 'source': f['source'],
                                     'url': f['url'], 'words': label + (' salaires fonctionnaires' if code == 'D1' else ''),
                                     'values': dict(zip(years, f['data'][code]['TOTAL']))}
    a = T._json('national-accounts-3201.json')
    for key, label, words in (('spending', 'Dépenses des administrations publiques (comptes nationaux)', 'depense publique totale'),
                              ('revenue', 'Recettes des administrations publiques', 'recettes prelevements'),
                              ('balance', 'Solde public (déficit si négatif)', 'deficit solde')):
        out[f'apu-{key}'] = {'label': label, 'unit': a.get('unit', 'Md€'), 'source': a['source'], 'url': a['source'],
                             'words': words, 'values': {r['year']: r[key] for r in a['years'] if r.get(key) is not None}}
    d = T._json('national-debt.json')
    out['dette'] = {'label': 'Dette publique (au sens de Maastricht, fin d’année)', 'unit': d.get('unit', 'Md€'),
                    'source': d['source'], 'url': d['source'], 'words': 'dette publique endettement',
                    'values': {r['year']: r['debt'] for r in d['years'] if r.get('debt') is not None}}
    r = T._json('national-ratios-insee.json')
    for key, label in (('spending', 'dépense publique'), ('revenue', 'recettes publiques'), ('balance', 'déficit public'),
                       ('debt', 'dette publique')):
        out[f'ratio-{key}'] = {'label': f'{label.capitalize()} en % du PIB', 'unit': '% du PIB', 'source': r['source'],
                               'url': r['source'], 'words': f'{label} pourcentage pib ratio part',
                               'values': {x['year']: x[key] for x in r['years'] if x.get(key) is not None}}
    imp = T._json('impots.json')
    out['pib'] = {'label': 'Produit intérieur brut (PIB, richesse produite en un an)', 'unit': 'Md€',
                  'source': imp['insee']['source'], 'url': imp['insee']['source'], 'words': 'pib richesse produit interieur brut croissance',
                  'values': {x['year']: x['gdp'] for x in imp['macro'] if x.get('gdp')}}
    t = T._json('national-taxes-insee.json')
    out['prelevements'] = {'label': 'Taux de prélèvements obligatoires (impôts et cotisations en % du PIB)', 'unit': '% du PIB',
                           'source': t['source'], 'url': t['source'], 'words': 'prelevements obligatoires impots cotisations taux pression fiscale',
                           'values': {x['year']: x['levyRate'] for x in t['years'] if x.get('levyRate') is not None}}
    p = T._json('insee-population.json')
    out['population'] = {'label': 'Population de la France au 1er janvier', 'unit': 'habitants', 'source': p['source'],
                         'url': p['url'], 'words': 'population habitants francais',
                         'values': {x['year']: x['population'] for x in p['january1']}}
    c = T._json('insee-ipc.json')
    out['prix'] = {'label': 'Indice des prix à la consommation (base 100 en 2025)', 'unit': 'indice', 'source': c['source'],
                   'url': c['url'], 'words': 'prix inflation cout de la vie indice', 'values': dict(zip(c['years'], c['index']))}
    out['inflation'] = {'label': 'Inflation (hausse des prix sur un an)', 'unit': '%', 'source': c['source'], 'url': c['url'],
                        'words': 'inflation hausse des prix', 'values': {y: v for y, v in zip(c['years'], c['inflation']) if v is not None}}
    return out


_catalog: Optional[Dict[str, dict]] = None


def catalog() -> Dict[str, dict]:
    global _catalog
    if _catalog is None:
        _catalog = _series_catalog()
    return _catalog


def _score(query: str, item_id: str, item: dict) -> float:
    q = [w for w in T.words(query) if w not in ('de', 'la', 'le', 'les', 'des', 'du', 'en', 'et')]
    hay = ' '.join(T.words(item['label'] + ' ' + item['words'] + ' ' + item_id))
    score = sum(2 if re.search(rf'\b{re.escape(w)}', hay) else 0 for w in q)
    return score - .01 * len(hay.split())


def indicateur(nom: str, depuis: int = 0) -> dict:
    cat = catalog()
    key = str(nom or '').strip()
    if key not in cat:
        ranked = sorted(cat.items(), key=lambda kv: -_score(key, *kv))
        if not ranked or _score(key, *ranked[0]) <= 0:
            return {'error': 'aucun indicateur ne correspond', 'exemples': [f'{k} : {v["label"]}' for k, v in list(cat.items())[:25]]}
        key = ranked[0][0]
        others = [f'{k} : {v["label"]}' for k, v in ranked[1:6] if _score(nom, k, v) > 0]
    else:
        others = []
    item = cat[key]
    values = {str(y): v for y, v in sorted(item['values'].items()) if int(y) >= int(depuis or 0)}
    last = max(item['values'])
    return {'id': key, 'indicateur': item['label'], 'unite': item['unit'], 'dernier': {str(last): item['values'][last]},
            'valeurs': values, 'source': item['source'], 'lien': item['url'], 'autres_indicateurs_proches': others or None,
            'note': 'Montants en euros courants (de chaque année). Pour comparer des années, utiliser calcul (euros constants).'}


# =========================================================================================== calcul
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Pow: operator.pow, ast.USub: operator.neg, ast.UAdd: operator.pos}


def _eval(node):
    if isinstance(node, ast.Expression):
        return _eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        right = _eval(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise ValueError('exposant trop grand')
        return _OPS[type(node.op)](_eval(node.left), right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval(node.operand))
    raise ValueError('expression non permise (nombres, + - * / ** et parenthèses seulement)')


def _cpi() -> dict:
    c = T._json('insee-ipc.json')
    return dict(zip(c['years'], c['index']))


def calcul(operation: str, a: float = None, b: float = None, annee: int = None, vers: int = None, expression: str = '') -> dict:
    """part (a sur b) | evolution (de a à b) | par_habitant (a euros, b habitants) | euros_constants (a euros de
    l'année « annee » en euros de « vers ») | expression (arithmétique libre)."""
    op = str(operation or '').strip().lower()
    try:
        if op == 'expression' or (expression and not op):
            text = str(expression or '').replace(',', '.').replace('×', '*').replace(' ', '')
            if len(text) > 200:
                return {'error': 'expression trop longue'}
            return {'expression': expression, 'resultat': round(_eval(ast.parse(text, mode='eval')), 6)}
        a = float(a) if a is not None else None
        b = float(b) if b is not None else None
        if op == 'part':
            share = 100 * a / b
            return {'part_pct': round(share, 2), 'un_sur': round(100 / share, 1) if share else None,
                    'lecture': f'{a:g} représente {share:.1f} % de {b:g}, soit 1 sur {100 / share:.1f}'}
        if op == 'evolution':
            return {'evolution_pct': round(100 * (b / a - 1), 2), 'difference': round(b - a, 6), 'multiplie_par': round(b / a, 3)}
        if op == 'par_habitant':
            per = a / b
            return {'par_habitant_par_an': round(per, 2), 'par_mois': round(per / 12, 2),
                    'lecture': 'ce que chaque habitant, enfants compris, paierait si la somme était partagée à parts égales'}
        if op == 'euros_constants':
            cpi = _cpi()
            y0, y1 = int(annee), int(vers or max(cpi))
            if y0 not in cpi or y1 not in cpi:
                return {'error': f'années disponibles : {min(cpi)}-{max(cpi)}'}
            value = a * cpi[y1] / cpi[y0]
            return {'montant': a, 'annee': y0, 'en_euros_de': y1, 'resultat': round(value, 2),
                    'prix_evolution_pct': round(100 * (cpi[y1] / cpi[y0] - 1), 2),
                    'source': T._json('insee-ipc.json')['url']}
    except (TypeError, ValueError, ZeroDivisionError, SyntaxError, OverflowError) as exc:
        return {'error': f'calcul impossible : {exc}'}
    return {'error': 'operation : part, evolution, par_habitant, euros_constants ou expression'}


# =========================================================================================== comparer
BANDS = [0, 500, 2000, 3500, 5000, 10000, 20000, 50000, 100000, 10 ** 9]


def comparer(nom: str, agregat: str = 'depenses-totales', niveau: str = 'communes') -> dict:
    level = niveau if niveau in T.LEVELS else 'communes'
    ents = T._entities(level)
    q = T.norm(re.sub(r'(?i)^insee\s*:?\s*', '', str(nom or '').strip()))
    found = [i for i, (c, n, _) in enumerate(ents) if T.norm(c) == q or T.norm(n) == q] or \
            [i for i, (c, n, _) in enumerate(ents) if q and q in T.norm(n)]
    if not found:
        return {'error': f'« {nom} » introuvable parmi les {T.LEVELS[level].lower()}s'}
    if len(found) > 1:
        return {'plusieurs': [{'code': ents[i][0], 'nom': ents[i][1], 'lieu': ents[i][2]} for i in found[:15]]}
    i = found[0]
    index = T._json('local/index.json')['aggregates']
    if agregat not in index:
        hits = [k for k, v in index.items() if all(w in T.norm(v['label']) for w in T.words(agregat))]
        if not hits:
            return {'error': 'agrégat inconnu', 'agregats': {k: v['label'] for k, v in index.items()}}
        agregat = hits[0]
    data = T._json(f'local/{level}/{agregat}.json')
    pop = T._json(f'local/{level}/_pop.json')
    y = max(set(data['years']) & set(pop['years']))
    vals = data['values'][data['years'].index(y)]
    pops = pop['values'][pop['years'].index(y)]
    me_pop, me_val = pops[i], vals[i]
    if not me_pop or me_val is None:
        return {'error': f'pas de valeur {y} pour cette entité'}
    if level == 'communes':
        lo = max(b for b in BANDS if b <= me_pop)
        hi = min(b for b in BANDS if b > me_pop)
        peers = [j for j in range(len(ents)) if pops[j] and lo <= pops[j] < hi and vals[j] is not None]
        group = f'communes de {lo:,} à {hi - 1:,} habitants'.replace(',', ' ') if hi < 10 ** 9 else f'communes de plus de {lo:,} habitants'.replace(',', ' ')
    else:
        peers = [j for j in range(len(ents)) if pops[j] and vals[j] is not None]
        group = f'tous les {T.LEVELS[level].lower()}s'
    per = sorted(vals[j] / pops[j] for j in peers)
    mine = me_val / me_pop
    rank = sum(1 for v in per if v > mine) + 1
    q1, med, q3 = statistics.quantiles(per, n=4) if len(per) >= 4 else (min(per), statistics.median(per), max(per))
    return T.clip({'entite': {'code': ents[i][0], 'nom': ents[i][1], 'lieu': ents[i][2], 'population': me_pop},
                   'agregat': index[agregat]['label'], 'annee': y, 'montant_eur': round(me_val),
                   'par_habitant_eur': round(mine), 'groupe': group, 'nombre_dans_le_groupe': len(per),
                   'mediane_par_habitant_eur': round(med), 'quartiles_par_habitant_eur': [round(q1), round(q3)],
                   'rang': f'{rank}e sur {len(per)} (1er = le plus élevé par habitant)',
                   'ecart_a_la_mediane_pct': round(100 * (mine / med - 1), 1) if med else None,
                   'note': 'Comparer à la médiane des communes de même taille : une commune qui gère elle-même un service '
                           '(cantine, piscine, crèche) dépense plus qu’une commune qui le confie à son intercommunalité.',
                   'source': T._json('local/index.json').get('source')})


# =========================================================================================== dossier_beneficiaire
def _company(siren: str = '', q: str = '') -> Optional[dict]:
    params = {'q': siren or q, 'per_page': 3}
    try:
        status, res, _ = get_json('https://recherche-entreprises.api.gouv.fr/search?' + urllib.parse.urlencode(params), timeout=10)
    except NetworkError:
        return None
    if status != 200 or not res.get('results'):
        return None
    r = next((x for x in res['results'] if not siren or x.get('siren') == siren), res['results'][0])
    siege = r.get('siege') or {}
    return {'siren': r.get('siren'), 'nom': r.get('nom_complet'), 'etat': 'active' if r.get('etat_administratif') == 'A' else 'fermée',
            'creation': r.get('date_creation'), 'fermeture': r.get('date_fermeture'), 'nature_juridique': r.get('nature_juridique'),
            'activite': r.get('activite_principale'), 'commune_du_siege': siege.get('libelle_commune'),
            'tranche_effectif': r.get('tranche_effectif_salarie'),
            'fiche': f'https://annuaire-entreprises.data.gouv.fr/entreprise/{r.get("siren")}'}


def dossier_beneficiaire(nom: str) -> dict:
    q = str(nom or '').strip()
    siren = re.sub(r'\s', '', q)
    by_siren = bool(re.fullmatch(r'\d{9}', siren))
    if not by_siren:
        tokens = re.findall(r'[a-z0-9]+', T.norm(q))
        if not tokens:
            return {'error': 'nom vide'}
        match = 'who : "' + ' '.join(tokens) + '"'
    with T._sql_lock:
        try:
            db = T._sql_connection()
        except (OSError, Exception) as exc:  # noqa: BLE001
            return {'error': f'index de recherche indisponible : {exc}'}
        where, args = ('doc.siren = ?', [siren]) if by_siren else ('doc.id IN (SELECT rowid FROM fts WHERE fts MATCH ?)', [match])
        try:
            per = db.execute(f'SELECT src, year, COUNT(*), SUM(CASE WHEN fw = 0 THEN amount END), SUM(fw) FROM doc WHERE {where} '
                             f'GROUP BY src, year ORDER BY src, year', args).fetchall()
            names = db.execute(f'SELECT who, siren, COUNT(*) FROM doc WHERE {where} GROUP BY who, siren ORDER BY 3 DESC LIMIT 8', args).fetchall()
            top = db.execute(f'SELECT src, year, amount, title, who, extra, dept FROM doc WHERE {where} AND fw = 0 '
                             f'ORDER BY amount DESC LIMIT 10', args).fetchall()
        except Exception as exc:  # noqa: BLE001
            return {'error': f'recherche impossible : {str(exc)[:150]}'}
    if not per:
        return {'lignes': 0, 'note': 'Aucune ligne publiée pour ce nom ou ce SIREN. Essayer le SIREN (annuaire-entreprises.data.gouv.fr) '
                                     'ou un nom plus court.', 'entreprise': _company(q=q) if not by_siren else _company(siren=siren)}
    sources: Dict[str, dict] = {}
    for src, year, n, amount, fw in per:
        s = sources.setdefault(T.SRC.get(src, str(src)), {'lignes': 0, 'montant_eur': 0, 'par_annee_eur': {}, 'accords_cadres_lignes': 0})
        s['lignes'] += n
        s['montant_eur'] += round(amount or 0)
        s['accords_cadres_lignes'] += fw or 0
        if amount:
            s['par_annee_eur'][year] = round(amount)
    sirens = sorted({s for _, s, _ in names if s})
    return T.clip({'recherche': q, 'par_source': sources,
                   'noms_trouves': [{'nom': w, 'siren': s, 'lignes': n} for w, s, n in names],
                   'plus_grosses_lignes': [{'source': T.SRC.get(s), 'annee': y, 'montant_eur': round(a or 0), 'objet': (t or '')[:160],
                                            'beneficiaire_ou_acheteur': w, 'programme_ou_famille': e, 'dept': d} for s, y, a, t, w, e, d in top],
                   'entreprise': _company(siren=siren if by_siren else (sirens[0] if len(sirens) == 1 else ''), q=q),
                   'note': 'Montants publiés par source (subventions de l’État, marchés publics comme titulaire ou acheteur, '
                           'aides de minimis, Fonds vert). Les accords-cadres (plafonds) ne sont pas additionnés. Un nom peut '
                           'désigner plusieurs organismes : vérifier le SIREN.',
                   'page': f'{S.SITE_URL}/recherche.html?q={urllib.parse.quote(q)}'})


# =========================================================================================== chercher_fiche
def _records(jeu: str) -> List[dict]:
    if jeu == 'etat':
        e = T._json('etat.json')
        out = []
        for m in e['missions']:
            out.append({'type': 'mission', 'budget': e['budgets'].get(m['type'], m['type']), 'mission': m['name'],
                        'autorisations_engagement_meur': m['ae'], 'credits_paiement_meur': m['cp']})
            for p in m.get('progs', []):
                out.append({'type': 'programme', 'mission': m['name'], 'programme': f'{p["code"]} {p["name"]}', 'ministere': p.get('min'),
                            'autorisations_engagement_meur': p['ae'], 'credits_paiement_meur': p['cp'],
                            'actions': [a.get('name') for a in p.get('actions', [])][:12]})
        return out
    if jeu == 'niches':
        n = T._json('niches.json')
        return [{'id': m['id'], 'mesure': m['l'], 'impot': m['i'], 'mission': m['m'], 'finalite': m.get('fin'),
                 'cout_meur': dict(zip(map(str, n['years']), m['v'])), 'statut': m.get('st')} for m in n['measures']]
    if jeu == 'impots':
        return [{k: v for k, v in t.items() if k in ('id', 'name', 'amount', 'year', 'status', 'beneficiary', 'beneficiaryDetail',
                                                     'collector', 'payer', 'created', 'base', 'state', 'note')}
                for t in T._json('impots.json')['all']]
    if jeu == 'operateurs':
        return [{k: v for k, v in o.items() if not isinstance(v, (dict, list)) and v is not None}
                for o in T._json('operateurs.json')['operators']]
    return []


UNITS = {'etat': 'montants en millions d’euros, projet de loi de finances 2025', 'niches': 'coûts en millions d’euros par année',
         'impots': 'rendement en millions d’euros', 'operateurs': 'subventions pour charges de service public en euros'}


PRIMARY = ('name', 'full', 'acronym', 'short', 'mesure', 'programme', 'mission')


def chercher_fiche(jeu: str, mots: str) -> dict:
    jeu = str(jeu or '').strip().lower()
    recs = _records(jeu)
    if not recs:
        return {'error': 'jeu : etat (missions et programmes du budget de l’État), niches, impots ou operateurs'}
    wanted = [w for w in T.words(mots) if len(w) > 2]
    if not wanted:
        return {'error': 'mots vides'}
    phrase = ' '.join(T.words(mots))
    scored = []
    for r in recs:
        text = ' '.join(T.words(json.dumps(r, ensure_ascii=False)))
        main = ' '.join(T.words(' '.join(str(r.get(k) or '') for k in PRIMARY)))
        hits = sum(1 for w in wanted if re.search(rf'\b{re.escape(w)}', text))
        if hits:
            strong = sum(1 for w in wanted if re.search(rf'\b{re.escape(w)}', main))
            scored.append((hits + 2 * strong + (6 if phrase and phrase in main else 0), r))
    scored.sort(key=lambda x: -x[0])
    best = [r for h, r in scored if h == scored[0][0]] if scored else []
    return T.clip({'jeu': jeu, 'unite': UNITS[jeu], 'trouves': len(scored), 'resultats': (best or [r for _, r in scored])[:12],
                   'page': f'{S.SITE_URL}/{ {"etat": "etat.html", "niches": "niches.html", "impots": "impots.html", "operateurs": "operateurs.html"}[jeu] }'})


# =========================================================================================== page_du_site
def page_du_site(mots: str) -> dict:
    entries = T._json('site-index.json')['entries']
    wanted = [w for w in T.words(mots) if len(w) > 2]
    scored = []
    for e in entries:
        text = ' '.join(T.words(' '.join(str(e.get(k) or '') for k in ('page', 'title', 'eyebrow', 'text', 'keywords'))))
        hits = sum(1 for w in wanted if re.search(rf'\b{re.escape(w)}', text))
        if hits:
            scored.append((hits + (.5 if e.get('section') else 0), e))
    scored.sort(key=lambda x: -x[0])
    return {'sections': [{'titre': e['title'], 'page': e['page'], 'lien': f'{S.SITE_URL}/{e["url"]}', 'resume': (e.get('text') or '')[:200]}
                         for _, e in scored[:6]] or 'aucune section ne correspond'}


# =========================================================================================== jeux_ouverts
def jeux_ouverts(mots: str) -> dict:
    q = str(mots or '').strip()[:150]
    if not q:
        return {'error': 'mots vides'}
    try:
        status, res, _ = get_json('https://www.data.gouv.fr/api/1/datasets/?' + urllib.parse.urlencode({'q': q, 'page_size': 8}), timeout=15)
    except NetworkError as exc:
        return {'error': f'data.gouv.fr injoignable ({exc})'}
    if status != 200:
        return {'error': f'data.gouv.fr : HTTP {status}'}
    out = []
    for d in res.get('data', []):
        org = d.get('organization') or {}
        out.append({'titre': d.get('title'), 'producteur': org.get('name'), 'mis_a_jour': (d.get('last_update') or '')[:10],
                    'formats': sorted({(r.get('format') or '').lower() for r in d.get('resources', []) if r.get('format')})[:6],
                    'lien': d.get('page')})
    return {'jeux': out or 'aucun jeu trouvé', 'note': 'Avant de préparer une demande à un organisme, vérifier ici que le '
                                                     'document n’est pas déjà publié.'}


# =========================================================================================== suivi_demandes
def suivi_demandes(recherche: str = '') -> dict:
    from . import demandes
    q = T.norm(str(recherche or '').strip())
    rows = []
    for d in demandes.all_requests():
        if d['status'] in ('brouillon', 'refusee'):
            continue
        if q and q not in T.norm(d['ref'] + ' ' + d['to']['nom'] + ' ' + d['fields']['objet'] + ' ' + d['fields']['documents']):
            continue
        v = demandes.public_view(d) if d['status'] != 'a_valider' else {'ref': d['ref'], 'status': 'en relecture avant envoi',
                                                                         'organisme': d['to']['nom'], 'objet': d['fields']['objet']}
        rows.append(v)
    return {'demandes': rows[-15:] or 'aucune demande ne correspond', 'page': f'{S.SITE_URL}/{demandes.PAGE}'}
