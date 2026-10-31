"""Sécurité sociale page data: branch accounts, health insurance spending by region, and what the
Assurance maladie series files contain. Reads sources/raw (manifest.json gives every origin URL) and
writes dist/data/secu.json.

Run from the repo root:  python3 scripts/secu-data.py

The .xls files are read with xlrd when it is installed (pip install xlrd); otherwise they are converted
with LibreOffice (soffice --headless) into a temporary folder and read with openpyxl."""
import csv
import glob
import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'sources' / 'raw'
OUT = ROOT / 'dist' / 'data' / 'secu.json'
MANIFEST = json.loads((RAW / 'manifest.json').read_text(encoding='utf8'))
DATASET = 'https://www.data.gouv.fr/datasets/{}/'


# ---------- .xls reading ----------
def read_xls(path):
    """{sheet name: list of rows (lists of cell values)}."""
    try:
        import xlrd  # noqa: F401
        book = xlrd.open_workbook(str(path))
        return {s.name: [s.row_values(i) for i in range(s.nrows)] for s in book.sheets()}
    except ImportError:
        pass
    soffice = shutil.which('soffice') or shutil.which('libreoffice')
    if not soffice:
        sys.exit('Lecture .xls impossible : installez xlrd (pip install xlrd) ou LibreOffice.')
    import openpyxl
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / Path(path).name
        shutil.copy(path, src)
        env = dict(os.environ, HOME=tmp)
        subprocess.run([soffice, '--headless', '--convert-to', 'xlsx', '--outdir', tmp, str(src)],
                       check=True, capture_output=True, env=env, timeout=300)
        book = openpyxl.load_workbook(src.with_suffix('.xlsx'), data_only=True, read_only=True)
        return {ws.title: [list(r) for r in ws.iter_rows(values_only=True)] for ws in book.worksheets}


def clean(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def is_num(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def source_meta(source_id):
    entry = MANIFEST[source_id]
    return {'id': source_id, 'page': DATASET.format(entry['slug']), 'downloadedAt': entry.get('downloadedAt'),
            'files': [{'file': f['file'], 'url': f['url'], 'title': f.get('title') or '', 'bytes': f.get('bytes')} for f in entry['files']]}


# ---------- 1. Comptes simplifiés des régimes de base ----------
# (label in the file, id, level). Level 0 = totals, 1 = lines that add up to the total, 2+ = « dont ».
LINES = [
    ('CHARGES NETTES', 'charges', 0), ('Prestations', 'prestations', 1), ('prestations légales nettes', 'prest_legales', 2),
    ('prestations extra-légales nettes', 'prest_extra', 2), ('autres prestations nettes', 'prest_autres', 2),
    ('Transferts nets', 'transferts_ch', 1), ('Transferts entre RB', 'transf_rb', 2), ('Transfert vers le FSV', 'transf_fsv', 2),
    ('Autres transferts', 'transf_autres', 2), ('Charges financières', 'ch_fin', 1), ('Charges de gestion courante', 'gestion', 1),
    ('Autres charges', 'ch_autres', 1),
    ('PRODUITS NETS', 'produits', 0), ('Cotisations effectives', 'cotis', 1), ('Cotisations brutes', 'cotis_brutes', 2),
    ('reprises nettes de provisions et ANV', 'cotis_prov', 2), ("Cotisations fictives d'employeur", 'cotis_fictives', 1),
    ('Cotisations prises en charge par l’État', 'cotis_etat', 1), ('Cotisations prises en charge par la Sécu.', 'cotis_secu', 1),
    ('CSG, impôts et taxes affectés', 'csg_itaf', 1), ('CSG nette', 'csg_nette', 2), ('CSG', 'csg', 3), ('provisions et ANV', 'csg_prov', 3),
    ('Impôts et taxes affectées (ITAF)', 'itaf', 2), ('ITAF compensant des exonérations', 'itaf_exo', 3),
    ('ITAF compensant les allégements généraux', 'itaf_alleg', 4), ('ITAF compensant les heures supplémentaires et rachats de RTT', 'itaf_hs', 4),
    ('Autres ITAF', 'itaf_autres', 3), ('Transferts entre organismes', 'transferts_pr', 1), ('Reçus des régimes de base', 'recus_rb', 2),
    ('Reçus de la CNSA', 'recus_cnsa', 2), ('Reçus du FSV', 'recus_fsv', 2), ("Reçus de l'Etat", 'recus_etat', 2), ('Autres', 'recus_autres', 2),
    ('Produits financiers', 'pr_fin', 1), ('Autres produits', 'pr_autres', 1), ('Solde', 'solde', 0),
]
LABELS = {
    'charges': 'Charges nettes', 'prestations': 'Prestations', 'prest_legales': 'Prestations légales nettes',
    'prest_extra': 'Prestations extra-légales nettes', 'prest_autres': 'Autres prestations nettes', 'transferts_ch': 'Transferts versés (nets)',
    'transf_rb': 'Transferts entre régimes de base', 'transf_fsv': 'Transfert vers le FSV', 'transf_autres': 'Autres transferts',
    'ch_fin': 'Charges financières', 'gestion': 'Charges de gestion courante', 'ch_autres': 'Autres charges', 'produits': 'Produits nets',
    'cotis': 'Cotisations effectives', 'cotis_brutes': 'Cotisations brutes', 'cotis_prov': 'Provisions et admissions en non-valeur',
    'cotis_fictives': 'Cotisations fictives d’employeur', 'cotis_etat': 'Cotisations prises en charge par l’État',
    'cotis_secu': 'Cotisations prises en charge par la Sécurité sociale', 'csg_itaf': 'CSG, impôts et taxes affectés', 'csg_nette': 'CSG nette',
    'csg': 'CSG brute', 'csg_prov': 'Provisions et admissions en non-valeur', 'itaf': 'Impôts et taxes affectés (ITAF)',
    'itaf_exo': 'ITAF compensant des exonérations', 'itaf_alleg': 'compensant les allégements généraux',
    'itaf_hs': 'compensant les heures supplémentaires et rachats de RTT', 'itaf_autres': 'Autres ITAF', 'transferts_pr': 'Transferts reçus',
    'recus_rb': 'Reçus des régimes de base', 'recus_cnsa': 'Reçus de la CNSA', 'recus_fsv': 'Reçus du FSV', 'recus_etat': 'Reçus de l’État',
    'recus_autres': 'Autres', 'pr_fin': 'Produits financiers', 'pr_autres': 'Autres produits', 'solde': 'Solde',
}
BRANCHES = [('maladie', 'Maladie'), ('atmp', 'Accidents du travail et maladies professionnelles'), ('famille', 'Famille'),
            ('vieillesse', 'Vieillesse'), ('total', 'Toutes branches (consolidé)')]


def norm_label(text):
    return clean(text).replace("'", '’').lower()


def build_accounts():
    sheets = read_xls(RAW / 'datagouv-secu-comptes--1.xls')
    years, scopes = [], {'tous': {}, 'rg': {}, 'fsv': {}}
    wanted = {norm_label(label): (key, level) for label, key, level in LINES}
    for name, rows in sheets.items():
        title = clean(rows[0][1]) if rows and len(rows[0]) > 1 else ''
        m = re.search(r'(\d{4})', name)
        if not m:
            continue
        year = int(m.group(1))
        heads = [clean(c).lower() for c in rows[1]]
        assert heads[2:7] == ['maladie', 'at-mp', 'famille', 'vieillesse', 'toutes branches'], (name, heads)
        assert heads[9:14] == ['maladie', 'at-mp', 'famille', 'vieillesse', 'toutes branches'] and heads[15] == 'fsv', (name, heads)
        assert 'Tous régimes' in title, title
        found = {}
        for row in rows[2:]:
            label = norm_label(row[1] if len(row) > 1 else '')
            if label not in wanted:
                continue
            key = wanted[label][0]
            if key in found:
                continue
            found[key] = True
            get = lambda col: round(float(row[col]), 1) if len(row) > col and is_num(row[col]) else None
            scopes['tous'].setdefault(key, {})[year] = [get(c) for c in range(2, 7)]
            scopes['rg'].setdefault(key, {})[year] = [get(c) for c in range(9, 14)]
            scopes['fsv'].setdefault(key, {})[year] = get(15)
        missing = [k for _, k, _ in LINES if k not in found]
        assert not missing, (name, missing)
        years.append(year)
    years.sort()
    lines = [{'id': key, 'label': LABELS[key], 'level': level,
              'tous': [scopes['tous'][key][y] for y in years], 'rg': [scopes['rg'][key][y] for y in years],
              'fsv': [scopes['fsv'][key][y] for y in years]} for _, key, level in LINES]
    # Checks against the published totals: lines of level 1 add up to the totals, solde = produits − charges.
    checks = []
    by = {l['id']: l for l in lines}
    for scope in ('tous', 'rg'):
        for yi, year in enumerate(years):
            for b in range(5):
                for total, start, end in (('charges', 'prestations', 'produits'), ('produits', 'cotis', 'solde')):
                    ids = [l['id'] for l in lines[[x['id'] for x in lines].index(start):[x['id'] for x in lines].index(end)] if l['level'] == 1]
                    s = sum(by[i][scope][yi][b] or 0 for i in ids)
                    checks.append({'scope': scope, 'year': year, 'branch': BRANCHES[b][0], 'what': f'{total} = somme des postes',
                                   'published': by[total][scope][yi][b], 'recomputed': round(s, 1)})
                p, c, s = by['produits'][scope][yi][b], by['charges'][scope][yi][b], by['solde'][scope][yi][b]
                checks.append({'scope': scope, 'year': year, 'branch': BRANCHES[b][0], 'what': 'solde = produits − charges',
                               'published': s, 'recomputed': round(p - c, 1)})
    worst = max(abs(c['published'] - c['recomputed']) for c in checks)
    return {
        'unit': 'M€ courants', 'years': years,
        'scopes': [{'id': 'tous', 'label': 'Tous régimes de base'}, {'id': 'rg', 'label': 'Régime général'}],
        'branches': [{'id': i, 'label': l} for i, l in BRANCHES],
        'lines': lines, 'maxCheckGap': round(worst, 2), 'checks': len(checks),
        'source': source_meta('datagouv-secu-comptes'),
    }


# ---------- 2. Dépenses remboursées par région (janvier-juillet 2012) ----------
OLD_REGIONS = {  # code: (name, départements) – régions administratives en vigueur en 2012
    '11': ('Île-de-France', '75 77 78 91 92 93 94 95'), '21': ('Champagne-Ardenne', '08 10 51 52'), '22': ('Picardie', '02 60 80'),
    '23': ('Haute-Normandie', '27 76'), '24': ('Centre', '18 28 36 37 41 45'), '25': ('Basse-Normandie', '14 50 61'),
    '26': ('Bourgogne', '21 58 71 89'), '31': ('Nord-Pas-de-Calais', '59 62'), '41': ('Lorraine', '54 55 57 88'), '42': ('Alsace', '67 68'),
    '43': ('Franche-Comté', '25 39 70 90'), '52': ('Pays de la Loire', '44 49 53 72 85'), '53': ('Bretagne', '22 29 35 56'),
    '54': ('Poitou-Charentes', '16 17 79 86'), '72': ('Aquitaine', '24 33 40 47 64'), '73': ('Midi-Pyrénées', '09 12 31 32 46 65 81 82'),
    '74': ('Limousin', '19 23 87'), '82': ('Rhône-Alpes', '01 07 26 38 42 69 73 74'), '83': ('Auvergne', '03 15 43 63'),
    '91': ('Languedoc-Roussillon', '11 30 34 48 66'), '93': ('Provence-Alpes-Côte d’Azur', '04 05 06 13 83 84'), '94': ('Corse', '2A 2B'),
}
FILE_NAMES = {  # name in the file -> code
    'ILE DE FRANCE': '11', 'CHAMPAGNE ARDENNE': '21', 'PICARDIE': '22', 'HAUTE NORMANDIE': '23', 'CENTRE': '24', 'BASSE NORMANDIE': '25',
    'BOURGOGNE': '26', 'NORD PAS DE CALAIS': '31', 'LORRAINE': '41', 'ALSACE': '42', 'FRANCHE COMTE': '43', 'PAYS DE LA LOIRE': '52',
    'BRETAGNE': '53', 'POITOU CHARENTES': '54', 'AQUITAINE': '72', 'MIDI PYRENEES': '73', 'LIMOUSIN': '74', 'RHONE ALPES': '82',
    'AUVERGNE': '83', 'LANGUEDOC ROUSSILLON': '91', "PROVENCE ALPES COTE D'AZUR": '93', 'CORSE': '94',
}
# OFGL republishes its history on today's geography: Alsace (67A) groups Bas-Rhin and Haut-Rhin, Lyon (691) is part of Rhône.
DEP_REGION = {d: code for code, (_, deps) in OLD_REGIONS.items() for d in deps.split()}
DEP_REGION.update({'67A': '42', '691': '82'})
POSTS = [('ville', 'Soins de ville'), ('etab', 'Établissements sanitaires publics et privés'), ('medsoc', 'Établissements médico-sociaux'), ('total', 'Total')]


def population_2012():
    """Population totale 2012 par département (OFGL, population Insee en vigueur pour l’exercice 2012)."""
    path = ROOT / 'sources' / 'ofgl-departements-depenses-2012-2025.csv'
    pop = {}
    with open(path, encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f, delimiter=';'):
            if row['exer'] == '2012' and row['ptot']:
                # One row per budget holder (SIREN): Alsace (67A) carries Bas-Rhin and Haut-Rhin as two rows in 2012.
                pop[(row['dep_code'].zfill(2), row['siren'])] = int(float(row['ptot']))
    out = {}
    for (dep, _), value in pop.items():
        out[dep] = out.get(dep, 0) + value
    return out


def build_regions():
    rows = next(iter(read_xls(RAW / 'datagouv-cnam-regions--1.xls').values()))
    text = ' '.join(clean(c) for r in rows[:6] for c in r if c)
    period = re.search(r'PERIODE DU ([\d.]+) AU ([\d.]+)', text)
    assert period and 'euros' in text.lower(), text
    head = [clean(c) for c in rows[10]]
    assert head[1].startswith('TOTAL Soins de ville') and head[3].startswith('TOTAL Etablissements sanitaires') and head[5].startswith('TOTAL Etablissements médicaux') and head[7] == 'TOTAL', head
    pop = population_2012()
    regions, france = [], None
    for row in rows[12:]:
        name = clean(row[0]).upper()
        if not name:
            continue
        vals = {k: round(float(row[1 + 2 * i])) for i, (k, _) in enumerate(POSTS)}
        growth = {k: round(float(row[2 + 2 * i]), 2) for i, (k, _) in enumerate(POSTS)}
        if name.startswith('FRANCE M'):
            france = {'amounts': vals, 'growth': growth}
            continue
        code = FILE_NAMES[name]
        label, deps = OLD_REGIONS[code]
        p = sum(v for d, v in pop.items() if DEP_REGION.get(d) == code)
        regions.append({'code': code, 'name': label, 'deps': deps.split(), 'population': p, 'amounts': vals, 'growth': growth,
                        'perHab': {k: round(v / p, 1) for k, v in vals.items()}})
    assert len(regions) == 22 and france, len(regions)
    sums = {k: sum(r['amounts'][k] for r in regions) for k, _ in POSTS}
    france['population'] = sum(r['population'] for r in regions)
    france['perHab'] = {k: round(v / france['population'], 1) for k, v in france['amounts'].items()}
    france['sumOfRegions'] = sums
    return {
        'period': {'from': '2012-01-01', 'to': '2012-07-31', 'label': 'du 1er janvier au 31 juillet 2012'},
        'unit': '€ remboursés (montants cumulés sur 7 mois)', 'growthLabel': 'évolution par rapport à la même période de 2011 (PCAP), en %',
        'posts': [{'id': i, 'label': l} for i, l in POSTS], 'regions': regions, 'france': france,
        'population': {'label': 'Population totale 2012 (Insee, telle qu’utilisée par l’OFGL pour l’exercice 2012), sommée par département',
                       'url': 'https://data.ofgl.fr/explore/dataset/ofgl-base-departements-consolidee/'},
        'source': source_meta('datagouv-cnam-regions'),
    }


# ---------- 3. Soins de ville et cliniques privées : ce que contiennent les fichiers ----------
def table(sheet):
    out = []
    for r in sheet[1:]:
        cells = [clean(c) if not is_num(c) else (str(int(c)) if float(c).is_integer() else str(c)) for c in r[:2]]
        if cells and cells[0]:
            out.append(cells)
    return out


def listing(path):
    """What the downloaded « CSV » really is: an HTML page listing the real files behind a token."""
    raw = gzip.open(path).read()
    if b'<html' not in raw[:400].lower():
        return {'isData': True, 'files': []}
    names = re.findall(rb'file=[^"&]*?/([^"/&]+)"', raw)
    return {'isData': False, 'files': sorted({n.decode('latin-1') for n in names})}


def build_series_files():
    out = {}
    for key, sid, sheets_wanted in (('ville', 'datagouv-cnam-ville', ('exe_spe1', 'pre_spe1', 'asu_nat', 'serie', 'prs_nat', 'exe_spe')),
                                    ('cliniques', 'datagouv-cnam-cliniques', ('eta_typ', 'serie', 'prs_nat', 'region', 'cpam', 'psh_ddp'))):
        sheets = read_xls(next(RAW.glob(f'{sid}--1.xls')))
        sheets = {clean(k): v for k, v in sheets.items()}
        perimeter = [clean(r[0]) for r in sheets['périmètre des données'][1:] if r and clean(r[0]) and clean(r[0]) != ',']
        lists = {name: table(sheets[name]) for name in sheets_wanted if name in sheets}
        variables = []
        if 'variables' in sheets:
            variables = [[clean(r[0]), clean(r[1])] for r in sheets['variables'][1:] if r and clean(r[0]) and not clean(r[0]).startswith('l_')]
        meta = source_meta(sid)
        years = []
        for f in meta['files'][1:]:
            info = listing(RAW / f['file'])
            m = re.search(r'Annee=(\d{4})', f['url'])
            years.append({'year': int(m.group(1)), 'url': f['url'], 'isData': info['isData'], 'files': info['files']})
        years.sort(key=lambda y: y['year'])
        out[key] = {
            'perimeter': perimeter, 'variables': variables,
            'counts': {name: len(rows) for name, rows in lists.items()},
            'lists': {name: rows for name, rows in lists.items() if name in ('exe_spe1', 'pre_spe1', 'asu_nat', 'eta_typ')},
            'series': [r for r in lists.get('serie', [])],
            'years': years, 'dataFiles': sum(y['isData'] for y in years),
            'source': meta,
        }
    return out


# ---------- 4. Contexte : administrations de sécurité sociale dans les comptes nationaux ----------
def build_context():
    sectors = json.loads((ROOT / 'sources' / 'national-sectors-3215.json').read_text(encoding='utf8'))
    pop = {p['year']: p['population'] for p in json.loads((ROOT / 'sources' / 'insee-population.json').read_text(encoding='utf8'))['january1']}
    rows = []
    for y in sectors['years']:
        s = next(x for x in y['sectors'] if x['id'] == 'social')
        rows.append({'year': y['year'], 'spending': s['spending'], 'revenue': s['revenue'], 'balance': s['balance'],
                     'shareOfApu': round(s['spending'] / y['totalSpending'], 4),
                     'population': pop.get(y['year'])})
    return {'unit': sectors['unit'], 'table': sectors['table'], 'publication': sectors['publication'], 'url': sectors['source'],
            'note': 'Dépenses et recettes non consolidées des administrations de sécurité sociale (régimes de base, régimes complémentaires, assurance chômage, hôpitaux publics, Cades, FSV…), au sens de la comptabilité nationale.',
            'populationUrl': 'https://www.insee.fr/fr/statistiques/serie/001641586', 'years': rows}


def main():
    data = {'generated': 'scripts/secu-data.py', 'accounts': build_accounts(), 'regions': build_regions(),
            'seriesFiles': build_series_files(), 'context': build_context()}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    a = data['accounts']
    print(f"secu.json : comptes {a['years']} (écart max des contrôles {a['maxCheckGap']} M€), "
          f"{len(data['regions']['regions'])} régions, {OUT.stat().st_size // 1024} ko")


if __name__ == '__main__':
    main()
