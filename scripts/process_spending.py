"""Public spending by function (COFOG) and by nature, from Eurostat gov_10a_exp (data transmitted by Insee).

Input : sources/eurostat-cofog-fr.json  (fetched from the Eurostat API, see README)
Output: dist/data/national-functions.json

The four spending poles of the circuit (Insee table 3.201) are rebuilt from ESA transactions:
  operating  = D1 compensation of employees + P2 intermediate consumption + D29/D5/D8 other taxes paid
  interest   = D4 property income (essentially interest)
  benefits   = D62 cash benefits + D632 benefits in kind purchased + D3 subsidies + D7 other current transfers + D9 capital transfers
  investment = P5 gross capital formation + NP net acquisitions of non-produced assets
Their sum equals total expenditure (TE) exactly; it differs from table 3.201 by well under 1 %.
"""
import json
import os
import re

SRC = 'sources/eurostat-cofog-fr.json'
OUT = 'dist/data/national-functions.json'

POLES = {
    'operating': {'label': 'Fonctionnement', 'items': [
        ['D1', 'Salaires et cotisations des agents publics'],
        ['P2', 'Achats de biens et services (consommations intermédiaires)'],
        ['D29_D5_D8', 'Impôts payés et autres charges']]},
    'benefits': {'label': 'Prestations sociales et transferts', 'items': [
        ['D62', 'Prestations en espèces (retraites, allocations, indemnités)'],
        ['D632', 'Prestations en nature achetées (soins remboursés, médicaments, aides au logement versées aux bailleurs…)'],
        ['D3', 'Subventions aux producteurs'],
        ['D7', 'Autres transferts courants (associations, UE, coopération…)'],
        ['D9', 'Transferts en capital (aides à l’investissement…)']]},
    'investment': {'label': 'Investissement', 'items': [['OP5ANP', 'Investissement : équipements, bâtiments, infrastructures, logiciels, terrains']]},
    'interest': {'label': 'Intérêts de la dette', 'items': [['D4', 'Intérêts et autres revenus de la propriété versés']]},
}


def main():
    if not os.path.exists(SRC):
        print(f'· {SRC} absent'); return
    src = json.load(open(SRC, encoding='utf-8'))
    years = src['years']
    # Keep years with detailed data (the latest year is often published later).
    last = max(i for i, _ in enumerate(years) if src['data']['D1']['TOTAL'][i] is not None)
    keep = range(0, last + 1)
    codes = [c for c in src['cofogLabels'] if c == 'TOTAL' or re.fullmatch(r'GF\d{2}(\d{2})?', c)]
    data = {}
    for pole in POLES.values():
        for na, _ in pole['items']:
            data[na] = {c: [src['data'][na][c][i] for i in keep] for c in codes if any(src['data'][na][c][i] for i in keep)}
    data['TE'] = {c: [src['data']['TE'][c][i] for i in keep] for c in codes}
    # Consistency: the poles add up to total expenditure.
    i = last
    te = src['data']['TE']['TOTAL'][i]
    total = sum(src['data'][na]['TOTAL'][i] for pole in POLES.values() for na, _ in pole['items'])
    out = {
        'source': 'Eurostat, dépenses des administrations publiques par fonction (CFAP/COFOG), tableau gov_10a_exp, données transmises par l’Insee',
        'url': 'https://ec.europa.eu/eurostat/databrowser/view/gov_10a_exp/default/table?lang=fr',
        'updated': src.get('updated'), 'unit': 'Md€ courants', 'years': years[:last + 1],
        'poles': POLES, 'functions': {c: src['cofogLabels'][c] for c in codes}, 'data': data,
        'check': {'year': years[last], 'totalExpenditure': te, 'sumOfPoles': round(total, 2)},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, ensure_ascii=False, separators=(',', ':'))
    print(f'✓ fonctions : {years[0]}–{years[last]}, {len(codes)} codes, dépenses {te} Md€ = somme des pôles {total:.2f} Md€ ({os.path.getsize(OUT) // 1024} ko)')


if __name__ == '__main__':
    main()
