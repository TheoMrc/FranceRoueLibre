"""Who holds which mandate, from the Répertoire national des élus (RNE, ministère de l'Intérieur, data.gouv.fr), for la
Loupe and the search: the mayor of each commune, and an index of the elected people a reader may name (mayors,
departmental and regional councillors, presidents of intercommunalities, deputies, senators, members of the European
Parliament elected in France). Names, mandates, functions and their start dates only: no birth date, no profession.

  node scripts/fetch-sources.mjs --only=datagouv-rne
  python3 scripts/elus-data.py

Writes dist/data/elus/maires.json and dist/data/elus/personnes.json.
"""
import csv
import datetime
import gzip
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'sources' / 'raw'
OUT = ROOT / 'dist' / 'data' / 'elus'
PAGE = 'https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1/'
FILES = {'elus-maires-mai.csv': 'maires', 'elus-conseillers-departementaux-cd.csv': 'departementaux',
         'elus-conseillers-regionaux-cr.csv': 'regionaux', 'elus-membres-assemblee-ma.csv': 'assemblees',
         'elus-conseillers-communautaires-epci.csv': 'communautaires', 'elus-deputes-dep.csv': 'deputes',
         'elus-senateurs-sen.csv': 'senateurs', 'elus-representants-Parlement-européen-rpe.csv': 'europeens',
         'elus-conseillers-municipaux-cm.csv': 'municipaux'}
MONTHS = 'janvier février mars avril mai juin juillet août septembre octobre novembre décembre'.split()
PARTICLES = {'de', 'du', 'des', 'd'}


def norm(text):
    s = unicodedata.normalize('NFD', str(text or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(re.findall(r'[a-z0-9]+', s))


def surname(name):
    """« LE MAIRE » → « Le Maire », « DE VILLEPIN » → « de Villepin », « BLATRIX CONTAT » → « Blatrix Contat »."""
    parts = re.split(r"([\s'’-])", str(name or '').strip().lower())
    out = []
    for p in parts:
        if p in PARTICLES and out:
            out.append(p)
        elif p in PARTICLES:
            out.append(p)
        else:
            out.append(p[:1].upper() + p[1:])
    return ''.join(out)


def date_fr(iso):
    try:
        d = datetime.date.fromisoformat(str(iso)[:10])
    except ValueError:
        return ''
    return f'{d.day}{"er" if d.day == 1 else ""} {MONTHS[d.month - 1]} {d.year}'


def rows(file):
    with gzip.open(RAW / file['file'], 'rt', encoding='utf-8-sig', newline='') as handle:
        yield from csv.DictReader(handle, delimiter=';')


def main():
    manifest = json.loads((RAW / 'manifest.json').read_text(encoding='utf8'))
    entry = manifest.get('datagouv-rne')
    if not entry:
        raise SystemExit('Répertoire national des élus absent : node scripts/fetch-sources.mjs --only=datagouv-rne')
    files = {FILES[f['title']]: f for f in entry['files'] if f['title'] in FILES}
    missing = set(FILES.values()) - set(files)
    if missing:
        raise SystemExit(f'Fichiers du RNE absents : {sorted(missing)}')
    updated = max(f['modified'] for f in files.values())[:10]
    successors = json.loads((ROOT / 'sources' / 'communes-successeurs-2025.json').read_text(encoding='utf8'))['map']
    meta = json.loads((ROOT / 'dist' / 'data' / 'web' / 'communes-meta.json').read_text(encoding='utf8'))
    known = {r[0] for r in meta['rows']}

    people = {}

    def add(first, last, mandate):
        display = f'{first.strip()} {surname(last)}'.strip()
        key = norm(display)
        if not key:
            return
        p = people.setdefault(key, {'nom': display, 'mandats': []})
        if mandate not in p['mandats']:
            p['mandats'].append(mandate)

    mayors, unmatched = {}, 0
    for r in rows(files['maires']):
        code = successors.get(r['Code de la commune'], r['Code de la commune'])
        first, last = r["Prénom de l'élu"], r["Nom de l'élu"]
        name = f'{first.strip()} {surname(last)}'
        since = r.get('Date de début de la fonction') or r.get('Date de début du mandat') or ''
        if code not in known:
            unmatched += 1
        if code in mayors and r['Code de la commune'] != code:
            continue   # a former commune's delegate mayor never replaces the mayor of the commune of today
        mayors[code] = [name, since, r['Libellé de la commune']]
        add(r["Prénom de l'élu"], r["Nom de l'élu"], ['maire', r['Libellé de la commune'], r['Code du département'], code,
                                                       'Maire', since])
    # deputy mayors of the communes of 20 000 inhabitants and more: readers name them too
    pop = json.loads((ROOT / 'dist' / 'data' / 'local' / 'communes' / '_pop.json').read_text(encoding='utf8'))
    last_pop = pop['values'][-1]   # aligned with communes-meta.json rows
    big = {r[0] for r, p in zip(meta['rows'], last_pop) if (p or 0) >= 20000}
    for r in rows(files['municipaux']):
        fn = (r.get('Libellé de la fonction') or '').strip()
        code = successors.get(r['Code de la commune'], r['Code de la commune'])
        if 'adjoint' in fn.lower() and code in big:
            add(r["Prénom de l'élu"], r["Nom de l'élu"], ['adjoint', r['Libellé de la commune'], r['Code du département'], code,
                                                           fn, r.get('Date de début de la fonction') or ''])
    for r in rows(files['departementaux']):
        fn = (r.get('Libellé de la fonction') or '').strip() or 'Conseiller départemental'
        add(r["Prénom de l'élu"], r["Nom de l'élu"], ['departemental', r['Libellé du département'], r['Code du département'],
                                                       r['Libellé du canton'], fn, r.get('Date de début de la fonction') or r['Date de début du mandat']])
    for r in rows(files['regionaux']):
        fn = (r.get('Libellé de la fonction') or '').strip() or 'Conseiller régional'
        add(r["Prénom de l'élu"], r["Nom de l'élu"], ['regional', r['Libellé de la région'], r['Code de la région'], '', fn,
                                                       r.get('Date de début de la fonction') or r['Date de début du mandat']])
    for r in rows(files['assemblees']):
        fn = (r.get('Libellé de la fonction') or '').strip() or 'Membre de l’assemblée'
        add(r["Prénom de l'élu"], r["Nom de l'élu"], ['assemblee', r['Libellé de la collectivité à statut particulier'],
                                                       r['Code de la collectivité à statut particulier'], '', fn,
                                                       r.get('Date de début de la fonction') or r['Date de début du mandat']])
    for r in rows(files['communautaires']):
        fn = (r.get('Libellé de la fonction') or '').strip()
        if fn.lower().startswith('président'):
            add(r["Prénom de l'élu"], r["Nom de l'élu"], ['epci', r["Libellé de l'EPCI"], r['Code du département'], r['N° SIREN'],
                                                           fn, r.get('Date de début de la fonction') or ''])
    for r in rows(files['deputes']):
        add(r["Prénom de l'élu"], r["Nom de l'élu"], ['depute', f'{r["Libellé du département"]}, {r["Libellé de la circonscription législative"].lower()}',
                                                       r['Code du département'], r['Code de la circonscription législative'], 'Député',
                                                       r['Date de début du mandat']])
    for r in rows(files['senateurs']):
        add(r["Prénom de l'élu"], r["Nom de l'élu"], ['senateur', r['Libellé du département'] or r['Libellé de la collectivité à statut particulier'],
                                                       r['Code du département'], '', 'Sénateur', r['Date de début du mandat']])
    for r in rows(files['europeens']):
        add(r["Prénom de l'élu"], r["Nom de l'élu"], ['europeen', 'France', '', '', 'Député européen', r['Date de début du mandat']])

    OUT.mkdir(parents=True, exist_ok=True)
    head = {'source': 'Répertoire national des élus (ministère de l’Intérieur)', 'url': PAGE, 'miseAJour': updated,
            'miseAJourTexte': date_fr(updated)}
    (OUT / 'maires.json').write_text(json.dumps(dict(head, columns=['nom', 'depuis', 'commune_rne'],
                                                     communes={k: v for k, v in sorted(mayors.items())}),
                                                ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    plist = sorted(people.values(), key=lambda p: norm(p['nom']))
    (OUT / 'personnes.json').write_text(json.dumps(dict(head, columns=['type', 'lieu', 'code', 'detail', 'fonction', 'depuis'],
                                                        personnes=[[p['nom'], p['mandats']] for p in plist]),
                                                   ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    kinds = {}
    for p in plist:
        for m in p['mandats']:
            kinds[m[0]] = kinds.get(m[0], 0) + 1
    print(f'RNE du {updated} : {len(mayors)} maires ({unmatched} hors des communes du site), {len(plist)} personnes, mandats {kinds}')


if __name__ == '__main__':
    main()
