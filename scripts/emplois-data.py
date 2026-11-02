"""Emplois publics page data (emplois.html): what public employees and elected officials cost, and where.

Reads only files already in the repository:
  sources/insee-apu-3201-2026-08.xlsx      Insee 3.201, remuneration of public employees (D1) 1959-2025
  sources/insee-ratios-2026-08.xlsx        Insee, public spending in % of GDP (to get GDP)
  sources/insee-population.json            Insee, population on 1 January
  dist/data/national-functions.json        Eurostat COFOG, D1 and total spending by function 1995-2024
  dist/data/etat.json                      PLF 2025, titre 2 (personnel) by mission and programme, Pouvoirs publics
  dist/data/local/                         OFGL, frais de personnel of communes, intercommunalités, départements, régions
  dist/data/web/communes-meta.json         commune codes and départements (aligned with dist/data/local/communes)
  sources/departements-meta.json           département -> région
  sources/emplois-reference.json           figures read in official publications and laws (headcounts, seats, indemnity scale)
Writes dist/data/emplois.json and dist/data/emplois-communes.json (one row per commune, for the « Ma commune » search).

Run from the repo root:  python3 scripts/emplois-data.py"""
import json
import math
import statistics
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'sources'
DATA = ROOT / 'dist' / 'data'
LOCAL = DATA / 'local'
OUT = DATA / 'emplois.json'
OUT_COMMUNES = DATA / 'emplois-communes.json'
INSEE_PAGE = 'https://www.insee.fr/fr/statistiques/8988845'
OFGL_PAGE = 'https://data.ofgl.fr/explore/?refine.theme=Comptes+des+collectivit%C3%A9s'
REF = json.loads((SRC / 'emplois-reference.json').read_text(encoding='utf8'))


def load(path):
    return json.loads(Path(path).read_text(encoding='utf8'))


def r(value, digits=0):
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    return round(value, digits) if digits else int(round(value))


# ---------- 1. National series: remuneration of public employees, 1960-2025 ----------
def sheet_rows(name):
    book = openpyxl.load_workbook(SRC / name, data_only=True, read_only=True)
    return [list(row) for row in book.worksheets[0].iter_rows(values_only=True)]


def national():
    rows = sheet_rows('insee-apu-3201-2026-08.xlsx')
    header = next(row for row in rows if isinstance(row[2], int) and row[2] < 1970)
    years = [y for y in header[2:] if isinstance(y, int)]

    def line(prefix):
        row = next(row for row in rows if isinstance(row[1], str) and row[1].strip().startswith(prefix))
        return dict(zip(years, row[2:2 + len(years)]))

    d1, total, d122 = line('Rémunération des salariés (D1)'), line('Total des dépenses'), line('dont (a) - Cotisations sociales imputées')
    ratios = sheet_rows('insee-ratios-2026-08.xlsx')
    rheader = next(row for row in ratios if row[0] and str(row[0]).startswith('Dépense et recette'))
    spend_pct = next(row for row in ratios if row[0] == 'Dépenses')
    year_of = lambda h: int(str(h)[:4]) if h is not None and str(h)[:4].isdigit() else None   # « 2024 (sd) », « 2025 (p) »
    pct = {year_of(y): v for y, v in zip(rheader[1:], spend_pct[1:]) if year_of(y) and isinstance(v, (int, float))}
    pop = {p['year']: p['population'] for p in load(SRC / 'insee-population.json')['january1']}
    out = []
    for y in years:
        if y < 1960 or not isinstance(d1.get(y), (int, float)):
            continue
        gdp = total[y] / pct[y] * 100 if y in pct else None
        out.append({'year': y, 'd1': r(d1[y], 3), 'spending': r(total[y], 3), 'imputed': r(d122.get(y), 3) if isinstance(d122.get(y), (int, float)) else None,
                    'gdp': r(gdp, 1), 'population': pop.get(y)})
    return {'source': 'Insee, comptes nationaux, tableau 3.201 (base 2020), publication du 28 août 2026', 'url': INSEE_PAGE,
            'unit': 'Md€ courants', 'years': out}


# ---------- 2. Remuneration by function (COFOG) ----------
def functions():
    nf = load(DATA / 'national-functions.json')
    d1, te = nf['data']['D1'], nf['data']['TE']
    labels = nf['functions']
    top = [code for code in labels if len(code) == 4]
    items = []
    for code in top:
        subs = [s for s in labels if len(s) == 6 and s.startswith(code) and s in d1 and any(v for v in d1[s] if v)]
        items.append({'code': code, 'label': labels[code], 'd1': d1.get(code), 'te': te.get(code),
                      'subs': [{'code': s, 'label': labels[s], 'd1': d1.get(s), 'te': te.get(s)} for s in subs]})
    # Check: functions add up to the total, every year.
    gaps = [abs(sum((it['d1'] or [0] * len(nf['years']))[i] or 0 for it in items) - d1['TOTAL'][i]) for i in range(len(nf['years'])) if d1['TOTAL'][i]]
    return {'source': nf['source'], 'url': nf['url'], 'years': nf['years'], 'total': {'d1': d1['TOTAL'], 'te': te['TOTAL']},
            'items': items, 'maxGap': round(max(gaps), 3)}


# ---------- 3. State budget: titre 2 by mission ----------
def state():
    etat = load(DATA / 'etat.json')
    missions, pensions, powers = [], None, []
    for m in etat['missions']:
        t2 = m['titres'].get('2', 0) or 0
        if m['code'] == 'YD':
            pensions = {'name': m['name'], 'cp': r(m['cp'], 1), 't2': r(t2, 1), 'progs': [{'code': p['code'], 'name': p['name'], 'cp': r(p['cp'], 1)} for p in m['progs']]}
            continue
        if m['code'] == 'PB':
            powers = [{'code': p['code'], 'name': p['name'], 'cp': r(p['cp'], 2)} for p in m['progs']]
            continue
        if t2 < 0.5:
            continue
        progs = sorted(({'code': p['code'], 'name': p['name'], 'min': p.get('min'), 't2': r(p['titres'].get('2', 0) or 0, 1), 'cp': r(p['cp'], 1)}
                        for p in m['progs'] if (p['titres'].get('2', 0) or 0) >= 0.5), key=lambda p: -p['t2'])
        missions.append({'code': m['code'], 'type': m['type'], 'name': m['name'], 't2': r(t2, 1), 'cp': r(m['cp'], 1), 'progs': progs})
    missions.sort(key=lambda m: -m['t2'])
    src = etat['sources'].get('plf25-depenses-destination', {})
    # Budget général: all credits of paiement except tax refunds and rebates (« remboursements et dégrèvements », rd), and its titre 2.
    by = {}
    for t in etat['nature']['titres']:
        key = (t['budget'], bool(t['rd']), t['titre'])
        by[key] = by.get(key, 0) + (t['cp'] or 0)
    general = {'cpNet': r(sum(v for (b, rd, _), v in by.items() if b == 'BG' and not rd), 1),
               'cpRefunds': r(sum(v for (b, rd, _), v in by.items() if b == 'BG' and rd), 1),
               't2': r(sum(v for (b, rd, t), v in by.items() if b == 'BG' and t == '2'), 1),
               't2Annexes': r(sum(v for (b, rd, t), v in by.items() if b == 'BA' and t == '2'), 1)}
    return {'year': 2025, 'source': 'Projet de loi de finances 2025, crédits de paiement par mission, programme et titre', 'url': src.get('page'),
            'missions': missions, 'pensions': pensions, 'powers': powers, 'general': general, 'unit': 'M€'}


# ---------- 4. Local authorities: frais de personnel ----------
def local_level(level, slug):
    data = load(LOCAL / level / f'{slug}.json')
    return data['years'], data['values']


def local():
    index = load(LOCAL / 'index.json')
    totals = index['totals']
    labels = {'communes': 'Communes', 'gfp': 'Intercommunalités à fiscalité propre', 'departements': 'Départements', 'regions': 'Régions et collectivités uniques',
              'syndicats': 'Syndicats intercommunaux', 'sdis': 'Services d’incendie et de secours', 'ccas': 'Centres communaux d’action sociale', 'epl': 'Autres établissements publics locaux'}
    # Ville de Paris (from 2019) and Métropole de Lyon are published both as a commune / intercommunalité and as a département:
    # their département rows are left out here so that nothing is counted twice.
    dep_codes = load(LOCAL / 'departements' / '_entities.json')['codes']
    dup = {}
    for slug in ('frais-de-personnel', 'depenses-de-fonctionnement'):
        years, values = local_level('departements', slug)
        dup[slug] = {str(y): sum(values[i][dep_codes.index(c)] or 0 for c in ('75', '691') if not (c == '75' and y < 2019)) for i, y in enumerate(years)}
    levels = []
    for level, label in labels.items():
        t = totals.get(level, {})
        fp, fn = dict(t.get('frais-de-personnel', {})), dict(t.get('depenses-de-fonctionnement', {}))
        if level == 'departements':
            fp = {y: v - dup['frais-de-personnel'][y] for y, v in fp.items()}
            fn = {y: v - dup['depenses-de-fonctionnement'][y] for y, v in fn.items()}
        years = sorted(int(y) for y in fp)
        levels.append({'id': level, 'label': label, 'years': years, 'personnel': [r(fp[str(y)]) for y in years],
                       'operating': [r(fn.get(str(y))) for y in years]})
    pop = {p['year']: p['population'] for p in load(SRC / 'insee-population.json')['january1']}
    return {'source': 'OFGL, comptes consolidés des collectivités (budgets principaux et annexes)', 'url': OFGL_PAGE, 'levels': levels,
            'population': {str(y): pop.get(y) for y in range(2012, 2026)},
            'note': 'Départements sans la Ville de Paris (comptée avec les communes depuis 2019) ni la Métropole de Lyon (comptée avec les intercommunalités).'}


# ---------- 4a. Headcounts: DGAFP annual report 2026 (data at 31/12/2024), extracted by extract-effectifs-fp.py ----------
FP = SRC / 'fonction-publique'
DGAFP_PAGE = 'https://www.fonction-publique.gouv.fr/toutes-les-publications/rapport-annuel-sur-letat-de-la-fonction-publique-edition-2026'


def csv_rows(name):
    import csv
    with open(FP / name, encoding='utf-8', newline='') as handle:
        return list(csv.DictReader(handle))


def year_of(label):
    """« 2023 millésime 2024 », « 2016(3) » -> 2023, 2016."""
    return int(str(label)[:4])


def series(rows, key='effectif_milliers'):
    """One value per year: when a year is published twice (change of method), the later vintage is kept;
    the years with a break are returned too."""
    out, breaks = {}, set()
    for row in rows:
        y = year_of(row['annee_millesime'])
        if y in out and str(row['annee_millesime']) != str(y):
            breaks.add(y)
        if row.get(key) not in (None, ''):
            out[y] = float(row[key])
    return {k: out[k] for k in sorted(out)}, sorted(breaks)


def clean_label(label):
    import re
    return re.sub(r'\(\d\)', '', re.sub(r'\s+', ' ', label)).replace(', dont :', '').strip()


def workforce():
    vs = csv_rows('effectifs-versants-serie.csv')
    pick = lambda versant, ligne: series([r for r in vs if r['versant'] == versant and r['ligne'] == ligne])
    total, breaks = pick('FP', 'Total hors bénéficiaire de contrats aidés')
    with_aided, _ = pick('FP', 'Total y compris bénéficiaires de contrats aidés')
    versants = {'fpe': pick('FPE', 'Total ministères + EPA')[0], 'fpt': pick('FPT', 'Total emplois principaux')[0], 'fph': pick('FPH', 'Total FPH')[0]}
    last = max(total)
    # ministries (FPE): ministries + national public bodies (EPA)
    mins = csv_rows('effectifs-fpe-ministeres-serie.csv')
    names = [n for n in dict.fromkeys(r['ministere'] for r in mins) if not n.startswith('Total')]
    ministries = []
    for n in names:
        tot, _ = series([r for r in mins if r['ministere'] == n and r['perimetre'] == 'Total'])
        part = {p: series([r for r in mins if r['ministere'] == n and r['perimetre'] == p])[0].get(last) for p in ('Ministères', 'EPA')}
        ministries.append({'label': clean_label(n), 'total': tot.get(last), 'ministry': part['Ministères'], 'bodies': part['EPA'],
                           'series': [[y, v] for y, v in tot.items()]})
    ministries.sort(key=lambda m: -(m['total'] or 0))
    # FPT employers and FPH establishments
    fpt = csv_rows('effectifs-fpt-employeurs-serie.csv')
    employers = [{'label': clean_label(t), 'value': series([r for r in fpt if r['type_employeur'] == t])[0].get(last),
                  'series': [[y, v] for y, v in series([r for r in fpt if r['type_employeur'] == t])[0].items()]}
                 for t in dict.fromkeys(r['type_employeur'] for r in fpt)]
    fph = csv_rows('effectifs-fph-etablissements-serie.csv')
    hospitals = [{'label': clean_label(t), 'value': series([r for r in fph if r['type_etablissement'] == t])[0].get(last),
                  'series': [[y, v] for y, v in series([r for r in fph if r['type_etablissement'] == t])[0].items()]}
                 for t in dict.fromkeys(r['type_etablissement'] for r in fph)]
    # départements: agents (civils) and administration rate (ETP per 1 000 inhabitants)
    deps = {}
    for r_ in csv_rows('effectifs-departements.csv'):
        deps[r_['code_departement']] = {k: float(r_[k]) for k in ('fpe_civils', 'fpt', 'fph', 'total_civils', 'fonctionnaires', 'contractuels', 'autres_statuts',
                                                                  'taux_admin_fpe_etp_1000hab', 'taux_admin_fpt_etp_1000hab', 'taux_admin_fph_etp_1000hab', 'taux_admin_total_etp_1000hab')}
    long = csv_rows('effectifs-departements-serie.csv')
    rate_first = {}
    for r_ in long:
        if r_['niveau'] == 'departement' and r_['versant'] == 'FP' and r_['indicateur'].startswith('taux') and year_of(r_['annee_millesime']) == 2011:
            rate_first[r_['code_departement']] = float(r_['valeur'])
    national_rate = {}
    for r_ in long:
        if r_['zone'].startswith('Total France') and r_['versant'] in ('FP', 'FPE', 'FPT', 'FPH') and r_['indicateur'].startswith('taux'):
            national_rate.setdefault(r_['versant'], []).append(r_)
    rates = {v: [[y, x] for y, x in series(rows_, 'valeur')[0].items()] for v, rows_ in national_rate.items()}
    # salaries 2024
    sal = [{'versant': r_['versant'], 'population': clean_label(r_['population']), 'gross': float(r_['salaire_brut_mensuel_moyen_eqtp_eur']),
            'net': float(r_['salaire_net_mensuel_moyen_eqtp_eur']),
            'realChange': float(r_['evol_net_2023_2024_euros_constants_pct']) if r_['evol_net_2023_2024_euros_constants_pct'] else None}
           for r_ in csv_rows('salaires-versants-2024.csv')]
    # State jobs: ceilings voted in the budget acts (LFI) and jobs actually used in 2025
    ceil = csv_rows('plafonds-emplois-lfi-2019-2026.csv')
    ceilings = {}
    for r_ in ceil:
        if not r_['mission']:
            ceilings.setdefault(r_['ministere_2026'], {})[int(r_['annee_lfi'])] = round(float(r_['plafond_milliers_etpt']) * 1000)
    used = [{'label': r_['ministere_2025'], 'used': round(float(r_['consommation_etpt'])), 'gap': round(float(r_['ecart_vs_plafond_lfr_etpt']))}
            for r_ in csv_rows('consommation-emplois-ministeres-2025.csv')]
    checks = load(FP / 'checks.json')['checks']
    return {'source': 'DGAFP, rapport annuel sur l’état de la fonction publique, édition 2026 (Siasp, Insee)', 'url': DGAFP_PAGE, 'year': last,
            'total': {y: round(v * 1000) for y, v in total.items()}, 'withAided': round(with_aided[last] * 1000), 'breaks': breaks,
            'versants': {k: {y: round(v * 1000) for y, v in s_.items()} for k, s_ in versants.items()},
            'ministries': ministries, 'employers': employers, 'hospitals': hospitals, 'departments': deps, 'rateFirst': rate_first, 'rates': rates,
            'salaries': sal, 'ceilings': ceilings, 'used2025': used, 'checks': {'count': len(checks), 'ok': all(c['ok'] for c in checks)}}


# ---------- 4c. Results to put in front of the cost: inflation, Europe, trade, debt, hospitals, PISA ----------
RES = SRC / 'resultats'


def res_rows(name):
    import csv
    with open(RES / name, encoding='utf-8', newline='') as handle:
        return list(csv.DictReader(handle))


def fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def results():
    cpi = {int(r_['annee']): fnum(r_['ipc_chaine_base2025_100']) for r_ in res_rows('insee_ipc_annuel_1960_2025.csv') if fnum(r_['ipc_chaine_base2025_100'])}
    # hospitals, SAE, salaried full-time equivalents by filière
    hosp = {}
    for r_ in res_rows('drees_sae_etp_hopitaux_2001_2024.csv'):
        h = hosp.setdefault(r_['secteur'], [])
        h.append({'year': int(r_['annee']), 'doctors': fnum(r_['medecins_salaries_etp']), 'admin': fnum(r_['administratifs_etp']), 'care': fnum(r_['soignants_etp']),
                  'careManagers': fnum(r_['dont_cadres_soins_etp']), 'nurses': fnum(r_['dont_infirmiers_etp']), 'aides': fnum(r_['dont_aides_soignants_etp']),
                  'technical': fnum(r_['techniques_ouvriers_etp']), 'medtech': fnum(r_['medico_techniques_etp']), 'social': fnum(r_['educatifs_sociaux_etp']),
                  'total': fnum(r_['total_salaries_etp'])})
    for h in hosp.values():
        h.sort(key=lambda x: x['year'])
    # Europe: remuneration of government employees, % of GDP and % of spending
    eu = {}
    for r_ in res_rows('eurostat_gov_remuneration_salaries_ue.csv'):
        eu.setdefault(r_['geo'], {'label': r_['geo_label'], 'years': {}})['years'][int(r_['annee'])] = [fnum(r_['D1PAY_PC_GDP']), fnum(r_['D1PAY_pct_TE'])]
    eu_year = max(y for y in eu['FR']['years'] if sum(1 for c in eu.values() if (c['years'].get(y) or [None])[0] is not None) >= 27)
    europe = [{'geo': g, 'label': c['label'], 'gdp': c['years'][eu_year][0], 'spending': c['years'][eu_year][1]} for g, c in eu.items() if g not in ('EA19', 'EA21') and c['years'].get(eu_year) and c['years'][eu_year][0] is not None]
    oecd = {}
    for r_ in res_rows('ocde_emploi_apu_pct_emploi_total.csv'):
        v = fnum(r_['emploi_apu_pct_emploi_total'])
        if v is not None and int(r_['annee']) >= oecd.get(r_['pays_iso3'], {}).get('year', 0):
            oecd[r_['pays_iso3']] = {'iso3': r_['pays_iso3'], 'label': r_['pays'], 'year': int(r_['annee']), 'value': v}
    oecd_fr = sorted(([int(r_['annee']), fnum(r_['emploi_apu_pct_emploi_total'])] for r_ in res_rows('ocde_emploi_apu_pct_emploi_total.csv') if r_['pays_iso3'] == 'FRA'), key=lambda x: x[0])
    trade = [{'year': int(r_['annee']), 'goods': fnum(r_['solde_biens_Md_eur']), 'goodsGdp': fnum(r_['solde_biens_pct_pib']), 'goodsServices': fnum(r_['solde_biens_services_insee_Md_eur'])}
             for r_ in res_rows('france_solde_commercial_1949_2025.csv')]
    gdp_volume = {int(r_['annee']): fnum(r_['pib_volume_Md_eur_chaines_2020_011779991']) for r_ in res_rows('insee_deflateur_pib_1949_2025.csv')}
    ratios = load(SRC / 'national-ratios-insee.json')
    debt = [[y['year'], y['debt']] for y in ratios['years'] if y.get('debt') is not None]
    pisa = [{'year': int(r_['annee']), 'reading': fnum(r_['comprehension_ecrit']), 'math': fnum(r_['mathematiques']), 'science': fnum(r_['sciences'])} for r_ in res_rows('pisa_france_scores_moyens_2000_2018.csv')]
    return {'cpi': {'base': 2025, 'values': {y: round(v, 3) for y, v in sorted(cpi.items())}, 'url': 'https://www.insee.fr/fr/statistiques/serie/011814653', 'source': 'Insee, indice des prix à la consommation (séries chaînées base 2025, 2015, 1980)'},
            'hospitals': {'series': hosp, 'source': 'DREES, statistique annuelle des établissements de santé (SAE), ETP moyens annuels rémunérés', 'url': 'https://data.drees.solidarites-sante.gouv.fr/explore/dataset/708_bases-statistiques-sae/'},
            'europe': {'year': eu_year, 'countries': sorted(europe, key=lambda c: -c['gdp']), 'france': [[y, v[0], v[1]] for y, v in sorted(eu['FR']['years'].items())], 'eu27': [[y, v[0], v[1]] for y, v in sorted(eu['EU27_2020']['years'].items())], 'germany': [[y, v[0], v[1]] for y, v in sorted(eu['DE']['years'].items())],
                       'source': 'Eurostat, gov_10a_main (rémunération des salariés des administrations publiques, D.1)', 'url': 'https://ec.europa.eu/eurostat/databrowser/view/gov_10a_main/default/table?lang=fr'},
            'oecd': {'countries': sorted(oecd.values(), key=lambda c: -c['value']), 'france': oecd_fr, 'source': 'OCDE, Government at a Glance (emploi des administrations publiques en % de l’emploi total)', 'url': 'https://www.oecd.org/fr/topics/sub-issues/public-employment.html'},
            'trade': {'series': trade, 'source': 'Eurostat nama_10_gdp (biens, 1975–2025) ; Insee, équilibre ressources-emplois (biens et services)', 'url': 'https://ec.europa.eu/eurostat/databrowser/view/nama_10_gdp/default/table?lang=fr'},
            'gdpVolume': {'values': {y: v for y, v in sorted(gdp_volume.items()) if v}, 'source': 'Insee, PIB en volume (prix chaînés 2020)', 'url': 'https://www.insee.fr/fr/statistiques/serie/011779991'},
            'debt': {'series': debt, 'source': 'Insee, dette publique au sens de Maastricht, % du PIB', 'url': ratios['source']},
            'pisa': {'series': pisa, 'source': 'OCDE, PISA (repris par la Banque mondiale, EdStats)', 'url': 'https://databank.worldbank.org/source/education-statistics-%5E-all-indicators'}}


# ---------- 4b. Elected officials as they are: Répertoire national des élus (RNE) ----------
RAW = SRC / 'raw'
RNE_PAGE = 'https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1/'
RNE_FILES = {  # resource title (data.gouv.fr) -> id used on the page
    'elus-conseillers-municipaux-cm.csv': 'municipaux', 'elus-maires-mai.csv': 'maires',
    'elus-conseillers-communautaires-epci.csv': 'communautaires', 'elus-conseillers-darrondissements-ca.csv': 'arrondissements',
    'elus-conseillers-departementaux-cd.csv': 'departementaux', 'elus-conseillers-regionaux-cr.csv': 'regionaux',
    'elus-membres-assemblee-ma.csv': 'assemblees', 'elus-deputes-dep.csv': 'deputes', 'elus-senateurs-sen.csv': 'senateurs',
    'elus-representants-Parlement-européen-rpe.csv': 'europeens',
    'elus-conseillers-des-francais-de-letranger-consfde.csv': 'consulaires', 'elus-assemblee-des-francais-de-letranger-afe.csv': 'afe',
}
RNE_LABELS = {
    'municipaux': 'Conseillers municipaux (dont maires et adjoints)', 'maires': 'Maires', 'communautaires': 'Conseillers communautaires (aussi conseillers municipaux)',
    'arrondissements': 'Conseillers d’arrondissement (Paris, Lyon, Marseille)', 'departementaux': 'Conseillers départementaux',
    'regionaux': 'Conseillers régionaux', 'assemblees': 'Membres des assemblées de Corse, Guyane, Martinique, Métropole de Lyon et collectivités d’outre-mer',
    'deputes': 'Députés', 'senateurs': 'Sénateurs', 'europeens': 'Députés européens élus en France',
    'consulaires': 'Conseillers des Français de l’étranger', 'afe': 'Membres de l’Assemblée des Français de l’étranger',
}
# Professional categories (PCS) grouped for reading; teachers of private schools are in 34 and 42 too.
CSP_GROUPS = [
    ('public', 'Agents publics en activité', {'33', '34', '42', '45', '52', '53'}),
    ('cadres', 'Cadres et ingénieurs du privé, professions de l’information et des arts', {'35', '37', '38'}),
    ('independants', 'Chefs d’entreprise, artisans, commerçants, professions libérales', {'21', '22', '23', '31'}),
    ('agriculteurs', 'Agriculteurs exploitants', {'11', '12', '13'}),
    ('intermediaires', 'Professions intermédiaires du privé (santé, technique, commerce)', {'43', '44', '46', '47', '48'}),
    ('employes', 'Employés du privé', {'54', '55', '56'}),
    ('ouvriers', 'Ouvriers', {'62', '63', '64', '65', '67', '68', '69'}),
    ('retraites', 'Retraités', {'71', '72', '74', '75', '77', '78'}),
    ('autres', 'Étudiants, sans activité, non renseigné', None),
]


def rne_files():
    manifest = json.loads((RAW / 'manifest.json').read_text(encoding='utf8'))
    entry = manifest.get('datagouv-rne')
    if not entry:
        raise SystemExit('Répertoire national des élus absent : node scripts/fetch-sources.mjs --only=datagouv-rne')
    return entry, {RNE_FILES[f['title']]: f for f in entry['files'] if f['title'] in RNE_FILES}


def rne_rows(file):
    import csv
    import gzip
    import io
    with gzip.open(RAW / file['file'], 'rt', encoding='utf-8-sig', newline='') as handle:
        yield from csv.DictReader(handle, delimiter=';')


def csp_group(code):
    for gid, _, codes in CSP_GROUPS:
        if codes and code in codes:
            return gid
    return 'autres'


def rne(meta_rows, dep_meta):
    """Counts, profile (sex, age, profession) per mandate, and per commune / département counts."""
    import datetime
    entry, files = rne_files()
    ref_date = datetime.date.fromisoformat(max(f['modified'] for f in files.values())[:10])
    successors = load(SRC / 'communes-successeurs-2025.json')['map']
    index = {row[0]: i for i, row in enumerate(meta_rows)}
    per_commune = [[0, 0, 0] for _ in meta_rows]        # conseillers, adjoints, maires délégués
    dep = {}
    def bump(code, key, n=1):
        if code:
            d = dep.setdefault(code, {})
            d[key] = d.get(key, 0) + n
    mandates, profiles, unmatched = [], {}, 0
    for mid, f in files.items():
        count, sex, ages, csp = 0, {'F': 0, 'M': 0}, [], {g[0]: 0 for g in CSP_GROUPS}
        functions = {}
        for row in rne_rows(f):
            count += 1
            sex[row.get('Code sexe', '')] = sex.get(row.get('Code sexe', ''), 0) + 1
            born = row.get('Date de naissance', '')
            if len(born) == 10:
                b = datetime.date.fromisoformat(born)
                ages.append(ref_date.year - b.year - ((ref_date.month, ref_date.day) < (b.month, b.day)))
            csp[csp_group(row.get('Code de la catégorie socio-professionnelle', ''))] += 1
            fn = (row.get('Libellé de la fonction') or '').strip()
            if mid == 'municipaux':
                kind = 'adjoint' if 'adjoint' in fn.lower() else 'delegue' if fn.lower().startswith('maire délégué') else 'maire' if fn == 'Maire' else ''
                if kind:
                    functions[kind] = functions.get(kind, 0) + 1
                code = row['Code de la commune']
                i = index.get(successors.get(code, code))
                if i is None:
                    unmatched += 1
                    continue
                per_commune[i][0] += 1
                per_commune[i][1] += kind == 'adjoint'
                per_commune[i][2] += kind == 'delegue'
                bump(meta_rows[i][2], 'municipaux')
                bump(meta_rows[i][2], 'adjoints', kind == 'adjoint')
            elif mid == 'departementaux':
                code = row['Code du département']
                if code == '6AE':     # Collectivité européenne d'Alsace: the canton code starts with 67 or 68
                    code = row['Code du canton'][:2]
                bump(code, 'departementaux')
            elif mid == 'regionaux':
                bump('R' + row['Code de la région'], 'regionaux')     # section codes are not all départements: counted by region
            elif mid == 'assemblees':
                c = row['Code de la collectivité à statut particulier']
                section = row.get('Code de la section - collectivité à statut particulier', '')
                if c in ('94', '972', '973'):   # Assemblée de Corse, assemblées de Martinique et de Guyane: regional level
                    bump('R' + {'94': '94', '972': '02', '973': '03'}[c], 'regionaux')
                elif c == '69M':       # Conseil de la Métropole de Lyon: département-level body inside the Rhône
                    bump('69', 'departementaux')
            elif mid in ('deputes', 'senateurs'):
                code = row['Code du département'] or row['Code de la collectivité à statut particulier']
                bump({'94': None}.get(code, code), mid)
        ages.sort()
        mandates.append({'id': mid, 'label': RNE_LABELS[mid], 'count': count, 'women': r(sex.get('F', 0) / count, 4) if count else None,
                         'medianAge': ages[len(ages) // 2] if ages else None, 'over60': r(sum(a >= 60 for a in ages) / len(ages), 4) if ages else None,
                         'csp': {k: v for k, v in csp.items()}, 'functions': functions or None, 'file': f['url']})
    order = [m for m in ('municipaux', 'maires', 'communautaires', 'arrondissements', 'departementaux', 'regionaux', 'assemblees', 'deputes', 'senateurs', 'europeens', 'consulaires', 'afe')]
    mandates.sort(key=lambda m: order.index(m['id']))
    return {'source': 'Répertoire national des élus, ministère de l’Intérieur', 'url': RNE_PAGE, 'date': ref_date.isoformat(),
            'downloadedAt': entry.get('downloadedAt'), 'mandates': mandates, 'cspGroups': [[g, l] for g, l, _ in CSP_GROUPS],
            'unmatchedMunicipal': unmatched}, per_commune, dep


# ---------- 5. Elected officials: legal seats and maximum indemnities ----------
def step(table, pop):
    value = table[0][1]
    for threshold, v in table:
        if pop >= threshold:
            value = v
    return value


SEATS = REF['municipalSeats']
IND = REF['indemnities']


def seats(code, pop):
    # The six « villages morts pour la France » (Meuse, population 0) have no municipal council, only a commission named by the prefect.
    if not pop:
        return 0
    return SEATS['special'].get(code) or step(SEATS['strata'], pop)


def indemnity_cap_2025(pop, n_seats):
    """Same ceiling with the 2020-2025 scale, the one that applies to the indemnities paid in 2025."""
    if not n_seats:
        return 0
    deputies = math.floor(n_seats * SEATS['maxDeputyShare'])
    return 12 * IND['indexMonthly'] / 100 * (step(IND['mayor2020'], pop) + deputies * step(IND['deputy2020'], pop))


def indemnities_paid():
    """Accounts 653 actually paid (scripts/emplois-indemnites.py -> sources/indemnites/)."""
    import csv
    base = SRC / 'indemnites'
    with open(base / 'totaux-par-niveau.csv', encoding='utf-8') as h:
        levels = [{'year': int(r_['exer']), 'level': r_['niveau'], 'entities': int(r_['n_collectivites']), 'indemnities': float(r_['indemnites']),
                   'withContributions': float(r_['indemnites_et_cotisations']), 'total': float(r_['total_653_elus'])} for r_ in csv.DictReader(h)]
    with open(base / 'totaux-par-poste.csv', encoding='utf-8') as h:
        posts = [{'year': int(r_['exer']), 'level': r_['niveau'], 'post': r_['poste'], 'amount': float(r_['montant_tous_budgets'])} for r_ in csv.DictReader(h)]
    communes = {}
    with open(sorted(base.glob('communes-2019-*.csv'))[-1], encoding='utf-8') as h:
        for r_ in csv.DictReader(h):
            communes.setdefault(int(r_['exer']), {})[r_['code_insee']] = (float(r_['indemnites']), float(r_['total_653_elus']))
    others = {}
    with open(sorted(base.glob('autres-collectivites-*.csv'))[-1], encoding='utf-8') as h:
        for r_ in csv.DictReader(h):
            others[r_['siren']] = {'level': r_['niveau'], 'name': r_['nom'], 'indemnities': float(r_['indemnites']), 'total': float(r_['total_653_elus'])}
    return levels, posts, communes, others


def name_key(text):
    import unicodedata
    s = unicodedata.normalize('NFD', str(text)).encode('ascii', 'ignore').decode().upper()
    for ch in "-'’":
        s = s.replace(ch, ' ')
    words = [w for w in s.split() if w not in ('DE', 'DES', 'DU', 'LA', 'LE', 'LES', 'L', 'D', 'ET') and not w.isdigit()]   # « DEP INDRE-ET-LOIRE 37 »
    return ' '.join(words)


# Collectivités uniques, listed as départements in the accounts 653: the départements they cover.
UNIQUE_COLLECTIVITIES = {'CTU GUYANE': ['973'], 'CTU MARTINIQUE': ['972'], 'COLLECTIVITE CORSE': ['2A', '2B'],
                         'COLLECTIVITE EUROPEENNE ALSACE': ['67', '68']}


def paid_dep_and_region(others, dep_meta, dep_pop):
    """Indemnities paid by départements and régions (accounts 653), attached to départements.
    Returns {'byDep': {code: (département part €, région part €)}, 'matched': n}; stops if a name matches nothing."""
    dep_by_name = {name_key(d['nom']): code for code, d in dep_meta.items()}
    dep_by_name['TERRITOIRE BELFORT'] = '90'
    reg_entities = load(LOCAL / 'regions' / '_entities.json')
    reg_by_name = {name_key(n): c for c, n in zip(reg_entities['codes'], reg_entities['names'])}
    by_dep, unmatched, matched = {}, [], 0

    def share(targets, amount, slot):
        weight = sum(dep_pop.get(t, 0) for t in targets)
        for t in targets:
            if weight:
                cur = by_dep.setdefault(t, [0.0, 0.0])
                cur[slot] += amount * dep_pop.get(t, 0) / weight

    for ent in others.values():
        if ent['level'] not in ('departement', 'region'):
            continue
        key = name_key(ent['name'])
        if ent['level'] == 'departement':
            if key in UNIQUE_COLLECTIVITIES:
                targets = UNIQUE_COLLECTIVITIES[key]
            else:
                code = dep_by_name.get(key[4:] if key.startswith('DEP ') else key)
                targets = [code] if code else []
            slot = 0
        else:
            rc = reg_by_name.get(key[4:] if key.startswith('REG ') else key)
            targets = [d for d, m in dep_meta.items() if rc and m['codeRegion'] == rc]
            slot = 1
        if not targets:
            unmatched.append(ent['name'])
            continue
        matched += 1
        share(targets, ent['indemnities'], slot)
    if unmatched:
        raise SystemExit(f'Indemnités 653 : collectivités non rattachées à un département : {unmatched}')
    return {'byDep': {k: (v[0], v[1]) for k, v in by_dep.items()}, 'matched': matched}


def indemnity_cap(pop, n_seats):
    """Maximum yearly gross indemnities of the mayor and of the largest allowed number of deputies (euros)."""
    if not n_seats:
        return 0, 0
    deputies = math.floor(n_seats * SEATS['maxDeputyShare'])
    monthly = IND['indexMonthly'] / 100 * (step(IND['mayor'], pop) + deputies * step(IND['deputy'], pop))
    return 12 * monthly, deputies


STRATA = [(0, 100, 'Moins de 100'), (100, 200, '100 à 199'), (200, 500, '200 à 499'), (500, 1000, '500 à 999'), (1000, 2000, '1 000 à 1 999'),
          (2000, 3500, '2 000 à 3 499'), (3500, 5000, '3 500 à 4 999'), (5000, 10000, '5 000 à 9 999'), (10000, 20000, '10 000 à 19 999'),
          (20000, 50000, '20 000 à 49 999'), (50000, 100000, '50 000 à 99 999'), (100000, 10 ** 9, '100 000 et plus')]


def quantile(values, q):
    if not values:
        return None
    values = sorted(values)
    k = (len(values) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def kilo(value):
    return None if value is None else int(round(value / 1000))


def communes_and_departments():
    meta = load(DATA / 'web' / 'communes-meta.json')
    rows = meta['rows']
    pop_years, pop_values = local_level('communes', '_pop')
    fp_years, fp_values = local_level('communes', 'frais-de-personnel')
    fn_years, fn_values = local_level('communes', 'depenses-de-fonctionnement')
    year = max(fp_years)
    yi, y0 = fp_years.index(year), fp_years.index(min(fp_years))
    pyi = pop_years.index(year)

    def pop_of(i):
        for k in range(pyi, -1, -1):
            if pop_values[k][i]:
                return pop_values[k][i]
        return 0

    dep_meta = {d['code']: d for d in load(SRC / 'departements-meta.json')}
    elected, per_commune, rdep = rne(rows, dep_meta)
    paid_levels, paid_posts, paid_communes, paid_others = indemnities_paid()
    paid_year = max(paid_communes)
    successors = load(SRC / 'communes-successeurs-2025.json')['map']
    paid_by_index = {}
    index_of = {row[0]: i for i, row in enumerate(rows)}
    for y, table in paid_communes.items():
        for code, (ind_, tot_) in table.items():
            i = index_of.get(successors.get(code, code))
            if i is not None:
                cur = paid_by_index.setdefault(y, {}).get(i, (0, 0))
                paid_by_index[y][i] = (cur[0] + ind_, cur[1] + tot_)
    communes = []
    for i, row in enumerate(rows):
        code, name, dep = row[0], row[1], row[2]
        p = pop_of(i)
        n = seats(code, p)
        cap, deputies = indemnity_cap(p, n)
        communes.append({'i': i, 'code': code, 'name': name, 'dep': dep, 'pop': p, 'seats': n, 'deputies': deputies, 'cap': cap,
                         'cm': per_commune[i][0], 'adj': per_commune[i][1], 'cap25': indemnity_cap_2025(p, n),
                         'paid': paid_by_index[paid_year].get(i, (None, None))[0], 'paidTotal': paid_by_index[paid_year].get(i, (None, None))[1], 'paid19': paid_by_index.get(2019, {}).get(i, (None, None))[0],
                         'fp': fp_values[yi][i], 'fp0': fp_values[y0][i], 'pop0': pop_values[pop_years.index(min(fp_years))][i], 'fn': fn_values[fn_years.index(year)][i]})

    # Strata
    strata = []
    for lo, hi, label in STRATA:
        group = [c for c in communes if lo <= c['pop'] < hi and c['pop'] > 0]
        with_fp = [c for c in group if c['fp'] is not None]
        per = [c['fp'] / c['pop'] for c in with_fp]
        popsum = sum(c['pop'] for c in group)
        fp_pop = sum(c['pop'] for c in with_fp)
        strata.append({'label': label, 'min': lo, 'max': hi, 'communes': len(group), 'population': popsum,
                       'seats': sum(c['seats'] for c in group), 'elected': sum(c['cm'] for c in group), 'deputies': sum(c['adj'] for c in group), 'mayorsAndDeputiesMax': sum(1 + c['deputies'] for c in group),
                       'capTotal': r(sum(c['cap'] for c in group)), 'cap2025': r(sum(c['cap25'] for c in group)),
                       'paid': r(sum(c['paid'] or 0 for c in group)), 'paidTotal': r(sum(c['paidTotal'] or 0 for c in group)), 'paid2019': r(sum(c['paid19'] or 0 for c in group)),
                       'paidMedianShare': r(quantile([c['paid'] / c['cap25'] for c in group if c['paid'] is not None and c['cap25']], .5), 3), 'personnel': r(sum(c['fp'] for c in with_fp)),
                       'personnelPerHab': r(sum(c['fp'] for c in with_fp) / fp_pop, 1) if fp_pop else None,
                       'operatingShare': r(sum(c['fp'] for c in with_fp) / sum(c['fn'] for c in with_fp if c['fn']), 4) if with_fp else None,
                       'q1': r(quantile(per, .25), 1), 'median': r(quantile(per, .5), 1), 'q3': r(quantile(per, .75), 1)})

    # Départements: communes + intercommunalités (split by member population) + département + région (split by population)
    dep_names = {code: v[0] for code, v in meta['departments'].items()}
    deps = {}
    for c in communes:
        d = deps.setdefault(c['dep'], {'code': c['dep'], 'communes': 0, 'pop': 0, 'pop0': 0, 'seats': 0, 'cap': 0, 'mayors': 0, 'small': 0,
                                       'fp': {'communes': 0, 'gfp': 0, 'departement': 0, 'region': 0}, 'fp0': {'communes': 0, 'gfp': 0, 'departement': 0, 'region': 0}})
        d['communes'] += 1; d['pop'] += c['pop']; d['pop0'] += c['pop0'] or 0; d['seats'] += c['seats']; d['cap'] += c['cap']; d['mayors'] += 1
        d['small'] += c['pop'] < 500
        d['fp']['communes'] += c['fp'] or 0; d['fp0']['communes'] += c['fp0'] or 0
        d['paid'] = d.get('paid', 0) + (c['paid'] or 0); d['cap25'] = d.get('cap25', 0) + c['cap25']

    def split(level, code_to_deps, key):
        e = load(LOCAL / level / '_entities.json')
        years, values = local_level(level, 'frais-de-personnel')
        for k, y in ((years.index(year), 'fp'), (years.index(min(fp_years)), 'fp0')):
            for j, code in enumerate(e['codes']):
                v = values[k][j]
                if not v:
                    continue
                targets = code_to_deps(code, years[k])
                weight = sum(deps[t]['pop'] for t in targets if t in deps)
                for t in targets:
                    if t in deps and weight:
                        deps[t][y][key] += v * deps[t]['pop'] / weight

    # intercommunalités: split by the population of member communes in each département
    members = load(LOCAL / 'gfp' / '_communes.json')['members']
    gfp_e = load(LOCAL / 'gfp' / '_entities.json')
    g_years, g_values = local_level('gfp', 'frais-de-personnel')
    for k, y in ((g_years.index(year), 'fp'), (g_years.index(min(fp_years)), 'fp0')):
        for j, code in enumerate(gfp_e['codes']):
            v = g_values[k][j]
            idx = members.get(code) or []
            weight = sum(communes[i]['pop'] for i in idx)
            if not v or not weight:
                continue
            for i in idx:
                deps[communes[i]['dep']][y]['gfp'] += v * communes[i]['pop'] / weight
    for code, ent in paid_others.items():         # intercommunalités: indemnities split like their accounts
        idx = members.get(code) or []
        weight = sum(communes[i]['pop'] for i in idx)
        if ent['level'] == 'gfp' and weight:
            for i in idx:
                deps[communes[i]['dep']]['paidGfp'] = deps[communes[i]['dep']].get('paidGfp', 0) + ent['indemnities'] * communes[i]['pop'] / weight
    # départements and régions: accounts 653 are listed by SIREN and name (« DEP AIN », « REG BRETAGNE »); the name is matched to
    # the département / région, collectivités uniques are shared between their départements by population, like regions.
    paid_matched = paid_dep_and_region(paid_others, dep_meta, {code: d['pop'] for code, d in deps.items()})
    for code, (dep_part, reg_part) in paid_matched['byDep'].items():
        if code in deps:
            deps[code]['paidDep'] = dep_part
            deps[code]['paidReg'] = reg_part

    def dep_targets(code, y):
        # Ville de Paris: one collectivity, published as the commune 75056, from 2019; Métropole de Lyon: already an intercommunalité
        if (code == '75' and y >= 2019) or code == '691':
            return []
        if code == '67A':
            return ['67', '68']
        return [code]

    def region_targets(code, y):
        return [d for d, m in dep_meta.items() if m['codeRegion'] == code]

    split('departements', dep_targets, 'departement')
    split('regions', region_targets, 'region')
    reg_pop = {}
    for code, d in deps.items():
        rc = dep_meta.get(code, {}).get('codeRegion')
        reg_pop[rc] = reg_pop.get(rc, 0) + d['pop']
    # regional level as elected (regional councils, assemblies of Corse, Guyane, Martinique), shared between départements by population
    regional_real = {k[1:]: v['regionaux'] for k, v in rdep.items() if k.startswith('R')}
    for code, d in deps.items():
        rc = dep_meta.get(code, {}).get('codeRegion')
        if regional_real.get(rc) and reg_pop.get(rc):
            rdep.setdefault(code, {})['regionaux'] = regional_real[rc] * d['pop'] / reg_pop[rc]
    out_deps = []
    for code, d in sorted(deps.items()):
        rc = dep_meta.get(code, {}).get('codeRegion')
        total, total0 = sum(d['fp'].values()), sum(d['fp0'].values())
        out_deps.append({'code': code, 'name': dep_meta.get(code, {}).get('nom') or dep_names.get(code) or code, 'region': rc,
                         'population': d['pop'], 'communes': d['communes'], 'smallCommunes': d['small'], 'seats': d['seats'], 'cap': r(d['cap']),
                         'elected': {k: r(rdep.get(code, {}).get(k, 0), 2) for k in ('municipaux', 'adjoints', 'departementaux', 'regionaux', 'deputes', 'senateurs')},
                         'personnel': {k: r(v) for k, v in d['fp'].items()}, 'personnelTotal': r(total),
                         'personnel0': r(total0), 'population0': d['pop0'],
                         'paid': {'communes': r(d.get('paid', 0)), 'gfp': r(d.get('paidGfp', 0)), 'departement': r(d.get('paidDep', 0)), 'region': r(d.get('paidReg', 0)), 'cap2025': r(d.get('cap25', 0))}})

    # Regions: seats per inhabitant
    regions = []
    reg_e = load(LOCAL / 'regions' / '_entities.json')
    for code, name in zip(reg_e['codes'], reg_e['names']):
        if regional_real.get(code) and reg_pop.get(code):
            regions.append({'code': code, 'name': name, 'seats': r(regional_real[code]), 'population': reg_pop[code]})

    compact = {'year': year, 'year0': min(fp_years), 'alignedWith': 'web/communes-meta.json',
               'paidYear': paid_year,
               'columns': ['population', 'personnel (k€)', 'personnel year0 (k€)', 'population year0', 'operating spending (k€)', 'conseillers municipaux (RNE)', 'adjoints (RNE)',
                           f'indemnités payées {paid_year} (€)', 'indemnités payées 2019 (€)', f'total comptes 653 élus {paid_year} (€)', f'plafond légal {paid_year} (€)'],
               'rows': [[c["pop"], kilo(c["fp"]), kilo(c["fp0"]), c["pop0"], kilo(c["fn"]), c["cm"], c["adj"], r(c['paid']) if c['paid'] is not None else None,
                         r(c['paid19']) if c['paid19'] is not None else None, r(c['paidTotal']) if c['paidTotal'] is not None else None, r(c['cap25'])] for c in communes]}
    totals = {'communes': len(communes), 'population': sum(c['pop'] for c in communes), 'seats': sum(c['seats'] for c in communes),
              'mayors': sum(1 for c in communes if c['seats']), 'noCouncil': [c['name'] for c in communes if not c['seats']], 'deputiesMax': sum(c['deputies'] for c in communes), 'cap': r(sum(c['cap'] for c in communes)),
              'smallCommunes': sum(1 for c in communes if c['pop'] < 500), 'communesUnder1000': sum(1 for c in communes if c['pop'] < 1000),
              'seatsUnder1000': sum(c['seats'] for c in communes if c['pop'] < 1000), 'popUnder1000': sum(c['pop'] for c in communes if c['pop'] < 1000),
              'elected': sum(c['cm'] for c in communes), 'electedDeputies': sum(c['adj'] for c in communes),
              'electedUnder1000': sum(c['cm'] for c in communes if c['pop'] < 1000),
              'paid': r(sum(c['paid'] or 0 for c in communes)), 'paidTotal': r(sum(c['paidTotal'] or 0 for c in communes)), 'cap2025': r(sum(c['cap25'] for c in communes)),
              'communesPaid': sum(1 for c in communes if c['paid'] is not None), 'communesAboveCap': sum(1 for c in communes if c['paid'] and c['cap25'] and c['paid'] > c['cap25'] * 1.001),
              'communesBelowLegal': sum(1 for c in communes if c['seats'] and c['cm'] < c['seats']), 'communesWithoutRne': sum(1 for c in communes if c['seats'] and not c['cm'])}
    big = sorted(((paid_others[k]['indemnities'], paid_others[k]['name'], paid_others[k]['level']) for k in paid_others), reverse=True)[:10]
    paid = {'year': paid_year, 'levels': paid_levels, 'posts': paid_posts, 'largestOthers': big, 'depRegMatched': paid_matched['matched'],
            'source': 'DGFiP, balances comptables des collectivités (comptes de gestion), comptes 653', 'url': 'https://data.economie.gouv.fr/explore/?q=balances+comptables'}
    return {'year': year, 'year0': min(fp_years), 'strata': strata, 'departments': out_deps, 'regions': regions, 'totals': totals, 'rne': elected, 'paid': paid}, compact


def main():
    nat = national()
    fun = functions()
    st = state()
    loc = local()
    geo, compact = communes_and_departments()
    legal = {m['id']: m for m in REF['mandates']['items']}
    legal['municipaux'] = {**legal['municipaux'], 'count': geo['totals']['seats']}
    legal['regionaux'] = {**legal['regionaux'], 'count': sum(REF['regionalSeats']['byRegionCode'].values())}
    mandates = [{**m, 'legal': legal[m['id']]['count'] if m['id'] in legal else None, 'legalSource': legal[m['id']]['source'] if m['id'] in legal else None} for m in geo['rne']['mandates']]
    wf = workforce()
    out = {
        'generated': 'python3 scripts/emplois-data.py',
        'workforce': wf, 'results': results(),
        'national': nat, 'functions': fun, 'state': st, 'local': loc, 'territory': geo,
        'mandates': mandates, 'reference': {k: REF[k] for k in ('regionalSeats', 'municipalSeats', 'indemnities')},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    OUT_COMMUNES.write_text(json.dumps(compact, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    last = nat['years'][-1]
    t = geo['totals']
    print(f'{OUT.relative_to(ROOT)}: D1 {last["year"]} = {last["d1"]} Md€ ; {len(st["missions"])} missions ; {len(geo["departments"])} départements ; '
          f'{t["elected"]} conseillers municipaux en fonction (RNE) pour {t["seats"]} sièges légaux ; plafond indemnités maires+adjoints {t["cap"] / 1e9:.2f} Md€')
    print(f'{OUT_COMMUNES.relative_to(ROOT)}: {len(compact["rows"])} communes')


if __name__ == '__main__':
    main()
