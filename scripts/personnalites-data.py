"""Careers of national public figures, for la Loupe: who was President of the Republic, Prime Minister, a minister,
a deputy or a senator, and when, from Wikidata (the data behind the infobox of the Wikipedia articles), with the link
to the French Wikipedia article. Plus the pay attached to the functions, read from the official pages:
the parliamentary indemnity and the deputies' allowances (Assemblée nationale, « La situation matérielle du député »).

  python3 scripts/personnalites-data.py

Writes dist/data/elus/personnalites.json and dist/data/elus/remunerations.json. Every figure comes from these
downloads; the script stops when a page no longer has the layout it reads.
"""
import datetime
import html as htmllib
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist' / 'data' / 'elus'
RAW = ROOT / 'sources' / 'raw' / 'personnalites'
SPARQL = 'https://query.wikidata.org/sparql'
UA = 'FranceRoueLibre/1.0 (https://francerouelibre.fr; donnees publiques) python-urllib'
AN_PAGE = 'https://www.assemblee-nationale.fr/dyn/synthese/deputes-groupes-parlementaires/la-situation-materielle-du-depute'

# Who to read: the national elected people of the RNE (dist/data/elus/personnes.json, scripts/elus-data.py), the
# presidents of regions and départements, the mayors of the largest communes, and everyone Wikidata lists as President of
# the Republic, Prime Minister or minister of France. Their careers are then read from each Wikidata item (P39).
QUERY = """
SELECT DISTINCT ?p WHERE {
  { VALUES ?pos { wd:Q191954 wd:Q1587677 } ?p p:P39/ps:P39 ?pos . }
  UNION { ?pos wdt:P31/wdt:P279* wd:Q83307 ; wdt:P1001 wd:Q142 . ?p p:P39/ps:P39 ?pos . }
  ?p wdt:P31 wd:Q5 .
}
"""
API = 'https://www.wikidata.org/w/api.php'
WIKI = 'https://fr.wikipedia.org/w/api.php'
NATIONAL = {'depute', 'senateur', 'europeen'}


def get(url, data=None, accept='application/json'):
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA, 'Accept': accept})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f'  nouvel essai ({exc})')
            time.sleep(10 * (attempt + 1))


def api(url, params):
    return json.loads(get(url + '?' + urllib.parse.urlencode(dict(params, format='json', formatversion=2))))


def names_to_read():
    p = json.loads((OUT / 'personnes.json').read_text(encoding='utf-8'))
    pop = json.loads((ROOT / 'dist' / 'data' / 'local' / 'communes' / '_pop.json').read_text(encoding='utf8'))['values'][-1]
    meta = json.loads((ROOT / 'dist' / 'data' / 'web' / 'communes-meta.json').read_text(encoding='utf8'))['rows']
    big = {r[0] for r, n in zip(meta, pop) if (n or 0) >= 50000}
    out = []
    for name, mandates in p['personnes']:
        for m in mandates:
            if m[0] in NATIONAL or (m[0] in ('regional', 'departemental', 'assemblee') and m[4].lower().startswith('président')) \
                    or (m[0] == 'maire' and m[3] in big):
                out.append(name)
                break
    return out


def qids_of_titles(names):
    """Wikidata items of French Wikipedia articles named like these people (redirects followed, disambiguation pages
    and articles about something else than a person dropped later)."""
    found = {}
    for i in range(0, len(names), 50):
        chunk = names[i:i + 50]
        r = api(WIKI, {'action': 'query', 'titles': '|'.join(chunk), 'redirects': 1, 'prop': 'pageprops',
                       'ppprop': 'wikibase_item|disambiguation'})
        q = r.get('query', {})
        back = {x['to']: x['from'] for x in q.get('redirects', [])}
        norm_ = {x['to']: x['from'] for x in q.get('normalized', [])}
        for page in q.get('pages', []):
            props = page.get('pageprops') or {}
            if 'disambiguation' in props or 'wikibase_item' not in props:
                continue
            title = page['title']
            asked = back.get(title, title)
            asked = norm_.get(asked, asked)
            found[props['wikibase_item']] = asked
        time.sleep(0.5)
    return found


def entities(ids, props='claims|labels|sitelinks', size=20):
    """Wikidata items by batches; a batch that fails (the items of presidents are large) is read again item by item."""
    out = {}
    ids = list(ids)
    for i in range(0, len(ids), size):
        chunk = ids[i:i + size]
        try:
            r = api(API, {'action': 'wbgetentities', 'ids': '|'.join(chunk), 'props': props, 'languages': 'fr',
                          'sitefilter': 'frwiki'})
            got = {k: v for k, v in (r.get('entities') or {}).items() if 'missing' not in v}
        except Exception as exc:  # noqa: BLE001
            print(f'  lot illisible ({exc}) : relu élément par élément')
            got = {}
        out.update(got)
        missing = [q for q in chunk if q not in got]
        if missing and size > 1:
            out.update(entities(missing, props, 1))
        elif missing:   # one large item: the cached JSON export of the item (Special:EntityData)
            for q in missing:
                try:
                    data = json.loads(get(f'https://www.wikidata.org/wiki/Special:EntityData/{q}.json'))
                    out.update(data.get('entities') or {})
                except Exception as exc:  # noqa: BLE001
                    print(f'  {q} illisible : {exc}')
        time.sleep(0.3)
    return out


def _date(claim_quals, prop):
    for q in claim_quals.get(prop, []):
        v = (q.get('datavalue') or {}).get('value') or {}
        t = v.get('time', '')
        if t:
            return t[1:11].replace('-00', '-01')
    return ''


CATEGORIES = ['Catégorie:Ministre de la Cinquième République', 'Catégorie:Ministre français', 'Catégorie:Secrétaire d\'État français',
              'Catégorie:Président de la République française', 'Catégorie:Premier ministre de la Cinquième République',
              'Catégorie:Membre du gouvernement français']


def category_titles():
    """Articles of the French Wikipedia categories of ministers, Prime Ministers and Presidents (the infobox people)."""
    titles = set()
    for cat in CATEGORIES:
        params = {'action': 'query', 'list': 'categorymembers', 'cmtitle': cat, 'cmlimit': 500, 'cmtype': 'page'}
        while True:
            r = api(WIKI, params)
            titles |= {m['title'] for m in r.get('query', {}).get('categorymembers', [])}
            if 'continue' not in r:
                break
            params.update(r['continue'])
            time.sleep(0.5)
    return sorted(titles)


def careers():
    RAW.mkdir(parents=True, exist_ok=True)
    raw = get(SPARQL, urllib.parse.urlencode({'query': QUERY}).encode(), 'application/sparql-results+json')
    (RAW / 'wikidata-gouvernants.json').write_bytes(raw)
    qids = {b['p']['value'].rsplit('/', 1)[1] for b in json.loads(raw)['results']['bindings']}
    print(f'  {len(qids)} présidents, Premiers ministres et ministres sur Wikidata')
    names = names_to_read()
    by_title = qids_of_titles(names)
    cats = category_titles()
    print(f'  {len(cats)} articles dans les catégories de ministres et de chefs de l’exécutif')
    for qid, title in qids_of_titles(cats).items():
        qids.add(qid)
    print(f'  {len(by_title)} élus nationaux retrouvés sur Wikipédia sur {len(names)}')
    items = entities(qids | set(by_title))
    positions = set()
    for e in items.values():
        for c in (e.get('claims') or {}).get('P39', []):
            v = ((c.get('mainsnak') or {}).get('datavalue') or {}).get('value') or {}
            if v.get('id'):
                positions.add(v['id'])
    labels = {k: ((v.get('labels') or {}).get('fr') or {}).get('value', '') for k, v in entities(positions, 'labels').items()}
    people = {}
    for qid, e in items.items():
        claims = e.get('claims') or {}
        if not any(((c.get('mainsnak') or {}).get('datavalue') or {}).get('value', {}).get('id') == 'Q5' for c in claims.get('P31', [])):
            continue   # not a person: a Wikipedia article named like the elected person is about something else
        link = ((e.get('sitelinks') or {}).get('frwiki') or {}).get('title', '')
        # the label, else the title of the Wikipedia article without its precision (« X (homme politique) »)
        name = ((e.get('labels') or {}).get('fr') or {}).get('value', '') or re.sub(r'\s*\(.*\)$', '', link)
        if not name:
            continue
        dead = ''
        for c in claims.get('P570', []):
            t = (((c.get('mainsnak') or {}).get('datavalue') or {}).get('value') or {}).get('time', '')
            dead = t[1:11] if t else dead
        fns = []
        for c in claims.get('P39', []):
            v = ((c.get('mainsnak') or {}).get('datavalue') or {}).get('value') or {}
            label = labels.get(v.get('id', ''), '')
            if not label:
                continue
            quals = c.get('qualifiers') or {}
            item = [label, _date(quals, 'P580'), _date(quals, 'P582')]
            if item not in fns:
                fns.append(item)
        fns.sort(key=lambda f: f[1] or '0000', reverse=True)
        people[qid] = {'nom': name, 'rne': by_title.get(qid, ''), 'wikidata': qid,
                       'wikipedia': f'https://fr.wikipedia.org/wiki/{urllib.parse.quote(link.replace(" ", "_"))}' if link else '',
                       'deces': dead, 'fonctions': fns[:40]}
    return people


def num(text):
    return float(text.replace(' ', '').replace('\xa0', '').replace(' ', '').replace(',', '.'))


def parliament_pay():
    html = get(AN_PAGE, accept='text/html').decode('utf-8', 'replace')
    (RAW / 'an-situation-materielle.html').write_text(html, encoding='utf-8')
    text = re.sub(r'<[^>]+>', ' ', html)
    text = htmllib.unescape(text)
    text = re.sub(r'\s+', ' ', text)
    money = r'(\d{1,3}(?:[\s \xa0]\d{3})*,\d{2})\s*€'

    def find(pattern, label):
        m = re.search(pattern + r'[^€]{0,60}?' + money, text, re.I)
        if not m:
            raise SystemExit(f'Page de l’Assemblée : « {label} » introuvable, la page a changé ({AN_PAGE})')
        return num(m.group(1))
    out = {
        'base': find(r'indemnit[ée] de base', 'indemnité de base'),
        'residence': find(r'indemnit[ée] de r[ée]sidence', 'indemnité de résidence'),
        'fonction': find(r'indemnit[ée] de fonction', 'indemnité de fonction'),
        'brut': find(r'brut mensuel', 'brut mensuel'),
        'net': find(r'net mensuel', 'net mensuel'),
        'dfp': find(r'dotation[^.]{0,200}?est de', 'dotation de fonctionnement parlementaire'),
    }
    m = re.search(r'collaborateurs[^.]{0,200}?(\d{1,3}(?:[\s \xa0]\d{3})*(?:,\d{2})?)\s*€\s*par mois', text, re.I)
    if m:
        out['collaborateurs'] = num(m.group(1))
    m = re.search(r'depuis le (1er|\d{1,2}) (\w+) (\d{4})', text)
    out['depuis'] = m.group(0) if m else ''
    total = round(out['base'] + out['residence'] + out['fonction'], 2)
    if abs(total - out['brut']) > 1:
        raise SystemExit(f'Indemnité parlementaire incohérente : {total} ≠ {out["brut"]}')
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    today = datetime.date.today().isoformat()
    people = careers()
    (OUT / 'personnalites.json').write_text(json.dumps({
        'source': 'Wikidata (données des infobox de Wikipédia) : fonctions occupées (P39) par les présidents de la République, '
                  'Premiers ministres, ministres et élus nationaux', 'url': 'https://www.wikidata.org/', 'telecharge': today,
        'personnes': sorted(people.values(), key=lambda p: p['nom'])}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    pay = parliament_pay()
    (OUT / 'remunerations.json').write_text(json.dumps({
        'telecharge': today,
        'parlementaire': dict(pay, source='Assemblée nationale, « La situation matérielle du député »', url=AN_PAGE,
                              note='Même indemnité parlementaire pour les sénateurs (ordonnance n° 58-1210 du 13 décembre 1958). '
                                   'La dotation de fonctionnement et le crédit collaborateurs ne sont pas versés au député : ils '
                                   'paient ses frais de mandat et ses collaborateurs.'),
        'gouvernement': {'texte': 'décret n° 2012-983 du 23 août 2012 relatif au traitement du Président de la République et '
                                  'des membres du Gouvernement',
                         'url': 'https://www.legifrance.gouv.fr/search/all?tab_selection=all&query=d%C3%A9cret%202012-983'},
    }, ensure_ascii=False, indent=1), encoding='utf-8')
    for must in ('Q3052772', 'Q2105'):   # Emmanuel Macron, Jacques Chirac: the largest items must be there
        if must not in {p['wikidata'] for p in people.values()}:
            raise SystemExit(f'Wikidata : {must} manquant, lecture incomplète')
    print(f'{len(people)} personnalités (Wikidata) ; indemnité parlementaire {pay["brut"]} € brut par mois, net {pay["net"]} €')


if __name__ == '__main__':
    main()
