"""Lookup of the communes for the search boxes and the map: name, département, population, postal codes, and the last
year with State-aided projects. Postal codes come from La Poste's « Base officielle des codes postaux » (data.gouv.fr),
downloaded by this script into sources/raw/laposte/; the rest from the site's data (communes-meta.json, OFGL
population, DGCL projects).

  python scripts/communes-lookup.py            download if missing, then build dist/data/web/communes-lookup.json
  python scripts/communes-lookup.py --refresh  download again"""
import argparse
import csv
import io
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = 'https://www.data.gouv.fr/api/1/datasets/545b55e1c751df52de9b6045/'
PAGE = 'https://www.data.gouv.fr/datasets/base-officielle-des-codes-postaux/'
RAW = ROOT / 'sources' / 'raw' / 'laposte' / 'base-officielle-codes-postaux.csv'
WEB = ROOT / 'dist' / 'data' / 'web'
OUT = WEB / 'communes-lookup.json'
# Arrondissements of Paris, Lyon and Marseille: La Poste gives their own codes, the accounts the city's
CITY = {'751': '75056', '693': '69123', '132': '13055'}


def download():
    with urllib.request.urlopen(urllib.request.Request(DATASET, headers={'User-Agent': 'FranceRoueLibre'}), timeout=60) as r:
        meta = json.load(r)
    res = [x for x in meta['resources'] if (x.get('format') or '').lower() == 'csv' or x['url'].lower().endswith('.csv')]
    if not res:
        raise SystemExit('aucune ressource CSV dans le jeu La Poste')
    url = sorted(res, key=lambda x: x.get('last_modified') or '', reverse=True)[0]['url']
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'FranceRoueLibre'}), timeout=120) as r:
        raw = r.read()
    RAW.parent.mkdir(parents=True, exist_ok=True)
    RAW.write_bytes(raw)
    (RAW.parent / 'source.json').write_text(json.dumps({'page': PAGE, 'url': url, 'bytes': len(raw)}, indent=1), encoding='utf-8')
    print(f'{RAW.relative_to(ROOT)} : {len(raw):,} octets depuis {url}')


def postal_codes():
    text = RAW.read_bytes().decode('utf-8-sig', 'replace')
    sample = text[:2000]
    reader = csv.DictReader(io.StringIO(text), delimiter=';' if sample.count(';') > sample.count(',') else ',')
    cols = {c.lower().strip(): c for c in reader.fieldnames}
    insee = next(cols[c] for c in cols if 'insee' in c)
    cp = next(cols[c] for c in cols if 'postal' in c)
    out = {}
    for row in reader:
        code, post = (row[insee] or '').strip().zfill(5), (row[cp] or '').strip().zfill(5)
        if not re.fullmatch(r'\d[\dAB]\d{3}', code) or not re.fullmatch(r'\d{5}', post):
            continue
        code = CITY.get(code[:3], code) if code[:3] in CITY and code not in CITY.values() else code
        out.setdefault(code, set()).add(post)
    return out


def last_project_year():
    last = {}
    for path in sorted(WEB.glob('projects-*.json')):
        year = int(path.stem[-4:])
        for row in json.loads(path.read_text(encoding='utf-8'))['rows']:
            last[row[3]] = max(last.get(row[3], 0), year)
    return last


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--refresh', action='store_true')
    a = ap.parse_args()
    if a.refresh or not RAW.is_file():
        download()
    cps = postal_codes()
    meta = json.loads((WEB / 'communes-meta.json').read_text(encoding='utf-8'))
    pop = json.loads((ROOT / 'dist' / 'data' / 'local' / 'communes' / '_pop.json').read_text(encoding='utf-8'))
    last_pop = pop['values'][-1]
    projects = last_project_year()
    rows = [[code, name, dep, last_pop[i] or 0, ' '.join(sorted(cps.get(code, ()))), projects.get(code, 0)]
            for i, (code, name, dep, *_r) in enumerate(meta['rows'])]
    missing = sum(1 for r in rows if not r[4])
    OUT.write_text(json.dumps({'about': 'python scripts/communes-lookup.py', 'source': {'postal': PAGE, 'population': f'OFGL {pop["years"][-1]}'},
                               'cols': ['insee', 'nom', 'dep', 'population', 'codes_postaux', 'derniere_annee_projets'],
                               'deps': {k: v[0] for k, v in meta['departments'].items()}, 'rows': rows},
                              ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)} : {len(rows)} communes, {missing} sans code postal, {OUT.stat().st_size:,} octets')


if __name__ == '__main__':
    main()
