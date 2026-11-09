"""Index of the site's own content, page by page and section by section, for the search bar (dist/data/site-index.json).

Reads every page in dist/: its title, description and lead, then each <section id> with its eyebrow, its <h2>, its lead
paragraph and the titles of its panels and figures (<h3>). Readers' words that the pages do not use ("fonctionnaires",
"profs", "Bercy") are added per page or section in SYNONYMS below. Run after adding a page or a section, with
sync_nav.py and sync_seo.py:

  python3 scripts/site-index.py"""
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = DIST / 'data' / 'site-index.json'
SKIP = {'recherche.html', 'mentions.html'}

# Words readers type that the page itself does not use. Key: page, or page#section.
SYNONYMS = {
    'index.html': 'accueil carte communes départements régions intercommunalités budget local dépenses par commune',
    'index.html#comptes': 'dette de la France hausse augmente augmentation déficit PIB prélèvements obligatoires comptes nationaux Insee dette publique Maastricht',
    'index.html#circuit': 'circuit argent public fonctions enseignement santé défense protection sociale',
    'emplois.html': 'fonctionnaires agents publics fonction publique salaires masse salariale emplois publics élus maires '
                    'indemnités profs enseignants policiers militaires infirmiers hôpital',
    'emplois.html#synthese': 'combien coûtent les fonctionnaires salaire moyen part des dépenses budget de l’état salaires',
    'emplois.html#effectifs': 'nombre de fonctionnaires combien de fonctionnaires effectifs ministères',
    'emplois.html#elus': 'élus maires conseillers municipaux députés sénateurs indemnités des élus',
    'emplois.html#carte': 'carte fonctionnaires par département taux d’administration',
    'emplois.html#commune': 'ma commune mairie frais de personnel commune',
    'etat.html': 'budget de l’état ministères missions programmes loi de finances PLF Bercy crédits',
    'etat.html#missions': 'ministères missions éducation défense police justice',
    'etat.html#recettes': 'recettes de l’état TVA impôt sur le revenu',
    'impots.html': 'impôts taxes TVA impôt sur le revenu CSG prélèvements taxes affectées petites taxes',
    'impots.html#ecarts': 'évasion fiscale fraude fiscale fraude à la TVA contrôle fiscal redressements verrou de Bercy '
                          'optimisation fiscale paradis fiscaux écart de TVA impôts non payés',
    'niches.html': 'niches fiscales crédit d’impôt réduction d’impôt dépenses fiscales exonérations',
    'operateurs.html': 'agences opérateurs établissements publics universités France Travail ADEME CNRS',
    'secu.html': 'sécurité sociale assurance maladie retraites hôpitaux CNAM branches déficit de la sécu',
    'aides.html': 'subventions associations aides aux entreprises plan de relance fonds vert',
    'marches.html': 'marchés publics appels d’offres contrats acheteurs fournisseurs commande publique',
    'ugap.html': 'UGAP centrale d’achat prix catalogue',
    'signaux.html': 'anomalies signaux alertes contrôles',
    'demandes.html': 'demandes documents administratifs cada courrier mairie réponse',
    'europe.html': 'europe union européenne comparaison pays voisins allemagne italie espagne eurostat classement dépenses publiques en % du PIB moyenne européenne',
    'probite.html': 'corruption favoritisme prise illégale d’intérêts condamnations probité',
    'donnees.html': 'sources données ouvertes open data angles morts méthode',
}


class Page(HTMLParser):
    """Collects page metadata and, for each <section id>, its eyebrow, h2, first lead paragraph and h3 titles."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = self.desc = self.h1 = self.lead = ''
        self.sections, self.cur, self.capture, self.buf, self.depth = [], None, None, [], 0
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get('class') or ''
        if tag in ('script', 'style', 'svg', 'nav', 'footer', 'header'):
            self.skip += 1
            return
        if tag == 'meta' and a.get('name') == 'description':
            self.desc = a.get('content') or ''
        if self.skip:
            return
        if tag == 'section':
            self.depth += 1
            if a.get('id') and self.depth == 1:
                self.cur = {'id': a['id'], 'eyebrow': '', 'h2': '', 'lead': '', 'figures': []}
                self.sections.append(self.cur)
        want = None
        if tag == 'title':
            want = 'title'
        elif tag == 'h1':
            want = 'h1'
        elif tag == 'p' and 'hero__lead' in cls and not self.lead:
            want = 'lead'
        elif self.cur is not None:
            if tag == 'span' and 'eyebrow' in cls and not self.cur['eyebrow']:
                want = 'eyebrow'
            elif tag == 'h2' and not self.cur['h2']:
                want = 'h2'
            elif tag == 'p' and 'lead' in cls.split() and not self.cur['lead']:
                want = 'slead'
            elif tag == 'h3':
                want = 'h3'
        if want and not self.capture:
            self.capture, self.buf = (want, tag), []

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'svg', 'nav', 'footer', 'header'):
            self.skip = max(0, self.skip - 1)
            return
        if self.capture and tag == self.capture[1]:
            text = re.sub(r'\s+', ' ', ''.join(self.buf)).strip()
            kind = self.capture[0]
            self.capture = None
            if kind == 'title':
                self.title = text
            elif kind == 'h1':
                self.h1 = text
            elif kind == 'lead':
                self.lead = text
            elif kind == 'eyebrow':
                self.cur['eyebrow'] = text
            elif kind == 'h2':
                self.cur['h2'] = text
            elif kind == 'slead':
                self.cur['lead'] = text
            elif kind == 'h3' and text and text not in self.cur['figures']:
                self.cur['figures'].append(text)
        if tag == 'section' and not self.skip:
            self.depth = max(0, self.depth - 1)
            if self.depth == 0:
                self.cur = None

    def handle_data(self, data):
        if self.capture:
            self.buf.append(data)


def page_title(p: Page) -> str:
    return re.sub(r'\s*·\s*FranceRoueLibre\s*$', '', p.title) or p.h1


def build():
    out = []
    for path in sorted(DIST.glob('*.html')):
        if path.name in SKIP:
            continue
        p = Page()
        p.feed(path.read_text(encoding='utf-8'))
        title = page_title(p) if path.name != 'index.html' else 'Carte des dépenses publiques'
        out.append({'url': path.name, 'page': title, 'section': '', 'title': title,
                    'text': p.desc or p.lead, 'figures': [], 'keywords': SYNONYMS.get(path.name, '')})
        for s in p.sections:
            if not s['h2']:
                continue
            out.append({'url': f'{path.name}#{s["id"]}', 'page': title, 'section': s['id'], 'title': s['h2'],
                        'eyebrow': s['eyebrow'], 'text': s['lead'], 'figures': s['figures'][:12],
                        'keywords': SYNONYMS.get(f'{path.name}#{s["id"]}', '')})
    return out


def main():
    rows = build()
    for key in SYNONYMS:   # a synonym for a page or section that no longer exists is a mistake to fix here
        assert any(r['url'] == key for r in rows), f'SYNONYMS : {key} introuvable dans dist/'
    OUT.write_text(json.dumps({'generated': 'python3 scripts/site-index.py', 'entries': rows}, ensure_ascii=False,
                              separators=(',', ':')), encoding='utf-8')
    pages = len({r['url'].split('#')[0] for r in rows})
    print(f'{OUT.relative_to(ROOT)}: {pages} pages, {len(rows) - pages} sections, {OUT.stat().st_size // 1024} Ko')


if __name__ == '__main__':
    main()
