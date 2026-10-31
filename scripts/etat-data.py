"""Budget de l'État: build dist/data/etat.json from the files already downloaded in sources/raw.

Sources (URLs in sources/raw/manifest.json, dataset pages on data.economie.gouv.fr):
  plf25-depenses-destination   PLF 2025, crédits par mission, programme, action (AE et CP)
  plf25-depenses-nature        PLF 2025, crédits par titre et catégorie, prévisions de fonds de concours
  plf25-recettes               PLF 2025, recettes du budget général et prélèvements sur recettes
  plf25-recettes-cas-ccf       PLF 2025, recettes des comptes d'affectation spéciale et comptes de concours financiers
  etat-situations-mensuelles   Situation mensuelle budgétaire (cumul depuis janvier), 2024 à 2026
  etat-situation-mensuelle     Liste des situations mensuelles publiées en PDF depuis 2010
  rap-2025-performance         Indicateurs des rapports annuels de performance 2025
  plf26-budget-vert            Budget vert du PLF 2026 (cotation environnementale)
  aide-publique-developpement  Déclarations d'aide publique au développement, 2018 à 2024
  etat-balances                Balances de la comptabilité générale de l'État, 2016 à 2025

Amounts are written in millions of euros (M€), as published (euros courants), rounded to 0.01 M€.
Run from the repository root:  python3 scripts/etat-data.py
"""
import collections
import csv
import gzip
import json
import os
import re
import sys

RAW = 'sources/raw'
OUT = 'dist/data/etat.json'


def rows(name):
    path = f'{RAW}/{name}.csv.gz'
    if not os.path.exists(path):
        sys.exit(f'missing {path}: run scripts/fetch-sources.mjs first')
    with gzip.open(path, 'rt', encoding='utf-8') as handle:
        yield from csv.DictReader(handle, delimiter=';')


def num(value):
    if value is None:
        return 0.0
    value = str(value).strip().replace(',', '.')
    if not value:
        return 0.0
    return float(value)


def m(value):
    """euros -> M€, rounded."""
    return round(value / 1e6, 2)


def manifest():
    data = json.load(open(f'{RAW}/manifest.json', encoding='utf-8'))
    out = {}
    for key, item in data.items():
        if not isinstance(item, dict):
            continue
        files = item.get('files') or []
        out[key] = {
            'download': files[0]['url'] if files else None,
            'page': f"https://{item['host']}/explore/dataset/{item['dataset']}/" if item.get('host') and item.get('dataset') else None,
        }
    return out


TITRES = {
    '1': 'Dotations des pouvoirs publics',
    '2': 'Dépenses de personnel',
    '3': 'Dépenses de fonctionnement',
    '4': 'Charges de la dette de l’État',
    '5': 'Dépenses d’investissement',
    '6': 'Dépenses d’intervention',
    '7': 'Dépenses d’opérations financières',
}
CATEGORIES = {
    '10': 'Dotations des pouvoirs publics',
    '21': 'Rémunérations d’activité', '22': 'Cotisations et contributions sociales', '23': 'Prestations sociales et allocations diverses',
    '31': 'Fonctionnement autre que personnel', '32': 'Subventions pour charges de service public (opérateurs)',
    '41': 'Intérêts de la dette financière négociable', '42': 'Intérêts de la dette financière non négociable', '43': 'Charges financières diverses',
    '51': 'Immobilisations corporelles de l’État', '52': 'Immobilisations incorporelles de l’État', '53': 'Subventions pour charges d’investissement',
    '61': 'Transferts aux ménages', '62': 'Transferts aux entreprises', '63': 'Transferts aux collectivités territoriales',
    '64': 'Transferts aux autres collectivités', '65': 'Appels en garantie',
    '71': 'Prêts et avances', '72': 'Dotations en fonds propres', '73': 'Dépenses de participations financières',
}
BUDGETS = {'BG': 'Budget général', 'BA': 'Budgets annexes', 'CAS': 'Comptes d’affectation spéciale', 'CCF': 'Comptes de concours financiers'}


def code(value):
    value = (value or '').strip()
    return value[:-2] if value.endswith('.0') else value


# ---------------------------------------------------------------- PLF 2025: destination (mission > programme > action)
def plf_destination():
    missions = {}
    for r in rows('plf25-depenses-destination'):
        mk = (r['typebudget'], r['mission'])
        mi = missions.setdefault(mk, {'type': r['typebudget'], 'code': r['mission'], 'name': r['libelle_mission'].strip(), 'ae': 0.0, 'cp': 0.0, 'progs': {}, 'titres': collections.defaultdict(float)})
        ae, cp = num(r['autorisation_engagement']), num(r['credit_de_paiement'])
        mi['ae'] += ae; mi['cp'] += cp
        mi['titres'][r['titre']] += cp
        pr = mi['progs'].setdefault(r['programme'], {'code': r['programme'], 'name': r['libelle_programme'].strip(), 'min': r['libelle_ministere'].strip(), 'ae': 0.0, 'cp': 0.0, 'actions': {}, 'titres': collections.defaultdict(float)})
        pr['ae'] += ae; pr['cp'] += cp
        pr['titres'][r['titre']] += cp
        ac = pr['actions'].setdefault(r['action'], {'code': r['action'], 'name': r['libelle_action'].strip(), 'ae': 0.0, 'cp': 0.0})
        ac['ae'] += ae; ac['cp'] += cp
    out = []
    for mi in missions.values():
        progs = []
        for pr in mi['progs'].values():
            acts = sorted(({'code': a['code'], 'name': a['name'], 'ae': m(a['ae']), 'cp': m(a['cp'])} for a in pr['actions'].values()), key=lambda a: -a['cp'])
            progs.append({'code': pr['code'], 'name': pr['name'], 'min': pr['min'], 'ae': m(pr['ae']), 'cp': m(pr['cp']),
                          'titres': {t: m(v) for t, v in sorted(pr['titres'].items()) if abs(v) >= 5e3}, 'actions': acts})
        progs.sort(key=lambda p: -p['cp'])
        out.append({'type': mi['type'], 'code': mi['code'], 'name': mi['name'], 'ae': m(mi['ae']), 'cp': m(mi['cp']),
                    'titres': {t: m(v) for t, v in sorted(mi['titres'].items()) if abs(v) >= 5e3}, 'progs': progs})
    out.sort(key=lambda x: (list(BUDGETS).index(x['type']), -x['cp']))
    return out


# ---------------------------------------------------------------- PLF 2025: nature (titre, catégorie), fonds de concours
def plf_nature():
    by = collections.defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])
    cats = collections.defaultdict(lambda: [0.0, 0.0])
    for r in rows('plf25-depenses-nature'):
        key = (r['type_mission'], r['code_mission'] == 'RD', code(r['code_titre']))
        vals = [num(r['ae_plf']), num(r['cp_plf']), num(r['ae_prev_fdc_adp']), num(r['cp_prev_fdc_adp'])]
        for i, v in enumerate(vals):
            by[key][i] += v
        if r['type_mission'] == 'BG':
            ck = (code(r['code_titre']), code(r['categorie']), r['code_mission'] == 'RD')
            cats[ck][0] += vals[0]; cats[ck][1] += vals[1]
    titres = []
    for (budget, rd, t), (ae, cp, fae, fcp) in sorted(by.items()):
        titres.append({'budget': budget, 'rd': rd, 'titre': t, 'ae': m(ae), 'cp': m(cp), 'fdcAe': m(fae), 'fdcCp': m(fcp)})
    categories = [{'titre': t, 'cat': c, 'label': CATEGORIES.get(c, f'Catégorie {c}'), 'rd': rd, 'ae': m(v[0]), 'cp': m(v[1])}
                  for (t, c, rd), v in sorted(cats.items()) if abs(v[1]) >= 5e3 or abs(v[0]) >= 5e3]
    return {'titres': titres, 'categories': categories}


# ---------------------------------------------------------------- PLF 2025: recettes
def plf_recettes():
    lines = []
    for r in rows('plf25-recettes'):
        kind = r['type_de_recettes']
        group = 'fiscal' if kind.startswith('Recettes fiscales') else 'nonfiscal' if kind.startswith('Recettes non fiscales') else 'psr-ue' if 'Union' in kind else 'psr-ct'
        lines.append({'g': group, 'code': code(r['code_ligne_recettes']), 'label': r['libelle'].strip(), 'v': m(num(r['montant_recettes_plf']))})
    lines.sort(key=lambda x: -x['v'])
    spec = {}
    for r in rows('plf25-recettes-cas-ccf'):
        kind = 'CAS' if 'CAS' in r['type_de_recettes'] else 'CCF'
        mi = spec.setdefault((kind, r['libelle_mission'].strip()), {'type': kind, 'mission': r['libelle_mission'].strip(), 'v': 0.0, 'v26': 0.0, 'v27': 0.0, 'lines': collections.defaultdict(float)})
        v = num(r['montant_recettes_plf_2025'])
        mi['v'] += v; mi['v26'] += num(r['previsions_recettes_2026']); mi['v27'] += num(r['previsions_recettes_2027'])
        mi['lines'][r['libelle_section'].strip()] += v
    special = []
    for mi in spec.values():
        special.append({'type': mi['type'], 'mission': mi['mission'], 'v': m(mi['v']), 'v26': m(mi['v26']), 'v27': m(mi['v27']),
                        'sections': sorted(({'label': k, 'v': m(v)} for k, v in mi['lines'].items()), key=lambda s: -s['v'])})
    special.sort(key=lambda s: -s['v'])
    return {'lines': lines, 'special': special}


# ---------------------------------------------------------------- Situation mensuelle budgétaire
def monthly():
    reader = list(rows('etat-situations-mensuelles'))
    cols = [c for c in reader[0].keys() if re.match(r'\d\d_\d\d_\d{4}$', c)]
    dates = []
    for c in cols:
        d, mo, y = c.split('_')
        dates.append(f'{y}-{mo}-{d}')
    order = sorted(range(len(cols)), key=lambda i: dates[i])
    lines = []
    for r in reader:
        lines.append({'label': r['ligne_d_information'].strip(), 'cat': r['categorie'].strip(), 'sub': r['sous_categorie'].strip(),
                      'level': int(r['niveau_hierarchique']), 'values': [m(num(r[cols[i]])) if r[cols[i]] != '' else None for i in order]})
    pdfs = []
    for r in rows('etat-situation-mensuelle'):
        pdfs.append({'date': r['date_publication'], 'title': r['titre_document'].strip(), 'url': r['url_fichier'].strip()})
    pdfs.sort(key=lambda p: p['date'], reverse=True)
    return {'dates': [dates[i] for i in order], 'lines': lines, 'pdfs': pdfs}


# ---------------------------------------------------------------- RAP 2025: indicateurs de performance
STATUS = {'cible atteinte': 'ok', 'amélioration': 'up', 'absence amélioration': 'no', 'donnée non renseignée': 'nd', 'donnée non retenue': 'nr', '': 'na'}
NUM = re.compile(r'^\s*([<>≤≥~]?)\s*=?\s*(-?[\d\s  ]+(?:[.,]\d+)?)\s*%?\s*$')


def parse(value):
    """'1 040' -> (None, 1040.0); '≥ 12,5' -> ('≥', 12.5); 'ND' -> None."""
    hit = NUM.match(value or '')
    if not hit:
        return None
    digits = re.sub(r'[\s  ]', '', hit.group(2)).replace(',', '.')
    try:
        return hit.group(1) or None, float(digits)
    except ValueError:
        return None


def rap():
    """Compact table: mission and programme names are stored once, each indicator row refers to them by index."""
    missions, progs, out = [], [], []
    def index(table, value):
        if value not in table:
            table.append(value)
        return table.index(value)
    for r in rows('rap-2025-performance'):
        label = r['libelle_indicateur'].strip()
        sub = r['libelle_sous_indicateur'].strip()
        e25 = r['exec_2025'].strip() or r['abs_exec_2025'].strip()
        c25 = r['2025_cible'].strip() or r['abs_2025_cible'].strip()
        e24 = r['exec_2024'].strip() or r['absexec_2024'].strip()
        is_prog = r['type_de_secteur'] == 'Programme'
        mi = index(missions, (r['budget'], r['code_mission'], r['mission'].strip()))
        pi = index(progs, (r['code_programme'].strip(), r['programme'].strip())) if is_prog else -1
        gap = None
        pe, pc = parse(r['exec_2025']), parse(r['2025_cible'])
        # Gap in points only for true percentages (both values between 0 and 100, no comparator on the realisation).
        if r['unite'].strip() == '%' and pe and pc and pe[0] is None and 0 <= pe[1] <= 100 and 0 <= pc[1] <= 100:
            gap = round(pe[1] - pc[1], 2)
        out.append([mi, pi, label, '' if sub == label else sub, r['unite'].strip(), e24, c25, e25,
                    STATUS.get(r['atteinte_de_la_cible_2025'].strip(), 'na'), gap, r['code_externe_indicateur'].strip()])
    return {'missions': [list(x) for x in missions], 'progs': [list(x) for x in progs],
            'cols': ['mission', 'programme', 'indicateur', 'sous-indicateur', 'unite', 'exec2024', 'cible2025', 'exec2025', 'statut', 'ecartPoints', 'code'],
            'rows': out}


# ---------------------------------------------------------------- Budget vert PLF 2026
def green():
    totals = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
    missions = collections.defaultdict(lambda: collections.defaultdict(float))
    lines = []
    flags = collections.Counter()
    cols = ['execution_2024_cp', 'lfi_2025_cp_ou_prevision_2025_si_depense_fiscale', 'plf_2026_cp_ou_prevision_2026_si_depense_fiscale']
    for r in rows('plf26-budget-vert'):
        kind = r['type_depense'].strip()
        cot = r['cotation_globale'].strip() or 'NC'
        vals = [num(r[c]) for c in cols]
        for i, v in enumerate(vals):
            totals[(kind, cot)][i] += v
        missions[r['mission'].strip() or '(sans mission)'][cot] += vals[2]
        flag = r['depenses_fiscales_e_montant_inferieur_a_0_5_meur_nc_montant_non_calcule_en_prevision_2026'].strip()
        if flag:
            flags[(kind, flag)] += 1
        if cot in ('Favorable', 'Défavorable', 'Mixte'):
            axes = {k: r[k].strip() for k in ['attenuation_climat', 'adaptation_climat', 'eau', 'dechets', 'pollutions', 'biodiversite']}
            lines.append({'k': kind, 'm': r['mission'].strip(), 'p': r['programme'].strip(), 'l': r['libelle'].strip(), 'c': cot,
                          'cat': r['categorie_generale'].strip(), 'ax': [axes[k] for k in axes], 'v24': m(vals[0]), 'v25': m(vals[1]), 'v26': m(vals[2]),
                          'flag': flag or None})
    lines.sort(key=lambda x: -abs(x['v26']))
    return {
        'totals': [{'k': k, 'c': c, 'v24': m(v[0]), 'v25': m(v[1]), 'v26': m(v[2])} for (k, c), v in sorted(totals.items())],
        'missions': sorted(({'m': mi, **{c: m(v) for c, v in cots.items()}} for mi, cots in missions.items()), key=lambda x: -sum(v for k, v in x.items() if k != 'm')),
        'lines': lines,
        'flags': [{'k': k, 'flag': f, 'n': n} for (k, f), n in sorted(flags.items())],
    }


# ---------------------------------------------------------------- Aide publique au développement
def apd():
    years = collections.defaultdict(lambda: collections.defaultdict(float))
    by = {k: collections.defaultdict(lambda: collections.defaultdict(float)) for k in ['region', 'country', 'agency', 'sector', 'finance', 'channel']}
    count = collections.Counter()
    for r in rows('aide-publique-developpement'):
        year = r['annee_de_declaration'].strip()
        flow = r['type_de_flux'].strip()
        ge, paid = num(r['equivalent_don_k_eur']) * 1e3, num(r['montant_verse_k_eur']) * 1e3
        years[year][f'all_paid'] += paid
        if flow != 'Aide Publique au Développement':
            years[year]['other_paid'] += paid
            continue
        count[year] += 1
        y = years[year]
        y['ge'] += ge; y['paid'] += paid; y['received'] += num(r['montant_percu_k_eur']) * 1e3; y['committed'] += num(r['engagements_k_eur']) * 1e3
        y['bi' if r['bi_multi0'].strip() == 'Bilatéral' else 'multi'] += ge
        keys = {'region': r['region'].strip() or 'Non ventilé', 'country': r['pays_beneficiaire'].strip() or 'Non ventilé', 'agency': r['agence'].strip() or 'Non renseigné',
                'sector': r['secteur'].strip() or 'Non renseigné', 'finance': r['type_de_financement'].strip() or 'Non renseigné', 'channel': r['canal_agrege'].strip() or 'Non renseigné'}
        for k, v in keys.items():
            by[k][v][year] += ge
    ylist = sorted(years)
    out = {'years': [{'year': int(y), 'n': count[y], **{k: m(v) for k, v in years[y].items()}} for y in ylist]}
    for k, groups in by.items():
        last = ylist[-1]
        ranked = sorted(groups.items(), key=lambda kv: -kv[1].get(last, 0))
        keep = ranked if k in ('region', 'finance', 'channel') else ranked[:25]
        out[k] = [{'name': name, 'v': [m(vals.get(y, 0)) for y in ylist]} for name, vals in keep]
    return out


# ---------------------------------------------------------------- Comptabilité générale (balances)
def balances():
    agg = collections.defaultdict(lambda: collections.defaultdict(float))
    for r in rows('etat-balances'):
        agg[(r['categorie'].strip(), r['postes'].strip())][r['annee'].strip()] += num(r['balance_sortie'])
    years = sorted({y for v in agg.values() for y in v})
    sign = {'Actif': 1, 'Charges': 1, 'Passif': -1, 'Produits': -1, 'Situation nette': -1}
    out = {'years': [int(y) for y in years], 'postes': []}
    for (cat, poste), vals in sorted(agg.items()):
        if cat not in sign:
            continue
        out['postes'].append({'cat': cat, 'poste': poste, 'v': [round(sign[cat] * vals.get(y, 0) / 1e6, 1) for y in years]})
    return out


def main():
    src = manifest()
    ids = ['plf25-depenses-destination', 'plf25-depenses-nature', 'plf25-recettes', 'plf25-recettes-cas-ccf', 'etat-situations-mensuelles',
           'etat-situation-mensuelle', 'rap-2025-performance', 'plf26-budget-vert', 'aide-publique-developpement', 'etat-balances']
    data = {
        'sources': {i: src.get(i, {}) for i in ids},
        'titres': TITRES, 'budgets': BUDGETS,
        'missions': plf_destination(),
        'nature': plf_nature(),
        'recettes': plf_recettes(),
        'monthly': monthly(),
        'rap': rap(),
        'green': green(),
        'apd': apd(),
        'balances': balances(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(',', ':'))
    print(f'{OUT}: {os.path.getsize(OUT) / 1e6:.2f} Mo, {len(data["missions"])} missions, {sum(len(x["progs"]) for x in data["missions"])} programmes, '
          f'{len(data["rap"]["rows"])} indicateurs, {len(data["green"]["lines"])} lignes cotées du budget vert')


if __name__ == '__main__':
    main()
