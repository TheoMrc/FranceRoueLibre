"""Plan de relance (France Relance, 2020-2022) pour la page Aides.

Lit :
  sources/raw/france-relance.csv.gz   tableau de bord France Relance (indicateurs mensuels par mesure et par département, data.economie.gouv.fr)
  sources/raw/plan-de-relance.csv.gz  lauréats entreprises des appels à projets industriels (sans montant d'aide)
  sources/raw/ofgl-populations-communes.csv.gz  population municipale 2022 (Insee via OFGL), sommée par département
Écrit dist/data/aides/relance.json.

Les indicateurs du tableau de bord sont des cumuls depuis le début de la mesure : on garde la dernière valeur publiée de
chaque département, et la somme des départements mois par mois pour l'évolution. Les indicateurs en euros sont de natures
différentes (aide versée, aide validée, baisse d'impôt estimée, coût total des projets, investissement « déclenché ») :
ils sont classés par nature et jamais additionnés entre eux.

    python3 scripts/relance-data.py
"""
import csv
import gzip
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'sources', 'raw')
OUT = os.path.join(ROOT, 'dist', 'data', 'aides', 'relance.json')
POP_YEAR = '2022'

# Indicateurs publiés en euros au niveau départemental, classés par nature (aide publique ou coût des projets).
DEPT_AMOUNTS = {
    'MPR1': 'aide', 'MPR3': 'aide-validee', 'IDF1': 'aide', 'BIP2': 'fiscal',
    'MPR2': 'projet', 'IDF2': 'projet', 'PIT1': 'projet', 'SAC1': 'projet', 'BPI1': 'projet',
    'CBC2': 'projet', 'PEE2': 'projet', 'ETE1': 'projet', 'FAA1': 'projet', 'PAT1': 'projet',
}
# Indicateurs en euros publiés seulement au niveau national (valeur en euros explicite dans le fichier).
NATIONAL_EUROS = ['APS1', 'RRE2', 'FVE1', 'GFP3', 'ROF1']
# Indicateurs nationaux nommés « Montant » dont l'unité n'est pas indiquée (valeurs de quelques unités à quelques milliers).
NATIONAL_UNKNOWN_UNIT = ['CIF1', 'CIF2', 'CVD1', 'CVD2', 'CVS1', 'CVS2', 'EVD1', 'EVD2', 'EVS1', 'EVS2', 'HVS1', 'HVS2', 'AFG2', 'AFG3', 'DRA2', 'DRA3', 'GFP1']


def read(name):
    path = os.path.join(RAW, name)
    if not os.path.exists(path):
        sys.exit(f'Fichier absent : {path} (lancer node scripts/fetch-sources.mjs)')
    with gzip.open(path, 'rt', encoding='utf-8', newline='') as handle:
        return list(csv.DictReader(handle, delimiter=';'))


def num(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def dept_code(text):
    text = (text or '').strip()
    if not text:
        return ''
    if re.fullmatch(r'\d+(\.0)?', text):
        n = int(float(text))
        return f'{n:02d}' if n < 100 else str(n)
    return text.upper()


def short_label(indicator, code):
    """Indicator name without its trailing ' - CODE'."""
    return re.sub(r'\s*-\s*' + re.escape(code) + r'\s*$', '', indicator).strip()


def main():
    manifest = json.load(open(os.path.join(RAW, 'manifest.json'), encoding='utf-8'))
    src = lambda key: {'url': manifest[key]['files'][0]['url'], 'page': f"https://{manifest[key]['host']}/explore/dataset/{manifest[key]['dataset']}/",
                       'modified': manifest[key]['files'][0].get('modified'), 'downloadedAt': manifest[key].get('downloadedAt'), 'rows': manifest[key]['files'][0].get('records')}

    # Population municipale par département.
    pop = Counter()
    for r in read('ofgl-populations-communes.csv.gz'):
        if r['annee'] == POP_YEAR:
            pop[r['dep_code']] += int(float(r['pmun'] or 0))

    rows = read('france-relance.csv.gz')
    dates = sorted({r['date'] for r in rows})
    by_ind = defaultdict(list)
    for r in rows:
        by_ind[r['indic_id']].append(r)

    dept_names = {}
    for r in rows:
        if r['maille'] == 'Départementale' and r['code_departement']:
            dept_names[dept_code(r['code_departement'])] = r['level_0']

    indicators = []
    for code, nature in DEPT_AMOUNTS.items():
        items = [r for r in by_ind[code] if r['maille'] == 'Départementale']
        if not items:
            sys.exit(f'Indicateur absent du fichier : {code}')
        first = items[0]
        monthly = defaultdict(float)
        last = {}
        for r in items:
            v = num(r['valeur'])
            if v is None:
                continue
            monthly[r['date']] += v
            d = dept_code(r['code_departement'])
            if d not in last or r['date'] > last[d][0]:
                last[d] = (r['date'], v)
        series = [[d[:7], round(monthly[d])] for d in sorted(monthly)]
        # Baisses de plus de 20 % d'un mois à l'autre dans une série censée être cumulée : signalées, pas corrigées.
        drops = [[series[i][0], series[i - 1][1], series[i][1]] for i in range(1, len(series)) if series[i - 1][1] > 0 and series[i][1] < .8 * series[i - 1][1]]
        last_date = max(d for d, _ in last.values())
        depts = sorted(([d, round(v), pop.get(d)] for d, (_, v) in last.items()), key=lambda x: -x[1])
        indicators.append({
            'id': code, 'nature': nature, 'label': short_label(first['indicateur'], code), 'measure': first['mesure'],
            'volet': first['volet'], 'ministry': first['ministeres'], 'lastDate': last_date[:7],
            'total': round(sum(v for _, v in last.values())), 'series': series, 'drops': drops,
            'depts': depts,
        })

    def national(code):
        items = [r for r in by_ind[code] if r['maille'] == 'Nationale' and num(r['valeur']) is not None]
        if not items:
            return None
        r = max(items, key=lambda x: x['date'])
        return {'id': code, 'label': short_label(r['indicateur'], code), 'measure': r['mesure'], 'volet': r['volet'], 'date': r['date'][:7], 'value': num(r['valeur'])}

    national_euros = [x for x in map(national, NATIONAL_EUROS) if x]
    national_unknown = [x for x in map(national, NATIONAL_UNKNOWN_UNIT) if x]

    measures = sorted({r['mesure'] for r in rows if r['mesure']})
    volets = Counter(r['volet'] for r in rows if r['volet'])

    # Lauréats des appels à projets (sans montant).
    laureates = read('plan-de-relance.csv.gz')
    m_list = sorted({r['mesure'] for r in laureates})
    f_list = sorted({r['filiere'] or 'Non renseignée' for r in laureates})
    t_list = sorted({r['type_entreprise'] or 'Non renseigné' for r in laureates})
    lau_depts = Counter()
    lau_names = {}
    table = []
    for r in laureates:
        d = dept_code(r['code_departement'])
        if not d and r['nom_departement'] in ('CORSE-DU-SUD', 'HAUTE-CORSE'):
            d = '2A' if r['nom_departement'] == 'CORSE-DU-SUD' else '2B'
        lau_depts[d] += 1
        lau_names.setdefault(d, dept_names.get(d) or r['nom_departement'].title())
        table.append([r['entreprise'].strip(), (r['siren'] or '').strip(), d, m_list.index(r['mesure']), f_list.index(r['filiere'] or 'Non renseignée'),
                      t_list.index(r['type_entreprise'] or 'Non renseigné'), (r['nom_commune'] or '').title(), r['mise_a_jour']])
    table.sort(key=lambda x: x[0].lower())

    data = {
        'sources': {'dashboard': src('france-relance'), 'laureates': src('plan-de-relance'),
                    'population': {'label': f'Population municipale {POP_YEAR} par commune (Insee, diffusée par l’OFGL)', 'url': manifest['ofgl-populations-communes']['files'][0]['url']}},
        'dates': [dates[0][:7], dates[-1][:7]], 'rows': len(rows), 'measures': len(measures), 'indicatorsCount': len(by_ind),
        'volets': volets.most_common(), 'deptNames': dept_names, 'popYear': POP_YEAR,
        'indicators': indicators, 'nationalEuros': national_euros, 'nationalUnknownUnit': national_unknown,
        'laureates': {'count': len(laureates), 'measures': m_list, 'filieres': f_list, 'types': t_list,
                      'byMeasure': Counter(r['mesure'] for r in laureates).most_common(),
                      'byType': Counter(r['type_entreprise'] or 'Non renseigné' for r in laureates).most_common(),
                      'byFiliere': Counter(r['filiere'] or 'Non renseignée' for r in laureates).most_common(),
                      'byDept': [[d, lau_names.get(d, ''), n, pop.get(d)] for d, n in lau_depts.most_common()],
                      'updates': [min(r['mise_a_jour'] for r in laureates), max(r['mise_a_jour'] for r in laureates)],
                      'rows': table},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(',', ':'))
    print(f'{OUT} : {os.path.getsize(OUT)} octets ; {len(rows)} lignes tableau de bord, {len(laureates)} lauréats')
    for ind in indicators:
        print(f"  {ind['id']:5} {ind['nature']:13} {ind['lastDate']} {ind['total']:>16,.0f}  {ind['label'][:60]}  baisses={len(ind['drops'])}")


if __name__ == '__main__':
    main()
