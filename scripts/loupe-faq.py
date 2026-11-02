"""Saved answers of la Loupe (server/assistant/faq.json): questions many readers ask, answered once from data downloaded
by fetch-sources.mjs, then served without calling a model (no credits spent). Every figure is read from a file; the
wording around it is fixed here. Re-run after a new download:

  node scripts/fetch-sources.mjs --only=dette-trimestrielle
  python3 scripts/loupe-faq.py

Also writes the tidy series sources/dette-trimestrielle/dette-maastricht-trimestrielle.csv (versioned)."""
import csv
import json
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'sources' / 'raw' / 'dette-trimestrielle' / 'econ-gen-dette-trim-adm-pub-2.xlsx'
TIDY = ROOT / 'sources' / 'dette-trimestrielle' / 'dette-maastricht-trimestrielle.csv'
OUT = ROOT / 'server' / 'assistant' / 'faq.json'
INSEE_PAGE = 'https://www.insee.fr/fr/statistiques/2830301'
ANNUAL = ROOT / 'sources' / 'national-debt.json'


def quarterly():
    """{'2017-T1': (debt Md€, % of GDP), …} from the Insee workbook; checks the layout it relies on."""
    rows = list(openpyxl.load_workbook(RAW, read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True))
    head = next(i for i, r in enumerate(rows) if r and str(r[0] or '').startswith('Trimestre'))
    assert 'milliards' in str(rows[head][1]) and 'PIB' in str(rows[head][2]), rows[head]
    out = {}
    for r in rows[head + 1:]:
        if r and isinstance(r[0], str) and re.fullmatch(r'\d{4}-T[1-4]', r[0].strip()) and isinstance(r[1], (int, float)):
            out[r[0].strip()] = (float(r[1]), float(r[2]))
    assert len(out) > 100, 'série trimestrielle trop courte'
    return out


def fr(v, d=0):
    s = f'{v:,.{d}f}'.replace(',', ' ').replace('.', ',')
    return s


def debt_le_maire(q, annual):
    # Minister of the Economy from 17 May 2017 to 21 September 2024 (decrees of appointment of the Philippe I government and of the
    # Barnier government, Journal officiel): last quarter-end before he took office, and the
    # quarter-end that follows his departure (Insee publishes the debt at the end of each quarter only).
    start, end = '2017-T1', '2024-T3'
    (d0, p0), (d1, p1) = q[start], q[end]
    years = {y['year']: y for y in annual['years']}
    deficits = {y: years[y]['deficit'] for y in range(2017, 2025) if years.get(y, {}).get('deficit') is not None}
    covid = sum(deficits[y] for y in (2020, 2021))
    total_def = sum(deficits.values())
    peak_year = max(deficits, key=deficits.get)
    reply = (
        f'Entre l’arrivée de Bruno Le Maire au ministère de l’Économie (17 mai 2017) et son départ (21 septembre 2024), '
        f'la dette publique au sens de Maastricht est passée de **{fr(d0)} Md€** (fin mars 2017) à **{fr(d1)} Md€** '
        f'(fin septembre 2024) : **+{fr(d1 - d0)} Md€**, soit +{fr(100 * (d1 / d0 - 1))} %.\n\n'
        f'Rapportée à la richesse produite, elle passe de **{fr(p0, 1)} %** à **{fr(p1, 1)} % du PIB** '
        f'(+{fr(p1 - p0, 1)} points).\n\n'
        f'- Les déficits publics des années 2017 à 2024 (années entières) totalisent {fr(total_def)} Md€ ; la plus lourde est '
        f'{peak_year} ({fr(deficits[peak_year])} Md€), et 2020–2021, années du Covid, comptent pour {fr(covid)} Md€.\n'
        f'- Qui décide : la dette couvre toutes les administrations (État, sécurité sociale, collectivités) ; les lois de '
        f'finances et de financement de la sécurité sociale sont préparées par le gouvernement (ministres de l’Économie '
        f'et des Comptes publics) et votées chaque année par le Parlement.\n'
        f'- Insee ne publie la dette qu’en fin de trimestre : les dates exactes du mandat ne tombent pas sur ces points.\n\n'
        f'Pour le détail année par année : [Comptes publics](index.html#comptes). Sources : '
        f'[Insee, dette trimestrielle]({INSEE_PAGE}), [Insee, comptes de la Nation]({annual["source"]}).')
    return {
        'id': 'dette-le-maire',
        'question': 'De combien a augmenté la dette sous le mandat de Bruno Le Maire ?',
        # all groups must match (after lower-case and accent removal), any word inside a group
        'match': [['dette', 'endettement'], ['le maire', 'lemaire'], ['augment', 'hausse', 'combien', 'evolu', 'progress',
                                                                         'sous', 'pendant', 'mandat', 'bilan', 'creus']],
        'reply': reply,
        'sources': [{'title': 'Insee, dette des administrations publiques (trimestrielle)', 'url': INSEE_PAGE},
                    {'title': 'Insee, comptes de la Nation 3.101 et 3.105', 'url': annual['source']}],
        'data': {'start': start, 'end': end, 'debt': [round(d0, 1), round(d1, 1)], 'pctGdp': [round(p0, 1), round(p1, 1)],
                 'deficits': deficits},
    }


def main():
    q = quarterly()
    TIDY.parent.mkdir(parents=True, exist_ok=True)
    with open(TIDY, 'w', newline='', encoding='utf-8') as h:
        w = csv.writer(h)
        w.writerow(['trimestre', 'dette_maastricht_md_eur', 'dette_pct_pib'])
        for k in sorted(q):
            w.writerow([k, round(q[k][0], 3), round(q[k][1], 3)])
    annual = json.loads(ANNUAL.read_text(encoding='utf-8'))
    # check: the year-end quarter equals the annual debt of the national accounts (same Insee base)
    for y in (2017, 2020, 2024):
        a = next(r['debt'] for r in annual['years'] if r['year'] == y)
        assert abs(q[f'{y}-T4'][0] - a) < 1, f'dette fin {y} : trimestrielle {q[f"{y}-T4"][0]} vs annuelle {a}'
    entries = [debt_le_maire(q, annual)]
    OUT.write_text(json.dumps({'generated': 'python3 scripts/loupe-faq.py', 'entries': entries}, ensure_ascii=False, indent=1) + '\n',
                   encoding='utf-8')
    print(f'{TIDY.relative_to(ROOT)}: {len(q)} trimestres ; {OUT.relative_to(ROOT)}: {len(entries)} réponse(s)')
    for e in entries:
        print('---', e['question'], '\n' + e['reply'])


if __name__ == '__main__':
    main()
