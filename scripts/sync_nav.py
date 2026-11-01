"""One menu for every page. The structure lives here; this script rewrites the <ul class="nav__links"> block of every
page in dist/ (and adds dist/nav.js, dist/collapse.js, dist/assistant.js, dist/scroll-hint.js and dist/touch-hover.js), so that adding a page means adding one line below and running:
    python scripts/sync_nav.py
On the home page, the map, circuit and accounts links stay in-page anchors."""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'

# (label, href) for direct links; (label, [(title, href, description), ...]) for groups.
NAV = [
    ('Carte', 'index.html#explorer'),
    ('Circuit', 'index.html#circuit'),
    ('Comptes', 'index.html#comptes'),
    ('Recettes', [
        ('Impôts et taxes', 'impots.html', 'Ce que rapporte et coûte chaque prélèvement'),
        ('Niches fiscales', 'niches.html', 'Réductions et crédits d’impôt, mesure par mesure'),
    ]),
    ('Dépenses', [
        ('Budget de l’État', 'etat.html', 'Missions, programmes, exécution mois par mois'),
        ('Opérateurs de l’État', 'operateurs.html', 'Agences et établissements publics'),
        ('Sécurité sociale', 'secu.html', 'Comptes des branches, dépenses d’assurance maladie'),
        ('Aides et subventions', 'aides.html', 'Associations, entreprises, plan de relance'),
        ('Marchés publics', 'marches.html', '1,4 million de contrats depuis 2014'),
        ('UGAP', 'ugap.html', 'Les prix de la centrale d’achat public'),
    ]),
    ('Contrôle', [
        ('Signaux', 'signaux.html', 'Règles simples appliquées à toutes les données'),
        ('Probité', 'probite.html', 'Corruption, favoritisme : les affaires jugées'),
        ('Données et angles morts', 'donnees.html', 'Les sources, et ce qui n’est pas publié'),
    ]),
]

# « Pour aller plus loin » at the bottom of each page: where a reader of this page naturally goes next, and why.
RELATED = {
    'index.html': [('impots.html', 'D’où viennent les recettes : chaque impôt, ce qu’il rapporte et coûte'), ('etat.html', 'Le budget de l’État voté et exécuté, mission par mission'), ('secu.html', 'La Sécurité sociale, premier poste de dépense publique'), ('signaux.html', 'Les anomalies repérées dans les comptes locaux et les marchés')],
    'impots.html': [('niches.html', 'Ce que les réductions et crédits d’impôt retirent à ces recettes'), ('etat.html', 'Ce que l’État fait des recettes du budget général'), ('operateurs.html', 'Les agences financées par des taxes affectées'), ('donnees.html', 'Toutes les sources, et ce qui n’est pas publié')],
    'niches.html': [('impots.html', 'Ce que rapporte chaque impôt avant ces réductions'), ('aides.html', 'Les aides directes aux entreprises et associations'), ('etat.html', 'Les missions du budget auxquelles chaque niche se rattache')],
    'etat.html': [('operateurs.html', 'Les agences et établissements que ces programmes financent'), ('impots.html', 'D’où viennent les recettes du budget général'), ('niches.html', 'Les dépenses qui passent par l’impôt plutôt que par le budget'), ('aides.html', 'Qui reçoit les subventions, bénéficiaire par bénéficiaire')],
    'operateurs.html': [('etat.html', 'Les programmes budgétaires qui financent les opérateurs'), ('impots.html', 'Les taxes affectées à ces organismes'), ('marches.html', 'Ce que les opérateurs achètent')],
    'secu.html': [('impots.html', 'CSG, CRDS et autres prélèvements qui financent la Sécurité sociale'), ('index.html#circuit', 'La Sécurité sociale dans le circuit de l’argent public'), ('donnees.html', 'Hôpitaux, ARS : ce qui n’est pas publié')],
    'aides.html': [('niches.html', 'Les aides qui passent par l’impôt (crédits d’impôt)'), ('etat.html', 'Les programmes budgétaires qui versent ces aides'), ('signaux.html', 'Subventions à des structures fermées et autres signaux')],
    'marches.html': [('ugap.html', 'Les prix de la centrale d’achat public'), ('signaux.html', 'Offres uniques, avenants, montants sous les seuils'), ('probite.html', 'Favoritisme et corruption : les affaires jugées')],
    'ugap.html': [('marches.html', 'Tous les marchés publics, acheteur par acheteur'), ('signaux.html', 'Les signaux sur la concurrence dans les achats')],
    'signaux.html': [('marches.html', 'Les marchés publics en détail'), ('probite.html', 'Les atteintes à la probité jugées'), ('aides.html', 'Les subventions en détail')],
    'probite.html': [('signaux.html', 'Les anomalies repérées dans les données publiques'), ('marches.html', 'Les marchés publics, où se joue le favoritisme')],
    'donnees.html': [('impots.html#a-publier', 'Ce que le gouvernement devrait publier sur les impôts'), ('signaux.html', 'Ce qu’on peut déjà tirer des données publiées')],
}

# Donations and social account: a « Soutenir » button and the X logo in every header, the same links in every footer.
SUPPORT_URL = 'https://fr.tipeee.com/francerouelibre/'
X_URL = 'https://x.com/FranceRoueLibre'
HEART = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.8 6.8 4.6c2-.1 3.6 1 5.2 3 1.6-2 3.2-3.1 5.2-3 3.4.2 5.3 3.6 4.1 6.7-1.8 4.6-9.3 9.2-9.3 9.2z" fill="currentColor"/></svg>'
# X logo: Simple Icons (CC0-1.0), https://simpleicons.org
X_ICON = '<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="currentColor" aria-hidden="true"><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg>'
HEADER_EXTRA = (f'<a class="nav-support" href="{SUPPORT_URL}" target="_blank" rel="noopener" title="Soutenir FranceRoueLibre sur Tipeee">'
                f'{HEART}<span>Soutenir</span></a>'
                f'<a class="nav-github nav-x" href="{X_URL}" target="_blank" rel="noopener noreferrer" aria-label="FranceRoueLibre sur X" '
                f'title="FranceRoueLibre sur X">{X_ICON.format(s=16)}</a>')
FOOTER_EXTRA = (f'<a class="footer__github" href="{X_URL}" target="_blank" rel="noopener noreferrer">{X_ICON.format(s=13)}@FranceRoueLibre</a>'
                f'<a class="footer__github footer__support" href="{SUPPORT_URL}" target="_blank" rel="noopener">{HEART.replace("16", "15")}Soutenir sur Tipeee</a>')

CHEVRON = '<svg class="nav__chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def render(page, indent='      '):
    home = page == 'index.html'
    out = [f'{indent}<ul class="nav__links">']
    for i, (label, target) in enumerate(NAV):
        if isinstance(target, str):
            href = target.split('#', 1)
            link = f'#{href[1]}' if home and href[0] == 'index.html' and len(href) == 2 else target
            out.append(f'{indent}  <li><a href="{link}">{esc(label)}</a></li>')
            continue
        current = any(h == page for _, h, _ in target)
        mark = ' aria-current="page"'
        items = ''.join(
            f'<li><a href="{h}"{mark if h == page else ""}><strong>{esc(t)}</strong><small>{esc(d)}</small></a></li>'
            for t, h, d in target)
        out.append(
            f'{indent}  <li class="nav__group{" is-current" if current else ""}">'
            f'<button class="nav__toggle" type="button" aria-expanded="false" aria-controls="navMenu{i}">{esc(label)}{CHEVRON}</button>'
            f'<ul class="nav__menu" id="navMenu{i}">{items}</ul></li>')
    out.append(f'{indent}</ul>')
    return '\n'.join(out)


def titles():
    t = {h: (title, desc) for _, g in NAV if not isinstance(g, str) for title, h, desc in g}
    t['index.html'] = ('Accueil', 'Carte, circuit et comptes')
    return t


def render_related(page, indent='    '):
    links = RELATED.get(page)
    if not links:
        return ''
    known = titles()
    items = []
    for href, why in links:
        base = href.split('#')[0]
        if not (DIST / base).exists():
            continue
        title = known.get(base, (base, ''))[0]
        if href == 'index.html#circuit':
            title = 'Le circuit de l’argent public'
        items.append(f'<a class="related__card" href="{href}"><strong>{esc(title)}</strong><span>{esc(why)}</span></a>')
    if not items:
        return ''
    return (f'{indent}<section class="section related" aria-labelledby="relatedTitle"><div class="container">'
            f'<h2 class="related__title" id="relatedTitle">Pour aller plus loin</h2><div class="related__grid">{"".join(items)}</div></div></section>')


def sync(path):
    raw = path.read_bytes().decode('utf-8')
    nl = '\r\n' if '\r\n' in raw else '\n'
    text = raw.replace('\r\n', '\n')
    start = text.find('<ul class="nav__links">')
    if start < 0:
        return False
    end = text.find('<div class="nav__actions">', start)
    if end < 0:
        raise SystemExit(f'{path.name}: no nav__actions after the menu')
    line_start = text.rfind('\n', 0, start) + 1
    block_end = text.rfind('</ul>', start, end) + len('</ul>')
    indent = text[line_start:start]
    text = text[:line_start] + render(path.name, indent) + text[block_end:]
    if 'src="./nav.js"' in text and 'src="./collapse.js"' not in text:
        text = text.replace('<script defer src="./nav.js"></script>', '<script defer src="./nav.js"></script>\n  <script defer src="./collapse.js"></script>', 1)
    if 'src="./nav.js"' not in text:
        text = text.replace('<script defer src="./search-bar.js"></script>',
                            '<script defer src="./nav.js"></script>\n  <script defer src="./search-bar.js"></script>', 1)
        if 'src="./nav.js"' not in text:
            raise SystemExit(f'{path.name}: add <script defer src="./nav.js"></script> by hand')
    if 'src="./assistant.js"' not in text:  # AI assistant panel (shown only when its API answers)
        text = text.replace('<script defer src="./nav.js"></script>', '<script defer src="./nav.js"></script>\n  <script defer src="./assistant.js"></script>', 1)
    for extra in ('scroll-hint.js', 'touch-hover.js'):  # sideways scrollers made visible; chart tooltips by touch
        if f'src="./{extra}"' not in text:
            text = text.replace('<script defer src="./nav.js"></script>', f'<script defer src="./nav.js"></script>\n  <script defer src="./{extra}"></script>', 1)
    # Header: « Soutenir » and X before the GitHub link (rewritten each time). search-bar.js puts its form first.
    text = re.sub(r'[ \t]*<a class="nav-support".*?</a><a class="nav-github nav-x".*?</a>\n', '', text, flags=re.S)
    i = text.find('<div class="nav__actions">')
    if i >= 0:
        j = text.find('\n', i) + 1
        ind = re.match(r'[ \t]*', text[j:]).group(0)
        text = text[:j] + ind + HEADER_EXTRA + '\n' + text[j:]
    # Footer: every page of the menu, in menu order, then the source code link kept as it is, X and Tipeee.
    fstart = text.find('<div class="footer__links">')
    if fstart >= 0:
        fend = text.find('</div>', fstart)
        old = text[fstart:fend]
        code = old[old.find('<a class="footer__code"'):] if '<a class="footer__code"' in old else ''
        if not code:
            m = re.search(r'<a[^>]*github\.com[^>]*>.*?</a>', old, re.S)
            code = m.group(0) if m else ''
        home = path.name == 'index.html'
        links = []
        for label, target in NAV:
            if isinstance(target, str):
                h = target.split('#')
                links.append((label, f'#{h[1]}' if home and len(h) == 2 else target))
            else:
                links += [(t, h) for t, h, _ in target]
        text = text[:fstart] + '<div class="footer__links">' + ''.join(f'<a href="{h}">{esc(t)}</a>' for t, h in links) + code + FOOTER_EXTRA + text[fend:]
    # Related pages, just before the end of <main>; rewritten each time.
    start = text.find('<section class="section related"')
    if start >= 0:
        line_start = text.rfind('\n', 0, start) + 1
        end = text.find('</section>', start) + len('</section>')
        text = text[:line_start] + text[end:].lstrip('\n')
    block = render_related(path.name)
    if block and '</main>' in text:
        i = text.rfind('</main>')
        line_start = text.rfind('\n', 0, i) + 1
        text = text[:line_start] + block + '\n' + text[line_start:]
    new = text.replace('\n', nl)
    if new != raw:
        path.write_bytes(new.encode('utf-8'))
    return True


if __name__ == '__main__':
    pages = sorted(DIST.glob('*.html'))
    done = [p.name for p in pages if sync(p)]
    missing = [h for _, t in NAV if not isinstance(t, str) for _, h, _ in t if not (DIST / h).exists()]
    print(f'menu written in {len(done)} pages: {", ".join(done)}')
    if missing:
        print(f'pages in the menu that do not exist yet: {", ".join(missing)}', file=sys.stderr)
