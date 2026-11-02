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
    return {'year': 2025, 'source': 'Projet de loi de finances 2025, crédits de paiement par mission, programme et titre', 'url': src.get('page'),
            'missions': missions, 'pensions': pensions, 'powers': powers, 'unit': 'M€'}


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

    communes = []
    for i, row in enumerate(rows):
        code, name, dep = row[0], row[1], row[2]
        p = pop_of(i)
        n = seats(code, p)
        cap, deputies = indemnity_cap(p, n)
        communes.append({'i': i, 'code': code, 'name': name, 'dep': dep, 'pop': p, 'seats': n, 'deputies': deputies, 'cap': cap,
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
                       'seats': sum(c['seats'] for c in group), 'mayorsAndDeputiesMax': sum(1 + c['deputies'] for c in group),
                       'capTotal': r(sum(c['cap'] for c in group)), 'personnel': r(sum(c['fp'] for c in with_fp)),
                       'personnelPerHab': r(sum(c['fp'] for c in with_fp) / fp_pop, 1) if fp_pop else None,
                       'operatingShare': r(sum(c['fp'] for c in with_fp) / sum(c['fn'] for c in with_fp if c['fn']), 4) if with_fp else None,
                       'q1': r(quantile(per, .25), 1), 'median': r(quantile(per, .5), 1), 'q3': r(quantile(per, .75), 1)})

    # Départements: communes + intercommunalités (split by member population) + département + région (split by population)
    dep_meta = {d['code']: d for d in load(SRC / 'departements-meta.json')}
    dep_names = {code: v[0] for code, v in meta['departments'].items()}
    deps = {}
    for c in communes:
        d = deps.setdefault(c['dep'], {'code': c['dep'], 'communes': 0, 'pop': 0, 'pop0': 0, 'seats': 0, 'cap': 0, 'mayors': 0, 'small': 0,
                                       'fp': {'communes': 0, 'gfp': 0, 'departement': 0, 'region': 0}, 'fp0': {'communes': 0, 'gfp': 0, 'departement': 0, 'region': 0}})
        d['communes'] += 1; d['pop'] += c['pop']; d['pop0'] += c['pop0'] or 0; d['seats'] += c['seats']; d['cap'] += c['cap']; d['mayors'] += 1
        d['small'] += c['pop'] < 500
        d['fp']['communes'] += c['fp'] or 0; d['fp0']['communes'] += c['fp0'] or 0

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
    regional_seats = REF['regionalSeats']['byRegionCode']
    reg_pop = {}
    for code, d in deps.items():
        rc = dep_meta.get(code, {}).get('codeRegion')
        reg_pop[rc] = reg_pop.get(rc, 0) + d['pop']
    out_deps = []
    for code, d in sorted(deps.items()):
        rc = dep_meta.get(code, {}).get('codeRegion')
        total, total0 = sum(d['fp'].values()), sum(d['fp0'].values())
        out_deps.append({'code': code, 'name': dep_meta.get(code, {}).get('nom') or dep_names.get(code) or code, 'region': rc,
                         'population': d['pop'], 'communes': d['communes'], 'smallCommunes': d['small'], 'seats': d['seats'], 'cap': r(d['cap']),
                         'regionalSeats': r(regional_seats.get(rc, 0) * d['pop'] / reg_pop[rc], 2) if rc in regional_seats and reg_pop.get(rc) else 0,
                         'personnel': {k: r(v) for k, v in d['fp'].items()}, 'personnelTotal': r(total),
                         'personnel0': r(total0), 'population0': d['pop0']})

    # Regions: seats per inhabitant
    regions = []
    reg_e = load(LOCAL / 'regions' / '_entities.json')
    for code, name in zip(reg_e['codes'], reg_e['names']):
        if code in regional_seats and reg_pop.get(code):
            regions.append({'code': code, 'name': name, 'seats': regional_seats[code], 'population': reg_pop[code]})

    compact = {'year': year, 'year0': min(fp_years), 'alignedWith': 'web/communes-meta.json',
               'columns': ['population', 'personnel (k€)', 'personnel year0 (k€)', 'population year0', 'operating spending (k€)'],
               'rows': [[c["pop"], kilo(c["fp"]), kilo(c["fp0"]), c["pop0"], kilo(c["fn"])] for c in communes]}
    totals = {'communes': len(communes), 'population': sum(c['pop'] for c in communes), 'seats': sum(c['seats'] for c in communes),
              'mayors': sum(1 for c in communes if c['seats']), 'noCouncil': [c['name'] for c in communes if not c['seats']], 'deputiesMax': sum(c['deputies'] for c in communes), 'cap': r(sum(c['cap'] for c in communes)),
              'smallCommunes': sum(1 for c in communes if c['pop'] < 500), 'communesUnder1000': sum(1 for c in communes if c['pop'] < 1000),
              'seatsUnder1000': sum(c['seats'] for c in communes if c['pop'] < 1000), 'popUnder1000': sum(c['pop'] for c in communes if c['pop'] < 1000)}
    return {'year': year, 'year0': min(fp_years), 'strata': strata, 'departments': out_deps, 'regions': regions, 'totals': totals}, compact


def main():
    nat = national()
    fun = functions()
    st = state()
    loc = local()
    geo, compact = communes_and_departments()
    mandates = []
    for m in REF['mandates']['items']:
        m = dict(m)
        if m['id'] == 'municipaux':
            m['count'] = geo['totals']['seats']
        if m['id'] == 'regionaux':
            m['count'] = sum(REF['regionalSeats']['byRegionCode'].values())
        mandates.append(m)
    out = {
        'generated': 'python3 scripts/emplois-data.py',
        'national': nat, 'functions': fun, 'state': st, 'local': loc, 'territory': geo,
        'mandates': mandates, 'reference': {k: REF[k] for k in ('workforce', 'stateMinistries', 'education2024', 'regionalSeats', 'municipalSeats', 'indemnities')},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    OUT_COMMUNES.write_text(json.dumps(compact, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    last = nat['years'][-1]
    t = geo['totals']
    print(f'{OUT.relative_to(ROOT)}: D1 {last["year"]} = {last["d1"]} Md€ ; {len(st["missions"])} missions ; {len(geo["departments"])} départements ; '
          f'{t["seats"]} conseillers municipaux (légal) ; plafond indemnités maires+adjoints {t["cap"] / 1e9:.2f} Md€')
    print(f'{OUT_COMMUNES.relative_to(ROOT)}: {len(compact["rows"])} communes')


if __name__ == '__main__':
    main()
