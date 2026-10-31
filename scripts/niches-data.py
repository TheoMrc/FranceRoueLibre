"""Niches fiscales (dépenses fiscales), measure by measure, for dist/niches.html.

Two open files, both in sources/raw/ (URLs in sources/raw/manifest.json):
  - plf26-budget-vert.csv.gz : PLF 2026 « budget vert ». Its 483 « Dépenses fiscales » lines carry the cost of each measure
    (2024 estimated actual cost, 2025 and 2026 forecasts), its tax, its mission and programme, and a flag for 2026
    (« ε » = less than 0.5 M€, « nc » = not computed). A measure split between two environmental ratings appears on
    several lines, its cost already shared out: the lines are added back per measure code.
  - datagouv-depenses-fiscales--1.csv.gz : PLF 2024 « Voies et moyens » tome II, list of the 468 measures with their
    tax, section and stated purpose (« finalité »). Its cost columns are empty in the published file: it gives no amount.
The cost of tax expenditures does not add up rigorously (each measure is costed alone, all else equal): totals are
orders of magnitude, as the budget documents themselves say.
Run: python3 scripts/niches-data.py  (writes dist/data/niches.json)
"""
import csv
import gzip
import json
from collections import defaultdict
from pathlib import Path

root = Path(__file__).resolve().parent.parent
RAW = root / 'sources/raw'
manifest = json.loads((RAW / 'manifest.json').read_text(encoding='utf-8'))

YEARS = [2024, 2025, 2026]
COLS = ['execution_2024_cp', 'lfi_2025_cp_ou_prevision_2025_si_depense_fiscale', 'plf_2026_cp_ou_prevision_2026_si_depense_fiscale']
FLAG = 'depenses_fiscales_e_montant_inferieur_a_0_5_meur_nc_montant_non_calcule_en_prevision_2026'


def code_of(value):
    return str(int(float(value)))


def num(value):
    return float(value) if value not in ('', None) else None


# ---------- PLF 2026 budget vert: costs ----------
with gzip.open(RAW / 'plf26-budget-vert.csv.gz', 'rt', encoding='utf-8') as fh:
    green = [r for r in csv.DictReader(fh, delimiter=';') if r['type_depense'] == 'Dépenses fiscales']

def share(r):
    return num(r['2026_si_different_de_100']) if r['2026_si_different_de_100'] else 1.0


# Lines of one measure split between environmental ratings share its cost (shares add up to 1). Two different measures
# can also carry the same code (a new measure « reprise de l'ancienne » code): they stay apart, keyed by their label.
by_code = defaultdict(list)
for r in green:
    by_code[code_of(r['code_depense'])].append(r)
groups = {}
for code, rows in by_code.items():
    if sum(share(r) for r in rows) <= 1.01:
        groups[code] = rows
        continue
    labels = list(dict.fromkeys(r['libelle'].strip() for r in rows))
    for k, label in enumerate(labels):
        part = [r for r in rows if r['libelle'].strip() == label]
        if abs(sum(share(r) for r in part) - 1) > 0.01:
            raise SystemExit(f'measure {code}: shares do not add up')
        groups[code if k == 0 else f'{code}-{k + 1}'] = part

measures = []
for key, rows in groups.items():
    code = key.split('-')[0]
    first = rows[0]
    if len({r['mission'] for r in rows}) != 1 or len({r['impot_si_depense_fiscale'] for r in rows}) != 1:
        raise SystemExit(f'measure {code} split across missions or taxes')
    values = []
    for col in COLS:
        vals = [num(r[col]) for r in rows]
        known = [v for v in vals if v is not None]
        values.append(round(sum(known) / 1e6, 1) if known else None)
    flags = {r[FLAG] for r in rows if r[FLAG]}
    if len(flags) > 1:
        raise SystemExit(f'measure {code} has two flags')
    flag = flags.pop() if flags else None
    ratings = defaultdict(float)
    for r in rows:
        ratings[r['cotation_globale']] += share(r)
    measures.append({
        'id': key, 'c': code, 'l': first['libelle'].strip(), 'i': first['impot_si_depense_fiscale'].strip(),
        'm': first['mission'], 'p': f"{first['numero_programme']} {first['programme']}".strip(),
        'v': values, 'f': flag,
        'g': [[k, round(v, 2)] for k, v in sorted(ratings.items(), key=lambda kv: -kv[1])],
        'n': len(rows),
    })

# ---------- PLF 2024 tome II: nomenclature (no amounts in the published file) ----------
with gzip.open(RAW / 'datagouv-depenses-fiscales--1.csv.gz', 'rt', encoding='utf-8-sig') as fh:
    list24 = list(csv.reader(fh, delimiter=';'))[1:]
cost_cols_filled = sum(1 for r in list24 for c in r[6:11] if c.strip())
plf24 = {}
for r in list24:
    if not r[3]:
        continue
    plf24[code_of(r[3])] = {'i': r[0].strip(), 's': r[1].strip(), 'ss': r[2].strip(), 'l': r[4].strip(),
                            'fin': r[5].replace('Finalité :', '').strip()}
no_code = [r[4].strip() for r in list24 if not r[3]]

for m in measures:
    old = plf24.get(m['c'])
    m['in24'] = bool(old)
    if old:
        m['s'], m['ss'], m['fin'] = old['s'], old['ss'], old['fin']

codes26 = {m['c'] for m in measures}
gone = sorted(({'c': c, 'l': o['l'], 'i': o['i'], 'fin': o['fin']} for c, o in plf24.items() if c not in codes26), key=lambda g: (g['i'], g['c']))

# ---------- Aggregates ----------
def status(m):
    v = m['v'][2]
    if v is not None:
        return 'chiffré'
    return m['f'] or 'vide'


for m in measures:
    m['st'] = status(m)

totals = []
for k, year in enumerate(YEARS):
    vals = [m['v'][k] for m in measures if m['v'][k] is not None]
    totals.append({'year': year, 'total': round(sum(vals), 1), 'count': len(vals)})
constant = [m for m in measures if all(v is not None for v in m['v'])]
constant_totals = [round(sum(m['v'][k] for m in constant), 1) for k in range(3)]

lines_total = [round(sum(num(r[col]) or 0 for r in green) / 1e6, 1) for col in COLS]


def group(key):
    out = defaultdict(lambda: {'n': 0, 'v26': 0.0, 'known': 0, 'nc': 0, 'eps': 0, 'empty': 0})
    for m in measures:
        g = out[m[key]]
        g['n'] += 1
        if m['v'][2] is not None:
            g['v26'] += m['v'][2]
            g['known'] += 1
        elif m['st'] == 'nc':
            g['nc'] += 1
        elif m['st'] == 'ε':
            g['eps'] += 1
        else:
            g['empty'] += 1
    return sorted(({'name': k, **v, 'v26': round(v['v26'], 1)} for k, v in out.items()), key=lambda g: -g['v26'])


def src(file_id, idx=0, title=None):
    f = manifest[file_id]['files'][idx]
    return {'url': f['url'], 'file': f['file'], 'title': title or f.get('title') or file_id, 'modified': f.get('modified', '')[:10]}


measures.sort(key=lambda m: (-(m['v'][2] or -1), m['id']))
data = {
    'years': YEARS,
    'yearLabels': ['2024 (coût estimé constaté)', '2025 (prévision)', '2026 (prévision du PLF)'],
    'measures': measures,
    'totals': totals,
    'linesTotal': lines_total,
    'constant': {'count': len(constant), 'totals': constant_totals},
    'byTax': group('i'),
    'byMission': group('m'),
    'counts': {
        'measures': len(measures), 'lines': len(green),
        'known2026': sum(1 for m in measures if m['st'] == 'chiffré'),
        'nc': sum(1 for m in measures if m['st'] == 'nc'), 'eps': sum(1 for m in measures if m['st'] == 'ε'),
        'empty': sum(1 for m in measures if m['st'] == 'vide'),
        'neverCosted': sum(1 for m in measures if all(v is None for v in m['v'])),
        'plf24': len(plf24), 'plf24NoCode': len(no_code), 'plf24CostCells': cost_cols_filled,
        'plf24Rows': len(list24), 'inBoth': sum(1 for m in measures if m['in24']),
        'new': sum(1 for m in measures if not m['in24']), 'gone': len(gone),
    },
    'gone': gone,
    'sources': {
        'plf26': {**src('plf26-budget-vert'), 'title': 'PLF 2026, rapport sur l’impact environnemental du budget (« budget vert »), données', 'page': 'https://data.economie.gouv.fr/explore/dataset/plf-2026-budget-vert/'},
        'plf24': {**src('datagouv-depenses-fiscales'), 'title': 'PLF 2024, Évaluation des voies et moyens, tome II (dépenses fiscales), données', 'page': 'https://data.economie.gouv.fr/explore/dataset/plf-2024-vm-tome-2_depenses-fiscales/'},
    },
}

out = root / 'dist/data/niches.json'
out.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
c = data['counts']
print(f"niches.json: {c['measures']} mesures ({c['known2026']} chiffrées en 2026, {c['nc']} nc, {c['eps']} ε, {c['empty']} vides), "
      f"total 2026 {totals[2]['total']:.0f} M€, {out.stat().st_size // 1024} Ko")
