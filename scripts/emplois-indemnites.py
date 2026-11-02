"""Indemnities and costs of local elected officials actually paid (accounts 653*), from the DGFiP balances
downloaded by fetch-sources.mjs (sources « balances-653-* »). Writes the full tidy tables to sources/raw/indemnites/
and the compact files used by the site to sources/indemnites/ (versioned).
Usage: python3 scripts/emplois-indemnites.py
Amount = obnetdeb - obnetcre (net budgetary debit, as in the OFGL formulas). Accounts are read with their chart of
accounts (column nomen): in M57, 6532/6533 are CESER members (not elected officials) and are left out."""
import sys, os, glob, zipfile, io
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'sources', 'raw')
OUT = os.path.join(RAW, 'indemnites')
SITE = os.path.join(ROOT, 'sources', 'indemnites')
os.makedirs(OUT, exist_ok=True)
os.makedirs(SITE, exist_ok=True)
KEEP = ['exer', 'ident', 'siren', 'ndept', 'insee', 'lbudg', 'cbudg', 'ctype', 'cstyp',
        'nomen', 'categ', 'compte', 'obnetdeb', 'obnetcre', 'oobdeb', 'oobcre', 'onbdeb', 'onbcre']
NUM = ['obnetdeb', 'obnetcre', 'oobdeb', 'oobcre', 'onbdeb', 'onbcre']


def read_export(path, source):
    d = pd.read_csv(path, sep=';', dtype=str, encoding='utf-8-sig')
    d.columns = [c.lower() for c in d.columns]
    d = d[KEEP].copy()
    for c in NUM:
        d[c] = pd.to_numeric(d[c])
    d['source'] = source
    return d


def read_attach(path_or_buf, source):
    parts = []
    for ch in pd.read_csv(path_or_buf, sep=';', dtype=str, chunksize=500_000, encoding='latin-1'):
        ch.columns = [c.lower() for c in ch.columns]
        ch = ch[ch['compte'].str.startswith('653', na=False)]
        parts.append(ch[KEEP])
    d = pd.concat(parts)
    for c in NUM:
        d[c] = pd.to_numeric(d[c].str.replace(',', '.', regex=False))
    d['source'] = source
    return d


frames = []
for f in sorted(glob.glob(f'{RAW}/balances-653-communes-*.csv.gz')):
    y = os.path.basename(f)[-11:-7]
    frames.append(read_export(f, f'export balances-comptables-des-communes-en-{y}'))
for lvl, ds in [('gfp', 'balances-comptables-des-groupements-a-fiscalite-propre-depuis-2010'),
                ('dept', 'balances-comptables-des-departements'),
                ('reg', 'balances-comptables-des-regions-'),
                ('synd', 'balances-comptables-des-syndicats-depuis-2010')]:
    frames.append(read_export(f'{RAW}/balances-653-{lvl}.csv.gz', f'export {ds}'))
att = {
    'reg_2017.csv': 'attachment balance_reg_2017_dec2018_csv',
    'reg_2018.csv': 'attachment balance_reg_2018_dec2019_csv',
    'reg_2019.csv': 'attachment balance_reg_2019_dec2020_csv',
    'dept_2017.csv': 'attachment balance_deptctu_2017_dec2018_csv',
    'dept_2018.csv': 'attachment balance_deptctu_2018_dec2019_csv',
    'gfp_2018.csv': 'attachment balance_gfpeptml_2018_dec2019_csv',
}
for f, s in att.items():
    frames.append(read_attach(f'{RAW}/balances-653-pj/{f}', s))
with zipfile.ZipFile(f'{RAW}/balances-653-pj/gfp_2017.zip') as z:
    name = z.namelist()[0]
    with z.open(name) as fh:
        frames.append(read_attach(io.TextIOWrapper(fh, encoding='latin-1'), 'attachment balance_gfp_2017_zip'))

d = pd.concat(frames, ignore_index=True)
d['exer'] = d['exer'].str[:4].astype(int)

# ---- level
lvl_map = {'Commune': 'commune', 'PARIS': 'commune', 'GFP': 'gfp', 'EPT': 'gfp', 'ML': 'gfp',
           'DEPT': 'departement', 'CTU': 'departement', 'REG': 'region', 'SYND': 'syndicat'}
d['niveau'] = d['categ'].map(lvl_map)
assert d['niveau'].notna().all(), d.loc[d['niveau'].isna(), 'categ'].unique()

# ---- account classification (depends on nomenclature: M57 uses 6531x sub-accounts)
def classify(nomen, c):
    if str(nomen).startswith('M57'):
        if c == '653': return 'non_ventile'
        if c == '6531': return 'non_ventile'
        m = {'65311': 'indemnites', '65312': 'frais_mission', '65313': 'cotis_retraite',
             '65314': 'cotis_secu', '65315': 'formation', '65316': 'frais_representation',
             '65317': 'perte_revenus_fin_mandat', '653171': 'perte_revenus_fin_mandat',
             '653172': 'perte_revenus_fin_mandat', '65318': 'frais_divers',
             '653181': 'frais_divers', '653188': 'frais_divers'}
        if c in m: return m[c]
        if c.startswith('6532') or c.startswith('6533'): return 'ceser_hors_elus'
        if c == '6538': return 'autres_organismes_hors_elus'
        return 'autre_653'
    m = {'653': 'non_ventile', '6531': 'indemnites', '6532': 'frais_mission', '6533': 'cotis_retraite',
         '6534': 'cotis_secu', '6535': 'formation', '6536': 'frais_representation',
         '6537': 'perte_revenus_fin_mandat', '65371': 'perte_revenus_fin_mandat',
         '65372': 'perte_revenus_fin_mandat', '6538': 'frais_divers', '65381': 'frais_divers',
         '65388': 'frais_divers'}
    return m.get(c, 'autre_653')

pairs = d[['nomen', 'compte']].drop_duplicates()
pairs['poste'] = [classify(n, c) for n, c in zip(pairs['nomen'], pairs['compte'])]
d = d.merge(pairs, on=['nomen', 'compte'], how='left')
d['elus'] = ~d['poste'].isin(['ceser_hors_elus', 'autres_organismes_hors_elus'])
d['montant'] = (d['obnetdeb'] - d['obnetcre']).round(2)
d['montant_bp'] = d['montant'].where(d['cbudg'] == '1', 0.0)

# ---- commune INSEE code (5 chars). NDEPT is 3 chars ('001','02A','101'..'106'); INSEE field = 3-char commune number.
def insee5(ndept, insee):
    if pd.isna(insee) or pd.isna(ndept):
        return None
    if ndept.startswith('1'):          # DOM: 101 Guadeloupe -> 971xx ; INSEE field already carries the 3rd digit
        return '97' + insee
    return ndept[1:3] + insee
d['code_insee'] = None
mc = d['niveau'] == 'commune'
d.loc[mc, 'insee'] = d.loc[mc, 'insee'].str.zfill(3)   # 2017-2018 exports are not zero-padded
own = pd.Series([insee5(a, b) for a, b in zip(d['ndept'], d['insee'])], index=d.index)
# The INSEE field of budgets annexes is NOT reliable (often an internal number): take the code of the
# principal budget (cbudg=1) of the same SIREN, same year; else same SIREN another year; else own field.
bp = mc & (d['cbudg'] == '1') & own.notna()
ref_y = own[bp].groupby([d.loc[bp, 'exer'], d.loc[bp, 'siren']]).first()
ref_any = own[bp].groupby(d.loc[bp, 'siren']).agg(lambda s: s.value_counts().index[0])
code, src = [], []
for i, y, s_, o in zip(d.index[mc], d.loc[mc, 'exer'], d.loc[mc, 'siren'], own[mc]):
    if (y, s_) in ref_y.index:
        code.append(ref_y[(y, s_)]); src.append('budget_principal')
    elif s_ in ref_any.index:
        code.append(ref_any[s_]); src.append('budget_principal_autre_annee')
    else:
        code.append(o); src.append('champ_insee_ligne')
d.loc[mc, 'code_insee'] = code
d['code_insee_origine'] = None
d.loc[mc, 'code_insee_origine'] = src
# name: principal budget label per (exer, siren)
nm = d[d['cbudg'] == '1'].groupby(['exer', 'siren'])['lbudg'].first()
nm_any = d.sort_values('ident').groupby(['exer', 'siren'])['lbudg'].first()   # SIREN with only budgets annexes
d['nom'] = [nm.get((y, s), nm_any.get((y, s))) for y, s in zip(d['exer'], d['siren'])]

os.makedirs(OUT, exist_ok=True)
cols = ['exer', 'niveau', 'categ', 'siren', 'code_insee', 'code_insee_origine', 'ndept', 'nom', 'ident', 'lbudg', 'cbudg',
        'ctype', 'nomen', 'compte', 'poste', 'elus', 'obnetdeb', 'obnetcre', 'oobdeb', 'oobcre', 'montant', 'source']
d = d.sort_values(['exer', 'niveau', 'siren', 'cbudg', 'ident', 'compte'])
d[cols].to_csv(f'{OUT}/balances_653_lignes.csv.gz', index=False, compression='gzip')

# ---- tidy per collectivity: all budgets (BP+BA) summed per siren, élus posts only
d['code_insee'] = d['code_insee'].fillna('')
t = (d.groupby(['exer', 'niveau', 'categ', 'siren', 'code_insee', 'nom', 'nomen', 'compte', 'poste', 'elus'])
       .agg(montant=('montant', 'sum'), montant_budget_principal=('montant_bp', 'sum'), n_budgets=('ident', 'nunique'))
       .reset_index())
t['montant'] = t['montant'].round(2)
t['montant_budget_principal'] = t['montant_budget_principal'].round(2)
t.to_csv(f'{OUT}/indemnites_elus_par_collectivite_long.csv', index=False)
t = t[t['elus']]
w = t.pivot_table(index=['exer', 'niveau', 'categ', 'siren', 'code_insee', 'nom'], columns='poste',
                  values='montant', aggfunc='sum', fill_value=0).reset_index()
posts = ['indemnites', 'cotis_retraite', 'cotis_secu', 'perte_revenus_fin_mandat', 'frais_mission',
         'formation', 'frais_representation', 'frais_divers', 'non_ventile', 'autre_653']
for p in posts:
    if p not in w: w[p] = 0.0
w['indemnites_et_cotisations'] = w[['indemnites', 'cotis_retraite', 'cotis_secu', 'perte_revenus_fin_mandat']].sum(axis=1)
w['total_653_elus'] = w[posts].sum(axis=1)
w = w[['exer', 'niveau', 'categ', 'siren', 'code_insee', 'nom'] + posts + ['indemnites_et_cotisations', 'total_653_elus']]
w = w.dropna(subset=['siren'])
w[posts + ['indemnites_et_cotisations', 'total_653_elus']] = w[posts + ['indemnites_et_cotisations', 'total_653_elus']].round(2)
w.to_csv(f'{OUT}/indemnites_elus_par_collectivite.csv', index=False)

# ---- national summaries
s1 = (d.groupby(['exer', 'niveau', 'poste', 'elus'])
        .agg(montant_tous_budgets=('montant', 'sum'),
             montant_budget_principal=('montant_bp', 'sum'),
             n_lignes=('montant', 'size'), n_siren=('siren', 'nunique'))
        .reset_index())
s1.to_csv(f'{OUT}/totaux_nationaux_par_poste.csv', index=False)
s2 = (w.groupby(['exer', 'niveau'])
        .agg(n_collectivites=('siren', 'nunique'), indemnites=('indemnites', 'sum'),
             indemnites_et_cotisations=('indemnites_et_cotisations', 'sum'), total_653_elus=('total_653_elus', 'sum'))
        .reset_index())
s2[['indemnites', 'indemnites_et_cotisations', 'total_653_elus']] = s2[['indemnites', 'indemnites_et_cotisations', 'total_653_elus']].round(0)
s2.to_csv(f'{OUT}/totaux_nationaux_par_niveau.csv', index=False)
print(s2.to_string())
print(d.groupby(['exer', 'source']).size().to_string())
print('lines', len(d), 'long', len(t), 'wide', len(w))
print('oob nonzero', (d['oobdeb'] != 0).sum(), d['oobdeb'].sum(), 'onb nonzero', (d['onbdeb'] != 0).sum())
print('obnetcre nonzero', (d['obnetcre'] != 0).sum(), d['obnetcre'].sum())
print('autre_653', d[d.poste == 'autre_653'].groupby(['nomen', 'compte']).montant.agg(['size', 'sum']).to_string())
print(d[mc].groupby(['exer','code_insee_origine']).size().to_string())

# ---- compact files used by the site (versioned in sources/indemnites/)
s2.to_csv(f'{SITE}/totaux-par-niveau.csv', index=False)
s1[s1['elus']].round(2).to_csv(f'{SITE}/totaux-par-poste.csv', index=False)
last_year = int(w['exer'].astype(int).max())
keep = ['exer', 'niveau', 'siren', 'code_insee', 'nom', 'indemnites', 'indemnites_et_cotisations', 'total_653_elus']
wy = w.assign(exer=w['exer'].astype(int))
wy[(wy['niveau'] == 'commune') & wy['exer'].isin([2019, last_year])][['exer', 'code_insee', 'indemnites', 'total_653_elus']].round(0).astype({'indemnites': int, 'total_653_elus': int}).to_csv(f'{SITE}/communes-2019-{last_year}.csv', index=False)
wy[(wy['niveau'] != 'commune') & (wy['exer'] == last_year)][keep].to_csv(f'{SITE}/autres-collectivites-{last_year}.csv', index=False)
print('site files written to', SITE)
