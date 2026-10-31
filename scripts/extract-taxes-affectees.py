"""Taxes affectées (PLF 2024) and the few budget figures used to fill the Impôts list, frozen in sources/taxes-affectees.json.

Reads, in sources/raw/ (URLs in sources/raw/manifest.json):
  - plf24-taxes-affectees.csv.gz : PLF 2024 « Voies et moyens » tome I, list of the taxes affected to bodies other than the
    State budget (267 tax × beneficiary lines). For 2022 (actual), 2023 and 2024 (forecasts): yield, ceiling (« plafond »)
    and what goes back to the State budget above the ceiling (« reversement au budget général »). The published file
    lost the header of the yield columns; a label row in the middle of the file names the other ones (« Plafond 2022 »,
    « Reversement BG 2022 »…, « Début du plafonnement »). On every capped line, reversement = max(0, yield - ceiling):
    this is checked below.
  - plf25-recettes.csv.gz : PLF 2025 State budget revenue lines (forecast 2025), for the TGAP (line 1756) and the vehicle
    registration « malus » (line 1726).
  - ofgl-regions.csv.gz : OFGL consolidated regional accounts, aggregate « Cartes grises » (regional vehicle registration tax).
Amounts in millions of euros. Run: python3 scripts/extract-taxes-affectees.py
"""
import csv
import gzip
import json
from collections import defaultdict
from pathlib import Path

root = Path(__file__).resolve().parent.parent
RAW = root / 'sources/raw'
manifest = json.loads((RAW / 'manifest.json').read_text(encoding='utf-8'))


def meur(v):
    return None if v in ('', None) else round(float(v) / 1e6, 3)


def url(source_id):
    return manifest[source_id]['files'][0]['url']


# ---------- Taxes affectées ----------
with gzip.open(RAW / 'plf24-taxes-affectees.csv.gz', 'rt', encoding='utf-8') as fh:
    raw = list(csv.reader(fh, delimiter=';'))
labels = [r for r in raw[1:] if r[11] == 'Plafond 2022']
assert len(labels) == 1 and labels[0][17] == 'Plafond 2024' and labels[0][18] == 'Reversement BG 2024' and labels[0][19] == 'Début du plafonnement'
rows = []
for r in raw[1:]:
    if r[11] == 'Plafond 2022':
        continue
    y, cap, back = [meur(r[k]) for k in (10, 13, 16)], [meur(r[k]) for k in (11, 14, 17)], [meur(r[k]) for k in (12, 15, 18)]
    for k in range(3):
        if cap[k] is not None and y[k] is not None and back[k] is not None:
            assert abs(max(0, y[k] - cap[k]) - back[k]) < 0.001, (r[9], k)
    rows.append({
        'sector': r[0].strip(), 'category': r[1].strip(), 'nature': r[2].strip(),
        'beneficiary': r[7].strip(), 'tax': r[9].strip(), 'taxCode': int(float(r[8])) if r[8] else None,
        'mission': r[4].strip() or None, 'programme': r[5].strip() or None,
        'y': y, 'cap': cap, 'back': back, 'since': r[19].strip() or None,
    })

# ---------- Budget lines (PLF 2025) ----------
with gzip.open(RAW / 'plf25-recettes.csv.gz', 'rt', encoding='utf-8') as fh:
    rec = {int(float(r['code_ligne_recettes'])): r for r in csv.DictReader(fh, delimiter=';')}
budget_lines = {str(code): {'label': rec[code]['libelle'], 'year': rec[code]['annee'], 'amount': meur(rec[code]['montant_recettes_plf'])} for code in (1756, 1726)}

# ---------- Cartes grises (OFGL, regions) ----------
cg = defaultdict(lambda: [0.0, 0])
with gzip.open(RAW / 'ofgl-regions.csv.gz', 'rt', encoding='utf-8') as fh:
    for r in csv.DictReader(fh, delimiter=';'):
        if r['agregat'] == 'Cartes grises':
            cg[r['exer']][0] += float(r['montant'] or 0)
            cg[r['exer']][1] += 1
cartes = [{'year': int(y), 'amount': round(v / 1e6, 1), 'collectivities': n} for y, (v, n) in sorted(cg.items())]

out = {
    'note': 'Extrait figé de fichiers de sources/raw par scripts/extract-taxes-affectees.py. Montants en M€.',
    'affected': {
        'title': 'PLF 2024, Évaluation des voies et moyens, tome I : liste des taxes affectées',
        'url': url('plf24-taxes-affectees'),
        'page': 'https://data.economie.gouv.fr/explore/dataset/plf2024-v-and-m-t1-liste-des-taxes-affectees/',
        'modified': manifest['plf24-taxes-affectees']['files'][0].get('modified', '')[:10],
        'years': ['2022 (exécution)', '2023 (prévision)', '2024 (prévision du PLF)'],
        'rows': rows,
    },
    'budgetLines': {'title': 'PLF 2025, recettes du budget général (données)', 'url': url('plf25-recettes'),
                    'page': 'https://data.economie.gouv.fr/explore/dataset/plf25-recettes-du-budget-general/', 'lines': budget_lines},
    'cartesGrises': {'title': 'OFGL, comptes consolidés des régions, agrégat « Cartes grises »', 'url': url('ofgl-regions'),
                     'page': 'https://data.ofgl.fr/explore/dataset/ofgl-base-regions-consolidee/', 'years': cartes},
}
(root / 'sources/taxes-affectees.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
print(f"taxes-affectees.json: {len(rows)} lignes, {sum(1 for r in rows if r['cap'][2] is not None)} plafonnées en 2024; "
      f"TGAP {budget_lines['1756']['amount']} M€, malus {budget_lines['1726']['amount']} M€, cartes grises {cartes[-2]}")
