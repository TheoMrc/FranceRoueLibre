"""Saved answers of la Loupe (server/assistant/faq.json): questions many readers ask, answered once from data downloaded
by fetch-sources.mjs, then served without calling a model (no credits spent). Every figure is read from a file downloaded by
script; the wording around it is fixed here. Questions: the debt under Bruno Le Maire, inflation and the debt, where
100 € of taxes go, the associations that receive most from the State, the Senate's restaurants, the public broadcasting. Re-run after a new download:

  node scripts/fetch-sources.mjs --only=dette-trimestrielle,senat-comptes
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
        # matches when one of these sets matches: every group of the set, any word inside a group (lower case, no accents)
        'match_any': [[['dette', 'endettement'], ['bruno le maire', 'bruno lemaire', 'lemaire', 'bruno'], ['augment', 'hausse', 'combien', 'evolu', 'progress',
                                                                             'sous', 'pendant', 'mandat', 'bilan', 'creus']],
                      [['bruno le maire', 'bruno lemaire', 'lemaire', 'bruno'], ['coute', 'coût', 'cout']]],   # « Combien nous a coûté Bruno Le Maire ? », not « le maire d'Annecy »
        'reply': reply,
        'sources': [{'title': 'Insee, dette des administrations publiques (trimestrielle)', 'url': INSEE_PAGE},
                    {'title': 'Insee, comptes de la Nation 3.101 et 3.105', 'url': annual['source']}],
        'data': {'start': start, 'end': end, 'debt': [round(d0, 1), round(d1, 1)], 'pctGdp': [round(p0, 1), round(p1, 1)],
                 'deficits': deficits},
    }


COFOG = ROOT / 'dist' / 'data' / 'national-functions.json'   # Eurostat gov_10a_exp, built by scripts (national accounts)
CPI = ROOT / 'sources' / 'resultats' / 'insee_ipc_annuel_1960_2025.csv'
ASSOS = ROOT / 'dist' / 'data' / 'aides' / 'associations.json'
INSEE_CPI_CATEGORIES = 'https://www.insee.fr/fr/statistiques/fichier/7634629/ndc-juin-2023-ipc-categorie-menages.pdf'
AFT = 'https://fipeco.fr/pdf/Obligations%20index%C3%A9es.pdf'   # Fipeco, « Les obligations indexées sur l’inflation » (février 2023)
# the dataset downloaded by fetch-sources.mjs (jaune-associations-2025)
TRESOR = 'https://www.tresor.economie.gouv.fr/Articles/2022/07/05/finances-publiques-une-inflation-qui-rapporte'
ASSO_PAGE = 'https://data.economie.gouv.fr/explore/dataset/plf25-donnees-de-l-annexe-jaune-effort-financier-de-l-etat-en-faveur-des-associations/'


def cofog():
    d = json.loads(COFOG.read_text(encoding='utf-8'))
    return d, {code: dict(zip(d['years'], vals)) for code, vals in d['data']['TE'].items()}


def inflation_debt(q, annual):
    """« Quand les prix montent, qui paie la dette ? »: mostly the lenders, in real terms; the State gains in part (debt
    ratio, revenue), less on its indexed debt and as rates rise; savers pay a quiet inflation tax. Figures come from the
    downloaded data (inflation, debt, interest); the rest is stated without figures, with its sources."""
    cpi = {int(r['annee']): float(r['inflation_pct']) for r in csv.DictReader(open(CPI, encoding='utf-8')) if r['inflation_pct']}
    d, te = cofog()
    i21, i22, last = te['GF0107'][2021], te['GF0107'][2022], max(d['years'])
    (d21, p21), (d23, p23) = q['2021-T4'], q['2023-T4']
    reply = (
        f'**Surtout ceux qui ont prêté.** Une dette à taux fixe est fixée en euros : quand les prix montent, l’emprunteur '
        f'rembourse le même nombre d’euros, mais ces euros achètent moins. C’est un transfert de richesse des prêteurs vers '
        f'les emprunteurs. Exemple : 1 000 € empruntés à taux fixe, puis 10 % d’inflation ; ces 1 000 € ne valent plus '
        f'qu’environ {fr(1000 / 1.1)} € d’avant. L’emprunteur rembourse moins « vraiment », le prêteur perd la différence.\n\n'
        f'**L’État, grand emprunteur, y gagne en partie.**\n'
        f'- La dette pèse moins par rapport à la richesse produite : avec {fr(cpi[2022], 1)} % d’inflation en 2022 et '
        f'{fr(cpi[2023], 1)} % en 2023, elle est passée de {fr(d21)} à {fr(d23)} Md€ entre fin 2021 et fin 2023, mais de '
        f'{fr(p21, 1)} % à {fr(p23, 1)} % du PIB.\n'
        f'- Les recettes (TVA, impôt sur le revenu…) augmentent avec les prix.\n\n'
        f'**Mais l’allègement est partiel.**\n'
        f'- Environ un dixième de la dette de l’État est indexé sur l’inflation : là, ce qu’il doit rembourser suit les prix.\n'
        f'- Les taux montent avec l’inflation, ce qui renchérit les emprunts qui remplacent la dette arrivée à échéance. '
        f'Les intérêts payés par l’ensemble des administrations sont passés de {fr(i21)} Md€ en 2021 à {fr(i22)} Md€ en '
        f'2022, puis {fr(te["GF0107"][last])} Md€ en {last}, payés par l’impôt.\n'
        f'- Une inflation importée (énergie) appauvrit le pays et peut dégrader les comptes publics malgré tout.\n\n'
        f'**Les épargnants paient une « taxe d’inflation » discrète** : assurance vie, livrets ou fonds placés à un taux '
        f'inférieur à l’inflation perdent du pouvoir d’achat, comme les banques, assureurs et investisseurs (dont beaucoup '
        f'd’étrangers) qui détiennent la dette. Les ménages modestes, eux, ont peu d’épargne mais ont subi une inflation un '
        f'peu plus forte que la moyenne, surtout à cause de l’alimentation.\n\n'
        f'Le transfert joue surtout quand l’inflation est inattendue : prévue, les prêteurs exigent d’emblée des taux plus '
        f'élevés. **En résumé** : l’inflation n’efface pas la dette, elle en fait porter le coût réel aux prêteurs et aux '
        f'épargnants ; pour l’État, l’allègement est partiel et temporaire. Montants année par année : '
        f'[Comptes publics](index.html#comptes). Sources : [Direction générale du Trésor, « Finances publiques : une '
        f'inflation qui rapporte ? »]({TRESOR}), [Insee, prix à la consommation](https://www.insee.fr/fr/statistiques/serie/011814653), '
        f'[Insee, dette trimestrielle]({INSEE_PAGE}), [Eurostat, dépenses par fonction]({d["url"]}), '
        f'[Insee, inflation par catégorie de ménages]({INSEE_CPI_CATEGORIES}), [Fipeco, les obligations indexées]({AFT}).')
    return {
        'id': 'inflation-dette', 'question': 'Quand les prix montent, qui paie la dette ?',
        'match_any': [[['prix', 'inflation'], ['dette']], [['inflation'], ['qui paie', 'qui paye', 'pauvre', 'modeste', 'menage']]],
        'reply': reply,
        'sources': [{'title': 'Direction générale du Trésor, « Finances publiques : une inflation qui rapporte ? » (2022)', 'url': TRESOR},
                    {'title': 'Insee, indice des prix à la consommation', 'url': 'https://www.insee.fr/fr/statistiques/serie/011814653'},
                    {'title': 'Insee, dette des administrations publiques (trimestrielle)', 'url': INSEE_PAGE},
                    {'title': 'Eurostat, dépenses des administrations par fonction', 'url': d['url']},
                    {'title': 'Insee, inflation selon la catégorie de ménages (2023)', 'url': INSEE_CPI_CATEGORIES},
                    {'title': 'Fipeco, les obligations indexées sur l’inflation (2023)', 'url': AFT}],
        'data': {'inflation': {y: cpi[y] for y in (2021, 2022, 2023, 2024)}, 'debt': [round(d21, 1), round(d23, 1)],
                 'pctGdp': [round(p21, 1), round(p23, 1)], 'interest': {y: round(te['GF0107'][y], 1) for y in range(2019, last + 1)}},
    }


def hundred_euros(annual):
    """« Quand je paie 100 € d’impôts, comment sont-ils dépensés ? »: 100 € of public spending by function, and how
    much is spent for 100 € collected (the rest is borrowed)."""
    d, te = cofog()
    y = max(d['years'])
    total = te['TOTAL'][y]
    posts = [('GF10', 'protection sociale (retraites, famille, chômage)'), ('GF07', 'santé'), ('GF04', 'affaires économiques (transports, énergie, aides aux entreprises, emploi)'),
             ('GF09', 'enseignement'), ('GF01-GF0107', 'administration générale (ministères, impôts, recherche fondamentale)'), ('GF0107', 'intérêts de la dette'),
             ('GF02', 'défense'), ('GF03', 'police, justice, pompiers'), ('GF08', 'culture et sport'), ('GF06', 'logement et équipements'), ('GF05', 'environnement')]
    val = lambda code: sum((-1 if i else 1) * te[c][y] for i, c in enumerate(code.split('-')))
    rows = sorted(((100 * val(c) / total, label) for c, label in posts), reverse=True)
    assert abs(sum(v for v, _ in rows) - 100) < .5, 'les fonctions ne font pas 100 %'
    deficit = next(r['deficit'] for r in annual['years'] if r['year'] == y)
    spent = 100 * total / (total - deficit)
    lines_ = '\n'.join(f'- **{fr(v, 0) if v >= 9.5 else fr(v, 1)} €** : {label}' for v, label in rows)
    reply = (
        f'Sur **100 €** de dépenses publiques en {y} (État, Sécurité sociale et collectivités ensemble), voici où ils vont :\n\n'
        f'{lines_}\n\n'
        f'Deux précisions. Vos impôts ne vont pas tous au même endroit : la CSG finance surtout la Sécurité sociale, la '
        f'taxe foncière votre commune, la TVA et l’impôt sur le revenu l’État. Et les administrations dépensent plus '
        f'qu’elles ne prélèvent : en {y}, pour 100 € d’impôts et de cotisations, elles ont dépensé environ **{fr(spent, 0)} €**, '
        f'les {fr(spent - 100, 0)} € de plus étant empruntés (le déficit, {fr(deficit)} Md€).\n\n'
        f'Détail et évolution depuis 1995 : [le circuit de l’argent public](index.html#circuit). Sources : '
        f'[Eurostat et Insee, dépenses par fonction]({d["url"]}), [Insee, déficit et dette]({annual["source"]}).')
    return {
        'id': 'cent-euros', 'question': 'Quand je paie 100 € d’impôts, comment sont-ils dépensés ?',
        'match_any': [[['100', 'cent', '1000', 'mille'], ['impot', 'taxe', 'prelev', 'cotisation']],
                      [['mes impot', 'nos impot', 'mes taxe', 'nos taxe'], ['ou va', 'ou vont', 'depens', 'utilis', 'sert', 'servent', 'finance']]],
        'reply': reply,
        'sources': [{'title': 'Eurostat et Insee, dépenses des administrations par fonction', 'url': d['url']},
                    {'title': 'Insee, comptes de la Nation (déficit)', 'url': annual['source']}],
        'data': {'year': y, 'per100': {label: round(v, 2) for v, label in rows}, 'spentPer100Collected': round(spent, 1)},
    }


# Readable names for the largest recipients (the annex gives them in capitals, without accents, sometimes cut)
ASSO_NAMES = {'ASS INTERNATIONALE DE DEVELOPPEMEN': 'Association internationale de développement (fonds de la Banque mondiale)',
              'UNION NATIONALE DES CARPA': 'Union nationale des Carpa (aide juridictionnelle versée aux avocats)',
              'COALLIA': 'Coallia', 'CROIX ROUGE FRANCAISE': 'Croix-Rouge française', 'FONGECFA TRANSPORT': 'Fongecfa Transport (formation dans les transports)',
              'ASSOCIATION AURORE': 'Association Aurore', 'GROUPE SOS SOLIDARITES': 'Groupe SOS Solidarités',
              'FONDATION DE L ARMEE DU SALUT': 'Fondation de l’Armée du salut', 'EMMAUS SOLIDARITE': 'Emmaüs Solidarité',
              'FONDATION NATIONALE SCIENCES POLITIQUES': 'Fondation nationale des sciences politiques (Sciences Po)'}


def associations():
    """« Quelles associations reçoivent le plus de subventions de l’État ? »: the ten largest of the latest year published."""
    d = json.loads(ASSOS.read_text(encoding='utf-8'))
    y = max(d['top'], key=int)
    year = next(p for p in d['perYear'] if str(p['year']) == y)
    top = d['top'][y][:10]
    eur = lambda v: f'{fr(v / 1e6)} M€' if v < 1e9 else f'{fr(v / 1e9, 2)} Md€'
    lines_ = '\n'.join(f'{i}. **{ASSO_NAMES.get(name, name.title())}** : {eur(amount)}' for i, (_, name, amount, *_rest) in enumerate(top, 1))
    share = 100 * sum(r[2] for r in top) / year['amount']
    reply = (
        f'En {y}, l’État a versé **{fr(year["amount"] / 1e9, 1)} Md€** de subventions à {fr(year["beneficiaries"])} '
        f'organismes classés comme associations. Les dix qui ont reçu le plus :\n\n{lines_}\n\n'
        f'Ces dix-là touchent {fr(share)} % du total. Le mot « association » recouvre ici des organismes très différents : '
        f'un fonds de la Banque mondiale, des caisses qui reversent l’aide juridictionnelle aux avocats, des opérateurs '
        f'de l’hébergement d’urgence et de l’accueil des demandeurs d’asile, des fondations de recherche. Une subvention '
        f'paie souvent un service public confié à l’association (héberger, former, soigner), pas son fonctionnement.\n\n'
        f'Les montants sont publiés avec deux ans de retard, dans une annexe au projet de loi de finances. Pour chercher '
        f'une association ou voir les années précédentes : [Aides et subventions](aides.html#associations). Source : '
        f'[annexe « Effort financier de l’État en faveur des associations », projet de loi de finances {int(y) + 2}]({ASSO_PAGE}).')
    return {
        'id': 'associations', 'question': 'Quelles associations reçoivent le plus de subventions de l’État ?',
        'match_any': [[['association'], ['subvention', 'aide', 'argent', 'recoi', 'touch', 'financ', 'percoi']],],
        'reply': reply,
        'sources': [{'title': 'Annexe « jaune » : effort financier de l’État en faveur des associations',
                     'url': ASSO_PAGE}],
        'data': {'year': int(y), 'total': year['amount'], 'beneficiaries': year['beneficiaries'], 'top': [[r[1], r[2]] for r in top]},
    }


POP = ROOT / 'sources' / 'insee-population.json'
QUARTER_END = {'T1': 'fin mars', 'T2': 'fin juin', 'T3': 'fin septembre', 'T4': 'fin décembre'}


def debt_per_person(q):
    """« À combien s’élève la dette publique par Français ? »: the latest quarter divided by the population, and the
    same at the end of 2017 and 2019; the yearly interest per inhabitant."""
    popd = json.loads(POP.read_text(encoding='utf-8'))
    pop = {r['year']: r['population'] for r in popd['january1']}
    last = max(q)
    year, quarter = int(last[:4]), last[5:]
    debt, ratio = q[last]
    # population on 1 January of the year after the quarter when published, else the closest year before
    p_now = pop.get(year + 1) or pop[max(y for y in pop if y <= year + 1)]
    per = lambda d, y: d * 1e9 / (pop.get(y + 1) or pop[max(k for k in pop if k <= y + 1)])
    d17, d19 = q['2017-T4'][0], q['2019-T4'][0]
    prev = f'{year - 1}-{quarter}'
    d, te = cofog()
    ylast = max(d['years'])
    interest = te['GF0107'][ylast] * 1e9 / pop[ylast]
    reply = (
        f'**Environ {fr(round(debt * 1e9 / p_now, -2))} € par habitant.** La dette publique s’élevait à **{fr(debt)} Md€** '
        f'{QUARTER_END[quarter]} {year} (État, Sécurité sociale et collectivités, au sens de Maastricht), pour '
        f'{fr(p_now / 1e6, 1)} millions d’habitants.\n\n'
        f'- En un an ({QUARTER_END[quarter]} {year - 1} à {QUARTER_END[quarter]} {year}) : **+{fr(round(debt * 1e9 / p_now - per(q[prev][0], year - 1), -1))} € '
        f'par habitant** (+{fr(debt - q[prev][0])} Md€).\n'
        f'- Fin 2017 : {fr(round(per(d17, 2017), -2))} € par habitant ; fin 2019 : {fr(round(per(d19, 2019), -2))} €.\n'
        f'- Rapportée à la richesse produite en un an, elle représente {fr(ratio, 1)} % du PIB.\n'
        f'- Les seuls intérêts ont coûté environ **{fr(round(interest, -1))} € par habitant** en {ylast} '
        f'({fr(te["GF0107"][ylast])} Md€).\n\n'
        f'Le détail année par année : [Comptes publics](index.html#comptes). Sources : [Insee, dette trimestrielle]({INSEE_PAGE}), '
        f'[Insee, population au 1er janvier]({popd["url"]}), [Eurostat et Insee, dépenses par fonction]({d["url"]}).')
    return {
        'id': 'dette-par-habitant', 'question': 'À combien s’élève la dette publique par Français ?',
        'match_any': [[['dette'], ['par francais', 'par habitant', 'par personne', 'par tete', 'chaque francais', 'par citoyen', 'par menage', 'par foyer']]],
        'reply': reply,
        'sources': [{'title': 'Insee, dette des administrations publiques (trimestrielle)', 'url': INSEE_PAGE},
                    {'title': 'Insee, population au 1er janvier', 'url': popd['url']},
                    {'title': 'Eurostat et Insee, dépenses par fonction (intérêts)', 'url': d['url']}],
        'data': {'quarter': last, 'debt': round(debt, 1), 'population': p_now, 'perPerson': round(debt * 1e9 / p_now),
                 'perPerson2017': round(per(d17, 2017)), 'perPerson2019': round(per(d19, 2019)), 'interestPerPerson': round(interest)},
    }


RATIOS = ROOT / 'dist' / 'data' / 'national-ratios-insee.json'
RATIOS_URL = json.loads(RATIOS.read_text(encoding='utf-8'))['source']
NICHES = ROOT / 'dist' / 'data' / 'niches.json'


def pensions():
    """« Combien coûtent les retraites ? »: the old-age function of all public administrations (COFOG 10.2), what it
    is made of, its share of spending and of GDP, per inhabitant, over ten years against prices, and the 10 % income
    tax allowance on pensions. GDP is derived from the spending of the same year and its ratio to GDP (Insee)."""
    d, te = cofog()
    y = max(d['years'])
    nat = lambda nature: dict(zip(d['years'], d['data'][nature]['GF1002']))
    total, cash, kind, pay, buy = te['GF1002'][y], nat('D62')[y], nat('D632')[y], nat('D1')[y], nat('P2')[y]
    other = total - cash - kind - pay - buy
    spend_pct = next(r['spending'] for r in json.loads(RATIOS.read_text(encoding='utf-8'))['years'] if r['year'] == y)
    gdp = te['TOTAL'][y] / (spend_pct / 100)
    share = 100 * total / te['TOTAL'][y]
    popd = json.loads(POP.read_text(encoding='utf-8'))
    pop = {r['year']: r['population'] for r in popd['january1']}
    y0 = y - 10
    cpi = {int(r['annee']): float(r['ipc_chaine_base2025_100']) for r in csv.DictReader(open(CPI, encoding='utf-8'))}
    rise, prices = 100 * (total / te['GF1002'][y0] - 1), 100 * (cpi[y] / cpi[y0] - 1)
    popr = 100 * (pop[y] / pop[y0] - 1)
    niches = json.loads(NICHES.read_text(encoding='utf-8'))
    allowance = next(m for m in niches['measures'] if m['id'] == '120401')
    ny = max(i for i, v in enumerate(allowance['v']) if v is not None)
    reply = (
        f'**{fr(total)} Md€ en {y}**, pour l’ensemble des régimes publics (fonction « vieillesse » des comptes '
        f'nationaux), soit **{fr(share)} % de la dépense publique** (1 euro sur {fr(100 / share, 1)}) et '
        f'{fr(100 * total / gdp, 1)} % du PIB (la richesse produite en France en un an).\n\n'
        f'- Pensions et autres prestations versées en argent : {fr(cash)} Md€ ; prestations en nature : {fr(kind, 1)} Md€ ; '
        f'rémunérations : {fr(pay, 1)} Md€ ; achats : {fr(buy, 1)} Md€ ; autres : {fr(other, 1)} Md€.\n'
        f'- Divisé par le nombre d’habitants ({fr(pop[y] / 1e6, 1)} millions, enfants compris), cela fait environ '
        f'**{fr(round(total * 1e9 / pop[y], -1))} € par habitant et par an**, soit {fr(round(total * 1e9 / pop[y] / 12, -1))} € '
        f'par mois : ce que chacun paierait si la dépense était partagée à parts égales.\n'
        f'- En dix ans ({y0} à {y}) : **+{fr(rise)} %** ({fr(te["GF1002"][y0])} à {fr(total)} Md€), quand les prix ont '
        f'augmenté de {fr(prices)} % et la population de {fr(popr, 1)} %.\n'
        f'- L’abattement de 10 % sur les pensions à l’impôt sur le revenu coûte en plus {fr(allowance["v"][ny] / 1000, 2)} Md€ '
        f'de recettes en {niches["years"][ny]} (chiffrage du projet de loi de finances).\n\n'
        f'Ce que ces chiffres ne disent pas : la part payée par les cotisations, par l’impôt et par l’emprunt, le nombre '
        f'de retraités et la pension moyenne ne sont pas dans les données du site. Le Conseil d’orientation des retraites '
        f'et la Drees les publient chaque année.\n\n'
        f'Détail par fonction depuis 1995 : [le circuit de l’argent public](index.html#circuit). Sources : '
        f'[Eurostat et Insee, dépenses par fonction]({d["url"]}), [Insee, dépenses en % du PIB]({RATIOS_URL}), '
        f'[Insee, population]({popd["url"]}), [Insee, prix à la consommation](https://www.insee.fr/fr/statistiques/serie/011814653), '
        f'[Niches fiscales](niches.html).')
    return {
        'id': 'retraites', 'question': 'Combien coûtent les retraites ?',
        'match_any': [[['retraites', 'pensions', 'vieillesse'], ['cout', 'coute', 'depens', 'budget', 'pese', 'montant']]],
        'reply': reply,
        'sources': [{'title': 'Eurostat et Insee, dépenses des administrations par fonction', 'url': d['url']},
                    {'title': 'Insee, principaux ratios de finances publiques', 'url': RATIOS_URL},
                    {'title': 'Insee, population au 1er janvier', 'url': popd['url']},
                    {'title': 'Insee, indice des prix à la consommation', 'url': 'https://www.insee.fr/fr/statistiques/serie/011814653'}],
        'data': {'year': y, 'total': total, 'cash': cash, 'inKind': kind, 'pay': pay, 'purchases': buy,
                 'sharePct': round(share, 2), 'gdpPct': round(100 * total / gdp, 2), 'perPerson': round(total * 1e9 / pop[y]),
                 'rise10y': round(rise, 1), 'prices10y': round(prices, 1), 'allowance': [niches['years'][ny], allowance['v'][ny]]},
    }


FRAUDE = ROOT / 'dist' / 'data' / 'fraude.json'


def fraud():
    """« Combien coûte la fraude fiscale ? » (and the evasion): nobody measures it; what is measured (tax audits, sums
    recovered, VAT gap) and the estimates in circulation with their author and the Cour des comptes' view. Every figure
    comes from dist/data/fraude.json (scripts/fraude-data.py: Cour des comptes report of December 2025, European
    Commission VAT gap tables)."""
    f = json.loads(FRAUDE.read_text(encoding='utf-8'))
    popd = json.loads(POP.read_text(encoding='utf-8'))
    pop = {r['year']: r['population'] for r in popd['january1']}
    c, ys = f['controle'], f['controle']['annees']
    y0, y1 = ys[0], ys[-1]
    rec = f['recouvre']['montants_md_eur']
    part = f['part_dans_recettes']['pct']
    inc, ask, mo, det, pen = f['incertitude'], f['estimation_demandee'], f['moyens'], f['fraude_detectee_sur_place'], f['penal']
    v = f['ecart_tva_commission']
    full = [y for y in v['annees'] if y not in v['provisoires']]
    yv, yp = full[-1], (v['provisoires'] or [None])[0]
    gap = dict(zip(v['annees'], v['ecart_meur'])); pct = dict(zip(v['annees'], v['ecart_pct_tva_due']))
    tva = {e['id']: e for e in f['estimations_tva']}
    est = {e['id']: e for e in f['estimations_ecart_global']}
    per = rec[str(y1)] * 1e9 / pop[y1]
    gap_per = gap[yv] * 1e6 / pop[yv]
    sol = est['solidaires']
    cour_url, ce_url = f['sources']['cour']['url'], f['sources']['commission']['page']
    reply = (
        f'**Personne ne connaît le montant de la fraude fiscale en France : aucune administration ne la mesure.** La Cour des '
        f'comptes le dit sans détour (décembre 2025) : « {inc["citation"]} », sur {fr(inc["prelevements_obligatoires_md_eur"])} Md€ '
        f'd’impôts et de cotisations en {inc["annee"]}.\n\n'
        f'Quatre mots à ne pas confondre : la **fraude** est illégale (revenus cachés, fausses factures, TVA encaissée et non '
        f'reversée) ; l’**évasion** passe par des montages, souvent à l’étranger, illégaux quand ils sont abusifs ; '
        f'l’**optimisation** utilise la loi au mieux, elle est légale ; les **niches fiscales** sont des réductions d’impôt votées '
        f'par le Parlement. Ni l’évasion ni l’optimisation ne sont chiffrées.\n\n'
        f'**Ce qui est mesuré : ce que le fisc rattrape**\n'
        f'- Le contrôle fiscal a réclamé **{fr(c["resultats_totaux"][-1], 1)} Md€** en {y1} (impôts dus et pénalités), contre '
        f'{fr(c["resultats_totaux"][0], 1)} Md€ en {y0}. Pendant ce temps, les impôts encaissés par l’administration fiscale ont '
        f'augmenté de {fr(f["recettes_dgfip"]["hausse_pct"])} % : le contrôle pèse {fr(part[str(y1)], 1)} % des recettes, contre '
        f'{fr(part[str(y0)], 1)} % en {y0}.\n'
        f'- Sommes réellement encaissées après contrôle : **{fr(rec[str(y1)], 1)} Md€** en {y1}, soit environ {fr(round(per, -1))} € '
        f'par habitant, contre {fr(rec[str(y0)], 1)} Md€ en {y0}. Une partie de ce qui est réclamé n’est jamais payé.\n'
        f'- Fraude repérée lors des contrôles sur place : {fr(det["fraude_md_eur"], 1)} Md€ en {det["annee"]} '
        f'({fr(det["evolution_pct"])} % depuis {det["depuis"]}), à côté de {fr(det["erreurs_md_eur"], 1)} Md€ d’erreurs de bonne foi.\n'
        f'- Les agents affectés au contrôle ont diminué de {fr(mo["baisse_effectifs_controle_pct"])} % entre {mo["periode"][0]} et '
        f'{mo["periode"][1]}.\n\n'
        f'**Les estimations qui circulent**\n'
        f'- TVA, le seul impôt estimé : selon la Commission européenne, **{fr(gap[yv] / 1000, 1)} Md€** de TVA due n’ont pas été '
        f'perçus en {yv} ({fr(pct[yv], 1)} % de la TVA due, environ {fr(round(gap_per, -1))} € par habitant)'
        + (f', {fr(gap[yp] / 1000, 1)} Md€ en {yp} (estimation provisoire)' if yp else '') +
        f'. Ce manque mélange fraude, faillites et erreurs. L’administration fiscale trouve {fr(tva["dgfip"]["bas_md_eur"])} à '
        f'{fr(tva["dgfip"]["haut_md_eur"])} Md€ sur la seule TVA déclarée ({tva["dgfip"]["publie"]}) ; l’Insee '
        f'{fr(tva["insee"]["bas_md_eur"])} à {fr(tva["insee"]["haut_md_eur"])} Md€ ({tva["insee"]["publie"]}), un chiffre que la Cour '
        f'juge surestimé.\n'
        f'- Tous impôts, fraude et évasion mêlées : {fr(sol["bas_md_eur"])} à {fr(sol["haut_md_eur"])} Md€ selon le syndicat '
        f'Solidaires Finances publiques ({sol["publie_en"]}, sur des données d’avant {sol["donnees_anterieures_a"]}). La Cour '
        f'note que sa méthode n’est pas détaillée et qu’il mélange l’illégal et le légal. Les deux autres estimations datent de '
        f'{est["courson-leonard"]["publie_en"]} ({fr(est["courson-leonard"]["bas_md_eur"], 1)} à {fr(est["courson-leonard"]["haut_md_eur"], 1)} Md€) '
        f'et de {est["cpo"]["publie_en"]} ({fr(est["cpo"]["bas_md_eur"], 1)} à {fr(est["cpo"]["haut_md_eur"], 1)} Md€).\n'
        f'- Impôt sur le revenu et impôt sur les sociétés : aucune estimation. La Cour demande qu’elle soit faite d’ici '
        f'{ask["annee"]} ; l’administration y consacre {mo["statisticiens"]} statisticiens depuis {mo["depuis"]}.\n\n'
        f'**Côté justice** : {fr(list(pen["dossiers_parquet"].values())[-1])} dossiers transmis au procureur en '
        f'{list(pen["dossiers_parquet"])[-1]} (contre {fr(list(pen["dossiers_parquet"].values())[0])} en {list(pen["dossiers_parquet"])[0]}), '
        f'mais toujours {pen["condamnes_par_an"][0]} à {pen["condamnes_par_an"][1]} personnes condamnées par an ; '
        f'{fr(pen["prison_ferme_pct"])} % des peines comportent de la prison ferme ; amende moyenne : {fr(list(pen["amende_moyenne_eur"].values())[0])} € '
        f'en {list(pen["amende_moyenne_eur"])[0]}.\n\n'
        f'Pour aller plus loin :\n'
        f'- Combien coûtent les niches fiscales des entreprises ?\n'
        f'- Quel impôt fait l’objet du plus de redressements fiscaux ?\n'
        f'- Comment a évolué le manque de TVA depuis 2013 ?\n\n'
        f'Sources : [Cour des comptes, La lutte contre la fraude fiscale, décembre 2025]({cour_url}) (pages {c["page"]}, '
        f'{f["recouvre"]["page"]}, {inc["page"]} à {tva["dgfip"]["page"]}), [Commission européenne, écart de TVA]({ce_url}), '
        f'[Insee, population]({popd["url"]}).')
    return {
        'id': 'fraude', 'question': 'Combien coûte la fraude fiscale en France ?',
        'match_any': [[['fraude', 'evasion', 'fraudeurs'], ['fiscal', 'impot', 'fisc', 'tva']],
                      [['evasion fiscale', 'fraude fiscale', 'fraudes fiscales']]],
        'reply': reply,
        'sources': [{'title': 'Cour des comptes, La lutte contre la fraude fiscale (décembre 2025)', 'url': cour_url},
                    {'title': 'Commission européenne, écart de TVA (rapport 2025)', 'url': ce_url},
                    {'title': 'Insee, population au 1er janvier', 'url': popd['url']}],
        'data': {'controle': [y0, c['resultats_totaux'][0], y1, c['resultats_totaux'][-1]], 'recouvre': rec, 'perPerson': round(per),
                 'vatGap': [yv, gap[yv], pct[yv]], 'vatGapProvisional': [yp, gap.get(yp)] if yp else None},
    }


SENAT = ROOT / 'sources' / 'raw' / 'senat-comptes' / 'r25-628-chapitre-4.html'
SENAT_URL = 'https://www.senat.fr/rap/r25-628/r25-6284.html'
ETAT = ROOT / 'dist' / 'data' / 'etat.json'


def senate_restaurant():
    """« Combien coûte la cantine du Sénat ? »: the subsidy to the Senate's restaurants, read in the Senate's own
    accounts (downloaded page), per inhabitant, next to the Senate's whole budget line."""
    import html as html_lib
    text = html_lib.unescape(re.sub(r'<[^>]+>', ' ', SENAT.read_text(encoding='utf-8', errors='replace')))
    text = re.sub(r'\s+', ' ', text.replace('\xa0', ' ').replace('\u202f', ' '))
    hits = [m for m in re.finditer(r'([+-]?\d+(?:,\d+)?) ?% pour s.établir à ((?:\d{1,3} ?)+) euros', text)
            if re.search(r'restaura|repas|subvention', text[max(0, m.start() - 700):m.start()], re.I)]
    assert len(hits) == 1, f'subvention des restaurants : {len(hits)} montant(s) trouvé(s) dans la page du Sénat au lieu de 1'
    m = hits[0]
    change, amount = float(m.group(1).replace(',', '.')), int(m.group(2).replace(' ', ''))
    year = 2025
    popd = json.loads(POP.read_text(encoding='utf-8'))
    pop = next(r['population'] for r in popd['january1'] if r['year'] == year)
    etat = json.loads(ETAT.read_text(encoding='utf-8'))
    senat = next(p for m_ in etat['missions'] if m_['name'] == 'Pouvoirs publics' for p in m_['progs'] if p['name'] == 'Sénat')
    per = amount / pop
    reply = (
        f'**Environ {fr(100 * per, 1)} centime par Français et par an.** En {year}, la subvention versée aux restaurants du Sénat '
        f's’élève à **{fr(amount)} €**, en hausse de {fr(change, 2)} % sur un an, selon les comptes du Sénat. C’est la part '
        f'payée par le Sénat, au-delà de ce que règlent les convives.\n\n'
        f'- Rapportée aux {fr(pop)} habitants (Insee, 1er janvier {year}) : {fr(per, 3)} € par personne et par an.\n'
        f'- Le budget total du Sénat dans le projet de loi de finances 2025 est de **{fr(senat["cp"], 1)} M€**, soit '
        f'{fr(senat["cp"] * 1e6 / pop, 2)} € par habitant et par an : la restauration n’en est qu’une ligne.\n'
        f'- Le coût complet des repas et leur nombre ne sont pas publiés dans ces comptes.\n\n'
        f'Sources : [Sénat, les comptes de l’exercice {year}]({SENAT_URL}), [Budget de l’État, mission Pouvoirs publics](etat.html), '
        f'[Insee, population]({popd["url"]}).')
    return {
        'id': 'cantine-senat', 'question': 'Combien coûte la cantine du Sénat ?',
        'match_any': [[['cantine', 'restaurant', 'restauration', 'buvette', 'repas'], ['senat', 'senateur']]],
        'reply': reply,
        'sources': [{'title': f'Sénat, les comptes de l’exercice {year} (rapport n° 628)', 'url': SENAT_URL},
                    {'title': 'Insee, population au 1er janvier', 'url': popd['url']}],
        'data': {'year': year, 'amount': amount, 'changePct': change, 'population': pop, 'senatMeur': senat['cp']},
    }


def public_broadcasting():
    """« Combien coûte l’audiovisuel public ? »: the mission of the 2025 budget bill, by company, per inhabitant."""
    etat = json.loads(ETAT.read_text(encoding='utf-8'))
    mission = next(m for m in etat['missions'] if m['code'] == 'AQ')
    popd = json.loads(POP.read_text(encoding='utf-8'))
    pop = next(r['population'] for r in popd['january1'] if r['year'] == 2025)
    progs = sorted(mission['progs'], key=lambda p: -p['cp'])
    lines_ = '\n'.join(f'- {p["name"]} : {fr(p["cp"], 1)} M€' for p in progs)
    page = etat['sources']['plf25-depenses-destination']['page']
    reply = (
        f'La mission **« {mission["name"]} »** du projet de loi de finances 2025 représente **{fr(mission["cp"], 1)} M€** de crédits '
        f'de paiement, soit **{fr(mission["cp"] * 1e6 / pop, 2)} € par Français et par an** ({fr(pop)} habitants au 1er janvier 2025, Insee).\n\n'
        f'{lines_}\n\n'
        f'Depuis la suppression de la redevance, ces sommes sont payées par l’impôt. Ce sont des crédits votés, pas les comptes '
        f'des sociétés : leurs autres recettes (publicité, ventes) ne sont pas comptées ici.\n\n'
        f'Sources : [Budget de l’État, PLF 2025]({page}), [la mission sur le site](etat.html), [Insee, population]({popd["url"]}).')
    return {
        'id': 'audiovisuel-public', 'question': 'Combien coûte l’audiovisuel public ?',
        'match_any': [[['audiovisuel public', 'service public audiovisuel', 'france televisions', 'radio france'],
                       ['cout', 'coute', 'combien', 'budget', 'depens', 'argent', 'prix', 'paie', 'paye', 'finance']]],
        'reply': reply,
        'sources': [{'title': 'data.economie.gouv.fr, PLF 2025, dépenses selon destination', 'url': page},
                    {'title': 'Insee, population au 1er janvier', 'url': popd['url']}],
        'data': {'meur': mission['cp'], 'population': pop, 'progs': [[p['name'], p['cp']] for p in progs]},
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
    entries = [debt_le_maire(q, annual), debt_per_person(q), inflation_debt(q, annual), hundred_euros(annual), associations(), pensions(), fraud(), senate_restaurant(), public_broadcasting()]
    OUT.write_text(json.dumps({'generated': 'python3 scripts/loupe-faq.py', 'entries': entries}, ensure_ascii=False, indent=1) + '\n',
                   encoding='utf-8')
    print(f'{TIDY.relative_to(ROOT)}: {len(q)} trimestres ; {OUT.relative_to(ROOT)}: {len(entries)} réponse(s)')
    for e in entries:
        print('---', e['question'], '\n' + e['reply'])


if __name__ == '__main__':
    main()
