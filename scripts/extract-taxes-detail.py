"""Every line of the Insee « Impôts » table (categories and their « dont » details), 1995-2025, for the Impôts page.

Reads the frozen workbook sources/insee-impots-2026-08.xlsx and writes sources/taxes-insee-detail.json.
Values are kept to 4 decimals (Md€); '///' (tax that did not exist that year) becomes null.
The « dont » lines are already included in their category: they must never be added to it.
Run: python scripts/extract-taxes-detail.py
"""
import json, re
from pathlib import Path
import openpyxl

root = Path(__file__).resolve().parent.parent
sheet = openpyxl.load_workbook(root / 'sources/insee-impots-2026-08.xlsx', read_only=True, data_only=True).active
rows = list(sheet.iter_rows(min_row=1, max_row=32, values_only=True))

def year(v):
    m = re.match(r'^(19\d\d|20\d\d)', str(v))
    return int(m.group(1)) if m else None

header = rows[3]
columns = [(i, year(v)) for i, v in enumerate(header) if year(v)]

# (row index in the sheet, 1-based) -> id, label, parent category (None for a category)
LINES = [
    (5, 'vat', 'Taxe sur la valeur ajoutée (TVA)', None),
    (6, 'imports', 'Impôts et droits sur les importations', None),
    (7, 'products', 'Autres impôts sur les produits', None),
    (9, 'ticpe', 'Accises sur les produits énergétiques (TICPE)', 'products'),
    (10, 'tobacco', 'Accises sur les tabacs', 'products'),
    (11, 'payroll', 'Impôts sur les salaires et la main-d’œuvre', None),
    (12, 'payrolltax', 'Taxe sur les salaires', 'payroll'),
    (13, 'production', 'Impôts divers sur la production', None),
    (15, 'tf', 'Taxe foncière', 'production'),
    (16, 'cfe', 'Cotisation foncière des entreprises (CFE)', 'production'),
    (17, 'cvae', 'Cotisation sur la valeur ajoutée des entreprises (CVAE)', 'production'),
    (18, 'tp', 'Taxe professionnelle (supprimée en 2010)', 'production'),
    (19, 'c3s', 'Contribution sociale de solidarité des sociétés (C3S)', 'production'),
    (20, 'income', 'Impôts courants sur le revenu', None),
    (22, 'csg', 'Contribution sociale généralisée (CSG)', 'income'),
    (23, 'crds', 'Contribution au remboursement de la dette sociale (CRDS)', 'income'),
    (24, 'ir', 'Impôt sur le revenu (avant crédits d’impôt)', 'income'),
    (25, 'is', 'Impôt sur les sociétés (avant crédits d’impôt)', 'income'),
    (26, 'otherCurrent', 'Autres impôts courants', None),
    (28, 'th', 'Taxe d’habitation', 'otherCurrent'),
    (29, 'ifi', 'Impôt sur la fortune (ISF puis IFI)', 'otherCurrent'),
    (30, 'capital', 'Impôts en capital', None),
    (31, 'dmtg', 'Droits de mutation à titre gratuit (successions, donations)', 'capital'),
]

# A word that must appear in the workbook's own label, so that a moved row stops the extraction.
CHECK = {'vat': 'tva', 'imports': 'importations', 'products': 'produits', 'ticpe': 'ticpe', 'tobacco': 'tabacs', 'payroll': 'main',
         'payrolltax': 'taxes sur les salaires', 'production': 'production', 'tf': 'foncière', 'cfe': 'cotisation foncière',
         'cvae': 'valeur ajoutée', 'tp': 'professionnelle', 'c3s': 'solidarité', 'income': 'revenu', 'csg': 'csg', 'crds': 'crds',
         'ir': 'irpp', 'is': '(is)', 'otherCurrent': 'autres impôts courants', 'th': 'habitation', 'ifi': 'fortune', 'capital': 'capital',
         'dmtg': 'mutation'}

def value(v):
    if isinstance(v, (int, float)): return round(float(v), 4)
    if str(v).strip() == '///': return None
    raise ValueError(f'Unexpected cell: {v!r}')

lines = []
for row, key, label, parent in LINES:
    source_label = re.sub(r'\)\d$', ')', ' '.join(str(rows[row - 1][0]).split()))  # drop footnote calls such as « (CSG)1 »
    if CHECK[key] not in source_label.lower():
        raise ValueError(f'Row {row} moved: {source_label!r} is not {label!r}')
    lines.append({'id': key, 'label': label, 'sourceLabel': source_label, 'parent': parent,
                  'values': [value(rows[row - 1][i]) for i, _ in columns]})

years = [y for _, y in columns]
categories = [l for l in lines if l['parent'] is None]
for line in lines:
    if line['parent']:
        parent = next(c for c in categories if c['id'] == line['parent'])
        for v, total in zip(line['values'], parent['values']):
            if v is not None and v > total + 1e-9: raise ValueError(f'{line["id"]} exceeds {parent["id"]}')

out = {'publication': '2026-08-28', 'source': 'https://www.insee.fr/fr/statistiques/2381408', 'file': 'sources/insee-impots-2026-08.xlsx',
       'unit': 'milliards d’euros courants', 'status': {'2024': 'semi-définitif', '2025': 'provisoire'}, 'years': years, 'lines': lines}
(root / 'sources/taxes-insee-detail.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf8')
print(len(lines), 'lines,', years[0], '-', years[-1])
