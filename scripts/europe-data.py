"""La France et ses voisins : comptes publics comparés (Eurostat, FMI) -> dist/data/europe.json.

Deux étages, comme pour sources/resultats/ :

  1. Extraction (seulement si les fichiers bruts sont là) : sources/raw/international/ (téléchargé par
     `node scripts/fetch-sources.mjs --only=international`) -> CSV versionnés dans sources/international/.
     Chaque fichier est facultatif : un fichier absent ou illisible est signalé et sa section n'apparaît pas.
  2. Assemblage : sources/resultats/eurostat_gov_remuneration_salaries_ue.csv (toujours présent, versionné)
     et les CSV de sources/international/ quand ils existent -> dist/data/europe.json.

Aucun chiffre saisi à la main. Les seuls calculs sont signalés dans le fichier produit (`computed`) :
PIB déduit (dépense en M€ / dépense en % du PIB), écart à la moyenne de l'UE en points et en Md€, rang.
La moyenne de l'UE est l'agrégat publié par Eurostat (EU27_2020), jamais une moyenne recalculée ici.

    python3 scripts/europe-data.py
"""
import csv
import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'sources', 'raw', 'international')
TIDY = os.path.join(ROOT, 'sources', 'international')
MAIN = os.path.join(ROOT, 'sources', 'resultats', 'eurostat_gov_remuneration_salaries_ue.csv')
MANIFEST = os.path.join(ROOT, 'sources', 'raw', 'manifest.json')
POP = os.path.join(ROOT, 'dist', 'data', 'insee-population.json')
OUT = os.path.join(ROOT, 'dist', 'data', 'europe.json')

EU27 = ['BE', 'BG', 'CZ', 'DK', 'DE', 'EE', 'IE', 'EL', 'ES', 'FR', 'HR', 'IT', 'CY', 'LV', 'LT', 'LU', 'HU', 'MT',
        'NL', 'AT', 'PL', 'PT', 'RO', 'SI', 'SK', 'FI', 'SE']
OTHERS = ['CH', 'IS', 'NO']          # published by Eurostat, outside the EU: shown, never ranked
EU = 'EU27_2020'
# Names of countries in French (labels only; the source file carries the English ones).
NAMES = {'BE': 'Belgique', 'BG': 'Bulgarie', 'CZ': 'Tchéquie', 'DK': 'Danemark', 'DE': 'Allemagne', 'EE': 'Estonie',
         'IE': 'Irlande', 'EL': 'Grèce', 'ES': 'Espagne', 'FR': 'France', 'HR': 'Croatie', 'IT': 'Italie',
         'CY': 'Chypre', 'LV': 'Lettonie', 'LT': 'Lituanie', 'LU': 'Luxembourg', 'HU': 'Hongrie', 'MT': 'Malte',
         'NL': 'Pays-Bas', 'AT': 'Autriche', 'PL': 'Pologne', 'PT': 'Portugal', 'RO': 'Roumanie', 'SI': 'Slovénie',
         'SK': 'Slovaquie', 'FI': 'Finlande', 'SE': 'Suède', 'CH': 'Suisse', 'IS': 'Islande', 'NO': 'Norvège',
         EU: 'Union européenne (27 pays)'}
# IMF country codes (ISO 3166 alpha-3) kept for the forecasts, with their French names.
IMF_GEOS = {'FRA': 'France', 'DEU': 'Allemagne', 'ITA': 'Italie', 'ESP': 'Espagne', 'GBR': 'Royaume-Uni',
            'USA': 'États-Unis', 'JPN': 'Japon', 'BEL': 'Belgique', 'NLD': 'Pays-Bas', 'GRC': 'Grèce',
            'PRT': 'Portugal', 'CAN': 'Canada'}

DATABROWSER = 'https://ec.europa.eu/eurostat/databrowser/view/{}/default/table?lang=fr'

# Series read from the Eurostat files of sources/raw/international/eurostat/.
# file, dimension filters, id of the metric on the page.
EUROSTAT = [
    ('gov_10a_main.json', {'sector': 'S13', 'na_item': 'TR', 'unit': 'PC_GDP'}, 'recettes'),
    ('gov_10a_main.json', {'sector': 'S13', 'na_item': 'D41PAY', 'unit': 'PC_GDP'}, 'interets'),
    ('gov_10dd_edpt1.json', {'sector': 'S13', 'na_item': 'B9', 'unit': 'PC_GDP'}, 'solde'),
    ('gov_10dd_edpt1.json', {'sector': 'S13', 'na_item': 'GD', 'unit': 'PC_GDP'}, 'dette'),
    ('irt_lt_mcby_a.json', {}, 'taux'),
]
COFOG = [('GF01', 'Services généraux, intérêts de la dette'), ('GF02', 'Défense'), ('GF03', 'Ordre et sécurité publics'),
         ('GF04', 'Affaires économiques'), ('GF05', 'Protection de l’environnement'),
         ('GF06', 'Logement et équipements collectifs'), ('GF07', 'Santé'), ('GF08', 'Loisirs, culture et cultes'),
         ('GF09', 'Enseignement'), ('GF10', 'Protection sociale (dont retraites)')]
# code, key, short label (chip), unit, what it is
IMF = [('GGXWDG_NGDP', 'dette', 'Dette publique', '% du PIB'),
       ('GGXCNL_NGDP', 'solde', 'Solde public', '% du PIB'),
       ('NGDP_RPCH', 'croissance', 'Croissance du PIB', '% par an'),
       ('PCPIPCH', 'inflation', 'Inflation', '% par an')]

METRICS = {
    'depenses': {'label': 'Dépenses publiques', 'unit': '% du PIB', 'dataset': 'gov_10a_main', 'order': 'desc',
                 'what': 'Tout ce que dépensent l’État, les collectivités locales et la Sécurité sociale, rapporté à la richesse produite dans l’année.'},
    'remunerations': {'label': 'Rémunération des agents publics', 'unit': '% du PIB', 'dataset': 'gov_10a_main', 'order': 'desc',
                      'what': 'Salaires et cotisations des agents des administrations publiques, rapportés à la richesse produite dans l’année.'},
    'recettes': {'label': 'Recettes publiques', 'unit': '% du PIB', 'dataset': 'gov_10a_main', 'order': 'desc',
                 'what': 'Impôts, cotisations sociales et autres recettes de l’ensemble des administrations publiques.'},
    'solde': {'label': 'Solde public', 'unit': '% du PIB', 'dataset': 'gov_10dd_edpt1', 'order': 'asc',
              'what': 'Recettes moins dépenses : un nombre négatif est un déficit. Chiffre notifié à la Commission européenne.'},
    'dette': {'label': 'Dette publique', 'unit': '% du PIB', 'dataset': 'gov_10dd_edpt1', 'order': 'desc',
              'what': 'Dette brute au sens de Maastricht en fin d’année, rapportée à la richesse produite dans l’année.'},
    'interets': {'label': 'Intérêts de la dette', 'unit': '% du PIB', 'dataset': 'gov_10a_main', 'order': 'desc',
                 'what': 'Intérêts versés aux prêteurs dans l’année par l’ensemble des administrations publiques.'},
    'taux': {'label': 'Taux d’emprunt à dix ans', 'unit': '% par an', 'dataset': 'irt_lt_mcby_a', 'order': 'desc',
             'what': 'Rendement moyen sur l’année des emprunts d’État à dix ans (critère de convergence de Maastricht).'},
}


def fnum(text):
    try:
        return float(text) if text not in (None, '') else None
    except ValueError:
        return None


# ---------------------------------------------------------------- stage 1: raw files -> tidy CSVs
def jsonstat(doc):
    """Eurostat JSON-stat 2.0 -> (list of {dimension: category, 'value': float, 'flag': str}, updated).
    Same decoding as scripts/emplois-resultats/eurostat.py, without pandas."""
    ids, size = doc['id'], doc['size']
    cats = []
    for dim in ids:
        index = doc['dimension'][dim]['category']['index']
        cats.append(sorted(index, key=lambda c: index[c]) if isinstance(index, dict) else list(index))
    if [len(c) for c in cats] != list(size):
        raise ValueError('JSON-stat : tailles des dimensions incohérentes')
    status = doc.get('status') or {}
    if isinstance(status, list):
        status = {str(i): s for i, s in enumerate(status) if s}
    values = doc['value']
    items = values.items() if isinstance(values, dict) else ((i, v) for i, v in enumerate(values))
    rows = []
    for flat, value in items:
        if value is None:
            continue
        rem, coords = int(flat), []
        for s in reversed(size):
            coords.append(rem % s)
            rem //= s
        coords.reverse()
        row = {dim: cats[i][coords[i]] for i, dim in enumerate(ids)}
        row['value'], row['flag'] = float(value), status.get(str(flat), '')
        rows.append(row)
    return rows, doc.get('updated', '')


def select(rows, filters):
    """Rows matching every filter. A filter on a dimension the file does not have is an error: the series asked for
    is not the one in the file."""
    if rows and any(k not in rows[0] for k in filters):
        raise ValueError(f'dimension absente du fichier : {[k for k in filters if k not in rows[0]]}')
    out = [r for r in rows if all(r[k] == v for k, v in filters.items())]
    if not out:
        raise ValueError(f'aucune valeur pour {filters}')
    return out


def imf_series(doc, indicator):
    """IMF DataMapper answer {"values": {indicator: {ISO3: {year: value}}}} -> {ISO3: {year: value}}."""
    block = (doc.get('values') or {}).get(indicator)
    if not isinstance(block, dict) or not block:
        raise ValueError(f'indicateur {indicator} absent de la réponse')
    return {geo: {int(y): float(v) for y, v in years.items() if v is not None} for geo, years in block.items() if isinstance(years, dict)}


def write_csv(name, header, rows):
    os.makedirs(TIDY, exist_ok=True)
    with open(os.path.join(TIDY, name), 'w', encoding='utf-8', newline='') as handle:
        writer = csv.writer(handle, lineterminator='\n')
        writer.writerow(header)
        writer.writerows(rows)


def extract(log):
    """Reads whatever raw file is present. Returns nothing: the tidy CSVs are the result."""
    if not os.path.isdir(RAW):
        log.append('sources/raw/international/ absent : seules les séries déjà versionnées sont utilisées')
        return
    cache = {}

    def doc(rel):
        if rel not in cache:
            with open(os.path.join(RAW, rel), encoding='utf-8') as handle:
                cache[rel] = json.load(handle)
        return cache[rel]

    rows_out, updated = [], {}
    for file, filters, metric in EUROSTAT:
        try:
            rows, upd = jsonstat(doc(os.path.join('eurostat', file)))
            for r in select(rows, filters):
                rows_out.append((metric, r['geo'], int(r['time'][:4]), r['value'], r['flag']))
            updated[metric] = upd
        except (OSError, ValueError, KeyError) as error:
            log.append(f'{metric} ({file}) non intégré : {error}')
    if rows_out:
        write_csv('eurostat_finances_publiques_ue.csv', ['serie', 'geo', 'annee', 'valeur', 'statut_obs'], sorted(rows_out))
        write_csv('eurostat_mises_a_jour.csv', ['serie', 'mise_a_jour_eurostat'], sorted(updated.items()))

    try:
        rows, upd = jsonstat(doc(os.path.join('eurostat', 'gov_10a_exp_TE_cofog.json')))
        rows = select(rows, {'sector': 'S13', 'na_item': 'TE', 'unit': 'PC_GDP'})
        write_csv('eurostat_depenses_par_fonction_ue.csv', ['geo', 'annee', 'cofog99', 'depenses_pct_pib', 'statut_obs', 'mise_a_jour_eurostat'],
                  sorted((r['geo'], int(r['time'][:4]), r['cofog99'], r['value'], r['flag'], upd) for r in rows))
    except (OSError, ValueError, KeyError) as error:
        log.append(f'dépenses par fonction (gov_10a_exp) non intégrées : {error}')

    imf_rows = []
    for indicator, key, _, _ in IMF:
        try:
            series = imf_series(doc(os.path.join('fmi', f'{indicator}.json')), indicator)
            if 'FRA' not in series:
                raise ValueError('la France (FRA) est absente')
            for geo in IMF_GEOS:
                for year, value in sorted(series.get(geo, {}).items()):
                    imf_rows.append((indicator, geo, year, value))
        except (OSError, ValueError, KeyError) as error:
            log.append(f'FMI {indicator} non intégré : {error}')
    if imf_rows:
        write_csv('fmi_perspectives_economie_mondiale.csv', ['indicateur', 'pays_iso3', 'annee', 'valeur'], imf_rows)


# ---------------------------------------------------------------- stage 2: tidy CSVs -> europe.json
def read_csv(path):
    with open(path, encoding='utf-8', newline='') as handle:
        return list(csv.DictReader(handle))


def table(by_geo, years):
    """{geo: {year: value}} -> {geo: [value or None per year]} for the geographies of the page."""
    return {geo: [by_geo[geo].get(y) for y in years] for geo in EU27 + OTHERS + [EU] if geo in by_geo and any(by_geo[geo].get(y) is not None for y in years)}


def rank(values_at, geo, order):
    """Rank of geo among the EU countries that publish a value (1 = highest when order is 'desc')."""
    pool = sorted((v for g, v in values_at.items() if g in EU27 and v is not None), reverse=order == 'desc')
    return (pool.index(values_at[geo]) + 1, len(pool)) if values_at.get(geo) is not None else (None, len(pool))


def main():
    log = []
    extract(log)
    if not os.path.exists(MAIN):
        sys.exit(f'Fichier absent : {MAIN}')
    manifest = json.load(open(MANIFEST, encoding='utf-8')) if os.path.exists(MANIFEST) else {}

    # ---- always there: total expenditure and compensation of employees (gov_10a_main, versioned extract)
    te, te_meur, d1, flags = {}, {}, {}, {}
    for r in read_csv(MAIN):
        geo, year = r['geo'], int(r['annee'])
        for store, column in ((te, 'TE_PC_GDP'), (te_meur, 'TE_MIO_EUR'), (d1, 'D1PAY_PC_GDP')):
            value = fnum(r[column])
            if value is not None:
                store.setdefault(geo, {})[year] = value
        if r.get('flags_D1PAY_PC_GDP'):
            flags.setdefault(geo, {})[year] = r['flags_D1PAY_PC_GDP']
    missing = [g for g in EU27 + [EU] if g not in te]
    if missing:
        sys.exit(f'Pays absents du fichier Eurostat : {missing}')
    years = list(range(min(te['FR']), max(te['FR']) + 1))
    series = {'depenses': te, 'remunerations': d1}
    updated = {}

    # ---- optional: series extracted from sources/raw/international/
    extra = os.path.join(TIDY, 'eurostat_finances_publiques_ue.csv')
    if os.path.exists(extra):
        for r in read_csv(extra):
            series.setdefault(r['serie'], {}).setdefault(r['geo'], {})[int(r['annee'])] = float(r['valeur'])
        upd = os.path.join(TIDY, 'eurostat_mises_a_jour.csv')
        if os.path.exists(upd):
            updated = {r['serie']: r['mise_a_jour_eurostat'] for r in read_csv(upd)}

    metrics = {}
    for key, meta in METRICS.items():
        if key not in series or 'FR' not in series[key] or EU not in series[key] and key != 'taux':
            continue
        values = table(series[key], years)
        metrics[key] = {**meta, 'values': values, 'source': f'Eurostat, {meta["dataset"]}', 'url': DATABROWSER.format(meta['dataset']),
                        'updated': updated.get(key), 'firstYear': next(y for y in years if series[key]['FR'].get(y) is not None),
                        'lastYear': max(y for y in years if series[key]['FR'].get(y) is not None)}

    # ---- France against the EU aggregate, year by year (expenditure)
    last = metrics['depenses']['lastYear']
    gdp_fr = {y: te_meur['FR'][y] / te['FR'][y] * 100 for y in years if te['FR'].get(y) and te_meur['FR'].get(y)}   # M€, computed
    population = {}
    if os.path.exists(POP):
        doc = json.load(open(POP, encoding='utf-8'))
        population = {int(r['year']): r['population'] for r in doc.get('january1', []) if r.get('population')}
    gap = []
    for y in years:
        fr, eu = te['FR'].get(y), te[EU].get(y)
        if fr is None or eu is None:
            continue
        r_, n = rank({g: te[g].get(y) for g in EU27}, 'FR', 'desc')
        points = round(fr - eu, 1)
        md = round(points / 100 * gdp_fr[y] / 1000, 1) if y in gdp_fr else None
        per_head = round(md * 1e9 / population[y]) if md is not None and population.get(y) else None
        gap.append({'year': y, 'france': fr, 'eu': eu, 'points': points, 'mdEur': md, 'eurPerHead': per_head, 'rank': r_, 'of': n})

    # ---- optional: expenditure by function (COFOG), every EU country, last year France publishes
    cofog = None
    path = os.path.join(TIDY, 'eurostat_depenses_par_fonction_ue.csv')
    if os.path.exists(path):
        rows = read_csv(path)
        fr_years = sorted({int(r['annee']) for r in rows if r['geo'] == 'FR' and r['cofog99'] == 'TOTAL'})
        if fr_years:
            y = fr_years[-1]
            at = {(r['geo'], r['cofog99']): float(r['depenses_pct_pib']) for r in rows if int(r['annee']) == y}
            functions = []
            for code, label in COFOG:
                vals = {g: at.get((g, code)) for g in EU27}
                r_, n = rank(vals, 'FR', 'desc')
                top = max((g for g in EU27 if vals[g] is not None), key=lambda g: vals[g], default=None)
                functions.append({'code': code, 'label': label, 'france': at.get(('FR', code)), 'eu': at.get((EU, code)), 'rank': r_, 'of': n,
                                  'top': {'geo': top, 'value': vals[top]} if top else None, 'values': {g: v for g, v in vals.items() if v is not None}})
            total_fr = at.get(('FR', 'TOTAL'))
            parts = [f['france'] for f in functions if f['france'] is not None]
            cofog = {'year': y, 'functions': functions, 'totalFrance': total_fr, 'totalEu': at.get((EU, 'TOTAL')),
                     'sumFrance': round(sum(parts), 1), 'source': 'Eurostat, gov_10a_exp (dépenses par fonction, CFAP)',
                     'url': DATABROWSER.format('gov_10a_exp'), 'updated': rows[0].get('mise_a_jour_eurostat')}
            if total_fr is not None and abs(cofog['sumFrance'] - total_fr) > 0.6:
                log.append(f'COFOG {y} : la somme des dix fonctions ({cofog["sumFrance"]}) s’écarte du total publié ({total_fr})')

    # ---- optional: IMF World Economic Outlook, with its projections
    imf = None
    path = os.path.join(TIDY, 'fmi_perspectives_economie_mondiale.csv')
    if os.path.exists(path):
        rows = read_csv(path)
        downloaded = (manifest.get('international') or {}).get('downloadedAt', '')[:10]
        imf_years = sorted({int(r['annee']) for r in rows if int(r['annee']) >= 2000})
        indicators = []
        for code, key, label, unit in IMF:
            by_geo = {}
            for r in rows:
                if r['indicateur'] == code and int(r['annee']) >= 2000:
                    by_geo.setdefault(r['pays_iso3'], {})[int(r['annee'])] = round(float(r['valeur']), 2)
            if 'FRA' in by_geo:
                indicators.append({'code': code, 'key': key, 'label': label, 'unit': unit,
                                   'values': {g: [by_geo[g].get(y) for y in imf_years] for g in IMF_GEOS if g in by_geo}})
        if indicators and downloaded:
            imf = {'years': imf_years, 'geos': IMF_GEOS, 'indicators': indicators, 'downloaded': downloaded,
                   # the file does not flag projections: every year from the download year on is one
                   'projectionsFrom': int(downloaded[:4]), 'source': 'FMI, Perspectives de l’économie mondiale (DataMapper)',
                   'url': 'https://www.imf.org/external/datamapper/datasets/WEO'}
        elif indicators:
            log.append('FMI : date de téléchargement inconnue (manifest absent), prévisions non affichées')

    fr_last = next(g for g in gap if g['year'] == last)
    result = {
        'generated': date.today().isoformat(),
        'years': years, 'eu27': EU27, 'others': OTHERS, 'aggregate': EU, 'names': NAMES,
        'metrics': metrics, 'flags': {'remunerations': {g: {str(y): f for y, f in v.items()} for g, v in flags.items()}},
        'gap': gap, 'france': fr_last, 'cofog': cofog, 'imf': imf,
        'gdpFrance': {str(y): round(v / 1000, 1) for y, v in gdp_fr.items()},
        'computed': ['PIB de la France en Md€ : dépenses en M€ divisées par les dépenses en % du PIB (Eurostat)',
                     'Écart en points : France moins agrégat UE-27 publié par Eurostat',
                     'Écart en Md€ : écart en points appliqué au PIB de la France',
                     'Écart par habitant : écart en Md€ divisé par la population au 1er janvier (Insee)',
                     'Rang : position parmi les pays de l’UE qui publient une valeur cette année-là'],
        'sources': [{'title': 'Eurostat, principaux agrégats des administrations publiques (gov_10a_main)', 'url': DATABROWSER.format('gov_10a_main')}]
        + ([{'title': 'Eurostat, déficit et dette notifiés (gov_10dd_edpt1)', 'url': DATABROWSER.format('gov_10dd_edpt1')}] if 'dette' in metrics or 'solde' in metrics else [])
        + ([{'title': 'Eurostat, taux à long terme (irt_lt_mcby_a)', 'url': DATABROWSER.format('irt_lt_mcby_a')}] if 'taux' in metrics else [])
        + ([{'title': cofog['source'], 'url': cofog['url']}] if cofog else [])
        + ([{'title': imf['source'], 'url': imf['url']}] if imf else [])
        + [{'title': 'Insee, population au 1er janvier', 'url': 'https://www.insee.fr/fr/statistiques/serie/001641586'}],
        'pending': [m for m in ('recettes', 'solde', 'dette', 'interets', 'taux') if m not in metrics] + ([] if cofog else ['cofog']) + ([] if imf else ['fmi']),
        'log': log,
    }
    with open(OUT, 'w', encoding='utf-8') as handle:
        json.dump(result, handle, ensure_ascii=False, separators=(',', ':'))
    f = result['france']
    print(f'europe.json : {len(metrics)} séries ({", ".join(metrics)}), {years[0]}–{years[-1]} ; France {last} : {f["france"]} % du PIB, '
          f'rang {f["rank"]}/{f["of"]}, UE {f["eu"]} %, écart {f["points"]} pt = {f["mdEur"]} Md€')
    for line in log:
        print('  ·', line)


if __name__ == '__main__':
    main()
