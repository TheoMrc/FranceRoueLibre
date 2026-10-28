"""Full-text search over every published spending line → dist/data/search/frl-search.sqlite3 (+ meta.json).

Corpus (one row per spending line):
  1 associations  State grants to associations (annexes « jaunes », 2010–2023): object, association, programme
  2 marchés       public contracts (DECP 2014–2026): object, buyer, CPV label; framework agreements flagged (ceilings, not spending)
  3 projets       State-funded local investment projects (DGCL 2025): title, commune, scheme
  4 fonds vert    Fonds vert projects (2023–2025): project, beneficiary, measure
  5 entreprises   de minimis aid (2026): company, sector, granting authority
  6 budget État   lines of the 2026 budget bill tagged by the green budget (PLF 2026 amounts): label, programme

The browser queries the database through HTTP range requests (vendor/sql.js-httpvfs), so only the pages a query
needs are downloaded. Tables:
  doc(id, src, year, amount, fw, title, who, siren, extra, dept)   one line of spending
  fts                                                              FTS5 index on title, who, extra (accents ignored)
  term(norm, display, df)                                          vocabulary for the suggestions
  stat(norm, src, year, fw, n, amount)                             precomputed totals for very frequent words
  top(norm, rank, id)                                              precomputed largest lines for very frequent words
Requires: Python's sqlite3 with FTS5, duckdb. Inputs: sources/derived/*.parquet (written by process_subsidies.py and
process_procurement.py), dist/data/web/projects-2025.json, sources/raw/plf26-budget-vert.csv.gz.
Run: python scripts/process_search.py
"""
import collections
import json
import os
import re
import sqlite3
import sys
import unicodedata

import duckdb

from rawfiles import csv as raw_csv

OUT_DIR = 'dist/data/search'
DB = f'{OUT_DIR}/frl-search.sqlite3'
DERIVED = 'sources/derived'
SOURCES = {1: 'Subventions aux associations', 2: 'Marchés publics', 3: 'Projets aidés par l’État (DGCL)', 4: 'Fonds vert', 5: 'Aides aux entreprises (de minimis)', 6: 'Budget de l’État (PLF 2026)'}
FREQUENT = 1500          # words found in more lines than this get precomputed totals and top lines
TOP = 60
WORD = re.compile(r"[^\W\d_]{3,}", re.UNICODE)


def norm(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if unicodedata.category(c) != 'Mn')


def clip(value, size):
    if value is None:
        return None
    value = ' '.join(str(value).split())
    return value[:size] if value else None


def main():
    probe = sqlite3.connect(':memory:')
    try:
        probe.execute("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='unicode61 remove_diacritics 2')")
    except sqlite3.OperationalError:
        sys.exit('Le module sqlite3 de ce Python n’a pas FTS5 : installez Python 3.11+ depuis python.org ou utilisez « pip install pysqlite3-binary ».')
    os.makedirs(OUT_DIR, exist_ok=True)
    if os.path.exists(DB):
        os.remove(DB)
    db = sqlite3.connect(DB)
    db.executescript('''PRAGMA page_size = 4096; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
        CREATE TABLE doc (id INTEGER PRIMARY KEY, src INTEGER, year INTEGER, amount REAL, fw INTEGER, title TEXT, who TEXT, siren TEXT, extra TEXT, dept TEXT);''')
    duck = duckdb.connect()
    rows = []

    def flush():
        db.executemany('INSERT INTO doc (src, year, amount, fw, title, who, siren, extra, dept) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', rows)
        rows.clear()

    def add(*row):
        rows.append(row)
        if len(rows) >= 50000:
            flush()

    # 1. Associations
    labels = {}
    if os.path.exists('dist/data/aides/associations.json'):
        labels = json.load(open('dist/data/aides/associations.json', encoding='utf-8')).get('programmeLabels', {})
    path = f'{DERIVED}/associations.parquet'
    if os.path.exists(path):
        for year, siren, name, amount, obj, programme, dept, city in duck.execute(f"SELECT year, siren, name, amount, object, programme, dept, city FROM '{path}'").fetchall():
            extra = f'Programme {programme} · {labels[programme]}' if programme in labels else (f'Programme {programme}' if programme else None)
            add(1, year, amount, 0, clip(obj, 300) or clip(name, 200), clip(name, 160), siren, extra, dept)
        flush()
    # 2. Contracts
    path = f'{DERIVED}/decp.parquet'
    if os.path.exists(path):
        cpv = json.load(open('sources/cpv-2008-fr.json', encoding='utf-8')) if os.path.exists('sources/cpv-2008-fr.json') else {}
        names = json.load(open(f'{DERIVED}/buyer-names.json', encoding='utf-8')) if os.path.exists(f'{DERIVED}/buyer-names.json') else {}
        # Some buyers publish a budget name instead of their own ("BUDGET PRINCIPAL", "BA EAU"…): left blank, the page resolves the SIREN.
        generic = re.compile(r'^(budget|bp|ba|b\.?a\.?|budget annexe|service|direction|régie|regie|pôle|pole)\b', re.I)
        names = {siren: name for siren, name in names.items() if name and not generic.match(name.strip())}
        for year, buyer, supplier, amount, obj, code, framework in duck.execute(f"SELECT year, buyer_siren, supplier, amount, object, cpv, framework FROM '{path}'").fetchall():
            label = cpv.get(code) or cpv.get((code or '')[:3].ljust(8, '0'))
            add(2, year, amount, 1 if framework else 0, clip(obj, 260), clip(names.get(buyer), 120), buyer, label, None)
        flush()
    # 3. DGCL projects
    path = 'dist/data/web/projects-2025.json'
    if os.path.exists(path):
        projects = json.load(open(path, encoding='utf-8'))
        for scheme, dept, commune, insee, title, amount in projects['rows']:
            add(3, 2025, amount, 0, clip(title, 300), clip(commune, 120), None, projects['schemes'][scheme - 1] if isinstance(scheme, int) and scheme >= 1 else None, dept)
        flush()
    # 4. Fonds vert
    path = f'{DERIVED}/fonds-vert.parquet'
    if os.path.exists(path):
        for year, programme, amount, measure, dept, siren, name, project in duck.execute(f"SELECT year, programme, amount, measure, dept, siren, name, project FROM '{path}'").fetchall():
            add(4, year, amount, 0, clip(project, 300) or clip(measure, 200), clip(name, 160), siren, clip(measure, 160), dept)
        flush()
    # 5. De minimis
    path = f'{DERIVED}/minimis.parquet'
    if os.path.exists(path):
        for year, ident, name, amount, instrument, sector, city, authority in duck.execute(f"SELECT year, id, name, amount, instrument, sector, city, autorite FROM '{path}'").fetchall():
            add(5, year, amount, 0, clip(f'{instrument or "Aide"} · {sector or ""}', 200), clip(name, 160), (ident or '')[:9] or None, clip(authority, 160), None)
        flush()
    # 6. State budget lines (budget vert, PLF 2026)
    src = raw_csv('plf26-budget-vert')
    if src:
        for kind, mission, programme, label, amount in duck.execute(f'''SELECT type_depense, mission, programme, libelle, TRY_CAST(replace(plf_2026_cp_ou_prevision_2026_si_depense_fiscale, ',', '.') AS DOUBLE)
                FROM {src}''').fetchall():
            add(6, 2026, amount, 0, clip(label, 300), clip(programme, 160), None, clip(f'{kind} · {mission}', 200), None)
        flush()
    total = db.execute('SELECT count(*) FROM doc').fetchone()[0]
    print(f'· {total} lignes')

    db.executescript('''CREATE VIRTUAL TABLE fts USING fts5(title, who, extra, content='doc', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
        INSERT INTO fts (rowid, title, who, extra) SELECT id, title, who, extra FROM doc;
        INSERT INTO fts (fts) VALUES ('optimize');''')

    # Vocabulary with a readable (accented) spelling: the most frequent original form of each normalised word.
    forms = collections.defaultdict(collections.Counter)
    for title, who, extra in db.execute('SELECT title, who, extra FROM doc'):
        for text in (title, who, extra):
            if text:
                for word in WORD.findall(text):
                    lower = word.lower()
                    forms[norm(lower)][lower] += 1
    db.execute('CREATE VIRTUAL TABLE vocab USING fts5vocab(fts, row)')
    db.execute('CREATE TABLE term (norm TEXT PRIMARY KEY, display TEXT, df INTEGER) WITHOUT ROWID')
    terms = [(term, forms[term].most_common(1)[0][0] if forms.get(term) else term, df) for term, df in db.execute('SELECT term, doc FROM vocab WHERE length(term) >= 3 AND doc >= 2')]
    db.executemany('INSERT INTO term VALUES (?, ?, ?)', terms)
    db.execute('DROP TABLE vocab')
    print(f'· {len(terms)} mots')

    # Frequent words: totals and largest lines precomputed (a live query would have to read too many pages).
    db.executescript('''CREATE TABLE stat (norm TEXT, src INTEGER, year INTEGER, fw INTEGER, n INTEGER, amount REAL);
        CREATE TABLE top (norm TEXT, rank INTEGER, id INTEGER, PRIMARY KEY (norm, rank)) WITHOUT ROWID;''')
    frequent = [t for t, _, df in terms if df > FREQUENT]
    for term in frequent:
        query = f'"{term}"'
        db.execute('INSERT INTO stat SELECT ?, src, year, fw, count(*), sum(amount) FROM doc WHERE id IN (SELECT rowid FROM fts WHERE fts MATCH ?) GROUP BY 2, 3, 4', (term, query))
        db.execute('INSERT INTO top SELECT ?, row_number() OVER (ORDER BY amount DESC), id FROM doc WHERE fw = 0 AND id IN (SELECT rowid FROM fts WHERE fts MATCH ?) ORDER BY amount DESC LIMIT ?', (term, query, TOP))
    db.execute('CREATE INDEX stat_norm ON stat (norm)')
    print(f'· {len(frequent)} mots fréquents précalculés')

    db.commit()
    db.execute('VACUUM')
    db.close()
    meta = {'sources': SOURCES, 'lines': total, 'frequentThreshold': FREQUENT, 'size': os.path.getsize(DB), 'pageSize': 4096,
            'note': 'Recherche dans les libellés publiés (objet du marché, objet de la subvention, titre du projet, nom du bénéficiaire, programme). Un mot trouvé dans un libellé ne signifie pas que tout le montant y est consacré.'}
    json.dump(meta, open(f'{OUT_DIR}/meta.json', 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'✓ recherche : {total} lignes, {meta["size"] / 1e6:.0f} Mo')


if __name__ == '__main__':
    main()
