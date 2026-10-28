"""Local-authority accounts (OFGL) → compact web files for the map.

Reads sources/raw/ofgl-{communes,gfp,departements,regions}.csv.gz and writes dist/data/local/:
  index.json                       aggregates, years, national totals per level
  <level>/_entities.json           entity codes and names (communes: aligned with web/communes-meta.json)
  <level>/_pop.json                population per year (OFGL "ptot")
  <level>/<aggregate-slug>.json    values per year, in euros, aligned with _entities

Run:  python scripts/process_local.py      (requires: pip install duckdb)
"""
import json
import os
import re
import sys
import unicodedata

import duckdb

from rawfiles import csv as raw_csv

RAW = 'sources/raw'
OUT = 'dist/data/local'
LEVELS = {
    # level: (file, entity key, name column, population column)
    'communes': ('ofgl-communes', 'insee', None, 'ptot'),
    'gfp': ('ofgl-gfp', 'siren_key', 'epci_name', 'ptot'),
    'departements': ('ofgl-departements', 'dep_code', 'dep_name', 'ptot'),
    'regions': ('ofgl-regions', 'reg_code', 'reg_name', 'ptot'),
}

# Display groups for the aggregate selector; anything not listed goes to "Autres".
GROUPS = {
    'Dépenses': ['Dépenses totales', 'Dépenses totales hors remb', 'Dépenses de fonctionnement', 'Frais de personnel', 'Achats et charges externes',
                 "Dépenses d'intervention", 'Subventions aux personnes de droit privé', 'Charges financières', 'Autres dépenses de fonctionnement',
                 "Dépenses d'investissement", "Dépenses d'investissement hors remb", "Dépenses d'équipement", "Subventions d'équipement versées",
                 "Autres dépenses d'investissement", 'Remboursements d\'emprunts hors GAD', 'Annuité de la dette', 'Frais d\'hébergement'],
    'Recettes': ['Recettes totales', 'Recettes totales hors emprunts', 'Recettes de fonctionnement', 'Impôts et taxes', 'Impôts locaux',
                 'Autres impôts et taxes', 'Fiscalité reversée', "Taxe d'enlévement des ordures ménagères", 'TVA', 'Versement transport',
                 "Concours de l'Etat", 'Dotation globale de fonctionnement', 'Autres dotations de fonctionnement', 'Péréquations et compensations fiscales',
                 'Subventions reçues et participations', 'Ventes de biens et services', 'Autres recettes de fonctionnement',
                 "Recettes d'investissement", "Recettes d'investissement hors emprunts", 'FCTVA', 'Autres dotations et subventions',
                 "Produit des cessions d'immobilisations", "Autres recettes d'investissement", 'Emprunts hors GAD'],
    'Dette et équilibre': ['Encours de dette', 'Encours de dette - Dettes bancaires et assimilées', 'Encours de dette - Dépôts et cautionnements reçus',
                           'Flux net de dette', 'Epargne brute', 'Epargne nette', 'Epargne de gestion', 'Capacité ou besoin de financement',
                           'Fonds de roulement', 'Variation du fonds de roulement', 'Crédits de trésorerie', 'Dépôts au Trésor',
                           'Fonds de soutien aux emprunts à risque'],
}


def slugify(text):
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def group_of(agregat):
    for group, names in GROUPS.items():
        if agregat in names:
            return group
    return 'Autres'


def write(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(',', ':'))


def main():
    con = duckdb.connect()
    con.execute("SET preserve_insertion_order=false")
    meta = json.load(open('dist/data/web/communes-meta.json', encoding='utf-8'))
    commune_codes = [row[0] for row in meta['rows']]
    index = {'source': 'OFGL, bases consolidées (budgets principaux et annexes)', 'aggregates': {}, 'levels': {}, 'totals': {}}

    for level, (file, key, name_col, pop_col) in LEVELS.items():
        src = raw_csv(file)
        if not src:
            print(f'· {level}: {file} absent, ignoré')
            continue
        columns = [row[0] for row in con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()]
        key_expr = key
        if level == 'gfp':
            # Historic intercommunalities are mapped onto their 2025 successor when OFGL provides it.
            key_expr = "coalesce(nullif(siren_25, ''), siren)" if 'siren_25' in columns else 'siren'
        name_expr = name_col if name_col in columns else ('lbudg' if 'lbudg' in columns else "''")
        if level == 'communes':
            # Accounts of communes that later merged are attached to their 2025 successor (OFGL insee → insee_25),
            # summing amounts and populations of the former communes.
            successors = json.load(open('sources/communes-successeurs-2025.json', encoding='utf-8'))['map'] if os.path.exists('sources/communes-successeurs-2025.json') else {}
            con.execute('CREATE OR REPLACE TABLE succ (old VARCHAR, new VARCHAR)')
            if successors:
                con.executemany('INSERT INTO succ VALUES (?, ?)', list(successors.items()))
            con.execute(f"""
                CREATE OR REPLACE TABLE t AS
                WITH raw AS (SELECT CAST(left(exer, 4) AS INTEGER) AS year, insee, agregat, sum(TRY_CAST(montant AS DOUBLE)) AS value, max(TRY_CAST({pop_col} AS DOUBLE)) AS pop
                             FROM {src} WHERE agregat IS NOT NULL AND insee IS NOT NULL AND insee <> '' GROUP BY 1, 2, 3)
                SELECT year, coalesce(succ.new, raw.insee) AS code, NULL AS name, agregat, sum(value) AS value, sum(pop) AS pop
                FROM raw LEFT JOIN succ ON raw.insee = succ.old GROUP BY 1, 2, 4
            """)
        else:
            con.execute(f"""
            CREATE OR REPLACE TABLE t AS
            SELECT CAST(left(exer, 4) AS INTEGER) AS year, {key_expr} AS code, max({name_expr}) AS name, agregat,
                   sum(TRY_CAST(montant AS DOUBLE)) AS value, max(TRY_CAST({pop_col} AS DOUBLE)) AS pop
            FROM {src}
            WHERE agregat IS NOT NULL AND {key_expr} IS NOT NULL AND {key_expr} <> ''
            GROUP BY 1, 2, 4
        """)
        years = [row[0] for row in con.execute('SELECT DISTINCT year FROM t ORDER BY 1').fetchall()]
        aggregates = [row[0] for row in con.execute('SELECT DISTINCT agregat FROM t ORDER BY 1').fetchall()]
        if level == 'communes':
            codes = commune_codes
            names = None
        else:
            rows = con.execute('SELECT code, arg_max(name, year) FROM t GROUP BY 1 ORDER BY 1').fetchall()
            codes = [row[0] for row in rows]
            names = [row[1] for row in rows]
        position = {code: i for i, code in enumerate(codes)}
        unknown = con.execute('SELECT count(DISTINCT code) FROM t').fetchone()[0] - len(set(position) & {r[0] for r in con.execute('SELECT DISTINCT code FROM t').fetchall()})
        write(f'{OUT}/{level}/_entities.json', {'codes': codes, 'names': names} if names else {'alignedWith': 'web/communes-meta.json', 'count': len(codes)})

        pop = [[None] * len(codes) for _ in years]
        for year, code, value in con.execute('SELECT year, code, max(pop) FROM t GROUP BY 1, 2').fetchall():
            if code in position and value is not None:
                pop[years.index(year)][position[code]] = round(value)
        write(f'{OUT}/{level}/_pop.json', {'years': years, 'values': pop})

        totals = {}
        for agregat in aggregates:
            values = [[None] * len(codes) for _ in years]
            for year, code, value in con.execute('SELECT year, code, value FROM t WHERE agregat = ?', [agregat]).fetchall():
                if code in position and value is not None:
                    values[years.index(year)][position[code]] = round(value)
            slug = slugify(agregat)
            write(f'{OUT}/{level}/{slug}.json', {'aggregate': agregat, 'years': years, 'values': values})
            totals[slug] = {str(year): total for year, total in con.execute('SELECT year, sum(value) FROM t WHERE agregat = ? GROUP BY 1 ORDER BY 1', [agregat]).fetchall()}
            index['aggregates'].setdefault(slug, {'label': agregat, 'group': group_of(agregat), 'levels': []})['levels'].append(level)
        index['levels'][level] = {'years': years, 'entities': len(codes), 'unmatchedEntities': unknown}
        index['totals'][level] = totals
        print(f'✓ {level}: {len(codes)} entités, {len(aggregates)} agrégats, {years[0]}–{years[-1]}' + (f', {unknown} codes sans contour' if unknown else ''))

    # Other local public bodies: national totals per aggregate and year (no map geometry), used by the circuit.
    for level, source_id in [('syndicats', 'ofgl-syndicats'), ('sdis', 'ofgl-sdis'), ('epl', 'ofgl-epl'), ('ccas', 'ofgl-ccas')]:
        src = raw_csv(source_id)
        if not src:
            continue
        rows = con.execute(f"SELECT CAST(left(exer, 4) AS INTEGER) AS y, agregat, sum(TRY_CAST(montant AS DOUBLE)), count(DISTINCT siren) FROM {src} WHERE agregat IS NOT NULL GROUP BY 1, 2").fetchall()
        totals, entities = {}, {}
        for year, agregat, value, n in rows:
            totals.setdefault(slugify(agregat), {})[str(year)] = value
            entities[str(year)] = max(entities.get(str(year), 0), n)
            index['aggregates'].setdefault(slugify(agregat), {'label': agregat, 'group': group_of(agregat), 'levels': []})
        index['totals'][level] = totals
        index['levels'][level] = {'years': sorted({r[0] for r in rows}), 'entitiesPerYear': entities, 'totalsOnly': True}
        print(f'✓ {level}: totaux nationaux, {len(totals)} agrégats')

    # Commune → intercommunality membership (latest year), used to draw intercommunalities from commune shapes.
    populations = raw_csv('ofgl-populations-communes')
    if populations and 'gfp' in index['levels']:
        latest = con.execute(f"SELECT max(CAST(left(annee, 4) AS INTEGER)) FROM {populations}").fetchone()[0]
        position = {code: i for i, code in enumerate(commune_codes)}
        members = {}
        for insee, epci in con.execute(f"SELECT insee, epci_code FROM {populations} WHERE CAST(left(annee, 4) AS INTEGER) = ? AND epci_code IS NOT NULL AND epci_code <> ''", [latest]).fetchall():
            if insee in position:
                members.setdefault(epci, []).append(position[insee])
        write(f'{OUT}/gfp/_communes.json', {'year': latest, 'alignedWith': 'web/communes-meta.json', 'members': members})
        index['levels']['gfp']['membershipYear'] = latest
        print(f'✓ gfp: appartenance de {sum(len(v) for v in members.values())} communes ({latest})')

    write(f'{OUT}/index.json', index)
    write_signals(con, commune_codes, meta)


def write_signals(con, commune_codes, meta):
    """Screening rules on local accounts (communes, latest year). Leads to check, not findings."""
    names = {row[0]: (row[1], row[2]) for row in meta['rows']}
    src = raw_csv('ofgl-communes')
    signals = {}
    if src:
        con.execute(f"""CREATE OR REPLACE TABLE c AS SELECT CAST(left(exer, 4) AS INTEGER) AS year, insee, agregat, sum(TRY_CAST(montant AS DOUBLE)) AS value, max(TRY_CAST(ptot AS DOUBLE)) AS pop
            FROM {src} WHERE agregat IN ('Epargne brute', 'Encours de dette', 'Frais de personnel', 'Recettes de fonctionnement', 'Dépenses de fonctionnement')
            GROUP BY 1, 2, 3""")
        latest = con.execute('SELECT max(year) FROM c').fetchone()[0]
        con.execute(f"""CREATE OR REPLACE TABLE w AS SELECT insee, max(pop) AS pop,
            sum(value) FILTER (WHERE agregat = 'Epargne brute') AS eb, sum(value) FILTER (WHERE agregat = 'Encours de dette') AS debt,
            sum(value) FILTER (WHERE agregat = 'Frais de personnel') AS staff, sum(value) FILTER (WHERE agregat = 'Recettes de fonctionnement') AS recf
            FROM c WHERE year = {latest} GROUP BY insee""")
        eb, debt, staff, recf, popc = 'eb', 'debt', 'staff', 'recf', 'pop'
        q = lambda c: f'"{c}"'
        def named(rows):
            return [[r[0], *names.get(r[0], (None, None)), *r[1:]] for r in rows]
        signals['negativeSavings'] = {'rule': f'Épargne brute négative en {latest} : les recettes de fonctionnement ne couvrent pas les dépenses de fonctionnement',
            'fields': ['insee', 'name', 'dept', 'epargneBrute', 'recettesFonctionnement', 'population'],
            'rows': named(con.execute(f'SELECT insee, {q(eb)}, {q(recf)}, {q(popc)} FROM w WHERE {q(eb)} < 0 ORDER BY {q(eb)} ASC LIMIT 400').fetchall()),
            'count': con.execute(f'SELECT count(*) FROM w WHERE {q(eb)} < 0').fetchone()[0]}
        signals['debtCapacity'] = {'rule': f'Capacité de désendettement supérieure à 12 ans en {latest} (encours de dette ÷ épargne brute), encours ≥ 1 M€',
            'fields': ['insee', 'name', 'dept', 'years', 'encours', 'epargneBrute', 'population'],
            'rows': named(con.execute(f'SELECT insee, {q(debt)} / {q(eb)}, {q(debt)}, {q(eb)}, {q(popc)} FROM w WHERE {q(eb)} > 0 AND {q(debt)} >= 1e6 AND {q(debt)} / {q(eb)} > 12 ORDER BY 2 DESC LIMIT 400').fetchall()),
            'count': con.execute(f'SELECT count(*) FROM w WHERE {q(eb)} > 0 AND {q(debt)} >= 1e6 AND {q(debt)} / {q(eb)} > 12').fetchone()[0]}
        # Staff costs per inhabitant compared with the median of communes of similar size *and* type:
        # tourist and mountain communes serve far more people than their residents, so they are compared among themselves.
        typology = json.load(open('sources/communes-typologie.json', encoding='utf-8')) if os.path.exists('sources/communes-typologie.json') else {'touristique': [], 'montagne': []}
        con.execute('CREATE OR REPLACE TABLE typ (insee VARCHAR, kind VARCHAR)')
        kinds = {code: 'touristique' for code in typology['touristique']}
        for code in typology['montagne']:
            kinds.setdefault(code, 'montagne')
        if kinds:
            con.executemany('INSERT INTO typ VALUES (?, ?)', list(kinds.items()))
        signals['staffOutliers'] = {'rule': f'Frais de personnel par habitant au moins 3 fois supérieurs à la médiane des communes de même taille et de même type (touristique, montagne, autre) en {latest}, communes de plus de 1 000 habitants',
            'fields': ['insee', 'name', 'dept', 'perHabitant', 'medianOfBand', 'ratio', 'population', 'type'],
            'rows': named(con.execute(f"""WITH x AS (SELECT insee, {q(staff)} / {q(popc)} AS ph, {q(popc)} AS pop, coalesce(typ.kind, 'autre') AS kind,
                        CASE WHEN {q(popc)} < 2000 THEN 1 WHEN {q(popc)} < 5000 THEN 2 WHEN {q(popc)} < 10000 THEN 3 WHEN {q(popc)} < 20000 THEN 4 WHEN {q(popc)} < 50000 THEN 5 WHEN {q(popc)} < 100000 THEN 6 ELSE 7 END AS band
                        FROM w LEFT JOIN typ USING (insee) WHERE {q(popc)} >= 1000 AND {q(staff)} > 0),
                    m AS (SELECT band, kind, median(ph) AS med FROM x GROUP BY 1, 2)
                    SELECT insee, ph, med, ph / med, pop, kind FROM x JOIN m USING (band, kind) WHERE ph >= 3 * med ORDER BY ph / med DESC LIMIT 300""").fetchall())}
        signals['staffOutliers']['count'] = len(signals['staffOutliers']['rows'])
        signals['year'] = latest
    for name in ('delais-paiement-2025', 'delais-paiement-2024'):
        src = raw_csv(name)
        if not src:
            continue
        rows = con.execute(f"""SELECT libelle_budget_collectivite, code_departement_bc, type_budget_collectivite, TRY_CAST(dgp_annuel_moyen AS DOUBLE) AS d, code_insee FROM {src}
                                WHERE TRY_CAST(dgp_annuel_moyen AS DOUBLE) > 60 ORDER BY d DESC LIMIT 400""").fetchall()
        total = con.execute(f'SELECT count(*), count(*) FILTER (WHERE TRY_CAST(dgp_annuel_moyen AS DOUBLE) > 30), count(*) FILTER (WHERE TRY_CAST(dgp_annuel_moyen AS DOUBLE) > 60), median(TRY_CAST(dgp_annuel_moyen AS DOUBLE)) FROM {src}').fetchone()
        signals['paymentDelays'] = {'rule': f'Délai global de paiement moyen supérieur à 60 jours ({name[-4:]}) ; le délai légal est de 30 jours (50 jours pour les établissements publics de santé)',
                                    'fields': ['budget', 'dept', 'type', 'days', 'siret'], 'rows': [list(r) for r in rows],
                                    'stats': {'budgets': total[0], 'over30': total[1], 'over60': total[2], 'median': total[3]}, 'count': total[2]}
        break
    write(f'{OUT}/signals.json', signals)
    summary = ', '.join(f"{k}={v.get('count')}" for k, v in signals.items() if isinstance(v, dict))
    print(f'✓ signaux locaux : {summary}')


if __name__ == '__main__':
    sys.exit(main())
