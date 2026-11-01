"""Search engine and AI-answer metadata for every page, without touching what the pages show.
Rewrites one block between <!-- seo:begin --> and <!-- seo:end --> at the end of each <head> in dist/ (structured data
schema.org JSON-LD, touch icon), and regenerates dist/sitemap.xml. The site's name is written both as one word and as
three words (« France Roue Libre ») so that searches with spaces find it. Run after adding a page:
    python scripts/sync_seo.py"""
import datetime
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
SITE = 'https://francerouelibre.fr'
NAME = 'FranceRoueLibre'
ALT_NAMES = ['France Roue Libre', 'France Roue-Libre', 'francerouelibre', 'francerouelibre.fr', 'FRL']
SAME_AS = [
    'https://x.com/FranceRoueLibre',
    'https://github.com/TheoMrc/FranceRoueLibre',
    'https://fr.tipeee.com/francerouelibre/',
]
SITE_DESC = ('France Roue Libre (FranceRoueLibre) ouvre le capot des comptes publics français à partir des seules '
             'données ouvertes : dépenses, recettes, impôts, niches fiscales, déficit et dette de l’État, de la Sécurité '
             'sociale et des collectivités, marchés publics, subventions et signaux d’anomalies, chaque chiffre avec sa source.')
ABOUT = ['Finances publiques', 'Dépenses publiques', 'Impôts et taxes', 'Dette publique', 'Déficit public',
         'Marchés publics', 'Subventions', 'Collectivités territoriales', 'Données ouvertes']

# The home page is the brand page: its <title> and description carry the spaced name too (head only, nothing shown on the page).
HOME_TITLE = 'FranceRoueLibre (France Roue Libre) · Cartographie des dépenses publiques'
HOME_DESC = ('France Roue Libre : où part l’argent public ? Dépenses, impôts, déficit et dette, par région, département '
             'et commune, à partir des données ouvertes.')

# Pages not worth a sitemap entry, and their priority otherwise.
PRIORITY = {'index.html': '1.0', 'mentions.html': '0.2'}

BEGIN, END = '<!-- seo:begin -->', '<!-- seo:end -->'


def meta(page, attr, key):
    m = re.search(r'<meta\s+%s="%s"\s+content="([^"]*)"' % (attr, re.escape(key)), page)
    return html.unescape(m.group(1)) if m else ''


def graph(path, page):
    url = SITE + '/' if path.name == 'index.html' else '%s/%s' % (SITE, path.name)
    title = html.unescape(re.search(r'<title>(.*?)</title>', page, re.S).group(1)).strip()
    short = re.sub(r'\s*·\s*FranceRoueLibre\s*$', '', title)
    org = {
        '@type': 'Organization', '@id': SITE + '/#organisation', 'name': NAME, 'alternateName': ALT_NAMES,
        'url': SITE + '/', 'logo': {'@type': 'ImageObject', 'url': SITE + '/logo-512.png', 'width': 512, 'height': 512},
        'email': 'stonks@francerouelibre.fr', 'sameAs': SAME_AS, 'description': SITE_DESC,
    }
    website = {
        '@type': 'WebSite', '@id': SITE + '/#site', 'url': SITE + '/', 'name': NAME, 'alternateName': ALT_NAMES,
        'description': SITE_DESC, 'inLanguage': 'fr-FR', 'publisher': {'@id': org['@id']},
        'potentialAction': {'@type': 'SearchAction',
                            'target': {'@type': 'EntryPoint', 'urlTemplate': SITE + '/recherche.html?q={q}'},
                            'query-input': 'required name=q'},
    }
    webpage = {
        '@type': 'WebPage', '@id': url + '#page', 'url': url, 'name': title,
        'description': meta(page, 'name', 'description'), 'inLanguage': 'fr-FR',
        'isPartOf': {'@id': website['@id']}, 'publisher': {'@id': org['@id']},
        'primaryImageOfPage': {'@type': 'ImageObject', 'url': SITE + '/og.png', 'width': 1200, 'height': 630},
        'isAccessibleForFree': True, 'license': 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
    }
    nodes = [webpage]
    if path.name == 'index.html':
        webpage['about'] = [{'@type': 'Thing', 'name': a} for a in ABOUT]
        nodes = [website, org, webpage]
    else:
        webpage['breadcrumb'] = {'@id': url + '#fil'}
        nodes.append({'@type': 'BreadcrumbList', '@id': url + '#fil', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': NAME, 'item': SITE + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': short, 'item': url},
        ]})
    return json.dumps({'@context': 'https://schema.org', '@graph': nodes}, ensure_ascii=False, separators=(',', ':'))


def set_home_head(page):
    page = re.sub(r'<title>.*?</title>', '<title>%s</title>' % html.escape(HOME_TITLE, quote=False), page, count=1, flags=re.S)
    return re.sub(r'(<meta\s+name="description"\s+content=")[^"]*(")', lambda m: m.group(1) + html.escape(HOME_DESC) + m.group(2), page, count=1)


def main():
    pages = sorted(DIST.glob('*.html'))
    for path in pages:
        page = path.read_text(encoding='utf-8')
        page = re.sub(r'\n?\s*%s.*?%s' % (re.escape(BEGIN), re.escape(END)), '', page, flags=re.S)
        if path.name == 'index.html':
            page = set_home_head(page)
        block = ('\n  %s\n  <link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
                 '  <script type="application/ld+json">\n%s\n  </script>\n  %s' % (BEGIN, graph(path, page), END))
        page = page.replace('\n</head>', block + '\n</head>', 1)
        path.write_text(page, encoding='utf-8', newline='\n')

    today = datetime.date.today().isoformat()
    urls = []
    for path in pages:
        loc = SITE + '/' if path.name == 'index.html' else '%s/%s' % (SITE, path.name)
        urls.append('  <url><loc>%s</loc><lastmod>%s</lastmod><priority>%s</priority></url>'
                    % (loc, today, PRIORITY.get(path.name, '0.8')))
    (DIST / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n'
                                      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n%s\n</urlset>\n'
                                      % '\n'.join(urls), encoding='utf-8', newline='\n')
    print('%d pages, sitemap.xml' % len(pages))


if __name__ == '__main__':
    main()
