"""UGAP study (ugap/ folder) -> dist/data/ugap.json, small and derived.

Reads only files that already exist, never the network:
  ugap/data/ugap_urls.jsonl           product URLs from the ugap.fr sitemaps (whole catalogue)
  ugap/data/ugap_products/*.jsonl     product pages crawled so far (random order, laboratory last)
  ugap/data/ugap_errors/*.jsonl       product pages that could not be read
  ugap/data/retail_urls_<r>.jsonl     retailer product URLs (sitemaps), ugap/data/retail_<r>/*.jsonl retailer pages
  ugap/data/matches.csv               output of `python ugap/match.py` (same product on both sides, clean pairs)
  ugap/data/matches_review.csv        pairs set aside for manual review (pack size or ratio out of bounds)
  sources/raw/decp-v3--*.csv.gz, decp-2022--*.csv.gz   DECP, to find the contracts where UGAP is buyer or supplier
  dist/data/marches/summary.json, buyers.json          DECP totals per year and buyer names (marches page)

The price statistics are recomputed from matches.csv with the same rule as match.py (one value per UGAP product,
its cheapest comparable offer), so they always match the published pairs. Run `python ugap/match.py` first when the
crawl has moved on; the script warns when matches.csv is older than the newest crawled shard.

Run from the repository root: python scripts/ugap-data.py
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'ugap' / 'data'
OUT = ROOT / 'dist' / 'data' / 'ugap.json'
UGAP_SIREN = '776056467'  # Union des groupements d'achats publics (name confirmed by acheteur_nom in DECP v3)
MAX_PLAUSIBLE = 2e9       # same rule as scripts/process_procurement.py
RATIO_BINS = [0, 0.5, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0, None]

RETAILERS = {  # status of each retailer considered by the study (from ugap/README.md and ugap/retail_crawl.py)
    'bureauvallee': {'name': 'Bureau Vallée', 'site': 'https://www.bureau-vallee.fr', 'kind': 'grand public, TTC'},
    'boulanger': {'name': 'Boulanger', 'site': 'https://www.boulanger.com', 'kind': 'grand public, TTC'},
    'ldlc': {'name': 'LDLC', 'site': 'https://www.ldlc.com', 'kind': 'grand public, TTC',
             'note': 'le site a refusé les connexions après quelques centaines de pages : collecte arrêtée'},
    'manutan': {'name': 'Manutan', 'site': 'https://www.manutan.fr', 'kind': 'professionnel, HT',
                'note': 'page de vérification JavaScript servie aux robots : aucune fiche lisible'},
}
EXCLUDED = [
    ['Mondoffice (JPG)', 'CAPTCHA anti-robot (Radware) : non collecté'],
    ['Raja', 'CAPTCHA anti-robot (Radware) : non collecté'],
    ['Conforama', 'robots.txt interdit toute collecte'],
    ['Amazon', 'conditions d’utilisation : non collecté'],
    ['Cdiscount, ledenicheur', 'pages de recherche interdites par robots.txt'],
]
UNIVERSE_LABELS = {
    'informatique-et-telephonie': 'Informatique et téléphonie', 'papeterie-fournitures': 'Papeterie et fournitures',
    'mobilier': 'Mobilier', 'sante': 'Santé', 'laboratoire': 'Laboratoire', 'vehicules': 'Véhicules',
    'incendie-et-secours': 'Incendie et secours', 'equipement': 'Équipement', 'energie': 'Énergie',
    'restauration': 'Restauration', 'eveil-enseignement': 'Éveil et enseignement', 'vetements-et-epi': 'Vêtements et EPI',
    'hygiene-et-entretien': 'Hygiène et entretien', 'seconde-vie': 'Seconde vie', 'cap-sur-le-sport': 'Sport',
    'handicap': 'Handicap', 'consommables-informatiques': 'Consommables informatiques (encre, toner)',
    'fournitures-de-bureau': 'Fournitures de bureau', 'telecom-reseaux-serveur': 'Télécom, réseaux, serveurs',
    'fournitures-scolaires': 'Fournitures scolaires', 'informatique-bureautique': 'Matériel informatique et bureautique',
    'reunion-accueil': 'Mobilier de réunion et d’accueil', 'arts-graphiques': 'Arts graphiques',
}


def universe(path: str) -> str:
    return re.sub(r'-\d+$', '', (path or '').split('/')[0])


def label(slug: str) -> str:
    slug = re.sub(r'-\d+$', '', slug)
    if slug in UNIVERSE_LABELS:
        return UNIVERSE_LABELS[slug]
    s = slug.replace('-', ' ').strip()
    return s[:1].upper() + s[1:]


def jsonl(pattern: str):
    for f in sorted(glob.glob(str(pattern))):
        with open(f, encoding='utf-8') as handle:
            for line in handle:
                try:
                    yield json.loads(line)
                except ValueError:
                    pass


def norm_ref(s) -> str:  # same as ugap/common.py
    return re.sub(r'[^A-Z0-9]', '', str(s or '').upper())


def iso_day(s):
    return s[:10] if s else None


# ---------------------------------------------------------------- price statistics (same rule as ugap/match.py)

def best_per_product(rows):
    best = {}
    for r in rows:
        if r['ugap_id'] not in best or r['retail_price'] < best[r['ugap_id']]['retail_price']:
            best[r['ugap_id']] = r
    return list(best.values())


def stats(best):
    ratios = sorted(r['ratio'] for r in best)
    if not ratios:
        return {'n': 0}
    q = lambda x: ratios[min(len(ratios) - 1, int(x * len(ratios)))]
    return {'n': len(ratios), 'median': round(statistics.median(ratios), 3), 'p25': q(.25), 'p75': q(.75),
            'moreExpensive': round(sum(x > 1 for x in ratios) / len(ratios), 3),
            'within10': round(sum(0.9 <= x <= 1.1 for x in ratios) / len(ratios), 3),
            'twiceOrMore': round(sum(x >= 2 for x in ratios) / len(ratios), 3),
            'halfOrLess': round(sum(x <= 0.5 for x in ratios) / len(ratios), 3),
            'basket': round(sum(r['ugap_price'] for r in best) / sum(r['retail_price'] for r in best), 3),
            'basketUgap': round(sum(r['ugap_price'] for r in best), 2),
            'basketRetail': round(sum(r['retail_price'] for r in best), 2)}


def histogram(best):
    out = []
    for lo, hi in zip(RATIO_BINS[:-1], RATIO_BINS[1:]):
        n = sum(1 for r in best if r['ratio'] >= lo and (hi is None or r['ratio'] < hi))
        out.append([lo, hi, n])
    return out


def read_matches(name):
    path = DATA / name
    if not path.exists():
        return []
    with open(path, encoding='utf-8-sig', newline='') as handle:
        rows = list(csv.DictReader(handle, delimiter=';'))
    for r in rows:
        for k in ('ugap_price', 'retail_price', 'ratio'):
            r[k] = float(r[k])
        r['price_public'] = r['price_public'] == 'True'
    return rows


def comparison(products_by_id):
    clean = read_matches('matches.csv')
    review = read_matches('matches_review.csv')
    published = [r for r in clean if r['price_public']]  # match.py default: prices hidden to visitors are excluded
    best = best_per_product(published)
    for r in best:
        txt = norm_ref(r['retail_name']) + norm_ref(r['retail_url'])
        ref = norm_ref(r['ref'])
        r['refSeen'] = len(ref) >= 5 and ref in txt

    def group(key, min_n=1):
        g = defaultdict(list)
        for r in best:
            g[key(r)].append(r)
        rows = [{'key': k, **stats(v)} for k, v in g.items() if len(v) >= min_n]
        return sorted(rows, key=lambda x: -x['n'])

    by_universe = group(lambda r: r['universe'])
    for row in by_universe:
        row['label'] = label(row['key'])
    by_category = group(lambda r: r['universe'] + '/' + r['category'], 5)
    for row in by_category:
        row['label'] = label(row['key'].split('/')[1])
        row['universe'] = row['key'].split('/')[0]
    by_retailer = group(lambda r: r['retailer'])
    for row in by_retailer:
        row['label'] = RETAILERS.get(row['key'], {}).get('name', row['key'])
    flags = Counter()
    for r in review:
        for f in (r.get('flags') or '').split('; '):
            flags['pack' if f.startswith('pack') else f] += 1

    fetched = [products_by_id[r['ugap_id']].get('fetched') for r in best if r['ugap_id'] in products_by_id]
    table = []
    for r in sorted(best, key=lambda r: (r['universe'], r['category'], r['title'] or '')):
        table.append([r['title'], r['brand'], r['ref'], r['universe'], label(r['category']), r['ugap_price'], r['retailer'],
                      r['retail_name'], r['retail_price'], r['ratio'], r['ugap_url'], r['retail_url'], int(r['refSeen']), r['match']])
    return {
        'pairsClean': len(clean), 'pairsReview': len(review), 'reviewFlags': dict(flags),
        'pairsHiddenPrice': len(clean) - len(published),
        'productsCompared': len(best),
        'matchMethod': dict(Counter(r['match'] for r in best)),
        'basis': dict(Counter(r['basis'] for r in best)),
        'all': stats(best),
        'refSeen': stats([r for r in best if r['refSeen']]),
        'histogram': histogram(best),
        'byUniverse': by_universe, 'byCategory': by_category, 'byRetailer': by_retailer,
        'ugapFetched': [min(fetched), max(fetched)] if fetched else None,
        'tableFields': ['title', 'brand', 'ref', 'universe', 'category', 'ugapTtc', 'retailer', 'retailName',
                        'retailTtc', 'ratio', 'ugapUrl', 'retailUrl', 'refSeen', 'match'],
        'table': table,
    }


# ---------------------------------------------------------------- crawl coverage

def coverage():
    catalogue, path_of = Counter(), {}
    for row in jsonl(DATA / 'ugap_urls.jsonl'):
        catalogue[universe(row.get('path'))] += 1
        path_of[row['id']] = row.get('path')
    products, crawled, public, with_ref, with_ean, fetched = {}, Counter(), Counter(), 0, 0, []
    for p in jsonl(DATA / 'ugap_products' / '*.jsonl'):
        products[p['id']] = p
    for p in products.values():
        u = universe(p.get('path'))
        crawled[u] += 1
        public[u] += bool(p.get('price_public'))
        with_ref += len(norm_ref(p.get('ref_manufacturer'))) >= 4
        with_ean += bool(p.get('ean'))
        if p.get('fetched'):
            fetched.append(p['fetched'])
    errors, err_u, seen = Counter(), Counter(), set()
    for e in jsonl(DATA / 'ugap_errors' / '*.jsonl'):
        if e.get('id') in seen or e.get('id') in products:
            continue
        seen.add(e.get('id'))
        kind = e.get('error', '?')
        errors[kind if kind.startswith(('http_', 'robots')) else 'page illisible'] += 1
        err_u[universe(path_of.get(e.get('id'), ''))] += 1
    universes = []
    for u, n in catalogue.most_common():
        universes.append({'key': u, 'label': label(u), 'catalogue': n, 'crawled': crawled.get(u, 0),
                          'errors': err_u.get(u, 0), 'publicPrice': public.get(u, 0)})
    retailers = []
    for key, meta in RETAILERS.items():
        urls_file = DATA / f'retail_urls_{key}.jsonl'
        urls = sum(1 for _ in open(urls_file, encoding='utf-8')) if urls_file.exists() else 0
        recs = list(jsonl(DATA / f'retail_{key}' / '*.jsonl'))
        ok = [r for r in recs if not r.get('error')]
        dates = sorted(r['fetched'] for r in ok if r.get('fetched'))
        retailers.append({'key': key, **meta, 'urls': urls, 'fetched': len(recs), 'parsed': len(ok),
                          'withPrice': sum(1 for r in ok if r.get('price')),
                          'usable': sum(1 for r in ok if r.get('price') and (r.get('mpn') or r.get('gtin'))),
                          'dates': [iso_day(dates[0]), iso_day(dates[-1])] if dates else None})
    fetched.sort()
    lab = 'laboratoire'
    non_lab_cat = sum(n for u, n in catalogue.items() if u != lab)
    non_lab_done = sum(n for u, n in crawled.items() if u != lab)
    return {
        'catalogue': sum(catalogue.values()), 'crawled': len(products), 'errors': sum(errors.values()),
        'errorKinds': dict(errors.most_common(6)),
        'publicPrice': sum(public.values()), 'withRef': with_ref, 'withEan': with_ean,
        'nonLabCatalogue': non_lab_cat, 'nonLabCrawled': non_lab_done,
        'labCatalogue': catalogue.get(lab, 0), 'labCrawled': crawled.get(lab, 0),
        'ugapDates': [iso_day(fetched[0]), iso_day(fetched[-1])] if fetched else None,
        'universes': universes, 'retailers': retailers, 'excluded': EXCLUDED,
    }, products


# ---------------------------------------------------------------- DECP

def decp(products):
    try:
        import duckdb
    except ImportError:
        print('· duckdb absent: section DECP omise')
        return None
    sys.path.insert(0, str(ROOT / 'scripts'))
    os.chdir(ROOT)
    from rawfiles import csv as raw_csv
    con = duckdb.connect()
    parts = []
    for name in ('decp-v3', 'decp-2022'):
        src = raw_csv(name, ', max_line_size=10000000')
        if not src:
            continue
        cols = {r[0] for r in con.execute(f'DESCRIBE SELECT * FROM {src}').fetchall()}
        col = lambda c: c if c in cols else 'NULL'
        parts.append(f"""SELECT * FROM (SELECT '{name}' AS source, {col('id')} AS id,
            regexp_replace({col('acheteur_id')}, '\\s', '', 'g') AS buyer, {col('acheteur_nom')} AS buyer_name,
            regexp_replace({col('titulaire_id_1')}, '\\s', '', 'g') AS supplier, TRY_CAST({col('montant')} AS DOUBLE) AS amount,
            TRY_CAST(left({col('datenotification')}, 10) AS DATE) AS notified, {col('procedure')} AS procedure,
            {col('nature')} AS nature, {col('techniques')} AS techniques, {col('objet')} AS object,
            TRY_CAST({col('offresrecues')} AS INTEGER) AS bids FROM {src})
            WHERE left(buyer, 9) = '{UGAP_SIREN}' OR left(supplier, 9) = '{UGAP_SIREN}'""")
    if not parts:
        return None
    con.execute('CREATE TABLE raw AS ' + ' UNION ALL '.join(parts))
    con.execute("""CREATE TABLE m AS SELECT * EXCLUDE (rn) FROM (SELECT *, row_number() OVER
        (PARTITION BY buyer, id, notified, amount ORDER BY source DESC) AS rn FROM raw) WHERE rn = 1""")
    con.execute("""ALTER TABLE m ADD COLUMN plausible BOOLEAN; UPDATE m SET plausible = amount > 1 AND amount < ?
        AND NOT (amount >= 1e7 AND CAST(CAST(round(amount) AS BIGINT) AS VARCHAR) LIKE '%99999%')
        AND NOT (amount >= 1e8 AND CAST(round(amount) AS BIGINT) % 10000000 = 0)""", [MAX_PLAUSIBLE])
    con.execute("""ALTER TABLE m ADD COLUMN framework BOOLEAN; UPDATE m SET framework =
        coalesce(nature ILIKE '%accord%cadre%', false) OR coalesce(techniques ILIKE '%accord%cadre%', false)""")
    con.execute('UPDATE m SET bids = NULL WHERE bids > 500 OR bids < 0')
    q = lambda sql, p=None: [list(r) for r in con.execute(sql, p or []).fetchall()]
    raw_count = q('SELECT count(*) FROM raw')[0][0]
    buyer = f"left(buyer, 9) = '{UGAP_SIREN}'"
    supplier = f"left(supplier, 9) = '{UGAP_SIREN}' AND NOT {buyer}"

    as_buyer_year = q(f"""SELECT year(notified) y, count(*), count(*) FILTER (WHERE framework), count(*) FILTER (WHERE NOT framework),
        count(*) FILTER (WHERE bids IS NOT NULL), round(avg(bids) FILTER (WHERE bids > 0), 1), count(*) FILTER (WHERE bids = 1),
        count(DISTINCT left(supplier, 9)) FROM m WHERE {buyer} AND notified IS NOT NULL GROUP BY 1 ORDER BY 1""")
    months = q(f"SELECT strftime(notified, '%Y-%m'), count(*) FROM m WHERE {buyer} AND notified IS NOT NULL GROUP BY 1 ORDER BY 1")
    procedures = q(f"SELECT coalesce(procedure, '(non renseignée)'), count(*) FROM m WHERE {buyer} GROUP BY 1 ORDER BY 2 DESC LIMIT 8")
    # One line per call for tenders: lots of the same notice share the object and the notification month.
    largest = q(f"""SELECT left(regexp_replace(object, '\\s+', ' ', 'g'), 160) o, strftime(min(notified), '%Y-%m') || ' à ' || strftime(max(notified), '%Y-%m') d, count(*) lots,
        max(amount) top, count(*) FILTER (WHERE plausible) kept, bool_or(framework), round(avg(bids) FILTER (WHERE bids > 0), 1),
        min(id), any_value(source) FROM m WHERE {buyer} AND amount IS NOT NULL
        GROUP BY 1 ORDER BY top DESC LIMIT 15""")
    buyer_quality = q(f"""SELECT count(*), count(*) FILTER (WHERE NOT plausible OR plausible IS NULL), count(*) FILTER (WHERE bids IS NULL),
        min(notified), max(notified) FROM m WHERE {buyer}""")[0]

    as_supplier_year = q(f"""SELECT year(notified) y, count(*), round(sum(amount) FILTER (WHERE plausible)), count(DISTINCT left(buyer, 9)),
        count(*) FILTER (WHERE NOT plausible OR plausible IS NULL) FROM m WHERE {supplier} AND notified IS NOT NULL GROUP BY 1 ORDER BY 1""")
    top_buyers = q(f"""SELECT left(buyer, 9) s, any_value(buyer_name), count(*), round(sum(amount) FILTER (WHERE plausible)),
        strftime(min(notified), '%Y'), strftime(max(notified), '%Y') FROM m WHERE {supplier} GROUP BY 1 ORDER BY 4 DESC NULLS LAST LIMIT 12""")
    sup_quality = q(f"SELECT count(*), count(*) FILTER (WHERE NOT plausible OR plausible IS NULL), min(notified), max(notified) FROM m WHERE {supplier}")[0]

    names = {}
    buyers_json = ROOT / 'dist' / 'data' / 'marches' / 'buyers.json'
    if buyers_json.exists():
        b = json.load(open(buyers_json, encoding='utf-8'))
        for row in b['rows']:
            names[row[0]] = row[1]
    for row in top_buyers:
        row[1] = names.get(row[0]) or row[1]

    totals = {}
    summary_json = ROOT / 'dist' / 'data' / 'marches' / 'summary.json'
    if summary_json.exists():
        s = json.load(open(summary_json, encoding='utf-8'))
        f = s['perYearFields']
        for row in s['perYear']:
            r = dict(zip(f, row))
            totals[r['year']] = [r['contracts'] + r['frameworks'], round((r['amountContracts'] or 0) + (r['ceilingFrameworks'] or 0))]

    market_numbers = {str(p['market_number']) for p in products.values() if p.get('market_number')}
    ids = [str(r[0]) for r in q(f'SELECT id FROM m WHERE {buyer}')]
    found = sum(1 for i in ids if any(mk in i for mk in market_numbers))
    markets = Counter((str(p.get('market_number')), p.get('market_name'), p.get('market_end')) for p in products.values() if p.get('market_number'))
    return {
        'siren': UGAP_SIREN, 'rawRows': raw_count,
        'asBuyer': {'fields': ['year', 'rows', 'frameworks', 'others', 'withBids', 'avgBids', 'singleBid', 'suppliers'],
                    'perYear': as_buyer_year, 'months': months, 'procedures': procedures,
                    'rows': buyer_quality[0], 'implausible': buyer_quality[1], 'noBids': buyer_quality[2],
                    'first': str(buyer_quality[3]), 'last': str(buyer_quality[4]),
                    'largestFields': ['object', 'month', 'lots', 'maxAmount', 'plausibleLots', 'framework', 'avgBids', 'firstId', 'source'],
                    'largest': largest},
        'asSupplier': {'fields': ['year', 'rows', 'amount', 'buyers', 'implausible', 'decpRows', 'decpAmount'],
                       'perYear': [r + totals.get(r[0], [None, None]) for r in as_supplier_year],
                       'rows': sup_quality[0], 'implausible': sup_quality[1], 'first': str(sup_quality[2]), 'last': str(sup_quality[3]),
                       'topBuyersFields': ['siren', 'name', 'rows', 'amount', 'from', 'to'], 'topBuyers': top_buyers},
        'marketNumbers': {'catalogue': len(market_numbers), 'foundInDecpIds': found, 'decpUgapIds': len(ids),
                          'top': [[k[0], k[1], k[2], n] for k, n in markets.most_common(10)]},
    }


def sources():
    manifest = json.load(open(ROOT / 'sources' / 'raw' / 'manifest.json', encoding='utf-8'))
    out = []
    for key in ('decp-v3', 'decp-2022'):
        m = manifest.get(key)
        if m:
            out.append({'id': key, 'label': m.get('note') or key, 'downloadedAt': iso_day(m.get('downloadedAt')),
                        'url': f"https://{m.get('host')}/explore/dataset/{m.get('dataset')}/"})
    return out


def main():
    cov, products = coverage()
    comp = comparison(products)
    shards = glob.glob(str(DATA / 'ugap_products' / '*.jsonl')) + glob.glob(str(DATA / 'retail_*' / '*.jsonl'))
    newest = max(os.path.getmtime(f) for f in shards)
    matched = os.path.getmtime(DATA / 'matches.csv')
    stale = newest > matched + 60
    if stale:
        print('! matches.csv est plus ancien que les dernières fiches collectées : relancer python ugap/match.py')
    out = {
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'matchedAt': datetime.fromtimestamp(matched, timezone.utc).strftime('%Y-%m-%d'),
        'matchStale': stale,
        'coverage': cov, 'comparison': comp, 'decp': decp(products), 'sources': sources(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, ensure_ascii=False, separators=(',', ':'), default=str)
    a = comp['all']
    print(f"✓ {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} ko) : {cov['crawled']} fiches UGAP sur {cov['catalogue']}, "
          f"{comp['productsCompared']} produits comparés, médiane UGAP/revendeur {a.get('median')}")


if __name__ == '__main__':
    main()
