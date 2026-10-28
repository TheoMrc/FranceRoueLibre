"""Public procurement (DECP) → dist/data/marches/.

Sources: sources/raw/decp-v3.csv.gz and decp-2022.csv.gz (données essentielles de la commande publique, data.economie.gouv.fr).
The two extracts overlap; contracts are de-duplicated on (buyer SIRET, contract id, notification date, amount).

Outputs:
  summary.json   totals per year, by procedure, by CPV division, competition statistics, data-quality counters
  buyers.json    the largest buyers with competition indicators
  signals.json   transparent screening rules — leads to check, never findings
  cpv.json       contracts and framework ceilings per year and CPV group (3 digits), with French CPV labels
  cpv-top.json   the largest contracts of each CPV group (2019+)
  energie.json   renewable-energy zoom: DECP contracts by technology, State support (budget vert, programme 345), Fonds vert
Run: python scripts/process_procurement.py
"""
import html
import json
import os

import duckdb

from rawfiles import csv as raw_csv

RAW = 'sources/raw'
OUT = 'dist/data/marches'
MAX_PLAUSIBLE = 2e9  # single contracts above this are almost always unit errors (cents, duplicated digits)


def clean_text(value):
    """Contract objects sometimes carry HTML entities (&#8217;) or literal \\n sequences."""
    return ' '.join(html.unescape(value).replace('\\n', ' ').split()) if isinstance(value, str) else value


def write(name, value):
    os.makedirs(OUT, exist_ok=True)
    with open(f'{OUT}/{name}', 'w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(',', ':'), default=str)


def rows(con, sql, params=None):
    return [list(r) for r in con.execute(sql, params or []).fetchall()]


def main():
    con = duckdb.connect()
    parts = []
    for name in ('decp-v3', 'decp-2022'):
        src = raw_csv(name, ', max_line_size=10000000')
        if not src:
            continue
        cols = {r[0] for r in con.execute(f'DESCRIBE SELECT * FROM {src}').fetchall()}
        col = lambda c: c if c in cols else 'NULL'
        parts.append(f"""SELECT '{name}' AS source, {col('id')} AS id, regexp_replace({col('acheteur_id')}, '\\s', '', 'g') AS buyer, {col('acheteur_nom')} AS buyer_name,
            regexp_replace({col('titulaire_id_1')}, '\\s', '', 'g') AS supplier, {col('titulaire_typeidentifiant_1')} AS supplier_type,
            TRY_CAST({col('montant')} AS DOUBLE) AS amount, TRY_CAST(left({col('datenotification')}, 10) AS DATE) AS notified,
            {col('procedure')} AS procedure, {col('nature')} AS nature, left({col('codecpv')}, 8) AS cpv, {col('objet')} AS object,
            TRY_CAST({col('offresrecues')} AS INTEGER) AS bids, TRY_CAST({col('montantmodification')} AS DOUBLE) AS amount_modified,
            TRY_CAST({col('dureemois')} AS DOUBLE) AS months, {col('lieuexecution_code')} AS place, {col('techniques')} AS techniques
            FROM {src}""")
    if not parts:
        print('· DECP absent'); return
    con.execute('CREATE TABLE raw AS ' + ' UNION ALL '.join(parts))
    con.execute("""CREATE TABLE m AS SELECT * EXCLUDE (rn) FROM (
        SELECT *, row_number() OVER (PARTITION BY buyer, id, notified, amount ORDER BY source DESC) AS rn FROM raw) WHERE rn = 1""")
    con.execute("ALTER TABLE m ADD COLUMN year INTEGER; UPDATE m SET year = year(notified)")
    # Implausible: ≤ 1 €, above MAX_PLAUSIBLE, or a placeholder ceiling (≥ 10 M€ containing "99999", or a round ≥ 100 M€ figure).
    con.execute("""ALTER TABLE m ADD COLUMN plausible BOOLEAN; UPDATE m SET plausible = amount > 1 AND amount < ?
        AND NOT (amount >= 1e7 AND CAST(CAST(round(amount) AS BIGINT) AS VARCHAR) LIKE '%99999%')
        AND NOT (amount >= 1e8 AND CAST(round(amount) AS BIGINT) % 10000000 = 0)""", [MAX_PLAUSIBLE])
    # Bid counts above 500 are entry errors (an amount or a date typed in the field); they would distort averages.
    implausible_bids = con.execute('SELECT count(*) FROM m WHERE bids > 500 OR bids < 0').fetchone()[0]
    con.execute('UPDATE m SET bids = NULL WHERE bids > 500 OR bids < 0')
    con.execute("ALTER TABLE m ADD COLUMN buyer_siren VARCHAR; UPDATE m SET buyer_siren = left(buyer, 9)")
    # Framework agreements publish a ceiling, not a spend: kept apart from contract totals. The v3 format flags them in
    # "nature"; the 2022 format always says "Marché" there and flags them in "techniques" ("Accord-cadre").
    con.execute("""ALTER TABLE m ADD COLUMN framework BOOLEAN;
        UPDATE m SET framework = coalesce(nature ILIKE '%accord%cadre%', false) OR coalesce(techniques ILIKE '%accord%cadre%', false)""")
    os.makedirs('sources/derived', exist_ok=True)
    con.execute(f"""COPY (SELECT year, buyer_siren, buyer_name, supplier, amount, object, cpv, procedure, framework, bids FROM m WHERE {'plausible AND year BETWEEN 2014 AND 2026'})
                   TO 'sources/derived/decp.parquet' (FORMAT parquet, COMPRESSION zstd)""")
    names = {}
    # Local authorities first (official names from OFGL), then names published in DECP v3.
    meta_path = 'dist/data/web/communes-meta.json'
    commune_names = {row[0]: row[1] for row in json.load(open(meta_path, encoding='utf-8'))['rows']} if os.path.exists(meta_path) else {}
    for file, sql in [
        ('ofgl-communes.csv.gz', "SELECT DISTINCT siren, insee FROM {src} WHERE siren IS NOT NULL"),
        ('ofgl-gfp.csv.gz', "SELECT siren, arg_max(epci_name, exer) FROM {src} GROUP BY 1"),
        ('ofgl-departements.csv.gz', "SELECT siren, arg_max(lbudg, exer) FROM {src} GROUP BY 1"),
        ('ofgl-regions.csv.gz', "SELECT siren, arg_max(reg_name, exer) FROM {src} GROUP BY 1"),
        ('ofgl-syndicats.csv.gz', "SELECT siren, arg_max(synd_name, exer) FROM {src} GROUP BY 1"),
        ('ofgl-epl.csv.gz', "SELECT siren, arg_max(nom_epl, exer) FROM {src} GROUP BY 1"),
    ]:
        src = raw_csv(file.replace('.csv.gz', ''))
        if not src:
            continue
        try:
            for siren, value in con.execute(sql.format(src=src)).fetchall():
                name = commune_names.get(value, value) if file == 'ofgl-communes.csv.gz' else value
                if siren and name and siren not in names:
                    names[siren] = (f'Commune de {name}' if file == 'ofgl-communes.csv.gz' else name)
        except duckdb.Error as error:
            print(f'· noms {file}: {error}')
    for siren, value in con.execute("SELECT buyer_siren, arg_max(buyer_name, notified) FROM m WHERE buyer_name IS NOT NULL AND buyer_name <> '' GROUP BY 1").fetchall():
        names.setdefault(siren, value)
    with open('sources/derived/buyer-names.json', 'w', encoding='utf-8') as handle:
        json.dump(names, handle, ensure_ascii=False)
    quality_extra = {'implausibleBids': implausible_bids}
    quality = dict(zip(['raw', 'unique', 'implausible', 'noDate', 'noBuyer', 'noBidCount'], con.execute("""
        SELECT (SELECT count(*) FROM raw), count(*), count(*) FILTER (WHERE NOT plausible), count(*) FILTER (WHERE notified IS NULL),
               count(*) FILTER (WHERE buyer IS NULL OR length(buyer) < 9), count(*) FILTER (WHERE bids IS NULL) FROM m""").fetchone()))
    ok = 'plausible AND year BETWEEN 2014 AND 2026'
    summary = {
        'source': 'DECP (données essentielles de la commande publique), formats 2022 et v3, data.economie.gouv.fr',
        'quality': quality,
        'maxPlausible': MAX_PLAUSIBLE,
        'perYearFields': ['year', 'contracts', 'amountContracts', 'frameworks', 'ceilingFrameworks', 'buyers', 'suppliers', 'avgBids', 'singleBid'],
        'perYear': rows(con, f"""SELECT year, count(*) FILTER (WHERE NOT framework), sum(amount) FILTER (WHERE NOT framework), count(*) FILTER (WHERE framework), sum(amount) FILTER (WHERE framework),
                                  count(DISTINCT buyer_siren), count(DISTINCT supplier), avg(bids) FILTER (WHERE bids > 0), count(*) FILTER (WHERE bids = 1) FROM m WHERE {ok} GROUP BY 1 ORDER BY 1"""),
        'byProcedure': rows(con, f"SELECT procedure, count(*), sum(amount), avg(bids) FILTER (WHERE bids > 0) FROM m WHERE {ok} GROUP BY 1 ORDER BY 3 DESC LIMIT 20"),
        'byNature': rows(con, f"SELECT nature, count(*), sum(amount) FROM m WHERE {ok} GROUP BY 1 ORDER BY 3 DESC LIMIT 12"),
        'byCpvDivision': rows(con, f"SELECT left(cpv, 2), count(*), sum(amount), count(*) FILTER (WHERE bids = 1) FROM m WHERE {ok} GROUP BY 1 ORDER BY 3 DESC"),
        'bidsDistribution': rows(con, f"SELECT least(bids, 10), count(*), sum(amount) FROM m WHERE {ok} AND bids >= 1 GROUP BY 1 ORDER BY 1"),
        'amountBands': rows(con, f"SELECT floor(amount / 5000) * 5000 AS band, count(*) FROM m WHERE {ok} AND amount < 300000 GROUP BY 1 ORDER BY 1"),
    }
    summary['quality'].update(quality_extra)
    write('summary.json', summary)

    buyers = rows(con, f"""
        WITH b AS (SELECT buyer_siren, count(*) AS n, sum(amount) FILTER (WHERE NOT framework) AS total, avg(bids) FILTER (WHERE bids > 0) AS avg_bids,
                          count(*) FILTER (WHERE bids = 1) * 1.0 / nullif(count(*) FILTER (WHERE bids IS NOT NULL), 0) AS single_share
                   FROM m WHERE {ok} GROUP BY 1),
             s AS (SELECT buyer_siren, supplier, sum(amount) AS amount FROM m WHERE {ok} AND NOT framework GROUP BY 1, 2),
             top AS (SELECT buyer_siren, arg_max(supplier, amount) AS top_supplier, max(amount) AS top_amount FROM s GROUP BY 1)
        SELECT b.buyer_siren, b.n, b.total, b.avg_bids, b.single_share, top.top_supplier, top.top_amount / nullif(b.total, 0)
        FROM b JOIN top USING (buyer_siren) ORDER BY b.total DESC NULLS LAST LIMIT 3000""")
    for row in buyers:
        row.insert(1, names.get(row[0]))
    write('buyers.json', {'fields': ['siren', 'name', 'contracts', 'amount', 'avgBids', 'singleBidShare', 'topSupplier', 'topSupplierShare'], 'rows': buyers})

    contract_fields = ['buyerSiren', 'buyerName', 'supplier', 'amount', 'notified', 'procedure', 'cpv', 'bids', 'object', 'framework']
    pick = lambda where, order, limit=300: [[r[0], names.get(r[0]), *r[1:]] for r in rows(con, f"""
        SELECT buyer_siren, supplier, amount, notified, procedure, cpv, bids, left(object, 220), framework FROM m WHERE {ok} AND {where} ORDER BY {order} LIMIT {limit}""")]
    thresholds = [90000, 143000, 221000, 5538000]
    bunching = []
    for t in thresholds:
        bunching.append({'threshold': t, 'rows': [[r[0], names.get(r[0]), *r[1:]] for r in rows(con, f"""
            SELECT buyer_siren, count(*) FILTER (WHERE amount >= {t * .9} AND amount < {t}) AS below, count(*) FILTER (WHERE amount >= {t} AND amount < {t * 1.1}) AS above,
                   count(*) AS n FROM m WHERE {ok} GROUP BY 1 HAVING below >= 5 AND below >= 3 * greatest(above, 1) ORDER BY below DESC LIMIT 150""")],
            'national': con.execute(f"SELECT count(*) FILTER (WHERE amount >= {t * .9} AND amount < {t}), count(*) FILTER (WHERE amount >= {t} AND amount < {t * 1.1}) FROM m WHERE {ok}").fetchone()})
    signals = {
        'contractFields': contract_fields,
        'singleBidLarge': {'rule': 'Une seule offre reçue pour un marché ≥ 1 M€ passé selon une procédure ouverte à la concurrence', 'rows': pick("bids = 1 AND amount >= 1000000 AND procedure NOT ILIKE '%sans publicit%'", 'amount DESC')},
        'noCompetition': {'rule': 'Marché ≥ 500 k€ passé sans publicité ni mise en concurrence préalables', 'rows': pick("procedure ILIKE '%sans publicit%' AND amount >= 500000", 'amount DESC')},
        'amendments': {'rule': 'Montant après modification supérieur de plus de 50 % au montant initial (et d’au moins 100 k€)', 'fields': contract_fields + ['amountModified'],
                       'rows': [[r[0], names.get(r[0]), *r[1:]] for r in rows(con, f"""SELECT buyer_siren, supplier, amount, notified, procedure, cpv, bids, left(object, 220), framework, amount_modified FROM m
                                 WHERE {ok} AND amount_modified <= amount * 20 AND amount_modified > amount * 1.5 AND amount_modified - amount >= 100000 AND amount_modified < {MAX_PLAUSIBLE}
                                 AND NOT (amount_modified >= 1e8 AND CAST(round(amount_modified) AS BIGINT) % 10000000 = 0)
                                 AND CAST(CAST(round(amount_modified) AS BIGINT) AS VARCHAR) NOT LIKE '%9999%' AND CAST(CAST(round(amount) AS BIGINT) AS VARCHAR) NOT LIKE '%9999%' ORDER BY amount_modified - amount DESC LIMIT 300""")]},
        'amendmentOutliers': {'rule': 'Montant après modification plus de 20 fois supérieur au montant initial : erreur de saisie probable (unité, séparateur), à corriger par l’acheteur', 'fields': contract_fields + ['amountModified'],
                       'rows': [[r[0], names.get(r[0]), *r[1:]] for r in rows(con, f"""SELECT buyer_siren, supplier, amount, notified, procedure, cpv, bids, left(object, 220), framework, amount_modified FROM m
                                 WHERE {ok} AND amount_modified > amount * 20 AND amount_modified - amount >= 100000 AND amount_modified < {MAX_PLAUSIBLE}
                                 AND NOT (amount_modified >= 1e8 AND CAST(round(amount_modified) AS BIGINT) % 10000000 = 0)
                                 AND CAST(CAST(round(amount_modified) AS BIGINT) AS VARCHAR) NOT LIKE '%9999%' AND CAST(CAST(round(amount) AS BIGINT) AS VARCHAR) NOT LIKE '%9999%' ORDER BY amount_modified - amount DESC LIMIT 300""")]},
        'thresholdBunching': {'rule': 'Acheteurs ayant au moins 5 marchés dans les 10 % sous un seuil de procédure et au moins 3 fois plus qu’au-dessus', 'byThreshold': bunching},
        'splitting': {'rule': 'Même acheteur, même titulaire, même famille CPV : au moins 3 marchés de moins de 90 k€ notifiés sur 12 mois, totalisant au moins 90 k€',
                      'rows': [[r[0], names.get(r[0]), *r[1:]] for r in rows(con, f"""
                        SELECT buyer_siren, supplier, left(cpv, 3) AS family, year, count(*) AS n, sum(amount) AS total FROM m
                        WHERE {ok} AND NOT framework AND amount < 90000 AND supplier IS NOT NULL GROUP BY 1, 2, 3, 4 HAVING n >= 3 AND total >= 90000 ORDER BY total DESC LIMIT 300""")]},
        'supplierConcentration': {'rule': 'Acheteur avec au moins 10 marchés et 1 M€ (hors accords-cadres) dont un titulaire reçoit plus de 60 % du montant',
                                  'rows': [r for r in buyers if r[2] >= 10 and (r[3] or 0) >= 1e6 and (r[7] or 0) > .6][:300]},
        'implausibleAmounts': {'rule': f'Montants ≤ 1 €, ≥ {MAX_PLAUSIBLE / 1e9:.0f} Md€ ou plafonds fictifs (999 999…, montants ronds ≥ 100 M€) : exclus des totaux',
                               'rows': [[r[0], names.get(r[0]), *r[1:]] for r in rows(con, "SELECT buyer_siren, supplier, amount, notified, procedure, cpv, bids, left(object, 220), framework FROM m WHERE NOT plausible ORDER BY amount DESC LIMIT 200")]},
    }
    write('signals.json', signals)
    products(con, ok)
    energy(con, ok)
    print(f"✓ DECP: {quality}")



def products(con, ok):
    """Purchases by product family (CPV). Labels come from the official CPV 2008 vocabulary (sources/cpv-2008-fr.json)."""
    labels = json.load(open('sources/cpv-2008-fr.json', encoding='utf-8')) if os.path.exists('sources/cpv-2008-fr.json') else {}
    con.execute("ALTER TABLE m ADD COLUMN IF NOT EXISTS cpv3 VARCHAR; UPDATE m SET cpv3 = CASE WHEN regexp_matches(cpv, '^\\d{3}') THEN left(cpv, 3) END")
    per_year = {}
    for year, group, n, amount, fw_n, fw_amount in con.execute(f"""SELECT year, cpv3, count(*) FILTER (WHERE NOT framework), round(sum(amount) FILTER (WHERE NOT framework)),
            count(*) FILTER (WHERE framework), round(sum(amount) FILTER (WHERE framework)) FROM m WHERE {ok} AND cpv3 IS NOT NULL GROUP BY 1, 2""").fetchall():
        per_year.setdefault(str(year), []).append([group, n, amount or 0, fw_n, fw_amount or 0])
    groups = sorted({row[0] for rows_ in per_year.values() for row in rows_})
    label = lambda code: labels.get(code.ljust(8, '0'))
    write('cpv.json', {'fields': ['group', 'contracts', 'amount', 'frameworks', 'ceilings'], 'years': sorted(int(y) for y in per_year), 'perYear': per_year,
                       'divisions': {g[:2]: label(g[:2]) for g in groups}, 'groups': {g: label(g) for g in groups},
                       'source': 'DECP ; libellés : vocabulaire commun pour les marchés publics (CPV 2008), Office des publications de l’UE'})
    top = {}
    for group, year, buyer, supplier, amount, obj, cpv, bids, procedure in con.execute(f"""SELECT cpv3, year, buyer_siren, supplier, amount, left(object, 200), cpv, bids, procedure FROM (SELECT * FROM m
            WHERE {ok} AND NOT framework AND cpv3 IS NOT NULL AND year >= 2019 QUALIFY row_number() OVER (PARTITION BY buyer_siren, object, amount ORDER BY supplier) = 1) AS t
            QUALIFY row_number() OVER (PARTITION BY cpv3 ORDER BY amount DESC) <= 12 ORDER BY cpv3, amount DESC""").fetchall():
        top.setdefault(group, []).append([year, buyer, supplier, amount, clean_text(obj), cpv, bids, procedure])
    write('cpv-top.json', {'fields': ['year', 'buyerSiren', 'supplier', 'amount', 'object', 'cpv', 'bids', 'procedure'], 'groups': top, 'cpvLabels': {
        code: labels.get(code) for rows_ in top.values() for code in {r[5] for r in rows_} if code in labels}})
    print(f'✓ achats par produit : {len(groups)} groupes CPV')


# Renewable-energy technologies, recognised from the contract object (and CPV for solar panels).
ENERGY = [
    ('solaire', 'Solaire photovoltaïque et thermique', "regexp_matches(lower(object), 'photovolta|panneaux? solaires?|centrale solaire|solaire thermique|chauffe-eau solaire|ombri[eè]res? (solaire|photo)') OR cpv LIKE '09331%'"),
    ('eolien', 'Éolien', "regexp_matches(lower(object), '[ée]olien')"),
    ('chaleur', 'Chaleur renouvelable (bois, géothermie, pompes à chaleur, réseaux de chaleur)', "regexp_matches(lower(object), 'g[ée]otherm|pompes? à chaleur|r[ée]seaux? de chaleur|chaufferie bois|chaudi[eè]re (à |a )?(bois|biomasse|granul)|bois[- ][ée]nergie|biomasse')"),
    ('biogaz', 'Méthanisation et biogaz', "regexp_matches(lower(object), 'm[ée]thanis|biogaz|biom[ée]thane')"),
    ('hydro', 'Hydroélectricité', "regexp_matches(lower(object), 'hydro[ée]lectri|microcentrale|petite hydraulique')"),
    ('renovation', 'Rénovation énergétique (efficacité, pas production)', "regexp_matches(lower(object), 'r[ée]novation [ée]nerg|performance [ée]nerg|isolation thermique|contrat de performance')"),
]


def energy(con, ok):
    out = {'technologies': [[key, label] for key, label, _ in ENERGY], 'decp': {}, 'top': {},
           'note': 'Marchés repérés par mots-clés dans leur objet : une même opération peut relever de plusieurs technologies, et un objet rédigé autrement échappe au repérage.'}
    for key, label, cond in ENERGY:
        out['decp'][key] = rows(con, f"""SELECT year, count(*) FILTER (WHERE NOT framework), round(sum(amount) FILTER (WHERE NOT framework)), count(*) FILTER (WHERE framework), round(sum(amount) FILTER (WHERE framework))
            FROM m WHERE {ok} AND ({cond}) GROUP BY 1 ORDER BY 1""")
        # One row per contract: the lots of a joint award repeat buyer, object and amount with each co-contractor.
        out['top'][key] = rows(con, f"""SELECT year, buyer_siren, supplier, amount, left(object, 200), bids, procedure FROM m WHERE {ok} AND NOT framework AND ({cond}) AND year >= 2019
            QUALIFY row_number() OVER (PARTITION BY buyer_siren, object, amount ORDER BY supplier) = 1 ORDER BY amount DESC LIMIT 15""")
        out['top'][key] = [[*row[:4], clean_text(row[4]), *row[5:]] for row in out['top'][key]]
    # State support (budget vert annex of the 2026 finance bill): totals by rating, and programme 345 (renewables support).
    src = raw_csv('plf26-budget-vert')
    if src:
        num = lambda c: f'TRY_CAST(replace("{c}", \',\', \'.\') AS DOUBLE)'
        cols = ['execution_2024_cp', 'lfi_2025_cp_ou_prevision_2025_si_depense_fiscale', 'plf_2026_cp_ou_prevision_2026_si_depense_fiscale']
        sums = ', '.join(f'round(sum({num(c)}))' for c in cols)
        out['budgetVert'] = {'years': [2024, 2025, 2026], 'yearsNote': '2024 : exécution ; 2025 : loi de finances ; 2026 : projet de loi de finances',
            'byRating': rows(con, f'SELECT type_depense, cotation_globale, count(*), {sums} FROM {src} GROUP BY 1, 2 ORDER BY 1, 2'),
            'renewables': rows(con, f"""SELECT libelle, cotation_globale, {', '.join(f'round({num(c)})' for c in cols)} FROM {src}
                WHERE programme = 'Service public de l''énergie' ORDER BY {num(cols[2])} DESC NULLS LAST"""),
            'source': 'Rapport sur l’impact environnemental du budget de l’État (budget vert), PLF 2026'}
    fonds_vert = 'dist/data/aides/fonds-vert.json'
    if os.path.exists(fonds_vert):
        fv = json.load(open(fonds_vert, encoding='utf-8'))
        out['fondsVert'] = {'perYear': fv.get('perYear'), 'energyMeasures': [row for row in fv.get('byMeasure', []) if row[0] and any(k in row[0].lower() for k in ('énerg', 'energ', 'éclairage', 'chaleur', 'renouvelable'))]}
    write('energie.json', out)
    print('✓ énergie : ' + ', '.join(f"{k} {sum(r[1] for r in v)} marchés" for k, v in out['decp'].items()))


if __name__ == '__main__':
    main()
