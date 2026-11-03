"""The assistant's toolbox. Read-only by construction:

* ``rechercher_depenses``: the site's full-text search (server/search_api.py, local HTTP), summarised;
* ``requete_sql``: one SELECT on the search index, opened read-only and immutable, under an authorizer that refuses
  anything but reading (no PRAGMA, ATTACH, writes or temp tables), interrupted after 5 seconds, 100 rows at most;
* ``comptes_collectivite``: accounts of a commune, intercommunalité, département or région (OFGL, dist/data/local);
* ``dossier_commune``: everything the site has on one commune (accounts, State-aided projects, elected officials,
  signals, lines of the search index that name it in its département);
* ``lire_donnees``: browse one of the JSON files published with the site (dist/data), never a path outside it;
* the shortcuts of outils.py (indicateur, calcul, comparer, dossier_beneficiaire, chercher_fiche, page_du_site,
  jeux_ouverts, suivi_demandes) and ``dossier_collectivite`` (dossier_commune or comptes_collectivite);
* ``recherche_web``: a web search run by the model provider (see providers.py);
* ``preparer_demande``: a request for administrative documents to the body that holds them (see demandes.py), shown
  to the reader under the answer, never sent without the reader's click.

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
     'description': 'Cherche un mot ou une expression dans les 2,1 millions de lignes de dépenses publiées (objet des '
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
    {'name': 'dossier_collectivite',
     'description': 'Tout ce que le site a sur une collectivité, en un appel. Commune : comptes OFGL 2018-2025 '
                    '(dépenses, personnel, dette, par habitant), projets d’investissement subventionnés par l’État, '
                    'élus et indemnités, signaux, lignes de dépenses qui la citent. Intercommunalité, département, '
                    'région : comptes année par année et par habitant. À utiliser d’abord pour toute question sur une '
                    'collectivité, ou une question qui n’est qu’un nom de commune.',
     'parameters': {'type': 'OBJECT', 'properties': {
         'nom': {'type': 'STRING', 'description': 'Nom ou code (Insee de commune, SIREN d’intercommunalité, numéro de '
                                                  'département, code de région)'},
         'niveau': {'type': 'STRING', 'enum': ['communes', 'gfp', 'departements', 'regions'],
                    'description': 'gfp = intercommunalités. Par défaut : communes'},
         'agregats': {'type': 'STRING', 'description': 'Hors communes : identifiants OFGL séparés par des virgules, facultatif'}},
         'required': ['nom']}},
    {'name': 'comparer',
     'description': 'Compare une collectivité à celles de même niveau et de même taille (communes de même tranche de '
                    'population) : montant par habitant, médiane, quartiles, rang. Répond à « est-ce beaucoup ? ».',
     'parameters': {'type': 'OBJECT', 'properties': {
         'nom': {'type': 'STRING'}, 'niveau': {'type': 'STRING', 'enum': ['communes', 'gfp', 'departements', 'regions']},
         'agregat': {'type': 'STRING', 'description': 'Ex. depenses-totales, frais-de-personnel, encours-de-dette, '
                                                      'depenses-d-equipement, impots-locaux (ou des mots du libellé)'}},
         'required': ['nom']}},
    {'name': 'indicateur',
     'description': 'Une série nationale clé, année par année, avec sa source : dépense publique totale ou par fonction '
                    '(retraites, santé, enseignement, défense, police et justice, intérêts de la dette...), par nature '
                    '(salaires des agents, prestations), recettes, déficit, dette, PIB, ratios en % du PIB, taux de '
                    'prélèvements obligatoires, population, prix et inflation. Le plus rapide pour un chiffre national.',
     'parameters': {'type': 'OBJECT', 'properties': {
         'nom': {'type': 'STRING', 'description': 'Ex. « retraites », « dette », « pib », « inflation », « fonction-GF09 »'},
         'depuis': {'type': 'INTEGER', 'description': 'Première année voulue, facultatif'}},
         'required': ['nom']}},
    {'name': 'calcul',
     'description': 'Calcul exact fait par le serveur : TOUJOURS l’utiliser avant d’écrire une part, une évolution, un '
                    'montant par habitant ou des euros d’une autre année. operation = part (a sur b), evolution (de a '
                    'à b), par_habitant (a euros pour b habitants), euros_constants (a euros de l’année « annee » '
                    'exprimés en euros de « vers ») ou expression (arithmétique libre).',
     'parameters': {'type': 'OBJECT', 'properties': {
         'operation': {'type': 'STRING', 'enum': ['part', 'evolution', 'par_habitant', 'euros_constants', 'expression']},
         'a': {'type': 'NUMBER'}, 'b': {'type': 'NUMBER'}, 'annee': {'type': 'INTEGER'}, 'vers': {'type': 'INTEGER'},
         'expression': {'type': 'STRING', 'description': 'Ex. « (391.95 - 292.77) / 292.77 * 100 »'}},
         'required': ['operation']}},
    {'name': 'dossier_beneficiaire',
     'description': 'Tout l’argent public publié pour un organisme (association, entreprise, acheteur public), par '
                    'SIREN ou par nom : subventions de l’État, marchés publics, aides de minimis, Fonds vert, par année '
                    'et par source, plus grosses lignes, et sa fiche de l’annuaire des entreprises (active ou fermée, '
                    'activité, siège).',
     'parameters': {'type': 'OBJECT', 'properties': {'nom': {'type': 'STRING', 'description': 'SIREN (9 chiffres) ou nom'}},
                    'required': ['nom']}},
    {'name': 'chercher_fiche',
     'description': 'Cherche par mots-clés dans un des grands jeux du site : etat (missions et programmes du budget de '
                    'l’État, crédits), niches (458 dépenses fiscales et leur coût), impots (292 impôts et taxes, '
                    'rendement, payeur, bénéficiaire), operateurs (431 opérateurs de l’État). Plus rapide que lire_donnees.',
     'parameters': {'type': 'OBJECT', 'properties': {
         'jeu': {'type': 'STRING', 'enum': ['etat', 'niches', 'impots', 'operateurs']},
         'mots': {'type': 'STRING'}}, 'required': ['jeu', 'mots']}},
    {'name': 'page_du_site',
     'description': 'Trouve la section précise du site à citer en lien (page et ancre) pour un sujet.',
     'parameters': {'type': 'OBJECT', 'properties': {'mots': {'type': 'STRING'}}, 'required': ['mots']}},
    {'name': 'lire_donnees',
     'description': 'Lit un fichier JSON publié par le site (liste dans le prompt système). « chemin » descend dans le '
                    'fichier (clés et indices séparés par des points, ex. « measures » ou « totals.0 ») ; « filtre » '
                    'garde les éléments d’une liste qui contiennent ce texte (sans accents) ; « debut » et « limite » '
                    'paginent (limite 40 au plus). Sans chemin : la structure du fichier.',
     'parameters': {'type': 'OBJECT', 'properties': {
         'fichier': {'type': 'STRING'}, 'chemin': {'type': 'STRING'}, 'filtre': {'type': 'STRING'},
         'debut': {'type': 'INTEGER'}, 'limite': {'type': 'INTEGER'}}, 'required': ['fichier']}},
    {'name': 'preparer_demande',
     'description': 'Quand les données du site ET le web ne donnent pas la réponse : prépare une demande de '
                    'communication de documents administratifs (CRPA, art. L. 300-1) à l’organisme qui les détient '
                    '(mairie, intercommunalité, département, région, ministère, opérateur). L’adresse vient de '
                    'l’annuaire officiel de l’administration ; la lettre suit un modèle poli fixe. Le lecteur la voit '
                    'sous la réponse et choisit de la faire envoyer par FranceRoueLibre ou de l’envoyer lui-même. '
                    'Seulement pour des documents qui existent (budget, compte administratif, délibération, '
                    'convention, marché, liste de subventions, rapport), jamais pour une opinion, une explication ou '
                    'des données personnelles. Une seule demande par réponse.',
     'parameters': {'type': 'OBJECT', 'properties': {
         'organisme': {'type': 'STRING', 'description': 'Ex. « Mairie de Hautmont », « Conseil départemental du Nord »'},
         'code_insee': {'type': 'STRING', 'description': 'Code Insee de la commune quand l’organisme est une mairie'},
         'objet': {'type': 'STRING', 'description': 'Objet court et neutre, ex. « coût de la cantine scolaire 2024 »'},
         'documents': {'type': 'STRING', 'description': 'Les documents demandés, un par ligne, précis (nature, année, '
                                                         'périmètre), formulés comme des documents et non des questions'},
         'contexte': {'type': 'STRING', 'description': 'Une ou deux phrases neutres : ce que les données publiques '
                                                       'montrent déjà et ce qui y manque'}},
         'required': ['organisme', 'objet', 'documents']}},
    {'name': 'jeux_ouverts',
     'description': 'Cherche les jeux de données publiés sur data.gouv.fr (budgets, délibérations, subventions d’une '
                    'collectivité...). À appeler avant preparer_demande, pour ne pas demander ce qui est déjà publié.',
     'parameters': {'type': 'OBJECT', 'properties': {'mots': {'type': 'STRING', 'description': 'Ex. « subventions associations Lyon »'}},
                    'required': ['mots']}},
    {'name': 'suivi_demandes',
     'description': 'Les demandes de documents déjà envoyées par le site aux organismes publics, leur état et les '
                    'réponses publiées. Pour « la mairie a-t-elle répondu ? », et avant d’en préparer une nouvelle.',
     'parameters': {'type': 'OBJECT', 'properties': {'recherche': {'type': 'STRING', 'description': 'Organisme, objet ou référence FRL-…'}}}},
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
    'secu.json': 'Sécurité sociale : comptes simplifiés des régimes de base par branche (« accounts », années 2009-2010 '
                 'seulement : dernier fichier publié sur data.gouv.fr, ne pas présenter comme actuel), dépenses '
                 'd’assurance maladie par région (« regions »)',
    'probite.json': 'Atteintes à la probité jugées 2021-2025 : affaires, infractions, peines',
    'ugap.json': 'Étude des prix du catalogue UGAP comparés au commerce',
    'national-accounts-3201.json': 'Recettes et dépenses de l’ensemble des administrations publiques 1960-2025 (Insee 3.201, Md€)',
    'national-debt.json': 'Dette publique et passage du déficit à la dette (Insee 3.101 et 3.105)',
    'national-sectors-3215.json': 'Comptes par sous-secteur (État, organismes divers, administrations locales, sécurité sociale)',
    'national-functions.json': 'Dépenses de toutes les administrations publiques par fonction (COFOG, Eurostat '
                               '1995-2024, Md€). Chemin « data.NATURE.FONCTION » : NATURE = TE dépense totale, D62 '
                               'prestations sociales, D1 rémunérations, P2 achats, D4 intérêts ; FONCTION = TOTAL, '
                               'GF10 protection sociale, GF1002 vieillesse (retraites), GF07 santé, GF09 enseignement, '
                               'GF02 défense, GF0107 dette (« functions » : tous les libellés). Valeurs données par année',
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
    'insee-ipc.json': 'Indice des prix à la consommation 1960-2025 (Insee, base 100 en 2025) et inflation annuelle',
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


# =========================================================================================== dossier_commune
PROJECT_YEARS = range(2018, 2031)


def _find_commune(nom: str) -> tuple:
    """(index in communes-meta, None) or (None, error dict)."""
    q = norm(str(nom or '').strip())
    if not q:
        return None, {'error': 'nom vide'}
    ents = _entities('communes')
    loose = lambda s: ' '.join(re.findall(r'[a-z0-9]+', norm(s)))
    lq = loose(q)
    found = [i for i, (c, n, _) in enumerate(ents) if norm(c) == q or norm(n) == q or loose(n) == lq]
    found = found or [i for i, (c, n, _) in enumerate(ents) if lq and lq in loose(n)]
    if not found:
        return None, {'error': f'aucune commune « {nom} » ; donner le code Insee ou un autre niveau (comptes_collectivite)'}
    if len(found) > 1:
        return None, {'plusieurs': [{'code': ents[i][0], 'nom': ents[i][1], 'lieu': ents[i][2]} for i in found[:15]],
                      'note': 'Plusieurs communes correspondent : rappeler l’outil avec le code Insee.'}
    return found[0], None


def _projects(code: str) -> dict:
    rows = []
    for year in PROJECT_YEARS:
        try:
            data = _json(f'web/projects-{year}.json')
        except (OSError, ValueError):
            continue
        rows += [(year, data['schemes'][r[0]], r[4], r[5]) for r in data['rows'] if r[3] == code]
    by_year: Dict[int, float] = {}
    by_scheme: Dict[str, float] = {}
    for y, s, _, a in rows:
        by_year[y] = by_year.get(y, 0) + (a or 0)
        by_scheme[s] = by_scheme.get(s, 0) + (a or 0)
    top = sorted(rows, key=lambda r: -(r[3] or 0))[:12]
    return {'nombre': len(rows), 'total_eur': round(sum(by_year.values())),
            'par_annee_eur': {y: round(v) for y, v in sorted(by_year.items())},
            'par_dispositif_eur': {s: round(v) for s, v in sorted(by_scheme.items(), key=lambda kv: -kv[1])},
            'plus_gros': [{'annee': y, 'dispositif': s, 'objet': (t or '')[:160], 'montant_eur': round(a or 0)}
                          for y, s, t, a in top],
            'note': 'Subventions d’investissement de l’État (DETR, DSIL, DPV, DSID) attribuées à la commune, liste DGCL.'}


def _mentions(name: str, dept: str) -> dict:
    """Lines of the search index whose text contains the commune's name, in its département."""
    tokens = re.findall(r'[a-z0-9]+', norm(name))
    if not tokens:
        return {}
    match = '"' + ' '.join(tokens) + '"'
    depts = sorted({dept, dept[:2]}) if dept.startswith('97') else [dept]
    marks = ','.join('?' * len(depts))
    with _sql_lock:
        db = _sql_connection()
        started = time.monotonic()
        db.set_progress_handler(lambda: 1 if time.monotonic() - started > 5 else 0, 10000)
        try:
            per_src = db.execute(
                f'SELECT doc.src, COUNT(*), SUM(CASE WHEN doc.fw = 0 THEN doc.amount END), SUM(doc.fw) FROM fts '
                f'JOIN doc ON doc.id = fts.rowid WHERE fts MATCH ? AND doc.dept IN ({marks}) GROUP BY doc.src',
                [match, *depts]).fetchall()
            top = db.execute(
                f'SELECT doc.src, doc.year, doc.amount, doc.title, doc.who FROM fts JOIN doc ON doc.id = fts.rowid '
                f'WHERE fts MATCH ? AND doc.dept IN ({marks}) AND doc.fw = 0 AND doc.src != 3 '
                f'ORDER BY doc.amount DESC LIMIT 10', [match, *depts]).fetchall()
        except sqlite3.Error as exc:
            return {'error': f'recherche impossible : {str(exc)[:120]}'}
        finally:
            db.set_progress_handler(None, 0)
    return {'par_source': [{'source': SRC.get(s, s), 'lignes': n, 'montant_eur': round(a or 0),
                            'accords_cadres_lignes': fw or 0} for s, n, a, fw in per_src],
            'plus_grosses_lignes': [{'source': SRC.get(s), 'annee': y, 'montant_eur': round(a or 0),
                                     'objet': (t or '')[:160], 'beneficiaire_ou_acheteur': w} for s, y, a, t, w in top],
            'page': f'{S.SITE_URL}/recherche.html?q={urllib.parse.quote(name)}',
            'note': 'Lignes du département dont l’objet, le bénéficiaire ou l’acheteur contient le nom de la commune : '
                    'une mention ne veut pas dire que la dépense est faite par la commune ou pour elle. Les accords-cadres '
                    '(plafonds) sont exclus des montants.'}


def _elected(i: int) -> Optional[dict]:
    e = _json('emplois-communes.json')
    if i >= len(e['rows']) or not e['rows'][i]:
        return None
    r = dict(zip(e['columns'], e['rows'][i]))
    out = {'annee': e['year'], 'conseillers_municipaux': r.get('conseillers municipaux (RNE)'),
           'adjoints': r.get('adjoints (RNE)'), 'indemnites_elus_payees_eur': r.get(f'indemnités payées {e["paidYear"]} (€)'),
           'indemnites_elus_payees_2019_eur': r.get('indemnités payées 2019 (€)'),
           'indemnites_cotisations_et_frais_eur': r.get(f'total comptes 653 élus {e["year"]} (€)'),
           'plafond_de_base_indemnites_eur': r.get(f'plafond légal {e["year"]} (€)'),
           'frais_de_personnel_keur': r.get('personnel (k€)'), f'frais_de_personnel_{e["year0"]}_keur': r.get('personnel year0 (k€)'),
           'page': f'{S.SITE_URL}/emplois.html',
           'note': 'Indemnités de fonction payées (compte 6531, DGFiP). Le plafond de base (maire et 30 % du conseil en '
                   'adjoints) ne compte ni les majorations légales (chef-lieu, station de tourisme, quartiers '
                   'prioritaires...) ni les conseillers délégués : le dépasser n’est pas en soi une irrégularité, le '
                   'détail par élu n’est pas publié. Frais de personnel en milliers d’euros.'}
    return {k: v for k, v in out.items() if v is not None}


def _signals(code: str) -> list:
    s = _json('local/signals.json')
    out = []
    for key, block in s.items():
        if not isinstance(block, dict) or 'insee' not in (block.get('fields') or []):
            continue
        k = block['fields'].index('insee')
        for row in block.get('rows', []):
            if row[k] == code:
                out.append({'signal': block.get('rule'), 'valeurs': {f: v for f, v in zip(block['fields'], row)
                                                                      if f not in ('insee', 'name', 'dept')}})
    return out


def dossier_commune(nom: str) -> dict:
    i, err = _find_commune(nom)
    if err:
        return err
    code, name, place = _entities('communes')[i]
    dept = _json('web/communes-meta.json')['rows'][i][2]
    accounts = comptes_collectivite(code, 'communes')
    accounts.pop('liste', None)
    try:
        mentions = _mentions(name, dept)
    except (OSError, sqlite3.Error) as exc:
        mentions = {'error': f'index de recherche indisponible : {exc}'}
    signals = _signals(code)
    return clip({
        'commune': {'code': code, 'nom': name, 'lieu': place},
        'comptes': {k: accounts.get(k) for k in accounts if k not in ('entite',)},
        'projets_aides_etat': _projects(code),
        'elus_et_personnel': _elected(i),
        'signaux': signals or 'aucun signal relevé pour cette commune',
        'mentions_dans_les_depenses': mentions,
        'pages': {'carte': f'{S.SITE_URL}/index.html#explorer', 'signaux': f'{S.SITE_URL}/signaux.html'},
    })


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


def _is_series(value: Any, years: list) -> bool:
    return (isinstance(value, list) and len(value) == len(years)
            and all(v is None or isinstance(v, (int, float)) for v in value))


def _by_year(node: Any, years: list) -> Any:
    """A list of numbers aligned with the file's « years » becomes {year: value} (also one level down), so that a
    value is never read with the wrong year."""
    if _is_series(node, years):
        return dict(zip(map(str, years), node))
    if isinstance(node, dict) and node and any(_is_series(v, years) for v in node.values()):
        return {k: dict(zip(map(str, years), v)) if _is_series(v, years) else v for k, v in node.items()}
    return node


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
    years = node.get('years') if isinstance(node, dict) else None
    for key in [k for k in str(chemin or '').split('.') if k]:
        if isinstance(node, dict) and isinstance(node.get('years'), list):
            years = node['years']
        if isinstance(node, dict) and key in node:
            node = node[key]
        elif isinstance(node, list) and key.lstrip('-').isdigit() and -len(node) <= int(key) < len(node):
            node = node[int(key)]
        else:
            return {'error': f'« {key} » introuvable après « {".".join(walked) or "racine"} »',
                    'cles_disponibles': list(node)[:60] if isinstance(node, dict) else f'liste de {len(node)}'
                    if isinstance(node, list) else None}
        walked.append(key)
    if walked and years:
        node = _by_year(node, years)
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
        self.question = ''             # the reader's question (kept with a request draft)
        self.demande: Optional[dict] = None  # the request draft shown under the answer (preparer_demande)

    def call(self, name: str, args: dict) -> dict:
        args = args if isinstance(args, dict) else {}
        try:
            if name == 'rechercher_depenses':
                return rechercher_depenses(args.get('requete', ''))
            if name == 'requete_sql':
                return requete_sql(args.get('sql', ''))
            if name == 'comptes_collectivite':
                return comptes_collectivite(args.get('nom', ''), args.get('niveau') or 'communes', args.get('agregats') or '')
            if name == 'dossier_commune':
                return dossier_commune(args.get('nom', ''))
            if name == 'dossier_collectivite':
                level = args.get('niveau') or 'communes'
                if level == 'communes':
                    return dossier_commune(args.get('nom', ''))
                return comptes_collectivite(args.get('nom', ''), level, args.get('agregats') or '')
            from . import outils as O
            simple = {'indicateur': lambda: O.indicateur(args.get('nom', ''), args.get('depuis') or 0),
                      'calcul': lambda: O.calcul(args.get('operation', ''), args.get('a'), args.get('b'), args.get('annee'),
                                                 args.get('vers'), args.get('expression') or ''),
                      'comparer': lambda: O.comparer(args.get('nom', ''), args.get('agregat') or 'depenses-totales',
                                                     args.get('niveau') or 'communes'),
                      'dossier_beneficiaire': lambda: O.dossier_beneficiaire(args.get('nom', '')),
                      'chercher_fiche': lambda: O.chercher_fiche(args.get('jeu', ''), args.get('mots', '')),
                      'page_du_site': lambda: O.page_du_site(args.get('mots', '')),
                      'jeux_ouverts': lambda: O.jeux_ouverts(args.get('mots', '')),
                      'suivi_demandes': lambda: O.suivi_demandes(args.get('recherche') or '')}
            if name in simple:
                return simple[name]()
            if name == 'preparer_demande':
                if self.demande:
                    return {'error': 'une demande est déjà préparée pour cette réponse'}
                from . import demandes
                res = demandes.prepare(args.get('organisme', ''), args.get('code_insee') or '', args.get('objet') or '',
                                       args.get('documents') or '', args.get('contexte') or '', self.question)
                if res.get('demande'):
                    self.demande = res['demande']
                return res
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
