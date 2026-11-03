"""Publishes the yearly consumer price index (Insee, chained to base 2025 = 100, built by the national accounts scripts in
sources/resultats) as dist/data/insee-ipc.json, for the Loupe's tools (euros of another year, prices over a period).

  python3 scripts/publish-ipc.py"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'sources' / 'resultats' / 'insee_ipc_annuel_1960_2025.csv'
OUT = ROOT / 'dist' / 'data' / 'insee-ipc.json'

rows = [r for r in csv.DictReader(open(SRC, encoding='utf-8')) if r['ipc_chaine_base2025_100']]
years = [int(r['annee']) for r in rows]
OUT.write_text(json.dumps({
    'source': 'Insee, indice des prix à la consommation, ensemble des ménages, France (séries 011814653, 001765177, 000008965 chaînées)',
    'url': 'https://www.insee.fr/fr/statistiques/serie/011814653', 'unit': 'indice, base 100 en 2025', 'years': years,
    'index': [float(r['ipc_chaine_base2025_100']) for r in rows],
    'inflation': [float(r['inflation_pct']) if r['inflation_pct'] else None for r in rows]},
    ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print(f'{OUT.relative_to(ROOT)} : {years[0]}-{years[-1]}')
