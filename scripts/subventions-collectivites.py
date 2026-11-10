"""Subventions attribuées par les collectivités et organismes publics -> dist/data/aides/collectivites*.json.

Il n'existe pas de fichier national : chaque collectivité publie (ou non) ses « données essentielles des conventions
de subvention » (décret 2017-779, schéma SCDL), obligatoires seulement au-dessus de 23 000 €. Ce script lit tous les
CSV moissonnés sur data.gouv.fr par `node scripts/fetch-sources.mjs --only=subventions-collectivites`
(sources/raw/subventions-collectivites/ + index.json), garde ceux dont les colonnes sont celles du schéma, et dit qui
publie et qui ne publie pas.

Sorties :
  sources/derived/subventions-collectivites.csv.gz   une ligne par subvention (lue par process_search.py)
  dist/data/aides/collectivites.json                 totaux, par année, par type d'attribuant, attribuants,
                                                     couverture des régions et des départements, compteurs de qualité
  dist/data/aides/collectivites-index.json           une ligne par bénéficiaire identifié par un SIREN (recherche)

Règles : aucun montant corrigé ni complété. Une ligne sans montant lisible ou sans bénéficiaire est comptée et écartée.
Une ligne strictement identique (attribuant, bénéficiaire, montant, date, objet) déjà lue dans un autre fichier est
une republication et n'est comptée qu'une fois. L'année est celle de la convention ; à défaut celle de la colonne
année ou exercice ; sinon la ligne reste sans année.

    python scripts/subventions-collectivites.py
"""
import collections
import csv
import datetime
import glob
import gzip
import io
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'sources', 'raw')
SRC = os.path.join(RAW, 'subventions-collectivites')
DERIVED = os.path.join(ROOT, 'sources', 'derived')
OUT = os.path.join(ROOT, 'dist', 'data', 'aides')
THRESHOLD = 23000          # legal publication threshold (décret 2017-779)
MAX_AMOUNT = 2e9           # above: a typing error or a total line, counted and left out
THIS_YEAR = datetime.date.today().year

csv.field_size_limit(1 << 26)


def norm(text):
    return re.sub(r'[^a-z0-9]', '', ''.join(c for c in unicodedata.normalize('NFD', str(text).lower()) if unicodedata.category(c) != 'Mn'))


# normalized header -> field. First match wins, in this order.
ALIASES = {
    'giver': ['nomattribuant', 'attribuant', 'nomdelattribuant', 'collnom'],
    'giver_id': ['idattribuant', 'siretattribuant', 'identifiantattribuant', 'collsiret'],
    'name': ['nombeneficiaire', 'nombenecifiaire', 'nombeneficiere', 'nomdubeneficiaire', 'beneficiaire', 'raisonsocialebeneficiaire', 'raisonsociale', 'nomraisonsociale',
             'tiersbeneficiaire', 'nomdutiers', 'nomdelassociation', 'association', 'organisme', 'attribnom', 'raison1'],
    'id': ['idbeneficiaire', 'siretbeneficiaire', 'identifiantbeneficiaire', 'identificationdubeneficiaire', 'identifiantdubeneficiaire',
           'numerodereferencementaurepertoiredesentreprises', 'attribsiret', 'numerosiret', 'nsiret', 'codesiret', 'codesirensiret', 'codesiren', 'numsiren', 'siret', 'siren'],
    'rna': ['rnabeneficiaire', 'idrna', 'rna'],
    'amount': ['montant', 'montantsubvention', 'montantdelasubvention', 'montanttotaldelasubvention', 'montantdelasubventioneuros', 'montantattribue', 'montantvote',
               'montantverse', 'montantordonnance', 'montantsubventionverseeeneuros', 'montantdelasubventionverseemontanteneuros', 'totalmontanteneuros',
               'montanteneuro', 'montanteuros', 'submontant', 'lasommeemtdel'],
    'object': ['objet', 'objetdelasubvention', 'objetdescriptif', 'objetdudossier', 'subobjet'],
    'date': ['dateconvention', 'datedeconvention', 'datedelaconventiondesubvention', 'ladateconv', 'datedecision', 'datededecision', 'datedeliberation'],
    'year': ['annee', 'exercice', 'anneebudgetaire', 'anneebudgetairedaffectationdelasubvention', 'anneeattribution', 'anneedeladecision'],
    'paid': ['datesperiodeversement', 'dateperiodeversement', 'dateversement', 'datesversement'],
    'nature': ['nature', 'naturedelasubvention', 'odnature'],
    'scheme': ['dispositifaide'],
}
# A file with one of these columns is a contract or budget file that happens to have an amount and a SIRET.
NOT_GRANTS = ('cpv', 'marche', 'acheteur', 'titulaire', 'procedure', 'bgt')

# Datasets published by a third party without the grantor in the file: dataset id -> (name, SIREN).
GIVER_BY_DATASET = {}
# Organisation names on data.gouv.fr that are harvesters, not grantors: never used as the grantor's name.
HARVESTERS = {'ressourcerie datalocale', 'gironde numerique', 'opendatafrance', 'data.gouv.fr', 'open data bourgogne'}


def decode(raw):
    for encoding in ('utf-8-sig', 'cp1252'):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode('latin-1')


def amount_of(text):
    """'23 000,50 €' or '23000.5' -> float; None when it is not a number."""
    t = str(text or '').replace(' ', '').replace(' ', '').replace(' ', '').replace('€', '').replace('EUR', '').strip()
    if not t:
        return None
    if ',' in t and '.' in t:
        t = t.replace('.', '').replace(',', '.') if t.rfind(',') > t.rfind('.') else t.replace(',', '')
    else:
        t = t.replace(',', '.')
    try:
        value = float(t)
    except ValueError:
        return None
    return value if value == value and abs(value) != float('inf') else None


YEAR = re.compile(r'(?<!\d)(20[0-2]\d|19[89]\d)(?!\d)')


def year_of(date, year, paid=''):
    """Year of the convention; failing that the year column; failing that the first payment date."""
    for text in (date, year, paid):
        text = str(text or '')
        m = (re.match(r'\s*(\d{4})-\d{1,2}', text) or re.match(r'\s*\d{1,2}[/.-]\d{1,2}[/.-](\d{4})', text) or re.fullmatch(r'\s*(\d{4})(?:\.0)?\s*', text)
             or re.fullmatch(r'\s*(\d{4})[01]\d[0-3]\d\s*', text))
        if not m:
            m = YEAR.search(text) if text and len(text) <= 24 else None
        if m and 2000 <= int(m.group(1)) <= THIS_YEAR + 1:
            return int(m.group(1))
    return None


def siren_of(text):
    digits = re.sub(r'\D', '', str(text or ''))
    return digits[:9] if len(digits) in (9, 14) else None


def clean(text, size=300):
    text = ' '.join(str(text or '').split())
    return text[:size]


def reference_sirens():
    """SIREN of every region and département, from the OFGL files of sources/raw (already used by the map)."""
    regions, departments = {}, {}
    for path, store, code, label in ((os.path.join(RAW, 'ofgl-regions.csv.gz'), regions, 'reg_code', 'reg_name'), (os.path.join(RAW, 'ofgl-departements.csv.gz'), departments, 'dep_code', 'dep_name')):
        if not os.path.exists(path):
            continue
        with gzip.open(path, 'rt', encoding='utf-8-sig', newline='') as handle:
            sample = handle.readline()
            handle.seek(0)
            reader = csv.DictReader(handle, delimiter=';' if sample.count(';') > sample.count(',') else ',')
            if not {'siren', code, label} <= set(reader.fieldnames or []):
                print(f'  · {os.path.basename(path)} : colonnes attendues absentes ({reader.fieldnames})')
                continue
            years = {}
            for row in reader:
                siren = siren_of(row['siren'])
                if siren and row[code]:
                    year = row.get('exer') or ''
                    if year >= years.get(row[code], ''):          # the latest SIREN of each territory (regions merged in 2016)
                        years[row[code]] = year
                        store[row[code]] = (siren, row[label])
    return regions, departments


def resolver(regions, departments):
    """Name of a grantor without a usable SIRET -> SIREN of the region or département it names, else None.
    'Conseil régional de Normandie', 'DEPARTEMENT DU MORBIHAN', 'Région Île-de-France'. The longest territory name
    wins (Loire, Haute-Loire, Loire-Atlantique)."""
    reg = sorted(((norm(name), siren) for siren, name in regions.values()), key=lambda x: -len(x[0]))
    dep = sorted(((norm(name), siren) for siren, name in departments.values()), key=lambda x: -len(x[0]))

    def resolve(name):
        n = norm(name)
        if 'region' in n and not any(w in n for w in ('prefecture', 'agence', 'direction', 'academie')):
            for key, siren in reg:
                if key in n:
                    return siren
        if any(w in n for w in ('departement', 'conseildepartemental', 'conseilgeneral')) and not any(w in n for w in ('prefecture', 'direction', 'service', 'agence', 'syndicat')):
            for key, siren in dep:
                if n.endswith(key):
                    return siren
        return None
    return resolve


def giver_type(siren, regions, departments, name=''):
    if siren in regions:
        return 'region'
    if siren in departments:
        return 'departement'
    if not siren:
        n = norm(name)
        if n.startswith(('ville', 'commune', 'mairie')):
            return 'commune'
        if any(w in n for w in ('metropole', 'communaute', 'agglomeration', 'syndicat')):
            return 'groupement'
        return 'inconnu'
    if siren.startswith('21'):
        return 'commune'
    if siren.startswith(('24', '20', '25')):
        return 'groupement'      # EPCI, métropoles, syndicats and other local public bodies
    if siren.startswith('1'):
        return 'etat'            # State and national public bodies
    return 'autre'


TYPE_LABELS = {'region': 'Régions', 'departement': 'Départements', 'commune': 'Communes', 'groupement': 'Intercommunalités et autres établissements locaux',
               'etat': 'État et établissements nationaux', 'autre': 'Autres organismes', 'inconnu': 'Attribuant sans identifiant'}


def main():
    index_path = os.path.join(SRC, 'index.json')
    if not os.path.exists(index_path):
        sys.exit('sources/raw/subventions-collectivites/index.json absent : lancer node scripts/fetch-sources.mjs --only=subventions-collectivites')
    index = json.load(open(index_path, encoding='utf-8'))
    regions, departments = reference_sirens()
    # The Métropole de Lyon is listed with the départements by the OFGL (code 691): here it is a grouping, the Rhône stays a département.
    departments = {code: v for code, v in departments.items() if len(code) <= 3 and code != '691'}
    resolve = resolver(regions, departments)
    region_sirens = {s: (code, name) for code, (s, name) in regions.items()}
    department_sirens = {s: (code, name) for code, (s, name) in departments.items()}
    known = set(region_sirens) | set(department_sirens)

    files = collections.Counter()
    quality = collections.Counter()
    seen = {}                                   # row key -> file that first carried it
    dead = {}                                   # SIREN of a region or département -> page of a file that no longer downloads
    rows_out = []
    rejected_headers = collections.Counter()
    per_file = []
    resources = sorted(index['resources'], key=lambda r: (r.get('organization') or '', r['dataset'], r['resource']))
    for position, res in enumerate(resources, 1):
        if position % 200 == 0:
            print(f'  {position}/{len(resources)} fichiers, {len(rows_out)} lignes', flush=True)
        path = os.path.join(SRC, res['file'])
        if res.get('bytes') is None or not os.path.exists(path):
            files['inaccessibles'] += 1
            if 'subvention' in norm(res.get('title') or ''):      # a subsidy file that is announced but cannot be downloaded
                owner = resolve(res.get('organization') or '') or resolve(res.get('title') or '')
                if owner:
                    dead.setdefault(owner, res['page'])
            continue
        try:
            with gzip.open(path, 'rb') as handle:
                head = handle.read(65536)        # the header decides: most files are not subsidy lists
                first = decode(head).split('\n', 1)[0]
                delimiter = max(';,\t|', key=first.count)
                header = [norm(c) for c in next(csv.reader([first], delimiter=delimiter))]
                col = {}
                for field, names in ALIASES.items():
                    for name in names:
                        if name in header:
                            col[field] = header.index(name)
                            break
                if 'amount' not in col or ('name' not in col and 'id' not in col) or any(mark in c for c in header for mark in NOT_GRANTS):
                    files['autres_formats'] += 1
                    rejected_headers[res.get('organization') or '?'] += 1
                    continue
                text = decode(head + handle.read())
            reader = csv.reader(io.StringIO(text, newline=''), delimiter=delimiter)
            next(reader)
        except (OSError, EOFError, csv.Error, StopIteration):
            files['illisibles'] += 1
            continue
        files['lus'] += 1
        org = res.get('organization') or ''
        fallback = GIVER_BY_DATASET.get(res['dataset']) or ((org, None) if norm(org) not in {norm(h) for h in HARVESTERS} else ('', None))
        kept = 0
        local = set()
        before = quality['sans_montant']
        try:
            for raw in reader:
                if not any(raw):
                    continue
                get = lambda f: raw[col[f]].strip() if f in col and col[f] < len(raw) else ''
                quality['lignes_lues'] += 1
                amount = amount_of(get('amount'))
                name = clean(get('name'), 160)
                siren = siren_of(get('id'))
                if amount is None:
                    quality['sans_montant'] += 1
                    continue
                if not name and not siren:
                    quality['sans_beneficiaire'] += 1
                    continue
                if abs(amount) > MAX_AMOUNT:
                    quality['montant_aberrant'] += 1
                    continue
                if amount == 0:
                    quality['montant_nul'] += 1
                    continue
                giver = clean(get('giver'), 140) or fallback[0]
                giver_siren = siren_of(get('giver_id')) or fallback[1] or resolve(giver)
                if not giver and not giver_siren:
                    quality['sans_attribuant'] += 1
                    continue
                year = year_of(get('date'), get('year'), get('paid'))
                obj = clean(get('object'), 300)
                key = (giver_siren or norm(giver), siren or norm(name), round(amount, 2), get('date'), norm(obj)[:80])
                if key in seen and seen[key] != res['file'] and key not in local:
                    quality['republications'] += 1
                    continue
                seen.setdefault(key, res['file'])
                local.add(key)
                if amount < 0:
                    quality['montants_negatifs'] += 1
                if not siren:
                    quality['sans_siren'] += 1
                if year is None:
                    quality['sans_annee'] += 1
                rows_out.append((giver_siren or '', giver, giver_type(giver_siren, region_sirens, department_sirens, giver), siren or '', name, amount, year or '', obj,
                                 clean(get('nature'), 60), clean(get('scheme'), 120), res['dataset'], res['page']))
                kept += 1
        except csv.Error:
            quality['fichiers_tronques'] += 1
        per_file.append((res['file'], org, kept, quality['sans_montant'] - before, res['title']))

    if not rows_out:
        sys.exit('Aucune ligne de subvention lue.')

    # ---- one name per grantor SIREN (the most frequent spelling), one per beneficiary SIREN
    giver_names = collections.defaultdict(collections.Counter)
    benef_names = collections.defaultdict(collections.Counter)
    for g_siren, giver, _, siren, name, *_ in rows_out:
        if g_siren and giver:
            giver_names[g_siren][giver] += 1
        if siren and name:
            benef_names[siren][name.upper()] += 1
    giver_label = {s: (region_sirens.get(s) or department_sirens.get(s) or (None, None))[1] or c.most_common(1)[0][0] for s, c in giver_names.items()}
    benef_label = {s: c.most_common(1)[0][0] for s, c in benef_names.items()}

    os.makedirs(DERIVED, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    with gzip.open(os.path.join(DERIVED, 'subventions-collectivites.csv.gz'), 'wt', encoding='utf-8', newline='') as handle:
        writer = csv.writer(handle, lineterminator='\n')
        writer.writerow(['attribuant_siren', 'attribuant', 'attribuant_type', 'beneficiaire_siren', 'beneficiaire', 'montant', 'annee', 'objet', 'nature', 'dispositif', 'jeu_de_donnees', 'page'])
        for row in rows_out:
            row = list(row)
            row[1] = giver_label.get(row[0], row[1])
            writer.writerow(row)

    # ---- aggregates
    def agg():
        return {'lines': 0, 'amount': 0.0, 'years': set(), 'under': 0, 'min': None, 'benef': set(), 'pages': set()}
    givers = collections.defaultdict(agg)
    per_year = collections.defaultdict(lambda: {'lines': 0, 'amount': 0.0, 'givers': set(), 'benef': set()})
    per_type = collections.defaultdict(lambda: {'lines': 0, 'amount': 0.0, 'givers': set()})
    benef = collections.defaultdict(lambda: {'total': 0.0, 'years': set(), 'givers': set(), 'lines': 0})
    for g_siren, giver, gtype, siren, name, amount, year, obj, nature, scheme, dataset, page in rows_out:
        gkey = g_siren or 'nom:' + norm(giver)
        g = givers[gkey]
        g['name'], g['siren'], g['type'] = giver_label.get(g_siren, giver), g_siren, gtype
        g['lines'] += 1
        g['amount'] += amount
        g['pages'].add(page)
        g['benef'].add(siren or norm(name))
        if year:
            g['years'].add(year)
        if 0 < amount < THRESHOLD:
            g['under'] += 1
        if amount > 0 and (g['min'] is None or amount < g['min']):
            g['min'] = amount
        y = per_year[year or 0]
        y['lines'] += 1
        y['amount'] += amount
        y['givers'].add(gkey)
        y['benef'].add(siren or norm(name))
        t = per_type[gtype]
        t['lines'] += 1
        t['amount'] += amount
        t['givers'].add(gkey)
        if siren:
            b = benef[siren]
            b['total'] += amount
            b['lines'] += 1
            b['givers'].add(gkey)
            if year:
                b['years'].add(year)

    def giver_row(g):
        return {'name': g['name'], 'siren': g['siren'] or None, 'type': g['type'], 'lines': g['lines'], 'amount': round(g['amount']), 'beneficiaries': len(g['benef']),
                'years': sorted(g['years']), 'underThreshold': g['under'], 'min': round(g['min']) if g['min'] is not None else None, 'pages': sorted(g['pages'])[:3]}

    def coverage(reference):
        out = []
        for code, (siren, name) in sorted(reference.items()):
            g = givers.get(siren)
            out.append({'code': code, 'name': name, 'siren': siren, 'published': bool(g), **({'deadLink': dead[siren]} if not g and siren in dead else {}), **({k: v for k, v in giver_row(g).items() if k in ('lines', 'amount', 'years', 'underThreshold', 'min', 'pages')} if g else {})})
        return out

    reg_cov, dep_cov = coverage(regions), coverage(departments)
    total_amount = sum(r[5] for r in rows_out)
    result = {
        'generated': datetime.date.today().isoformat(),
        'downloaded': index.get('downloadedAt', '')[:10],
        'source': 'data.gouv.fr : jeux de données déclarant le schéma SCDL « subventions », portant les mots-clés scdl, subvention ou subventions, ou répondant à la recherche « subvention »',
        'threshold': THRESHOLD,
        'files': {'datasets': index.get('datasets'), 'csv': len(resources), 'read': files['lus'], 'otherFormats': files['autres_formats'], 'unreachable': files['inaccessibles'], 'unreadable': files['illisibles']},
        'totals': {'lines': len(rows_out), 'amount': round(total_amount), 'givers': len(givers), 'beneficiaries': len(benef), 'withoutSiren': quality['sans_siren'], 'withoutYear': quality['sans_annee']},
        'quality': {'read': quality['lignes_lues'], 'noAmount': quality['sans_montant'], 'zero': quality['montant_nul'], 'noBeneficiary': quality['sans_beneficiaire'], 'noGiver': quality['sans_attribuant'],
                    'aberrant': quality['montant_aberrant'], 'republished': quality['republications'], 'negative': quality['montants_negatifs'], 'truncatedFiles': quality['fichiers_tronques']},
        'perYear': [{'year': y or None, 'lines': v['lines'], 'amount': round(v['amount']), 'givers': len(v['givers']), 'beneficiaries': len(v['benef'])} for y, v in sorted(per_year.items())],
        'types': [{'type': t, 'label': TYPE_LABELS[t], 'givers': len(v['givers']), 'lines': v['lines'], 'amount': round(v['amount'])} for t, v in sorted(per_type.items(), key=lambda kv: -kv[1]['amount'])],
        'givers': [giver_row(g) for g in sorted(givers.values(), key=lambda g: -g['amount'])[:400]],
        'regions': reg_cov, 'departments': dep_cov,
        'coverage': {'regions': [sum(1 for r in reg_cov if r['published']), len(reg_cov)], 'departments': [sum(1 for r in dep_cov if r['published']), len(dep_cov)],
                     'communes': sum(1 for g in givers.values() if g['type'] == 'commune'), 'groupements': sum(1 for g in givers.values() if g['type'] == 'groupement')},
    }
    with open(os.path.join(OUT, 'collectivites.json'), 'w', encoding='utf-8') as handle:
        json.dump(result, handle, ensure_ascii=False, separators=(',', ':'))
    rows = sorted(([s, benef_label.get(s, ''), round(b['total']), sorted(b['years']), len(b['givers']), b['lines']] for s, b in benef.items()), key=lambda r: -r[2])
    with open(os.path.join(OUT, 'collectivites-index.json'), 'w', encoding='utf-8') as handle:
        json.dump({'fields': ['siren', 'name', 'total', 'years', 'givers', 'lines'], 'rows': rows}, handle, ensure_ascii=False, separators=(',', ':'))

    c = result['coverage']
    print(f'subventions des collectivités : {files["lus"]} fichiers lus sur {len(resources)} ({files["autres_formats"]} dans un autre format, {files["inaccessibles"]} inaccessibles), '
          f'{len(rows_out):,} lignes, {total_amount / 1e9:.2f} Md€, {len(givers)} attribuants, {len(benef):,} bénéficiaires avec SIREN'.replace(',', ' '))
    print(f'  régions qui publient : {c["regions"][0]}/{c["regions"][1]} ; départements : {c["departments"][0]}/{c["departments"][1]} ; communes : {c["communes"]} ; groupements : {c["groupements"]}')
    print('  qualité :', dict(quality))
    worst = sorted(per_file, key=lambda f: -f[3])[:5]
    print('  fichiers avec le plus de lignes sans montant :', [(f[1], f[4][:50], f[3], f[2]) for f in worst if f[3]])
    no_id = sorted(((g['lines'], g['name']) for g in givers.values() if not g['siren']), reverse=True)[:12]
    if no_id:
        print('  attribuants sans SIRET (nom de l’organisation data.gouv.fr) :', no_id)


if __name__ == '__main__':
    main()
