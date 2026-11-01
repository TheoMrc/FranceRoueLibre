"""The assistant's toolbox. Read-only by construction:

* ``rechercher_depenses``: the site's full-text search (server/search_api.py, local HTTP), summarised;
* ``requete_sql``: one SELECT on the search index, opened read-only and immutable, under an authorizer that refuses
  anything but reading (no PRAGMA, ATTACH, writes or temp tables), interrupted after 5 seconds, 100 rows at most;
* ``comptes_collectivite``: accounts of a commune, intercommunalité, département or région (OFGL, dist/data/local);
* ``lire_donnees``: browse one of the JSON files published with the site (dist/data), never a path outside it;
* ``recherche_web``: a web search run by the model provider (see providers.py).

Tool results are data for the model, capped in size; the system prompt tells it never to follow instructions found
in them.
"""
from __future__ import annotations

import functools
import json
import re
import sqlite3
import sys
import threading
import time
import unicodedata
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import settings as S
from .net import NetworkError, get_json

MAX_RESULT_CHARS = 14000

SRC = {1: 'Subventions aux associations', 2: 'Marchés publics', 3: 'Projets aidés par l’État (DGCL)', 4: 'Fonds vert',
       5: 'Aides aux entreprises (de minimis)', 6: 'Budget de l’État (PLF 2026)'}

DECLARATIONS: List[dict] = [
    {'name': 'rechercher_depenses',
     'description': 'Cherche un mot ou une expression dans les 1,9 million de lignes de dépenses publiées (objet des '
                    'subventions aux associations 2010-2023, des marchés publics 2014-2026, projets DGCL, Fonds vert, '
                    'aides de minimis, intitulés du budget de l’État). Renvoie le nombre de lignes, les montants par '
                    'source et par année, les principaux bénéficiaires, programmes, départements et les plus grosses '
                    'lignes. Recherche plein texte sans accents ; le dernier mot est pris avec ses terminaisons.',
     'parameters': {'type': 'OBJECT', 'properties': {
         'requete': {'type': 'STRING', 'description': 'Mots à chercher, ex. « vidéoprotection » ou « mise en place »'}},
         'required': ['requete']}},
    {'name': 'requete_sql',
     'description': 'Une requête SQLite SELECT en lecture seule sur l’index de recherche, pour des calculs que '
                    'rechercher_depenses ne fait pas (somme par bénéficiaire, par année, filtre par département ou '
                    'SIREN...). Tables : doc(id, src, year, amount, fw, title, who, siren, extra, dept) une ligne par '
                    'dépense publiée ; fts(title, who, extra) index FTS5 de doc (rowid = doc.id ; WHERE fts MATCH '
                    '\'mot1 + mot2*\' ; JOIN doc ON doc.id = fts.rowid) ; who(id, name, siren) ; extra(id, label). '
                    'src : 1 subventions aux associations, 2 marchés publics, 3 projets DGCL, 4 Fonds vert, 5 aides '
                    'de minimis, 6 budget de l’État PLF 2026. fw = 1 : accord-cadre (montant = plafond, PAS une '
                    'dépense, ne jamais l’additionner aux dépenses). dept : code du département. amount en euros. '
                    '100 lignes au plus, 5 secondes au plus : agréger avec GROUP BY et LIMIT.',
     'parameters': {'type': 'OBJECT', 'properties': {'sql': {'type': 'STRING'}}, 'required': ['sql']}},
    {'name': 'comptes_collectivite',
     'description': 'Comptes d’une collectivité (OFGL, budgets principaux et annexes consolidés) année par année : '
                    'communes et intercommunalités 2018-2025, départements et régions 2012-2025. Donne aussi la '
                    'population et les montants par habitant. Sans « agregats », renvoie les principaux postes.',
     'parameters': {'type': 'OBJECT', 'properties': {
         'nom': {'type': 'STRING', 'description': 'Nom ou code (code Insee de commune, SIREN d’intercommunalité, '
                                                  'numéro de département, code de région)'},
         'niveau': {'type': 'STRING', 'enum': ['communes', 'gfp', 'departements', 'regions'],
                    'description': 'gfp = intercommunalités. Par défaut : communes'},
         'agregats': {'type': 'STRING', 'description': 'Identifiants séparés par des virgules (voir « liste » '
                                                       'dans une première réponse), facultatif'}},
         'required': ['nom']}},
    {'name': 'lire_donnees',
     'description': 'Lit un fichier JSON publié par le site (liste dans le prompt système). « chemin » descend dans le '
                    'fichier (clés et indices séparés par des points, ex. « measures » ou « totals.0 ») ; « filtre » '
                    'garde les éléments d’une liste qui contiennent ce texte (sans accents) ; « debut » et « limite » '
                    'paginent (limite 40 au plus). Sans chemin : la structure du fichier.',
     'parameters': {'type': 'OBJECT', 'properties': {
         'fichier': {'type': 'STRING'}, 'chemin': {'type': 'STRING'}, 'filtre': {'type': 'STRING'},
         'debut': {'type': 'INTEGER'}, 'limite': {'type': 'INTEGER'}}, 'required': ['fichier']}},
    {'name': 'recherche_web',
     'description': 'Recherche sur le web (actualité, textes de loi, rapports, contexte absent des données du site). '
                    'Renvoie une synthèse et ses sources. À utiliser quand les données du site ne suffisent pas ; '
                    'une question précise par appel.',
     'parameters': {'type': 'OBJECT', 'properties': {'question': {'type': 'STRING'}}, 'required': ['question']}},
]

# Published JSON files the model may read with lire_donnees (path relative to dist/data -> what it holds).
FILES = {
    'catalog.json': 'Les sources du site (producteur, période, lien) et les angles morts (données non publiées)',
    'impots.json': 'Les 292 impôts et taxes : rendement, assiette, payeur, affectataire, collecteur, avis de la Cour '
                   'des comptes (« all »), série Insee 1995-2025 (« insee »), coûts de collecte (« costs »)',
    'niches.json': 'Les 458 dépenses fiscales (niches) : coût 2024-2026 par mesure (« measures »), par impôt, par mission',
    'etat.json': 'Budget de l’État : PLF 2025 par mission, programme, action ; exécution mensuelle ; performance ; budget vert',
    'operateurs.json': 'Les 431 opérateurs de l’État : mission, statut, subventions pour charges de service public, taxes affectées',
    'secu.json': 'Sécurité sociale : comptes par branche, dépenses d’assurance maladie par région',
    'probite.json': 'Atteintes à la probité jugées 2021-2025 : affaires, infractions, peines',
    'ugap.json': 'Étude des prix du catalogue UGAP comparés au commerce',
    'national-accounts-3201.json': 'Recettes et dépenses de l’ensemble des administrations publiques 1960-2025 (Insee 3.201, Md€)',
    'national-debt.json': 'Dette publique et passage du déficit à la dette (Insee 3.101 et 3.105)',
    'national-sectors-3215.json': 'Comptes par sous-secteur (État, organismes divers, administrations locales, sécurité sociale)',
    'national-functions.json': 'Dépenses publiques par fonction (COFOG, Eurostat 1995-2024) et par nature',
    'national-ratios-insee.json': 'Ratios de finances publiques (% du PIB) 1959-2025',
    'national-taxes-insee.json': 'Prélèvements obligatoires par catégorie (Insee)',
    'insee-population.json': 'Population de la France au 1er janvier',
    'budgets-2025.json': 'Dépenses totales 2025 et par habitant de chaque commune, département et région',
    'aides/associations.json': 'Subventions de l’État aux associations par année et programme (jaunes 2010-2023)',
    'aides/entreprises.json': 'Aides de minimis aux entreprises : par autorité, instrument, secteur, plus gros bénéficiaires',
    'aides/fonds-vert.json': 'Fonds vert : par année, mesure, département, plus gros projets',
    'aides/relance.json': 'Plan France Relance : indicateurs, montants, lauréats',
    'marches/summary.json': 'Marchés publics : volumes par année, procédure, nature, qualité des données',
    'marches/buyers.json': 'Les 3 000 plus gros acheteurs publics',
    'marches/cpv.json': 'Achats publics par type de produit (codes CPV) et par année',
    'marches/cpv-top.json': 'Plus gros contrats par famille de produits (CPV)',
    'marches/energie.json': 'Énergies renouvelables : marchés publics, budget vert, Fonds vert',
    'marches/signals.json': 'Signaux sur les marchés : offre unique, sans concurrence, avenants, seuils, fractionnement',
    'local/signals.json': 'Signaux sur les collectivités : épargne négative, désendettement, frais de personnel, retards de paiement',
    'local/index.json': 'Liste des agrégats OFGL et totaux nationaux par niveau de collectivité',
}


def norm(text: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', str(text).lower()) if unicodedata.category(c) != 'Mn')


def words(text: str) -> List[str]:
    return [w for w in re.findall(r'[a-z0-9]+', norm(text)) if len(w) >= 2]


def clip(value: Any, limit: int = MAX_RESULT_CHARS) -> Any:
    """Keeps a result under ``limit`` characters of JSON (lists are shortened, with a note)."""
    text = json.dumps(value, ensure_ascii=False, default=str)
    if len(text) <= limit:
        return value
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            out[k] = clip(v, max(400, limit // max(1, len(value))))
        return out
    if isinstance(value, list):
        keep, used = [], 0
        for item in value:
            size = len(json.dumps(item, ensure_ascii=False, default=str)) + 2  # with the separator
            if used + size > limit:
                break
            keep.append(item)
            used += size
        return keep + [f'… {len(value) - len(keep)} élément(s) de plus non affichés']
    return text[:limit] + '…'


# =========================================================================================== rechercher_depenses
def _search_inprocess(q: str) -> dict:
    """Same search as the HTTP API, when it is not running (local use): imports server/search_api.py."""
    here = str(Path(__file__).resolve().parents[1])
    if here not in sys.path:
        sys.path.insert(0, here)
    import search_api  # noqa: E402
    if search_api.DB_PATH is None:
        if not S.SEARCH_DB.is_file():
            raise FileNotFoundError('index de recherche absent (assistant.bat le reconstitue)')
        search_api.DB_PATH = str(S.SEARCH_DB)
    match = search_api.fts_query(q, q.rstrip().endswith('*'))
    if not match:
        return {'lines': 0}
    with search_api.LOCK:
        return dict(search_api.search(match))


def rechercher_depenses(requete: str) -> dict:
    q = str(requete or '').strip()[:200]
    if not q:
        return {'error': 'requête vide'}
    try:
        status, res, _ = get_json(f'{S.SEARCH_API}/api/search?q={urllib.parse.quote(q)}', timeout=25)
        if status != 200:
            return {'error': f'recherche impossible ({res.get("error") or status})'}
    except NetworkError:
        try:
            res = _search_inprocess(q)
        except Exception as exc:  # noqa: BLE001
            return {'error': f'recherche indisponible : {exc}'}
    if not res.get('lines'):
        return {'lignes': 0, 'note': 'Aucune ligne publiée ne contient ces mots. Essayer un synonyme ou un mot plus court.'}
    by_src: Dict[int, dict] = {}
    by_year: Dict[int, float] = {}
    for s in res.get('stats', []):
        d = by_src.setdefault(s['src'], {'source': SRC.get(s['src'], s['src']), 'lignes': 0, 'montant_eur': 0.0,
                                         'accords_cadres_lignes': 0, 'accords_cadres_plafonds_eur': 0.0})
        if s.get('fw'):
            d['accords_cadres_lignes'] += s['n']
            d['accords_cadres_plafonds_eur'] += s['amount'] or 0
        else:
            d['lignes'] += s['n']
            d['montant_eur'] += s['amount'] or 0
            if s['src'] != 6:
                by_year[s['year']] = by_year.get(s['year'], 0) + (s['amount'] or 0)
    top = [{'source': SRC.get(t['src']), 'annee': t['year'], 'montant_eur': t['amount'], 'objet': (t['title'] or '')[:180],
            'beneficiaire': t['who'], 'siren': t['siren'], 'programme_ou_famille': t['extra'], 'dept': t['dept']}
           for t in res.get('top', [])[:15]]
    return clip({
        'lignes': res['lines'],
        'par_source': [{k: (round(v) if isinstance(v, float) else v) for k, v in d.items()} for d in by_src.values()],
        'depenses_par_annee_eur': {y: round(v) for y, v in sorted(by_year.items())},
        'beneficiaires_ou_acheteurs': [{'nom': w['label'], 'siren': w['siren'], 'source': SRC.get(w['src']),
                                       'lignes': w['n'], 'montant_eur': round(w['value'])} for w in res.get('who', [])[:12]],
        'programmes_ou_familles': [{'libelle': e['label'], 'source': SRC.get(e['src']), 'lignes': e['n'],
                                    'montant_eur': round(e['value'])} for e in res.get('extra', [])[:8]],
        'departements': [{'dept': d['key'], 'source': SRC.get(d['src']), 'montant_eur': round(d['value'])}
                         for d in res.get('depts', [])[:8]],
        'plus_grosses_lignes': top,
        'page': f'{S.SITE_URL}/recherche.html?q={urllib.parse.quote(q)}',
        'note': 'Un mot trouvé dans un libellé ne veut pas dire que tout le montant y est consacré. Les accords-cadres '
                'sont des plafonds, pas des dépenses : ils sont comptés à part.',
    })


# =========================================================================================== requete_sql
_sql_lock = threading.Lock()
_sql_db: Optional[sqlite3.Connection] = None
_READ_ACTIONS = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION}
if hasattr(sqlite3, 'SQLITE_RECURSIVE'):
    _READ_ACTIONS.add(sqlite3.SQLITE_RECURSIVE)
_BLOCKED_FUNCTIONS = {'load_extension', 'readfile', 'writefile', 'edit', 'fts5_source_id'}


def _authorizer(action, arg1, arg2, dbname, source):
    if action == sqlite3.SQLITE_PRAGMA:  # FTS5 reads data_version internally; every other PRAGMA is refused
        return sqlite3.SQLITE_OK if arg1 == 'data_version' and arg2 is None else sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_UPDATE and arg1 == 'sqlite_master':
        return sqlite3.SQLITE_OK  # some SQLite versions check this while building the FTS5 table (read-only file anyway)
    if action == sqlite3.SQLITE_FUNCTION and str(arg2 or arg1 or '').lower() in _BLOCKED_FUNCTIONS:
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_READ and dbname not in ('main', None):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK if action in _READ_ACTIONS else sqlite3.SQLITE_DENY


def _sql_connection() -> sqlite3.Connection:
    global _sql_db
    if _sql_db is None:
        if not S.SEARCH_DB.is_file():
            raise FileNotFoundError('index de recherche absent')
        uri = 'file:' + urllib.parse.quote(S.SEARCH_DB.resolve().as_posix()) + '?mode=ro&immutable=1'
        db = sqlite3.connect(uri, uri=True, check_same_thread=False)
        db.execute('PRAGMA cache_size = -16384')  # before the authorizer, which refuses every PRAGMA
        db.set_authorizer(_authorizer)
        _sql_db = db
    return _sql_db


def requete_sql(sql: str) -> dict:
    sql = str(sql or '').strip().rstrip(';').strip()
    if not re.match(r'(?is)^(select|with)\b', sql):
        return {'error': 'seules les requêtes SELECT (ou WITH ... SELECT) sont permises'}
    if len(sql) > 3000:
        return {'error': 'requête trop longue'}
    with _sql_lock:
        try:
            db = _sql_connection()
        except (OSError, sqlite3.Error) as exc:
            return {'error': f'base indisponible : {exc}'}
        started = time.monotonic()
        db.set_progress_handler(lambda: 1 if time.monotonic() - started > 5 else 0, 10000)
        try:
            cur = db.execute(sql)
            cols = [d[0] for d in cur.description or []]
            rows = cur.fetchmany(101)
        except (sqlite3.Error, sqlite3.Warning) as exc:  # Warning: several statements
            msg = str(exc)
            return {'error': 'requête interrompue après 5 s : ajouter un filtre ou un LIMIT' if 'interrupt' in msg
                    else f'erreur SQL : {msg[:200]}'}
        finally:
            db.set_progress_handler(None, 0)
    cut = len(rows) > 100
    rows = [[(v[:200] + '…') if isinstance(v, str) and len(v) > 200 else v for v in r] for r in rows[:100]]
    return clip({'colonnes': cols, 'lignes': rows, 'tronque': cut, 'ms': round(1000 * (time.monotonic() - started))})


# =========================================================================================== comptes_collectivite
LEVELS = {'communes': 'Commune', 'gfp': 'Intercommunalité', 'departements': 'Département', 'regions': 'Région'}
DEFAULT_AGGREGATES = ['depenses-totales', 'depenses-de-fonctionnement', 'frais-de-personnel', 'achats-et-charges-externes',
                      'depenses-d-equipement', 'recettes-totales', 'impots-locaux', 'dotation-globale-de-fonctionnement',
                      'epargne-brute', 'encours-de-dette']


@functools.lru_cache(maxsize=None)
def _json(rel: str) -> Any:
    path = (S.DATA_DIR / rel).resolve()
    if S.DATA_DIR.resolve() not in path.parents:
        raise ValueError('chemin hors des données du site')
    with path.open(encoding='utf-8') as f:
        return json.load(f)


@functools.lru_cache(maxsize=4)
def _entities(level: str) -> List[tuple]:
    """(code, name, extra) of every entity of a level, in the order of the value arrays."""
    if level == 'communes':
        meta = _json('web/communes-meta.json')
        names = {k: v[0] for k, v in meta['departments'].items()}
        return [(r[0], r[1], f'{names.get(r[2], r[2])} ({r[2]})') for r in meta['rows']]
    e = _json(f'local/{level}/_entities.json')
    return [(c, n, '') for c, n in zip(e['codes'], e['names'])]


def comptes_collectivite(nom: str, niveau: str = 'communes', agregats: str = '') -> dict:
    level = niveau if niveau in LEVELS else 'communes'
    q = norm(str(nom or '').strip())
    if not q:
        return {'error': 'nom vide'}
    ents = _entities(level)
    exact = [i for i, (c, n, _) in enumerate(ents) if norm(c) == q or norm(n) == q]
    found = exact or [i for i, (c, n, _) in enumerate(ents) if q in norm(n)]
    if not found:
        return {'error': f'aucune entité « {nom} » parmi les {LEVELS[level].lower()}s ; essayer un autre niveau ou le code'}
    if len(found) > 1:
        return {'plusieurs': [{'code': ents[i][0], 'nom': ents[i][1], 'lieu': ents[i][2]} for i in found[:15]],
                'note': 'Plusieurs entités correspondent : rappeler l’outil avec le code.'}
    i = found[0]
    index = _json('local/index.json')
    available = [k for k, v in index['aggregates'].items() if (S.DATA_DIR / 'local' / level / f'{k}.json').is_file()]
    wanted = [a.strip() for a in str(agregats or '').split(',') if a.strip()] or [a for a in DEFAULT_AGGREGATES if a in available]
    pop = _json(f'local/{level}/_pop.json')
    population = {y: vals[i] for y, vals in zip(pop['years'], pop['values']) if vals[i]}
    rows, unknown = {}, []
    for a in wanted[:12]:
        if a not in available:
            unknown.append(a)
            continue
        data = _json(f'local/{level}/{a}.json')
        rows[index['aggregates'][a]['label']] = {y: vals[i] for y, vals in zip(data['years'], data['values'])
                                                 if vals[i] is not None}
    last = max(population) if population else None
    per_head = ({label: round(v[last] / population[last]) for label, v in rows.items() if last in v and population[last]}
                if last else {})
    return clip({'entite': {'code': ents[i][0], 'nom': ents[i][1], 'niveau': LEVELS[level], 'lieu': ents[i][2]},
                 'population': population, 'montants_eur': rows, f'par_habitant_eur_{last}': per_head,
                 'inconnus': unknown or None,
                 'liste': None if agregats else {k: index['aggregates'][k]['label'] for k in available},
                 'source': index.get('source'), 'page': f'{S.SITE_URL}/index.html#explorer'})


# =========================================================================================== lire_donnees
def _describe(value: Any, depth: int = 0) -> Any:
    if isinstance(value, dict):
        if depth >= 1:
            return f'objet de {len(value)} clés : {", ".join(list(map(str, value))[:12])}{"…" if len(value) > 12 else ""}'
        return {k: _describe(v, depth + 1) for k, v in list(value.items())[:40]}
    if isinstance(value, list):
        first = json.dumps(value[0], ensure_ascii=False, default=str)[:300] if value else ''
        return f'liste de {len(value)} éléments' + (f', le premier : {first}' if first else '')
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) < 200 else text[:200] + '…'


def lire_donnees(fichier: str, chemin: str = '', filtre: str = '', debut: int = 0, limite: int = 20) -> dict:
    rel = str(fichier or '').strip().replace('\\', '/').lstrip('/')
    if rel.startswith('data/'):
        rel = rel[5:]
    if rel not in FILES:
        return {'error': f'fichier inconnu ; fichiers lisibles : {", ".join(FILES)}'}
    try:
        node = _json(rel)
    except (OSError, ValueError) as exc:
        return {'error': f'lecture impossible : {exc}'}
    walked = []
    for key in [k for k in str(chemin or '').split('.') if k]:
        if isinstance(node, dict) and key in node:
            node = node[key]
        elif isinstance(node, list) and key.lstrip('-').isdigit() and -len(node) <= int(key) < len(node):
            node = node[int(key)]
        else:
            return {'error': f'« {key} » introuvable après « {".".join(walked) or "racine"} »',
                    'cles_disponibles': list(node)[:60] if isinstance(node, dict) else f'liste de {len(node)}'
                    if isinstance(node, list) else None}
        walked.append(key)
    if isinstance(node, list):
        items = list(enumerate(node))
        if filtre:  # every word of the filter, accents and punctuation ignored
            wanted = words(filtre)
            items = [(j, v) for j, v in items
                     if all(w in ' '.join(words(json.dumps(v, ensure_ascii=False, default=str))) for w in wanted)]
        start, size = max(0, int(debut or 0)), max(1, min(40, int(limite or 20)))
        return clip({'fichier': rel, 'chemin': '.'.join(walked), 'total': len(node), 'retenus': len(items),
                     'elements': [{'indice': j, 'valeur': v} for j, v in items[start:start + size]],
                     'suite': start + size < len(items)})
    if isinstance(node, dict) and not walked:
        return clip({'fichier': rel, 'description': FILES[rel], 'structure': _describe(node)})
    if isinstance(node, dict) and len(json.dumps(node, ensure_ascii=False, default=str)) > MAX_RESULT_CHARS:
        return clip({'fichier': rel, 'chemin': '.'.join(walked), 'structure': _describe(node)})
    return clip({'fichier': rel, 'chemin': '.'.join(walked), 'valeur': node})


# =========================================================================================== dispatch
class Toolbox:
    def __init__(self, client):
        self.client = client
        self.sources: List[dict] = []  # web pages cited by the searches, shown under the answer
        self.queries: List[str] = []   # Google searches made by Gemini (Google asks to show them as search suggestions)

    def call(self, name: str, args: dict) -> dict:
        args = args if isinstance(args, dict) else {}
        try:
            if name == 'rechercher_depenses':
                return rechercher_depenses(args.get('requete', ''))
            if name == 'requete_sql':
                return requete_sql(args.get('sql', ''))
            if name == 'comptes_collectivite':
                return comptes_collectivite(args.get('nom', ''), args.get('niveau') or 'communes', args.get('agregats') or '')
            if name == 'lire_donnees':
                return lire_donnees(args.get('fichier', ''), args.get('chemin') or '', args.get('filtre') or '',
                                    args.get('debut') or 0, args.get('limite') or 20)
            if name == 'recherche_web':
                question = str(args.get('question') or '').strip()[:400]
                if not question:
                    return {'error': 'question vide'}
                res = self.client.web_search(question)
                for s in res.get('sources', []):
                    if s['url'] not in {x['url'] for x in self.sources}:
                        self.sources.append(s)
                self.queries += [q for q in res.pop('requetes', []) if q not in self.queries][:6]
                return clip(res)
        except Exception as exc:  # noqa: BLE001 - the model gets the error and can try something else
            from .budget import BudgetError
            from .providers import ModelError
            if isinstance(exc, (BudgetError, ModelError)):
                raise
            return {'error': f'{type(exc).__name__} : {str(exc)[:200]}'}
        return {'error': f'outil inconnu : {name}'}
