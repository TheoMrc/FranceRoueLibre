"""The Cour des comptes inventory of low-yield taxes (« taxes à faible rendement », April 2025) for the Impôts page.

Reads the annex published with the report, frozen in sources/ccomptes-taxes-faible-rendement-2025.xlsx
(« Inventaire » sheet: 319 taxes in force at some point between 2019 and 2024; « Scénarios » sheet: the taxes named in
the three reform scenarios), and writes sources/taxes-faible-rendement.json.
Amounts are the « enjeu financier » of the workbook, in M€; an empty cell stays null (yield unknown, never zero).
Scenario lines are matched to the inventory by their label (exact after normalisation, else the closest label above a
similarity threshold); unmatched lines are kept and listed, never guessed.
Checks against the report: 243 taxes in force in 2024, 126 with a known yield, 5 978 M€ in total.
Run: python scripts/extract-low-yield-taxes.py
"""
import difflib, json, re, unicodedata
from pathlib import Path
import openpyxl

root = Path(__file__).resolve().parent.parent
SRC = 'sources/ccomptes-taxes-faible-rendement-2025.xlsx'
wb = openpyxl.load_workbook(root / SRC)

def norm(s):
    s = str(s).replace('œ', 'oe').replace('Œ', 'Oe').replace('’', ' ').replace('\xa0', ' ')
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()

def amount(v):
    if v is None or str(v).strip() == '': return None
    return round(float(str(v).replace(',', '.').replace('\xa0', '')), 4)

def clean(s):
    return ' '.join(str(s).replace('\xa0', ' ').split()) if s is not None else None

head = [c.value for c in wb['Inventaire'][1]]
assert head == ['Identifiant', 'Libellé', 'Objectif', 'Redevable', 'Assiette', 'Collecteur', 'Affectataire', 'Enjeu 2019', 'Enjeu 2024', 'Etat'], head
STATE = {'En vigueur entre 2019 et 2024': 'en vigueur', 'Créée entre 2019 et 2024': 'créée', 'Supprimée entre 2019 et 2024': 'supprimée', 'Ephémère entre 2019 et 2024': 'éphémère'}
taxes = []
for r in wb['Inventaire'].iter_rows(min_row=2, values_only=True):
    if r[0] is None: continue
    taxes.append({'id': int(r[0]), 'label': clean(r[1]), 'objective': clean(r[2]), 'payer': clean(r[3]), 'base': clean(r[4]),
                  'collector': clean(r[5]), 'beneficiary': clean(r[6]), 'y2019': amount(r[7]), 'y2024': amount(r[8]), 'state': STATE[clean(r[9])],
                  'scenarios': []})

# Scenarios: bold rows open a scenario, italic rows a sub-group, other rows name a tax.
SCEN = {1: 'Revenir dès le budget 2026 sur ces taxes fragiles ou problématiques (simplifier ou supprimer)',
        2: 'Réexaminer d’ici 2027 leur place dans quatre secteurs (médicament, contrôle sanitaire des aliments, formation professionnelle, services publics locaux)',
        3: 'Rationaliser dans la prochaine loi de programmation (fusionner, découpler de l’affectataire, plafonner)'}
by_norm = {}
for t in taxes: by_norm.setdefault(norm(t['label']), []).append(t)
labels = list(by_norm)
# Scenario labels that name an inventory line differently (checked by hand against the « Inventaire » labels).
ALIAS = {'taxe main d oeuvre etrangere permanente': 17, 'taxe main d oeuvre etrangere saisonniere': 18, 'taxe main d oeuvre etrangere temporaire': 19,
         'taxe forfaitaire sur les metaux precieux les bijoux les objets d art les antiquites': 221,
         'prelevement sur les contrats participation et interessement en desherence': 121,
         'contribution sur la cession a un service de television des droits de diffusion de manifestations ou de competitions sportives': 32,
         'composante de la taxe generale sur les activites polluantes portant sur les lessives': 329,
         'taxe additionnelle a la taxe sur les surfaces commerciales tascom': 178, 'taxe annuelle a l essieu': 191,
         'cotisations des entreprises cinematographiques': 53,
         'contribution a la formation professionnelle du secteur du btp pour les entreprises de moins de 10 salaries': 31}
by_id = {t['id']: t for t in taxes}
scenario, group, unmatched, groups = None, None, [], []
for row in wb['Scénarios'].iter_rows():
    cell = row[0]
    if not cell.value: continue
    text = clean(cell.value)
    if cell.font and cell.font.b:
        scenario = int(re.search(r'Sc[ée]nario (\d)', text).group(1)); group = None; continue
    if (cell.font and cell.font.i) or re.match(r'^\d+ taxes ', text):
        group = text; groups.append({'scenario': scenario, 'label': text}); continue
    key = norm(text)
    if key in ALIAS:
        by_norm.setdefault(key, [by_id[ALIAS[key]]])
    if key not in by_norm:
        close = difflib.get_close_matches(key, labels, n=1, cutoff=0.72)
        key = close[0] if close else None
    if key is None:
        unmatched.append({'scenario': scenario, 'group': group, 'label': text}); continue
    for t in by_norm[key]:
        tag = {'scenario': scenario, 'group': group}
        if tag not in t['scenarios']: t['scenarios'].append(tag)

active = [t for t in taxes if t['state'] in ('en vigueur', 'créée')]
known = [t for t in active if t['y2024'] is not None]
total = sum(t['y2024'] for t in known)
assert len(active) == 243, len(active)
assert len(known) == 126, len(known)
assert abs(total - 5978) < 1, total

out = {
    'source': 'Cour des comptes, Les taxes à faible rendement, une rationalisation à poursuivre, rapport public thématique, avril 2025',
    'url': 'https://www.ccomptes.fr/fr/publications/les-taxes-faible-rendement-0',
    'report': 'https://www.ccomptes.fr/sites/default/files/2025-04/20250417-Taxes-a-faible-rendement_0.pdf',
    'file': SRC, 'unit': 'M€', 'threshold': 175, 'scenarioLabels': SCEN, 'groups': groups,
    'totals': {'inForce2024': len(active), 'knownYield2024': len(known), 'yield2024': round(total, 1),
               'removedSince2019': sum(t['state'] in ('supprimée', 'éphémère') for t in taxes)},
    'unmatchedScenarioLines': unmatched, 'taxes': taxes,
}
(root / 'sources/taxes-faible-rendement.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf8')
print(f'{len(taxes)} taxes, {len(active)} in force in 2024, {len(known)} known yields = {total:.1f} M€; '
      f'scenario links {sum(len(t["scenarios"]) for t in taxes)}, unmatched lines {len(unmatched)}')
