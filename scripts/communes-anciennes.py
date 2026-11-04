"""Former communes (merged into a « commune nouvelle », absorbed, or renamed) → the commune of today, so that a reader
who types « Champ-sur-Layon » or « Saint-Félix-de-Reilhac-et-Mortemart » reaches the accounts of the commune that took
it over. Source: Insee, Code officiel géographique, file of the communes' events since 1943 (v_mvt_commune_AAAA),
found in the data.gouv.fr dataset of the COG and downloaded here.

  python scripts/communes-anciennes.py           download (sources/raw/cog-mvt-commune.csv) and build
  python scripts/communes-anciennes.py --local   build from the file already downloaded

Output: dist/data/web/communes-anciennes.json, rows [former name, former INSEE code, INSEE code of today, year of
the change]; read by server/assistant/places.py."""
import csv
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'sources' / 'raw' / 'cog-mvt-commune.csv'
OUT = ROOT / 'dist' / 'data' / 'web' / 'communes-anciennes.json'
LOOKUP = ROOT / 'dist' / 'data' / 'web' / 'communes-lookup.json'
DATASET = 'https://www.data.gouv.fr/api/1/datasets/58c984b088ee386cdb1261f3/'


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'FranceRoueLibre (scripts/communes-anciennes.py)'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def download() -> dict:
    meta = json.loads(get(DATASET))
    files = [r for r in meta['resources'] if re.search(r'mvt[_-]?commune', (r.get('title') or '') + ' ' + (r.get('url') or ''), re.I)
             and (r.get('format') or '').lower() in ('csv', '')]
    if not files:
        sys.exit('aucun fichier « mvt_commune » dans le jeu du COG sur data.gouv.fr : vérifier ' + DATASET)
    year = lambda r: max([int(y) for y in re.findall(r'20\d\d', (r.get('title') or '') + (r.get('url') or ''))] or [0])
    best = max(files, key=year)
    data = get(best['url'])
    RAW.parent.mkdir(parents=True, exist_ok=True)
    RAW.write_bytes(data)
    print(f'{best["title"]} ({year(best)}) : {len(data) / 1e6:.1f} Mo -> {RAW}')
    return {'title': best['title'], 'url': best['url'], 'page': meta.get('page')}


def main():
    source = {'title': 'Insee, COG, mouvements des communes', 'page': 'https://www.insee.fr/fr/information/2560452'}
    if '--local' not in sys.argv:
        source = download()
    text = RAW.read_bytes().decode('utf-8-sig', errors='replace')
    rows = list(csv.DictReader(io.StringIO(text), delimiter=',' if text.count(',') > text.count(';') else ';'))
    if not rows or 'COM_AV' not in rows[0]:
        sys.exit(f'colonnes inattendues dans {RAW} : {list(rows[0]) if rows else "fichier vide"}')
    today = {r[0] for r in json.loads(LOOKUP.read_text(encoding='utf-8'))['rows']}
    nxt = {}      # former code -> code it went to (latest event first wins)
    names = {}    # (former code, former name) -> year
    for r in sorted(rows, key=lambda r: r['DATE_EFF']):
        if r.get('TYPECOM_AV') != 'COM' or r.get('TYPECOM_AP') not in ('COM',):
            continue
        av, ap, year = r['COM_AV'], r['COM_AP'], r['DATE_EFF'][:4]
        if av != ap:
            nxt[av] = ap
        if r['LIBELLE_AV'] != r.get('LIBELLE_AP') or av != ap:
            names[(av, r['LIBELLE_AV'])] = year

    def resolve(code):
        seen = set()
        while code not in today and code in nxt and code not in seen:
            seen.add(code)
            code = nxt[code]
        return code if code in today else None
    out = []
    for (av, name), year in sorted(names.items()):
        cur = av if av in today else resolve(av)
        if cur:
            out.append([name, av, cur, int(year)])
    OUT.write_text(json.dumps({'source': source, 'champs': ['ancien nom', 'ancien code Insee', 'code Insee actuel', 'année'],
                               'rows': out}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{OUT} : {len(out)} anciens noms rattachés à une commune actuelle')


if __name__ == '__main__':
    main()
