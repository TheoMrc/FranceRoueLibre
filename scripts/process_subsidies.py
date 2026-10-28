"""Subsidies and aid → dist/data/aides/.

Sources (sources/raw/, see scripts/fetch-sources.mjs):
  jaune-associations-YYYY  State grants to associations, annex "jaune" of the finance bill (grant year = PLF year − 2)
  aides-minimis            de minimis State aid to companies (EU transparency register extract)
  datagouv-fonds-vert--*   Fonds vert projects
Outputs:
  associations.json        totals per year, by programme, by département, top beneficiaries, data-quality counters
  associations-index.json  one line per beneficiary SIREN (search)
  entreprises.json         de minimis aid summary
  fonds-vert.json          Fonds vert summary
Run: python scripts/process_subsidies.py
"""
import glob
import re
import json
import os

import duckdb

RAW = 'sources/raw'
OUT = 'dist/data/aides'

# PLF year → (grant year, SQL expressions for each normalized column)
JAUNES = {
    2025: (2023, dict(programme='programme', siren='siren', name='denomination', amount='montant', object='objet_2023', dept="left(cog_code, CASE WHEN cog_code LIKE '97%' THEN 3 ELSE 2 END)", city='cog_libelle', status='etat_administratif', mission='NULL')),
    2020: (2018, dict(programme='programme', siren='siren', name='denomination', amount='montant', object='objet', dept='cog_code_departement_ou_pays', city='cog_ville_ou_pays', status='NULL', mission='NULL')),
    2018: (2016, dict(programme='programme_2016', siren='siren', name='denomination', amount='montant', object='objet', dept='cog_code_departement', city='cog_ville_ou_pays', status='situation_sirene', mission='NULL')),
    2017: (2015, dict(programme='programme', siren='siren', name='association', amount='subvention_2015', object='NULL', dept='departement', city='ville', status='NULL', mission='mission')),
    2016: (2014, dict(programme='programme', siren='siren', name='association', amount='"2014"', object='objet', dept='departement', city='ville', status='NULL', mission='mission')),
    2015: (2013, dict(programme='programme_2013', siren='siren', name='association', amount='subvention_2013', object='objet', dept='departement', city='ville', status='NULL', mission='mission_2013')),
    2014: (2012, dict(programme='programme', siren='siren', name='association', amount='subvention_2012', object='objet', dept='departement', city='ville', status='NULL', mission='mission')),
    2013: (2011, dict(programme='programme_en_2011', siren='siren', name='association', amount='subvention_2011_en_euros', object='objet_de_la_subvention', dept='departement', city='ville', status='NULL', mission='mission_en_2011')),
    2012: (2010, dict(programme='imputation', siren='siren', name='association', amount='total_des_subventions', object='NULL', dept='NULL', city='NULL', status='NULL', mission='NULL')),
}


# Labels of programmes that recent annexes give as bare codes (LOLF nomenclature).
KNOWN_PROGRAMMES = {
    '110': 'Aide économique et financière au développement', '119': 'Concours financiers aux collectivités territoriales', '122': 'Concours spécifiques et administration',
    '139': 'Enseignement privé du premier et du second degrés', '152': 'Gendarmerie nationale', '164': 'Cour des comptes et autres juridictions financières',
    '166': 'Justice judiciaire', '198': 'Régimes sociaux et de retraite', '232': 'Vie politique', '305': 'Stratégies économiques', '333': 'Moyens mutualisés des administrations déconcentrées',
    '349': 'Fonds pour la transformation de l’action publique', '350': 'Jeux olympiques et paralympiques 2024', '354': 'Administration territoriale de l’État',
    '361': 'Transmission des savoirs et démocratisation de la culture', '362': 'Écologie (plan de relance)', '363': 'Compétitivité (plan de relance)', '364': 'Cohésion (plan de relance)',
    '380': 'Fonds d’accélération de la transition écologique dans les territoires',
}


MOJIBAKE = re.compile('[\u00c2-\u00c5\u00e2][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]{1,2}')


def fix_text(value):
    """Repair UTF-8 text that was decoded as Windows-1252 upstream ("VandÅ“uvre" → "Vandœuvre"), one fragment at a time."""
    if not isinstance(value, str):
        return value

    def repair(match):
        try:
            return match.group(0).encode('cp1252').decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            return match.group(0)
    return MOJIBAKE.sub(repair, value)


def derived(name, con, sql):
    """Normalised rows kept for the full-text search index (scripts/process_search.py); local build artefacts, not versioned."""
    os.makedirs('sources/derived', exist_ok=True)
    con.execute(f"COPY ({sql}) TO 'sources/derived/{name}.parquet' (FORMAT parquet, COMPRESSION zstd)")


def write(name, value):
    os.makedirs(OUT, exist_ok=True)
    with open(f'{OUT}/{name}', 'w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(',', ':'))


def csv(path):
    return f"read_csv('{path}', delim=';', header=true, all_varchar=true, quote='\"', escape='\"', ignore_errors=true)"


def main():
    con = duckdb.connect()
    parts = []
    for plf, (year, cols) in JAUNES.items():
        path = f'{RAW}/jaune-associations-{plf}.csv.gz'
        if not os.path.exists(path):
            continue
        available = {row[0] for row in con.execute(f'DESCRIBE SELECT * FROM {csv(path)}').fetchall()}
        expr = {k: (v if v == 'NULL' or v.strip('"') in available or '(' in v else 'NULL') for k, v in cols.items()}
        parts.append(f"""SELECT {year} AS year, {plf} AS plf, CAST({expr['programme']} AS VARCHAR) AS programme, CAST({expr['mission']} AS VARCHAR) AS mission,
            regexp_replace(CAST({expr['siren']} AS VARCHAR), '[^0-9]', '', 'g') AS siren, trim(regexp_replace(replace(CAST({expr['name']} AS VARCHAR), chr(160), ' '), '\\s+', ' ', 'g')) AS name,
            TRY_CAST(replace(CAST({expr['amount']} AS VARCHAR), ',', '.') AS DOUBLE) AS amount, CAST({expr['object']} AS VARCHAR) AS object,
            lpad(CAST({expr['dept']} AS VARCHAR), 2, '0') AS dept, CAST({expr['city']} AS VARCHAR) AS city, CAST({expr['status']} AS VARCHAR) AS status
            FROM {csv(path)}
            WHERE NOT (lower(coalesce(CAST({expr['siren']} AS VARCHAR), '')) LIKE 'total%' OR lower(coalesce(CAST({expr['name']} AS VARCHAR), '')) LIKE 'total%')""")  # drop subtotal rows
    if parts:
        con.execute('CREATE TABLE j AS ' + ' UNION ALL '.join(parts))
        con.execute("UPDATE j SET siren = NULL WHERE length(siren) <> 9")
        # SIRENE status of the establishment at extraction: "Etablissement cessé 01/01/2008", "Fermé …".
        con.execute("ALTER TABLE j ADD COLUMN closed BOOLEAN")
        con.execute("ALTER TABLE j ADD COLUMN closed_on DATE")
        con.execute("""UPDATE j SET closed = regexp_matches(lower(status), 'cess|ferm|radi'),
                      closed_on = CAST(try_strptime(nullif(regexp_extract(status, '(\\d{2}/\\d{2}/\\d{4})', 1), ''), '%d/%m/%Y') AS DATE)""")
        # Programme labels where the source spells them ("131 - Création"), before reducing codes to 3 digits.
        labels = dict(con.execute("""SELECT regexp_extract(programme, '(\\d{3})', 1), arg_max(trim(regexp_replace(programme, '^\\D*\\d{3}\\s*-?\\s*', '')), year)
                                   FROM j WHERE regexp_matches(programme, '\\d{3}\\s*-\\s*\\S') GROUP BY 1""").fetchall())
        missions = dict(con.execute("SELECT regexp_extract(programme, '(\\d{3})', 1), arg_max(mission, year) FROM j WHERE mission IS NOT NULL GROUP BY 1").fetchall())
        for code, label in KNOWN_PROGRAMMES.items():
            labels.setdefault(code, label)
        con.execute("UPDATE j SET programme = regexp_extract(programme, '(\\d{3})', 1) WHERE programme IS NOT NULL")
        derived('associations', con, "SELECT year, siren, name, amount, object, programme, dept, city FROM j WHERE amount IS NOT NULL")
        years = [r[0] for r in con.execute('SELECT DISTINCT year FROM j ORDER BY 1').fetchall()]
        per_year = [dict(zip(['year', 'lines', 'amount', 'beneficiaries', 'withoutSiren', 'amountWithoutSiren', 'closed', 'amountClosed'], r)) for r in con.execute("""
            SELECT year, count(*), sum(amount), count(DISTINCT siren), count(*) FILTER (WHERE siren IS NULL), coalesce(sum(amount) FILTER (WHERE siren IS NULL), 0),
                   count(*) FILTER (WHERE closed), coalesce(sum(amount) FILTER (WHERE closed), 0)
            FROM j GROUP BY 1 ORDER BY 1""").fetchall()]
        programmes = {}
        for year, programme, amount, lines in con.execute('SELECT year, programme, sum(amount), count(*) FROM j GROUP BY 1, 2 ORDER BY 1, 3 DESC').fetchall():
            programmes.setdefault(str(year), []).append([programme or '?', round(amount or 0), lines])
        departments = {}
        for year, dept, amount, lines in con.execute("SELECT year, dept, sum(amount), count(*) FROM j WHERE dept IS NOT NULL GROUP BY 1, 2").fetchall():
            departments.setdefault(str(year), {})[dept] = [round(amount or 0), lines]
        top = {}
        for year, siren, name, amount, lines, dept, city in con.execute("""
            SELECT year, siren, any_value(name), sum(amount) AS total, count(*), any_value(dept), any_value(city) FROM j
            GROUP BY year, coalesce(siren, name), siren QUALIFY row_number() OVER (PARTITION BY year ORDER BY total DESC) <= 250""").fetchall():
            top.setdefault(str(year), []).append([siren, fix_text(name), round(amount or 0), lines, dept, fix_text(city)])
        for rows in top.values():
            rows.sort(key=lambda row: -row[2])
        # Grants recorded for a year after the establishment's SIRENE closure date (or closed with no date).
        # Programme 232 (public funding of political parties, set by law from votes and seats) is left out: a party's registered office changing is not a lead.
        closed = [[r[0], r[1], fix_text(r[2]), r[3], str(r[4]) if r[4] else None, fix_text(r[5]), r[6]] for r in con.execute("""
            SELECT year, siren, any_value(name), round(sum(amount)) AS total, min(closed_on), any_value(city), any_value(programme) FROM j
            WHERE closed AND (closed_on IS NULL OR closed_on < make_date(year, 1, 1)) AND coalesce(programme, '') <> '232' GROUP BY 1, 2 ORDER BY total DESC LIMIT 500""").fetchall()]
        write('associations.json', {'source': 'Annexes « jaunes » aux PLF 2012–2025 (Effort financier de l’État en faveur des associations)', 'years': years, 'perYear': per_year,
                                    'programmes': programmes, 'programmeLabels': labels, 'programmeMissions': missions, 'departments': departments, 'top': top, 'closedBeneficiaries': closed})
        index = [[r[0], fix_text(r[1]), *r[2:]] for r in con.execute("""
            SELECT siren, arg_max(name, year), round(sum(amount)), list(DISTINCT year ORDER BY year), any_value(dept)
            FROM j WHERE siren IS NOT NULL GROUP BY siren HAVING sum(amount) > 0 ORDER BY 3 DESC""").fetchall()]
        write('associations-index.json', {'fields': ['siren', 'name', 'total', 'years', 'dept'], 'rows': index})
        print(f'✓ associations: {sum(y["lines"] for y in per_year)} lignes, {len(index)} SIREN, années {years}')

    path = f'{RAW}/aides-minimis.csv.gz'
    if os.path.exists(path):
        con.execute(f"""CREATE TABLE m AS SELECT regime, nom_beneficiaire AS name, identifiant_beneficiaire AS id, TRY_CAST(montant_esb AS DOUBLE) AS amount,
            instrument_aide AS instrument, secteur_aide AS sector, commune_beneficiaire AS city, TRY_CAST(left(date_octroi, 4) AS INTEGER) AS year, autorite, operateur FROM {csv(path)}""")
        derived('minimis', con, 'SELECT year, id, name, amount, instrument, sector, city, autorite FROM m')
        summary = {
            'perYear': [list(r) for r in con.execute('SELECT year, count(*), sum(amount), count(DISTINCT id) FROM m GROUP BY 1 ORDER BY 1').fetchall()],
            'byAuthority': [list(r) for r in con.execute('SELECT autorite, count(*), sum(amount) FROM m GROUP BY 1 ORDER BY 3 DESC LIMIT 40').fetchall()],
            'byInstrument': [list(r) for r in con.execute('SELECT instrument, count(*), sum(amount) FROM m GROUP BY 1 ORDER BY 3 DESC').fetchall()],
            'bySector': [list(r) for r in con.execute('SELECT left(sector, 1), count(*), sum(amount) FROM m GROUP BY 1 ORDER BY 3 DESC').fetchall()],
            'top': [list(r) for r in con.execute('SELECT id, any_value(name), sum(amount) AS t, count(*), any_value(city) FROM m GROUP BY id ORDER BY t DESC LIMIT 300').fetchall()],
        }
        write('entreprises.json', {'source': 'Aides de minimis (data.economie.gouv.fr, aides_minimis)', **summary})
        print(f'✓ minimis: {con.execute("SELECT count(*), sum(amount) FROM m").fetchone()}')

    # Fonds vert: one CSV per year on data.gouv.fr; the 2023 file uses another layout. "p113" files cover programme 113 and are kept apart.
    manifest = json.load(open(f'{RAW}/manifest.json', encoding='utf-8')) if os.path.exists(f'{RAW}/manifest.json') else {}
    entries = [f for f in manifest.get('datagouv-fonds-vert', {}).get('files', []) if f['file'].endswith('.csv.gz')]
    parts = []
    for entry in entries:
        path = f"{RAW}/{entry['file']}"
        if not os.path.exists(path):
            continue

        match = re.search(r'(20\d\d)', entry.get('title', '') + entry.get('url', ''))
        if not match:
            continue
        year, programme = int(match.group(1)), ('113' if 'p113' in (entry.get('title', '') + entry.get('url', '')).lower() else '380')
        src = f"read_csv('{path}', delim=',', quote='\"', header=true, all_varchar=true, ignore_errors=true, max_line_size=10000000, normalize_names=true)"
        cols = {r[0] for r in con.execute(f'DESCRIBE SELECT * FROM {src}').fetchall()}
        pick = lambda *names: next((n for n in names if n in cols), 'NULL')
        parts.append(f"""SELECT {year} AS year, '{programme}' AS programme, TRY_CAST(replace({pick('montant_engage')}, ',', '.') AS DOUBLE) AS amount,
            {pick('demarche', 'nom_demarche_ds')} AS measure, lpad({pick('code_departement')}, 2, '0') AS dept, {pick('code_commune')} AS commune,
            left(regexp_replace(coalesce({pick('siret_beneficiaire')}, {pick('siren')}), '[^0-9]', '', 'g'), 9) AS siren,
            {pick('raison_sociale_beneficiaire', 'nom_beneficiaire_principal')} AS name, {pick('nom_du_projet')} AS project FROM {src}""")
    if parts:
        con.execute('CREATE TABLE fv AS ' + ' UNION ALL '.join(parts))
        derived('fonds-vert', con, 'SELECT year, programme, amount, measure, dept, commune, siren, name, project FROM fv')
        main = "programme = '380'"
        write('fonds-vert.json', {
            'source': 'Fonds vert : liste des projets subventionnés (data.gouv.fr)',
            'perYear': [list(r) for r in con.execute(f'SELECT year, count(*), sum(amount) FROM fv WHERE {main} GROUP BY 1 ORDER BY 1').fetchall()],
            'programme113': [list(r) for r in con.execute("SELECT year, count(*), sum(amount) FROM fv WHERE programme = '113' GROUP BY 1 ORDER BY 1").fetchall()],
            'byMeasure': [list(r) for r in con.execute(f'SELECT measure, count(*), sum(amount) FROM fv WHERE {main} GROUP BY 1 ORDER BY 3 DESC LIMIT 40').fetchall()],
            'byDepartment': {r[0]: [r[1], r[2]] for r in con.execute(f'SELECT dept, count(*), sum(amount) FROM fv WHERE {main} GROUP BY 1').fetchall() if r[0]},
            'top': [list(r) for r in con.execute(f'SELECT siren, any_value(name), sum(amount) AS t, count(*), list(DISTINCT year) FROM fv WHERE {main} AND siren IS NOT NULL GROUP BY 1 ORDER BY t DESC LIMIT 200').fetchall()],
            'topProjects': [list(r) for r in con.execute(f'SELECT year, siren, name, left(project, 160), measure, amount FROM fv WHERE {main} ORDER BY amount DESC LIMIT 100').fetchall()],
        })
        print(f'✓ fonds vert : {con.execute("SELECT count(*), sum(amount) FROM fv").fetchone()}')


if __name__ == '__main__':
    main()
