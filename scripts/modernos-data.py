"""Data of the /modernos page (live presentation for Le Monde Moderne): every figure the page shows, computed from the
site's own published files, so the 1-click buttons answer at once without the network or a model.

    python scripts/modernos-data.py [--db dist/data/search/frl-search.sqlite3]

Writes
  dist/data/modernos.json           the scenes: State budget lines, saved Loupe answers, the picked communes,
                                    SIRENs and procurement signals
  dist/data/modernos-communes.json  every commune (2025): population and a few per-inhabitant figures, with the
                                    median of communes of the same size, for the free "your town" field

Communes are compared with the median of communes of the same size, with the bands of the Loupe's `comparer` tool
(server/assistant/outils.py). The search index (for the SIRENs and the contracts near a threshold) is the one the
search API reads: rebuilt from its parts (dist/data/search/db/) when the assembled file is missing.
"""
import argparse
import json
import pathlib
import shutil
import sqlite3
import statistics
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / 'dist' / 'data'
sys.path.insert(0, str(ROOT / 'server'))
sys.path.insert(0, str(ROOT / 'server' / 'assistant'))

BANDS = [0, 500, 2000, 3500, 5000, 10000, 20000, 50000, 100000, 10 ** 9]  # same as outils.comparer
YEAR = 2025

CITIES = ['59350', '93014', '34172']                      # Lille, Clichy-sous-Bois, Montpellier
SIRENS = ['316344233', '775672272', '341062404']         # Union nationale des CARPA, Croix-Rouge, Groupe SOS Solidarités
SDIS06 = '280600511'                                     # buyer of the 89 000 € contracts (objects: « SDIS 06 »)
DUNKERQUE = '245900428'
# Grant years of the "jaunes" annexes left out of the totals shown here (none: the 2011 scale is fixed upstream in
# process_subsidies.py)
ASSO_SKIP = set()

def load(rel):
    return json.loads((DATA / rel).read_text(encoding='utf-8'))


def band(pop):
    lo = max(b for b in BANDS if b <= pop)
    return BANDS.index(lo)


def level_per_hab(level, agg, year):
    """{entity index: value per inhabitant} for one level and aggregate."""
    data, pop = load(f'local/{level}/{agg}.json'), load(f'local/{level}/_pop.json')
    v = data['values'][data['years'].index(year)]
    p = pop['values'][pop['years'].index(year)]
    return v, p


def communes():
    meta = load('web/communes-meta.json')
    rows, deps = meta['rows'], meta['departments']
    pop = load('local/communes/_pop.json')
    pops = pop['values'][pop['years'].index(YEAR)]
    aggs = {'pers': 'frais-de-personnel', 'dette': 'encours-de-dette', 'etat': 'concours-de-l-etat',
            'dep': 'depenses-totales-hors-remb'}
    vals = {}
    for key, agg in aggs.items():
        d = load(f'local/communes/{agg}.json')
        vals[key] = d['values'][d['years'].index(YEAR)]
    assos = load('aides/associations-communes.json')['communes']
    projects = {}
    for year in range(2018, YEAR + 1):
        path = DATA / 'web' / f'projects-{year}.json'
        if path.exists():
            for r in json.loads(path.read_text(encoding='utf-8'))['rows']:
                n, a = projects.get(r[3], (0, 0))
                projects[r[3]] = (n + 1, a + (r[5] or 0))
    # the other layers of the « mille-feuille »: intercommunality, département, région, spending per inhabitant
    gfp_members = load('local/gfp/_communes.json')['members']
    gfp_codes = load('local/gfp/_entities.json')['codes']
    gfp_names = load('local/gfp/_entities.json').get('names', gfp_codes)
    gfp_of = {i: code for code, members in gfp_members.items() for i in members}
    layers = {}
    for level in ('gfp', 'departements', 'regions'):
        v, p = level_per_hab(level, 'depenses-totales-hors-remb', YEAR)
        ents = load(f'local/{level}/_entities.json')
        layers[level] = {c: (round(v[i] / p[i]) if v[i] is not None and p[i] else None, (ents.get('names') or ents['codes'])[i])
                         for i, c in enumerate(ents['codes'])}
    reg_by_name = {name: code for code, (_, name) in layers['regions'].items()}

    out, per_band = [], {}
    for i, (code, name, dep, *_rest) in enumerate(rows):
        p = pops[i]
        if not p:
            continue
        ph = {k: (round(vals[k][i] / p) if vals[k][i] is not None else None) for k in aggs}
        b = band(p)
        for k, x in ph.items():
            if x is not None:
                per_band.setdefault(b, {}).setdefault(k, []).append(vals[k][i] / p)
        a = assos.get(code, {})
        a_years = {y: v for y, v in a.get('annees', {}).items() if y not in ASSO_SKIP}
        n_proj, a_proj = projects.get(code, (0, 0))
        gfp = gfp_of.get(i)
        out.append([code, name, dep, p, ph['pers'], ph['dette'], ph['etat'], ph['dep'],
                    a.get('beneficiaires', 0), round(a_years.get('2023', [0])[0]), n_proj, round(a_proj), gfp])
    medians = {str(b): {k: round(statistics.median(v)) for k, v in ks.items()} for b, ks in per_band.items()}
    counts = {str(b): len(ks['dep']) for b, ks in per_band.items()}
    # the four layers together (commune + intercommunality + département + région), € per inhabitant: mean and median
    # of the communes of each size band that have all four
    def four(row):
        g = layers['gfp'].get(row[12], (None,))[0] if row[12] else None
        d = layers['departements'].get(row[2], (None, None))
        r = layers['regions'].get(reg_by_name.get(deps.get(row[2], [None, None])[1]), (None,))[0]
        return row[7] + g + d[0] + r if None not in (row[7], g, d[0], r) else None
    totals = {}
    for row in out:
        t = four(row)
        if t is not None:
            totals.setdefault(str(band(row[3])), []).append(t)
    four_layers = {b: {'median': round(statistics.median(v)), 'mean': round(statistics.mean(v)), 'n': len(v)} for b, v in totals.items()}
    # rank in the band (1 = highest per inhabitant) for each figure
    col = {'pers': 4, 'dette': 5, 'etat': 6, 'dep': 7}
    ranks = {}
    for k, c in col.items():
        groups = {}
        for row in out:
            if row[c] is not None:
                groups.setdefault(band(row[3]), []).append(row)
        for rs in groups.values():
            rs.sort(key=lambda r: -r[c])
            for rank, row in enumerate(rs, 1):
                ranks.setdefault(row[0], {})[k] = rank
    for row in out:
        row.append([ranks.get(row[0], {}).get(k) for k in col])
    return {
        'year': YEAR,
        'source': 'OFGL, bases consolidées des communes ; annexes « jaunes » (associations, 2023) ; DGCL (projets aidés '
                  '2018-2025) ; groupements, départements et régions : OFGL, dépenses totales hors remboursements',
        'bands': BANDS[:-1],
        'cols': ['insee', 'nom', 'dep', 'population', 'personnel_hab', 'dette_hab', 'concours_etat_hab',
                 'depenses_hab', 'associations', 'associations_2023_eur', 'projets_aides', 'projets_aides_eur',
                 'groupement', 'rangs_dans_la_strate'],
        # spending per inhabitant of the other layers: [name, € per inhabitant]
        'groupements': {c: [n, v] for c, (v, n) in layers['gfp'].items()},
        'departements': {c: [n, v, reg_by_name.get(deps.get(c, [None, None])[1])] for c, (v, n) in layers['departements'].items()},
        'regions': {c: [n, v] for c, (v, n) in layers['regions'].items()},
        'rank_cols': list(col),
        'medians': medians, 'counts': counts, 'fourLayers': four_layers, 'rows': out,
    }


def search_db(path):
    if path and pathlib.Path(path).exists():
        return path, None
    default = DATA / 'search' / 'frl-search.sqlite3'
    if default.exists():
        return str(default), None
    parts = sorted((DATA / 'search' / 'db').glob('frl-search.sqlite3.0*'))
    tmp = tempfile.NamedTemporaryFile(suffix='.sqlite3', delete=False)
    with tmp as out:
        for part in parts:
            with open(part, 'rb') as f:
                shutil.copyfileobj(f, out)
    return tmp.name, tmp.name


def sirens(db_path):
    import search_api as A
    A.DB_PATH = db_path
    out = {}
    for s in SIRENS:
        r = A.search('siren:' + s)
        with sqlite3.connect(f'file:{db_path}?mode=ro&immutable=1', uri=True) as db:
            n_prog = db.execute("SELECT count(DISTINCT extra) FROM doc WHERE siren = ? AND src = 1 AND fw = 0", (s,)).fetchone()[0]
        spend = [x for x in r['stats'] if not x['fw'] and x['src'] != 6 and not (x['src'] == 1 and str(x['year']) in ASSO_SKIP)]
        years = {}
        for x in spend:
            years[x['year']] = years.get(x['year'], 0) + x['amount']
        out[s] = {
            'name': next((w['label'] for w in r['who'] if w['siren'] == s), None) or (r['top'][0]['who'] if r['top'] else s),
            'lines': sum(x['n'] for x in spend), 'total': round(sum(years.values())),
            'years': [[y, round(v)] for y, v in sorted(years.items())],
            'programmes': [[e['label'], round(e['value'])] for e in r['extra'] if e['src'] == 1][:8],
            'n_programmes': n_prog,
            'skipped2011': round(sum(x['amount'] for x in r['stats'] if x['src'] == 1 and str(x['year']) in ASSO_SKIP and not x['fw'])),
            'top': [{'year': t['year'], 'amount': round(t['amount']), 'title': t['title'], 'extra': t['extra']}
                    for t in sorted((t for t in r['top'] if not t['fw']), key=lambda t: -(t['amount'] or 0))[:4]],
        }
    return out


def signals(db_path):
    import sqlite3
    db = sqlite3.connect(f'file:{db_path}?mode=ro&immutable=1', uri=True)
    amounts = [a for (a,) in db.execute('SELECT amount FROM doc WHERE siren = ? AND src = 2 AND amount BETWEEN 70000 AND 110000', (SDIS06,))]
    exact = sum(1 for a in amounts if round(a) == 89000)
    bins = [[lo, sum(1 for a in amounts if lo <= a < lo + 2000)] for lo in range(70000, 110000, 2000)]
    titles = [t for (t,) in db.execute("SELECT title FROM doc WHERE siren = ? AND src = 2 AND round(amount) = 89000 LIMIT 400", (SDIS06,))]
    proc = load('marches/signals.json')
    bunch = next(t for t in proc['thresholdBunching']['byThreshold'] if t['threshold'] == 90000)
    sdis = next(r for r in bunch['rows'] if r[0] == SDIS06)
    national = {k: bunch.get(k) for k in ('national', 'nationalBelow', 'nationalAbove') if k in bunch}
    fields = proc['contractFields']
    rows = [dict(zip(fields, r)) for r in proc['implausibleAmounts']['rows']]
    dk = [r for r in rows if r['buyerSiren'] == DUNKERQUE]
    gas = [r for r in rows if r['amount'] == 2147483647]
    return {
        'sdis06': {'siren': SDIS06, 'name': 'SDIS des Alpes-Maritimes (SDIS 06)', 'below': sdis[2], 'above': sdis[3],
                   'contracts': sdis[4], 'exact89000': exact, 'bins': bins, 'threshold': 90000,
                   'frameworkShare': None, 'national': national, 'rule': proc['thresholdBunching']['rule'],
                   'sample': sorted(set(titles))[:8], 'link': 'signaux.html#sig-seuils'},
        'dunkerque': {'first': dk[0] if dk else None, 'n': len(dk), 'total': round(sum(r['amount'] for r in dk)),
                      'rule': proc['implausibleAmounts']['rule'], 'link': 'signaux.html#sig-montants-aberrants'},
        'int32': gas[:4],
    }


def etat():
    d = load('etat.json')
    pop = {x['year']: x['population'] for x in load('insee-population.json')['january1']}
    mission = next(m for m in d['missions'] if m['code'] == 'AQ')
    pp = next(m for m in d['missions'] if m['name'] == 'Pouvoirs publics')
    senat = next(p for p in pp['progs'] if p['name'] == 'Sénat')
    return {
        'population': pop[2025], 'populationYear': 2025,
        'audiovisuel': {'name': mission['name'], 'cp_meur': mission['cp'], 'source': 'PLF 2025, crédits de paiement',
                        'progs': [[p['name'], p['cp']] for p in mission['progs']]},
        'senat_meur': senat['cp'],
        'plf26_audiovisuel': [[x['programme'], x['cp26']] for x in d['plf26']['non_rattaches'] if 'audiovisuel' in x['mission']],
        'sources': {k: d['sources'][k]['page'] for k in ('plf25-depenses-destination', 'plf26-budget-vert')},
    }


def niches_info():
    """Tax expenditures of the PLF 2026 (dist/data/niches.json): how many, how many costed, and those without a cost."""
    n = load('niches.json')
    c = n['counts']
    t = next(x for x in n['totals'] if x['year'] == 2026)
    return {'measures': c['measures'], 'costed2026': c['known2026'], 'total2026_meur': t['total'], 'nc': c['nc'], 'eps': c['eps'],
            'empty': c['empty'], 'uncosted': c['nc'] + c['eps'] + c['empty'], 'neverCosted': c['neverCosted']}


def macro():
    acc = load('national-accounts-3201.json')
    debt = load('national-debt.json')
    a, d = acc['years'][-1], debt['years'][-1]
    fraude = load('fraude.json')
    tva = fraude['ecart_tva_commission']
    ctl = fraude['controle']
    niches = load('niches.json')['totals']
    assos = load('aides/associations.json')
    return {
        'year': a['year'], 'spending_md': round(a['spending'], 1), 'revenue_md': round(a['revenue'], 1),
        'deficit_md': round(-a['balance'], 1), 'debt_md': round(d['debt'], 1), 'debtYear': d['year'],
        'source': [acc['source'], debt['source']],
        'fraude': {'de_md': fraude['incertitude']['de'], 'a_md': fraude['incertitude']['a'],
                   'citation': fraude['incertitude']['citation'], 'tva_gap_meur': tva['ecart_meur'][-1],
                   'tva_gap_year': tva['annees'][-1], 'tva_gap_pct': tva['ecart_pct_tva_due'][-1],
                   'controle_year': ctl['annees'][-1], 'controle_md': ctl['resultats_totaux'][-1],
                   'recouvre': fraude['recouvre']['montants_md_eur'], 'sources': fraude['sources']},
        'niches': niches,
        'associationYears': assos['years'],
        'searchLines': load('search/meta.json')['lines'],
        'contracts': load('marches/summary.json')['quality']['unique'],
    }


def usage():
    """How the site was used since its launch, from the private journal on the editor's PC (_journal/, not in git).
    Empty when the journal is not there: the page then shows nothing of it."""
    j = ROOT / '_journal'
    out = {}
    try:
        stats = json.loads((j / 'stats.json').read_text(encoding='utf-8'))
        out['views'] = sum(v.get('views', 0) for v in stats.values())
        out['visitors'] = sum(v.get('visitors', 0) for v in stats.values())
        out['searches'] = sum(v.get('searches', 0) for v in stats.values())
        out['days'] = [min(stats), max(stats)]
    except (OSError, ValueError):
        pass
    try:
        import csv
        with open(j / 'loupe.csv', encoding='utf-8-sig', newline='') as f:
            rows = list(csv.DictReader(f))
        out['loupe_questions'] = len(rows)
        out['loupe_cost_eur'] = round(sum(float(r['cost_eur'] or 0) for r in rows), 2)
        out['lemaire_asked'] = sum(1 for r in rows if 'le maire' in r['question'].lower()
                                   and any(w in r['question'].lower() for w in ('coûté', 'couté', 'coute', 'coûte')))
    except (OSError, ValueError, KeyError):
        pass
    try:
        import subprocess
        log = subprocess.run(['git', 'log', '--since=2026-11-02T00:00', '--format=%h'], cwd=ROOT, capture_output=True,
                             text=True, check=True).stdout.split()
        out['commits_since_monday'] = len(log)
    except (OSError, subprocess.CalledProcessError):
        pass
    return out


def loupe():
    """The saved answers of the Loupe (server/assistant/faq.json, scripts/loupe-faq.py) that the scene 3 buttons ask:
    the real Loupe serves them without a model; the page shows the same text if the Loupe cannot be reached."""
    faq = json.loads((ROOT / 'server' / 'assistant' / 'faq.json').read_text(encoding='utf-8'))
    by_id = {e['id']: e for e in faq['entries']}
    keys = {'lemaire': 'dette-le-maire', 'cantine': 'cantine-senat', 'audiovisuel': 'audiovisuel-public'}
    return {k: {'question': by_id[i]['question'] if k != 'lemaire' else 'Combien nous a coûté Bruno Le Maire ?',
                'reply': by_id[i]['reply'], 'sources': by_id[i].get('sources', []), 'data': by_id[i].get('data', {})}
            for k, i in keys.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db')
    args = ap.parse_args()
    db, tmp = search_db(args.db)
    try:
        com = communes()
        picks = {c: next(r for r in com['rows'] if r[0] == c) for c in CITIES}
        layers = {c: {'groupement': com['groupements'].get(picks[c][12]), 'departement': com['departements'].get(picks[c][2])}
                  for c in CITIES}
        for c in CITIES:
            reg = layers[c]['departement'][2] if layers[c]['departement'] else None
            layers[c]['region'] = com['regions'].get(reg)
        page = {'etat': etat(), 'loupe': loupe(), 'macro': macro(), 'usage': usage(), 'cities': CITIES, 'cityRows': picks, 'cityLayers': layers,
                'sirens': sirens(db), 'signals': signals(db),
                'communesCols': com['cols'], 'medians': com['medians'], 'counts': com['counts'], 'bands': com['bands'],
                'fourLayers': com['fourLayers'], 'niches': niches_info()}
    finally:
        if tmp:
            pathlib.Path(tmp).unlink(missing_ok=True)
    (DATA / 'modernos.json').write_text(json.dumps(page, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (DATA / 'modernos-communes.json').write_text(json.dumps(com, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('modernos.json', (DATA / 'modernos.json').stat().st_size, 'octets ; modernos-communes.json',
          (DATA / 'modernos-communes.json').stat().st_size, 'octets ;', len(com['rows']), 'communes')


if __name__ == '__main__':
    main()
