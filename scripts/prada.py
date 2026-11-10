"""Personnes responsables de l'accès aux documents administratifs (PRADA), from the CADA's directory: the address
that receives the requests for documents in each body, often a better one than the general contact of the official
directory. The CADA publishes it only as a search form (www.cada.fr/administration/personnes-responsables), by type
of body: every page of every type is downloaded here.

  python scripts/prada.py           download (sources/raw/prada/) and build
  python scripts/prada.py --local   build from the pages already downloaded

Output: server/assistant/prada.json (not under dist/: not served by the site), rows [type of body, name of the body,
e-mail, postal code, town] for the bodies whose PRADA has an e-mail; no person's name is kept. Read by
server/assistant/demandes.py."""
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'sources' / 'raw' / 'prada'
OUT = ROOT / 'server' / 'assistant' / 'prada.json'
PAGE = 'https://www.cada.fr/administration/personnes-responsables-administration'
FORM = 'https://www.cada.fr/administration/personnes-responsables'
TYPE_FIELD, DEPT_FIELD = 'field_classement_de_l_administra_target_id', 'field_d_partement_de_l_autorit__target_id'


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': 'FranceRoueLibre (scripts/prada.py; stonks@francerouelibre.fr)'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode('utf-8', 'replace')
        except OSError:
            if attempt == 2:
                raise
            time.sleep(5)


def types(form: str) -> dict:
    i = form.index(f'name="{TYPE_FIELD}"')
    opts = re.findall(r'<option value="(\d+)"[^>]*>([^<]*)<', form[i:form.index('</select>', i)])
    return {v: html.unescape(label).strip() for v, label in opts}


def rows_of(page: str, kind: str) -> list:
    out = []
    for art in re.findall(r'<article class="node node--type-personne-responsable.*?</article>', page, re.S):
        name = re.search(r'<h2 class="title">\s*<span>(.*?)</span>', art, re.S)
        mail = re.search(r'href="mailto:([^"]+)"', art)
        addr = re.search(r'field-name-field-adresse-complete.*?</div>\s*</div>\s*</div>', art, re.S)
        text = html.unescape(re.sub(r'<[^>]+>', '\n', addr.group(0))) if addr else ''
        place = re.findall(r'(?m)^[ \t]*(\d{5})[ \t]+([A-Za-zÀ-ÿ][^\n]*)', text)   # « 51100 REIMS », not « CS 80036 »
        if not name or not mail or '@' not in mail.group(1):
            continue
        cp, town = place[-1] if place else ('', '')
        out.append([kind, html.unescape(re.sub(r'\s+', ' ', name.group(1))).strip().lstrip('#').strip(), mail.group(1).strip().lower(),
                    cp, re.sub(r'\s+(CEDEX|Cedex|cedex).*$', '', town).strip()])
    return out


def download(passes: int = 2) -> None:
    """Every page of every type. The site's result count changes from one call to the next and a page sometimes comes
    back empty: each type is read until two empty pages in a row, twice, and build() keeps the union."""
    RAW.mkdir(parents=True, exist_ok=True)
    form = get(FORM)
    (RAW / 'formulaire.html').write_text(form, encoding='utf-8')
    for n_pass in range(passes):
        for value, label in types(form).items():
            page, empty, got = 0, 0, 0
            while empty < 2 and page < 150:
                q = urllib.parse.urlencode({TYPE_FIELD: value, DEPT_FIELD: 'All', 'page': page})
                h = get(f'{PAGE}?{q}')
                n = len(re.findall(r'node--type-personne-responsable', h))
                if n:
                    (RAW / f'{value}-{n_pass}-{page:03d}.html').write_text(h, encoding='utf-8')
                empty = 0 if n else empty + 1
                got += n
                page += 1
                time.sleep(0.5)   # gentle with the CADA's site
            print(f'  passe {n_pass + 1}, {label} : {got} fiches sur {page} pages', flush=True)


def build() -> None:
    form = (RAW / 'formulaire.html').read_text(encoding='utf-8')
    kinds = types(form)
    rows, seen = [], set()
    for p in sorted(RAW.glob('*-*-*.html')):
        for r in rows_of(p.read_text(encoding='utf-8'), kinds.get(p.stem.split('-')[0], '')):
            if (r[1], r[2]) not in seen:
                seen.add((r[1], r[2]))
                rows.append(r)
    if len(rows) < 500:
        sys.exit(f'{len(rows)} PRADA seulement : la page de la CADA a sans doute changé, rien n’est écrit')
    rows.sort(key=lambda r: (r[0], r[1]))
    OUT.write_text(json.dumps({'source': FORM, 'telecharge': dt.date.today().isoformat(), 'colonnes':
                               ['type', 'organisme', 'courriel', 'code_postal', 'commune'], 'lignes': rows},
                              ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    by = {}
    for r in rows:
        by[r[0]] = by.get(r[0], 0) + 1
    print(f'{OUT} : {len(rows)} PRADA avec une adresse électronique')
    for k, n in sorted(by.items(), key=lambda x: -x[1]):
        print(f'  {n:5d}  {k}')


if __name__ == '__main__':
    if '--local' not in sys.argv:
        download()
    build()
