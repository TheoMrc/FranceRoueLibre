"""Opérateurs de l'État: builds dist/data/operateurs.json from three open files already in sources/raw.

  - datagouv-operateurs-2026: the list of operators annexed to the PLF 2026 (« jaune » Opérateurs de l'État):
    name, category, legal status, mission and lead programme (« programme chef de file »). Nothing else: the file
    carries no amount and no headcount.
  - plf25-depenses-nature: PLF 2025 credits by programme and nature; category 32 = subventions pour charges de service
    public (SCSP), the State's main payment to its operators. Known by programme only, never by operator.
  - plf24-taxes-affectees: list of earmarked taxes (Voies et moyens, tome 1, PLF 2024): yield, ceiling and amount paid
    back to the State budget above the ceiling, by beneficiary, for 2022 (executed), 2023 and 2024 (forecasts).

Nothing is estimated: a programme's SCSP is never split between its operators, and a tax is only attached to an
operator whose name or acronym matches the beneficiary exactly.

    python3 scripts/operateurs-data.py
"""
import csv
import gzip
import io
import json
import pathlib
import re
import unicodedata
from collections import Counter, defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / 'sources' / 'raw'
OUT = ROOT / 'dist' / 'data' / 'operateurs.json'

STATUTS = {
    'EPA': 'Établissement public administratif',
    'EPSCP': 'Établissement public à caractère scientifique, culturel et professionnel',
    'EPIC': 'Établissement public industriel et commercial',
    'GIP': 'Groupement d’intérêt public',
    'EPST': 'Établissement public à caractère scientifique et technologique',
    'Association': 'Association',
    'Fondation': 'Fondation',
    'sui generis': 'Statut particulier (sui generis)',
    'GIE': 'Groupement d’intérêt économique',
    'SAS': 'Société par actions simplifiée',
}


def norm(s):
    s = unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def num(v):
    try:
        return float(v) if v not in ('', None) else None
    except ValueError:
        return None


def rows(name, encoding='utf-8'):
    text = gzip.open(RAW / name).read().decode(encoding)
    return list(csv.reader(io.StringIO(text), delimiter=';'))


def manifest():
    m = json.loads((RAW / 'manifest.json').read_text(encoding='utf-8'))
    out = {}
    for key in ('datagouv-operateurs-2026', 'plf25-depenses-nature', 'plf24-taxes-affectees'):
        f = m[key]['files'][0]
        out[key] = {'url': f['url'], 'modified': f.get('modified'), 'downloadedAt': m[key].get('downloadedAt'),
                    'page': (f"https://www.data.gouv.fr/datasets/{m[key]['slug']}" if m[key].get('slug')
                             else f"https://data.economie.gouv.fr/explore/dataset/{m[key]['dataset']}/")}
    return out


def read_operators():
    data = rows('datagouv-operateurs-2026--1.csv.gz', 'cp1252')
    head, body = data[0], data[1:]
    assert head[:4] == ['Opérateur ou catégorie d\'opérateurs', 'Opérateur de la catégorie', 'Statut',
                        'Mission et Programme chefs de file'], head
    ops = []
    for i, (group, member, statut, mp, plf) in enumerate(body):
        mission, _, prog = mp.partition('\n')
        code, _, label = prog.partition('–')
        category = group.strip() if member.strip() else None
        name = (member or group).strip()
        acronym, full = None, name
        if not category and ' - ' in name:
            a, _, rest = name.partition(' - ')
            if len(a) <= 12:
                acronym, full = a.strip(), rest.strip()
        ops.append({'id': i + 1, 'name': name, 'acronym': acronym, 'full': full, 'category': category,
                    'statut': statut.strip(), 'mission': mission.strip(), 'programme': code.strip(),
                    'programmeLabel': label.strip(), 'plf': plf.strip()})
    # A category listed without a member name keeps a readable label.
    for o in ops:
        if o['category'] is None and o['name'] in {x['category'] for x in ops if x['category']}:
            o['category'] = o['name']
            o['name'] = f"{o['name']} (ligne sans nom d’établissement)"
            o['unnamed'] = True
    return ops


def read_programmes():
    data = rows('plf25-depenses-nature.csv.gz')
    head = data[0]
    ix = {k: head.index(k) for k in ('type_mission', 'mission', 'programme', 'libelle_programme', 'categorie', 'ae_plf', 'cp_plf', 'ministere')}
    progs = {}
    scsp_total = {'ae': 0.0, 'cp': 0.0}
    for r in data[1:]:
        code = str(int(float(r[ix['programme']])))
        p = progs.setdefault(code, {'code': code, 'label': r[ix['libelle_programme']].strip(), 'mission': r[ix['mission']].strip(),
                                     'type': r[ix['type_mission']], 'ministeres': Counter(), 'scspCp': 0.0, 'scspAe': 0.0, 'cp': 0.0})
        cp = num(r[ix['cp_plf']]) or 0.0
        p['ministeres'][r[ix['ministere']].strip()] += 1
        p['cp'] += cp
        if r[ix['categorie']] in ('32', '32.0'):
            p['scspCp'] += cp
            p['scspAe'] += num(r[ix['ae_plf']]) or 0.0
            scsp_total['cp'] += cp
            scsp_total['ae'] += num(r[ix['ae_plf']]) or 0.0
    for p in progs.values():
        p['ministere'] = p['ministeres'].most_common(1)[0][0]
        p['ministereCount'] = len(p['ministeres'])
        del p['ministeres']
    return progs, scsp_total


def read_taxes():
    data = rows('plf24-taxes-affectees.csv.gz')
    head = data[0]
    col = {k: i for i, k in enumerate(head)}
    out = []
    for r in data[1:]:
        if r[col['nature_juridique_du_beneficiaire']] == 'Secteur':
            continue  # second header line inside the file
        def y(a, b, c):
            rend, plaf, rev = num(r[col[a]]), num(r[col[b]]), num(r[col[c]])
            kept = None if rend is None else rend - (rev or 0.0)
            return {'yield': rend, 'ceiling': plaf, 'returned': rev, 'kept': kept}
        out.append({'type': r[col['empty']].strip(), 'beneficiary': r[col['empty3']].strip(), 'tax': r[col['empty4']].strip(),
                    'mission': r[col['rattachement_d_un_operateur']].strip(), 'programme': r[col['empty2']].strip(),
                    'y2022': y('empty5', 'empty6', 'empty7'), 'y2023': y('empty8', 'empty9', 'empty10'), 'y2024': y('empty11', 'empty12', 'empty13')})
    return out


def r0(v):
    return None if v is None else round(v)


def build():
    src = manifest()
    ops = read_operators()
    progs, scsp_total = read_programmes()
    taxes = read_taxes()

    # Match tax beneficiaries to operators (or categories) by exact acronym or exact name, nothing fuzzier.
    by_key = {}
    for o in ops:
        if o.get('unnamed'):
            continue
        for k in (o['name'], o['acronym'], o['full']):
            if k:
                by_key.setdefault(norm(k), o['id'])
    cat_keys = {norm(o['category']): o['category'] for o in ops if o['category']}
    op_taxes, cat_taxes, unmatched = defaultdict(list), defaultdict(list), defaultdict(list)
    for t in taxes:
        b = t['beneficiary']
        acr = b.split(' - ')[0] if ' - ' in b else b
        hit = by_key.get(norm(b)) or by_key.get(norm(acr))
        item = {'tax': t['tax'], **{f'y{yr}': {k: r0(v) for k, v in t[f'y{yr}'].items()} for yr in (2022, 2023, 2024)}}
        if hit:
            op_taxes[hit].append(item)
        elif norm(b) in cat_keys:
            cat_taxes[cat_keys[norm(b)]].append(item)
        elif t['type'] == 'Opérateurs État':
            unmatched[b].append(item)

    def summary(items):
        s = {}
        for yr in (2022, 2023, 2024):
            vals = [i[f'y{yr}'] for i in items]
            s[f'y{yr}'] = {k: (None if all(v[k] is None for v in vals) else sum(v[k] or 0 for v in vals)) for k in ('yield', 'returned', 'kept')}
        return {'count': len(items), **s, 'items': sorted(items, key=lambda i: -(i['y2024']['yield'] or 0))}

    chef = Counter(o['programme'] for o in ops)
    out_ops = []
    for o in ops:
        p = progs.get(o['programme'])
        rec = {k: o[k] for k in ('id', 'name', 'acronym', 'full', 'category', 'statut', 'mission', 'programme', 'programmeLabel')}
        if o.get('unnamed'):
            rec['unnamed'] = True
        rec['ministere'] = p['ministere'] if p else None
        if o['id'] in op_taxes:
            rec['taxes'] = summary(op_taxes[o['id']])
        out_ops.append(rec)

    programmes = []
    for code in sorted(set(chef) | {c for c, p in progs.items() if p['scspCp'] > 0}, key=lambda c: int(c)):
        p = progs.get(code)
        label = p['label'] if p else next(o['programmeLabel'] for o in ops if o['programme'] == code)
        mission = next((o['mission'] for o in ops if o['programme'] == code), p['mission'] if p else None)
        programmes.append({'code': code, 'label': label, 'mission': mission, 'missionPlf25': p['mission'] if p else None,
                           'ministere': p['ministere'] if p else None, 'inPlf25': bool(p), 'type': p['type'] if p else None,
                           'operators': chef.get(code, 0), 'scspCp': r0(p['scspCp']) if p else None,
                           'scspAe': r0(p['scspAe']) if p else None, 'cp': r0(p['cp']) if p else None})

    tax_ops = [t for t in taxes if t['type'] == 'Opérateurs État']
    totals = {
        'operators': len(ops),
        'published': 431, 'publishedPrevious': 434,
        'standalone': sum(1 for o in ops if not o['category']),
        'inCategories': sum(1 for o in ops if o['category']),
        'categories': len({o['category'] for o in ops if o['category']}),
        'missions': len({o['mission'] for o in ops}),
        'programmes': len(chef),
        'scspCp': r0(scsp_total['cp']), 'scspAe': r0(scsp_total['ae']),
        'scspChefCp': r0(sum(p['scspCp'] for c, p in progs.items() if c in chef)),
        'taxesOperatorsLines': len(tax_ops),
        'taxesOperatorsBeneficiaries': len({t['beneficiary'] for t in tax_ops}),
        'taxesOperators2024': {k: r0(sum(t['y2024'][k] or 0 for t in tax_ops)) for k in ('yield', 'returned', 'kept')},
        'taxesOperators2022': {k: r0(sum(t['y2022'][k] or 0 for t in tax_ops)) for k in ('yield', 'returned', 'kept')},
        'taxesAll2024': r0(sum(t['y2024']['yield'] or 0 for t in taxes)),
        'taxesAllLines': len(taxes),
    }
    return {
        'sources': {
            'list': {**src['datagouv-operateurs-2026'], 'title': 'PLF 2026, annexe « jaune » Opérateurs de l’État : liste des opérateurs et catégories'},
            'scsp': {**src['plf25-depenses-nature'], 'title': 'PLF 2025 : dépenses du budget général et des budgets annexes par destination et par nature'},
            'taxes': {**src['plf24-taxes-affectees'], 'title': 'PLF 2024, Voies et moyens tome 1 : liste des taxes affectées'},
            'count': {'url': 'https://acteurspublics.fr/articles/3-operateurs-de-letat-en-moins-en-2026/', 'title': 'Acteurs publics, « 3 opérateurs de l’État en moins en 2026 » (citation du jaune PLF 2026)'},
        },
        'statuts': STATUTS,
        'totals': totals,
        'operators': out_ops,
        'programmes': programmes,
        'categoryTaxes': {k: summary(v) for k, v in cat_taxes.items()},
        'unmatchedTaxes': [{'beneficiary': b, **summary(v)} for b, v in sorted(unmatched.items())],
    }


if __name__ == '__main__':
    data = build()
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    t = data['totals']
    print(f"{OUT.relative_to(ROOT)}: {t['operators']} opérateurs, {len(data['programmes'])} programmes, "
          f"SCSP PLF 2025 {t['scspCp'] / 1e9:.2f} Md€, taxes affectées 2024 aux opérateurs {t['taxesOperators2024']['kept'] / 1e9:.2f} Md€, "
          f"{OUT.stat().st_size / 1024:.0f} Ko")
