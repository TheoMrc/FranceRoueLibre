"""Probité : atteintes à la probité dans les décisions de justice (données nationales agrégées 2021-2025).

Lit sources/raw/atteintes-probite.csv.gz (data.economie.gouv.fr) et écrit dist/data/probite.json.
Le fichier est national, par année de décision : aucune géographie n'est publiée.
Les effectifs inférieurs à 5 sont masqués par le producteur (« <5 »), certains autres par masquage
secondaire (« n.d. ») : ils restent masqués ici, jamais estimés.

    python3 scripts/probite-data.py
"""
import csv
import gzip
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'sources', 'raw', 'atteintes-probite.csv.gz')
MANIFEST = os.path.join(ROOT, 'sources', 'raw', 'manifest.json')
OUT = os.path.join(ROOT, 'dist', 'data', 'probite.json')

DATASET = 'atteintes-a-la-probite-dans-les-decisions-de-justice-donnees-nationales-agregees-2021-2025'
PAGE_URL = f'https://data.economie.gouv.fr/explore/dataset/{DATASET}/'

# Libellés du fichier (typologie « libelle_afa ») -> famille, libellé lisible. L'ordre est celui de la page.
LABELS = [
    ('Corruption | Publique', 'Corruption', 'Corruption publique'),
    ('Corruption | Élus', 'Corruption', 'Corruption, élus'),
    ('Corruption | Privée', 'Corruption', 'Corruption privée'),
    ('Corruption | APE', 'Corruption', 'Corruption d’agent public étranger'),
    ('Corruption | infractions assimilées', 'Corruption', 'Corruption, infractions assimilées'),
    ("Trafic d'influence | Publique", 'Trafic d’influence', 'Trafic d’influence, sphère publique'),
    ("Trafic d'influence | Élus", 'Trafic d’influence', 'Trafic d’influence, élus'),
    ('Favoritisme', 'Favoritisme', 'Favoritisme (atteinte à l’égalité d’accès aux marchés publics)'),
    ("Prise illégale d'intérêts | Publique", 'Prise illégale d’intérêts', 'Prise illégale d’intérêts, sphère publique'),
    ("Prise illégale d'intérêts | Élus", 'Prise illégale d’intérêts', 'Prise illégale d’intérêts, élus'),
    ('DFP', 'Détournement de fonds publics', 'Détournement de fonds publics'),
    ('DFP | infractions assimilées', 'Détournement de fonds publics', 'Détournement de fonds publics, infractions assimilées'),
    ('Concussion', 'Concussion', 'Concussion'),
    ("Recel d'infraction d'AAP", 'Recel et blanchiment', 'Recel d’une atteinte à la probité'),
    ("Blanchiment d'infraction d'AAP", 'Recel et blanchiment', 'Blanchiment d’une atteinte à la probité'),
]
DECISIONS = ['Condamnation', 'Relaxe', 'Autre issue']


def value(row, field):
    """Published count as int, or the producer's mask as text ('<5', 'n.d.')."""
    shown = (row.get(f'affichage_{field}') or '').strip()
    raw = (row.get(field) or '').strip()
    status = (row.get(f'statut_{field}') or '').strip()
    if status == 'Publié' and raw:
        return int(float(raw))
    return shown or 'n.d.'


def main():
    if not os.path.exists(RAW):
        sys.exit(f'Fichier absent : {RAW} (lancer node scripts/fetch-sources.mjs)')
    with gzip.open(RAW, 'rt', encoding='utf-8', newline='') as handle:
        rows = list(csv.DictReader(handle, delimiter=';'))
    manifest = json.load(open(MANIFEST, encoding='utf-8')).get('atteintes-probite', {}) if os.path.exists(MANIFEST) else {}
    file_info = (manifest.get('files') or [{}])[0]

    years = sorted({int(r['annee_reference']) for r in rows if r['annee_reference']})
    yi = {y: i for i, y in enumerate(years)}
    view = lambda name: [r for r in rows if r['vue'] == name]
    pair = lambda r: {'affaires': value(r, 'nombre_affaires'), 'unites': value(r, 'nombre_unites_prevenu_infraction')}

    def series(view_rows, key):
        out = {}
        for r in view_rows:
            label = r[key]
            entry = out.setdefault(label, {'affaires': [None] * len(years), 'unites': [None] * len(years)})
            p = pair(r)
            entry['affaires'][yi[int(r['annee_reference'])]] = p['affaires']
            entry['unites'][yi[int(r['annee_reference'])]] = p['unites']
        return out

    total = pair(view('total_periode')[0])
    per_year = [None] * len(years)
    for r in view('total_annee'):
        per_year[yi[int(r['annee_reference'])]] = {'year': int(r['annee_reference']), **pair(r)}

    procedures_period = [{'label': r['categorie_evt_periode'], **pair(r)} for r in view('evenements_periode_detailles')]
    procedures = series(view('evenements_annee_regroupes'), 'categorie_evt_annuelle')
    authors = series(view('auteurs_annee_type'), 'type_d_auteur')
    situation = [{'label': r['situation_peine'], **pair(r)} for r in view('situation_peine_periode')]
    penalties = series(view('peines_annee_categorie'), 'categorie_peine')

    detail = {}
    for r in view('peines_annee_categorie_modalite'):
        key = (r['categorie_peine'], r['sous_categorie_peine'], r['modalite_peine'])
        entry = detail.setdefault(key, {'category': key[0], 'sub': key[1], 'modalite': key[2], 'affaires': [None] * len(years), 'unites': [None] * len(years)})
        p = pair(r)
        entry['affaires'][yi[int(r['annee_reference'])]] = p['affaires']
        entry['unites'][yi[int(r['annee_reference'])]] = p['unites']

    inf_rows = series(view('infractions_annee_libelle'), 'libelle_afa')
    dec = {}
    for r in view('infractions_annee_libelle_decision'):
        d = dec.setdefault(r['libelle_afa'], {k: {'affaires': [None] * len(years), 'unites': [None] * len(years)} for k in DECISIONS})
        p = pair(r)
        d[r['decision_diffusion']]['affaires'][yi[int(r['annee_reference'])]] = p['affaires']
        d[r['decision_diffusion']]['unites'][yi[int(r['annee_reference'])]] = p['unites']
    known = {code for code, _, _ in LABELS}
    missing = sorted(set(inf_rows) - known)
    if missing:
        sys.exit(f'Libellés inconnus, à ajouter dans LABELS : {missing}')
    infractions = [{'code': code, 'family': family, 'label': label, **inf_rows.get(code, {'affaires': [None] * len(years), 'unites': [None] * len(years)}),
                    'decisions': dec.get(code, {})} for code, family, label in LABELS]

    # Contrôles : somme des années face au total de la période (une affaire jugée sur deux années compte deux fois).
    sum_aff = sum(p['affaires'] for p in per_year if isinstance(p['affaires'], int))
    sum_uni = sum(p['unites'] for p in per_year if isinstance(p['unites'], int))
    checks = {
        'sumYearsAffaires': sum_aff, 'periodAffaires': total['affaires'],
        'sumYearsUnites': sum_uni, 'periodUnites': total['unites'],
        'sumProceduresAffaires': sum(p['affaires'] for p in procedures_period if isinstance(p['affaires'], int)),
        'sumSituationAffaires': sum(p['affaires'] for p in situation if isinstance(p['affaires'], int)),
    }

    data = {
        'source': {
            'title': 'Atteintes à la probité dans les décisions de justice, données nationales agrégées 2021–2025',
            'page': PAGE_URL, 'url': file_info.get('url'), 'modified': file_info.get('modified'),
            'downloadedAt': manifest.get('downloadedAt'), 'rows': len(rows), 'sha256': file_info.get('sha256'),
            'period': rows[0]['periode_reference'],
        },
        'years': years, 'total': total, 'perYear': per_year,
        'proceduresPeriod': procedures_period, 'procedures': procedures, 'authors': authors,
        'situation': situation, 'penalties': penalties, 'penaltiesDetail': list(detail.values()),
        'infractions': infractions, 'checks': checks,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(',', ':'))
    print(f'{OUT} : {os.path.getsize(OUT)} octets, {len(rows)} lignes lues, années {years[0]}-{years[-1]}')
    print('contrôles', checks)


if __name__ == '__main__':
    main()
