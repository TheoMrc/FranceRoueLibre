"""Fraude fiscale, écart fiscal et contrôle fiscal, for la Loupe and the site (dist/data/fraude.json).

Two files, downloaded by this script into sources/raw/fraude/ (kept, with their SHA-256 in the output):
  - Cour des comptes, « La lutte contre la fraude fiscale », rapport public thématique, 16 December 2025 (PDF): results
    of the tax audits 2015-2024 (tableau 1), rights recalled per tax (tableau 2), recovered amounts, the three old
    estimates of the tax gap (tableau 3), the VAT estimates of the DGFiP, the Insee and the European Commission, staff,
    criminal follow-up. Every figure is read in the PDF text by a pattern; a pattern that does not match stops the
    script (a new edition of the report must be checked, never filled by hand).
  - European Commission, « VAT gap in the EU, 2025 report », statistical tables (XLSX): VAT compliance gap of France
    2013-2024 in million euros (table 204), VAT revenues (table 203), gap in % 2000-2024 (table 205, 2024 = forecast).
Run (PyMuPDF needed for the PDF):  python scripts/fraude-data.py [--force]
Without network, from a text dump of the PDF (pages marked « === PAGE n »):  python scripts/fraude-data.py --text cour.txt
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'sources' / 'raw' / 'fraude'
OUT = ROOT / 'dist' / 'data' / 'fraude.json'
COUR = {'file': 'ccomptes-lutte-fraude-fiscale-2025.pdf',
        'url': 'https://www.ccomptes.fr/sites/default/files/2025-12/20251216-Lutte-contre-la-fraude-fiscale.pdf',
        'title': 'Cour des comptes, La lutte contre la fraude fiscale, rapport public thématique, décembre 2025'}
VAT = {'file': 'ce-vat-gap-2025-tables.xlsx',
       'url': 'https://taxation-customs.ec.europa.eu/document/download/b3045343-a25a-4fcf-97c8-b27c413b95ad_en?filename=VAT-GAP-2025-tables.xlsx',
       'title': 'Commission européenne, VAT gap in the EU, rapport 2025, tableaux statistiques',
       'page': 'https://taxation-customs.ec.europa.eu/taxation/vat/fight-against-vat-fraud/vat-gap_en'}


def download(src: dict, force: bool) -> Path:
    path = RAW / src['file']
    if force or not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(src['url'], headers={'User-Agent': 'Mozilla/5.0 (FranceRoueLibre open data)'})
        data = urllib.request.urlopen(req, timeout=180).read()
        path.write_bytes(data)
        print(f'téléchargé {path.relative_to(ROOT)} ({len(data):,} octets)')
    return path


def provenance(src: dict, path: Path) -> dict:
    return {'titre': src['title'], 'url': src['url'], 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'telecharge_le': dt.date.fromtimestamp(path.stat().st_mtime).isoformat(), 'octets': path.stat().st_size}


# ------------------------------------------------------------------------------------------- Cour des comptes PDF
def pdf_pages(path: Path) -> dict:
    import fitz  # PyMuPDF
    return {i: page.get_text() for i, page in enumerate(fitz.open(path), 1)}


def text_pages(path: Path) -> dict:
    parts = re.split(r'\n=== PAGE (\d+)[^\n]*\n', '\n' + path.read_text(encoding='utf-8'))
    return {int(parts[i]): parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def n(s: str) -> float:
    return float(s.replace(' ', '').replace('\xa0', '').replace(' ', '').replace(',', '.'))


class Report:
    def __init__(self, pages: dict):
        self.pages = pages
        self.flat = {k: re.sub(r'\s+', ' ', v) for k, v in pages.items()}

    def find(self, pattern: str, what: str):
        """(match, page) of the first page whose text matches; stops the script when none does."""
        for p in sorted(self.flat):
            m = re.search(pattern, self.flat[p])
            if m:
                return m, p
        sys.exit(f'Cour des comptes : « {what} » introuvable (motif {pattern!r}). Nouvelle édition du rapport ? Vérifier.')

    def table(self, title: str, rows: dict, count: int) -> dict:
        """A table of the report: the years after its title, then for each row label its `count` numbers."""
        m, p = self.find(re.escape(title), title)
        text = self.flat[p][m.end():]
        years = [int(y) for y in re.findall(r'\b(20\d\d)\b', text[:200])[:count]]
        if len(years) != count or years != list(range(years[0], years[0] + count)):
            sys.exit(f'{title} : années illisibles {years}')
        out = {'annees': years, 'page': p}
        num = r'(-?\d+,\d+)'
        for key, label in rows.items():
            mm = re.search(re.escape(label) + r'\*?\s+' + r'\s+'.join([num] * count), text)
            if not mm:
                sys.exit(f'{title} : ligne « {label} » illisible')
            out[key] = [n(v) for v in mm.groups()]
        return out


def cour(pages: dict) -> dict:
    r = Report(pages)
    t1 = r.table('Tableau n° 1 : résultats du contrôle fiscal 2015-2024 (en Md€)', {
        'droits_nets_rappeles': 'Droits nets rappelés',
        'credits_non_rembourses': "Taxes et crédits d'impôts non remboursés",
        'droits_rectifies': 'Total des droits rectifiés',
        'penalites_interets': 'Pénalités et intérêts de retard',
        'resultats_totaux': 'Résultats totaux du contrôle fiscal'}, 10)
    for i in range(10):  # the table adds up (rounding at 0.02 Md€)
        assert abs(t1['droits_nets_rappeles'][i] + t1['credits_non_rembourses'][i] - t1['droits_rectifies'][i]) < .03, i
        assert abs(t1['droits_rectifies'][i] + t1['penalites_interets'][i] - t1['resultats_totaux'][i]) < .03, i
    t2 = r.table('Tableau n° 2 : répartition des droits nets rappelés par impôts (2015-2024, en Md€)', {
        'impot_societes': 'Impôt sur les sociétés', 'impot_revenu': 'Impôt sur le revenu', 'tva': 'TVA',
        'droits_enregistrement': "Droits d'enregistrement", 'impot_fortune': 'Impôt sur la fortune',
        'impots_locaux': 'Impôts locaux', 'autres': 'Autres impôts'}, 10)

    m, p = r.find(r'Les recettes recouvrées issues du contrôle fiscal.{0,80}?passées de ([\d,]+) Md€ en (\d{4}) à ([\d,]+) Md€ en (\d{4})', 'recettes recouvrées')
    recouvre = {'montants_md_eur': {m.group(2): n(m.group(1)), m.group(4): n(m.group(3))}, 'page': p}
    m, p = r.find(r'équivalaient à ([\d,]+) % du montant des recettes fiscales encaissées par la DGFiP en (\d{4}), cette proportion n’est plus que de ([\d,]+) % en (\d{4})', 'part dans les recettes')
    part = {'pct': {m.group(2): n(m.group(1)), m.group(4): n(m.group(3))}, 'page': p}
    m, p = r.find(r'recettes fiscales brutes recouvrées par la DGFiP ont crû de (\d+) % entre (\d{4}) et (\d{4})', 'hausse des recettes')
    recettes = {'hausse_pct': n(m.group(1)), 'de': int(m.group(2)), 'a': int(m.group(3)), 'page': p}
    m, p = r.find(r'proche de (\d+) ou de (\d+) Md€ sur un total de prélèvements obligatoires de ([\d ]+) Md€ en (\d{4})', 'fourchette de l’ignorance')
    ignorance = {'de': n(m.group(1)), 'a': n(m.group(2)), 'prelevements_obligatoires_md_eur': n(m.group(3)), 'annee': int(m.group(4)), 'page': p,
                 'citation': f'Nul ne peut aujourd’hui se hasarder à affirmer que ce montant est proche de {m.group(1)} ou de {m.group(2)} Md€'}

    # Tableau 3: three old estimates of the tax gap
    est = []
    for key, pat, who in (
            ('courson-leonard', r'Rapport de Courson-Léonard \((\d{4})\) Entre ([\d,]+) et ([\d,]+) Entre ([\d,]+) et ([\d,]+) % Entre ([\d,]+) et ([\d,]+) %', 'Rapport des députés de Courson et Léonard'),
            ('cpo', r'Rapport du CPO sur la fraude \((\d{4})\) Entre ([\d,]+) et ([\d,]+) ([\d,]+) à ([\d,]+) % ([\d,]+) à ([\d,]+) %', 'Conseil des prélèvements obligatoires'),
            ('solidaires', r'Rapport de Solidaires Finances publiques \((\d{4}) sur la base des données exploitées en (?:\d{4})\) Entre ([\d,]+) et ([\d,]+) ([\d,]+) à ([\d,]+) % ([\d,]+) à ([\d,]+) ?%', 'Syndicat Solidaires Finances publiques')):
        m, p = r.find(pat, key)
        g = m.groups()
        est.append({'id': key, 'auteur': who, 'publie_en': int(g[0]), 'bas_md_eur': n(g[1]), 'haut_md_eur': n(g[2]),
                    'pct_pib': [n(g[3]), n(g[4])], 'pct_prelevements': [n(g[5]), n(g[6])], 'page': p})
    m, _ = r.find(r'Reposant sur des données antérieures à (\d{4})', 'données Solidaires')
    est[2]['donnees_anterieures_a'] = int(m.group(1))
    est[2]['avis_cour'] = ('Méthode non détaillée ; associe fraude et évasion fiscale, ce qui « entretient une confusion entre '
                           'agissements légaux et illégaux » ; c’est en réalité une estimation de l’écart fiscal.')
    est[0]['avis_cour'] = 'Données trop anciennes pour être extrapolées ; méthode à considérer avec précaution selon ses auteurs.'
    est[1]['avis_cour'] = 'Méthode expérimentale et fragile, selon le CPO lui-même.'
    m, p = r.find(r'une estimation de la fraude à ([\d,]+) Md€', 'extrapolation Courson-Léonard')
    est[0]['extrapolation_md_eur'] = n(m.group(1))
    est[0]['extrapolation_avis'] = 'hypothèse simplificatrice et probablement infondée (Cour des comptes)'

    # VAT
    m, p = r.find(r'La fourchette finalement dégagée par la DGFiP \(entre (\d+) et (\d+) Md€, soit entre (\d+) et (\d+) % du montant de TVA effectivement collectée', 'TVA DGFiP')
    tva = [{'id': 'dgfip', 'auteur': 'DGFiP (méthode « ascendante », à partir des contrôles)', 'publie': 'septembre 2024',
            'bas_md_eur': n(m.group(1)), 'haut_md_eur': n(m.group(2)), 'pct_tva_collectee': [n(m.group(3)), n(m.group(4))], 'page': p,
            'perimetre': 'TVA des entreprises qui la déclarent, sans les entreprises défaillantes ni les activités non déclarées',
            'avis_cour': 'Seule estimation récente par une méthode rigoureuse, mais incomplète.'}]
    m, p = r.find(r'celle estimée par l’Insee\S* en (\d{4}) \(entre (\d+) et (\d+) Md€\)', 'TVA Insee')
    tva.append({'id': 'insee', 'auteur': 'Insee (document de travail)', 'publie': m.group(1), 'bas_md_eur': n(m.group(2)),
                'haut_md_eur': n(m.group(3)), 'page': p, 'perimetre': 'extrapolation des seuls contrôles sur place',
                'avis_cour': 'Surestimée : les contrôles sur place visent les cas les plus suspects.'})
    m, p = r.find(r'évalué par la Commission européenne entre (\d+) et (\d+) Md€ en (\d{4}) et (\d{4})', 'TVA Commission (Cour)')
    tva.append({'id': 'commission-cour', 'auteur': 'Commission européenne (cité par la Cour)', 'annees': [int(m.group(3)), int(m.group(4))],
                'bas_md_eur': n(m.group(1)), 'haut_md_eur': n(m.group(2)), 'page': p,
                'perimetre': 'méthode « descendante » : TVA théorique d’après la comptabilité nationale, moins la TVA perçue',
                'avis_cour': 'La DGFiP juge que cette méthode ne tient pas compte des spécificités françaises.'})

    m, p = r.find(r'qu’elle réalise l’estimation de cet écart fiscal pour l’impôt sur les sociétés et l’impôt sur le revenu d’ici (\d{4})', 'échéance IS et IR')
    echeance = {'impots': ['impôt sur les sociétés', 'impôt sur le revenu'], 'annee': int(m.group(1)), 'page': p,
                'note': 'Aucune estimation de l’écart fiscal n’existe pour ces deux impôts : la Cour demande qu’elle soit faite.'}
    m, p = r.find(r'(\w+) statisticiens chargés, depuis (\w+ \d{4}), d’évaluer l’écart fiscal', 'statisticiens')
    moyens = {'statisticiens': {'trois': 3, 'deux': 2, 'quatre': 4}.get(m.group(1), m.group(1)), 'depuis': m.group(2), 'page_statisticiens': p}
    m, p = r.find(r'les effectifs affectés au contrôle fiscal ont, selon la DGFiP, diminué de (\d+) % entre (\d{4}) et (\d{4})', 'effectifs')
    moyens |= {'baisse_effectifs_controle_pct': n(m.group(1)), 'periode': [int(m.group(2)), int(m.group(3))], 'page_effectifs': p}
    m, p = r.find(r'En (\d{4}), l’administration fiscale a réalisé près de ([\d ]+) contrôles de professionnels et près de ([\d ]+) contrôles sur des particuliers', 'nombre de contrôles')
    moyens |= {'annee_controles': int(m.group(1)), 'controles_professionnels': int(n(m.group(2))),
               'controles_particuliers': int(n(m.group(3))), 'page_controles': p}
    m, p = r.find(r'\(([\d,]+) Md€ de fraudes pour ([\d,]+) Md€ d’irrégularités involontaires en (\d{4})\)', 'fraude sur place')
    detecte = {'annee': int(m.group(3)), 'fraude_md_eur': n(m.group(1)), 'erreurs_md_eur': n(m.group(2)), 'page': p,
               'note': 'Seulement les contrôles sur place : la fraude trouvée lors des contrôles sur pièces n’est pas comptée à part.'}
    m, _ = r.find(r'la fraude détectée par l’administration fiscale dans le cadre des contrôles sur place accuse une baisse significative \(- (\d+) % entre (\d{4}) et (\d{4})\)', 'baisse fraude sur place')
    detecte['evolution_pct'] = -n(m.group(1))
    detecte['depuis'] = int(m.group(2))

    m, p = r.find(r'les dossiers transmis au parquet par l’administration fiscale ont connu une forte augmentation depuis (\d{4}), passant de ([\d ]+) à ([\d ]+) en (\d{4})', 'parquet')
    penal = {'dossiers_parquet': {m.group(1): int(n(m.group(2))), m.group(4): int(n(m.group(3)))}, 'page_parquet': p}
    m, p = r.find(r'environ (\d+) à (\d+) personnes physiques ou morales condamnées chaque année pour fraude fiscale', 'condamnations')
    penal |= {'condamnes_par_an': [int(m.group(1)), int(m.group(2))], 'page_condamnes': p}
    m, _ = r.find(r'dont (\d+) % de peines de prison ferme', 'prison ferme')
    penal['prison_ferme_pct'] = n(m.group(1))
    m, _ = r.find(r'pour un montant moyen de ([\d ]+) € en (\d{4})', 'amende moyenne')
    penal['amende_moyenne_eur'] = {m.group(2): n(m.group(1))}
    m, _ = r.find(r'en (\d{4}), seul un quart des personnes mises en cause ont réellement fait l’objet de poursuites devant le tribunal correctionnel, tandis que pour (\d+) % d’entre elles, la procédure pénale s’est conclue par un classement sans suite et pour (\d+) % par des alternatives aux poursuites', 'suites pénales')
    penal['suites'] = {'annee': int(m.group(1)), 'tribunal_pct': 25, 'classement_sans_suite_pct': n(m.group(2)), 'alternatives_pct': n(m.group(3))}

    return {'controle': t1, 'droits_par_impot': t2, 'recouvre': recouvre, 'part_dans_recettes': part, 'recettes_dgfip': recettes,
            'incertitude': ignorance, 'estimation_demandee': echeance, 'estimations_ecart_global': est, 'estimations_tva': tva, 'moyens': moyens,
            'fraude_detectee_sur_place': detecte, 'penal': penal}


# ------------------------------------------------------------------------------------------- Commission VAT gap
def xlsx_sheets(path: Path) -> dict:
    """{sheet name: [[cell values]]} with the standard library (no openpyxl needed)."""
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        shared = [''.join(t.text or '' for t in si.iter(ns + 't')) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(ns + 'si')]
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    out = {}
    for s in ET.fromstring(z.read('xl/workbook.xml')).find(ns + 'sheets'):
        rid = s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        target = rels[rid].lstrip('/')
        target = target if target.startswith('xl/') else 'xl/' + target
        rows = []
        for row in ET.fromstring(z.read(target)).iter(ns + 'row'):
            vals = {}
            for c in row.findall(ns + 'c'):
                col = re.match(r'[A-Z]+', c.get('r')).group(0)
                v, t = c.find(ns + 'v'), c.get('t')
                val = None if v is None else (shared[int(v.text)] if t == 's' else v.text)
                if t == 'inlineStr':
                    val = ''.join(x.text or '' for x in c.iter(ns + 't'))
                vals[col] = val
            idx = lambda col: sum((ord(ch) - 64) * 26 ** i for i, ch in enumerate(reversed(col))) - 1
            line = [None] * (max((idx(k) for k in vals), default=-1) + 1)
            for k, v in vals.items():
                line[idx(k)] = v
            rows.append(line)
        out[s.get('name')] = rows
    return out


def series(rows: list, title_start: str, country: str = 'FR') -> dict:
    assert str(rows[0][0] or '').startswith(title_start), (title_start, rows[0][0])
    head = next(r for r in rows if r and any(re.fullmatch(r'20\d\d', str(x or '')) for x in r))
    line = next(r for r in rows if r and r[0] == country)
    out = {}
    for y, v in zip(head, line):
        if re.fullmatch(r'20\d\d', str(y or '')):
            try:
                out[int(y)] = float(v)
            except (TypeError, ValueError):
                pass
    return out


def vat(path: Path) -> dict:
    s = xlsx_sheets(path)
    gap = series(s['Table 204'], 'VAT compliance gap (EUR million)')
    rev = series(s['Table 203'], 'VAT revenues (EUR million)')
    pct = series(s['Table 205'], 'VAT compliance gap – all available estimates (%)')
    t205 = s['Table 205']
    kind = next(r for r in t205 if r and any(str(x or '').startswith('Forecast') for x in r))
    head = next(r for r in t205 if r and any(re.fullmatch(r'20\d\d', str(x or '')) for x in r))
    forecast = [int(head[i]) for i, x in enumerate(kind) if str(x or '').startswith('Forecast')]
    full_from = [int(head[i]) for i, x in enumerate(kind) if str(x or '').startswith('Full')]
    years = sorted(y for y in gap if y in rev)
    share = {y: gap[y] / (gap[y] + rev[y]) for y in years}   # the gap is the VAT due minus the VAT received
    start = full_from[0] if full_from else min(years)
    for y in years:  # table 205 gives the same share for the years of full estimates (before: other vintages)
        if y >= start and y in pct:
            assert abs(share[y] - pct[y]) < .002, (y, gap[y], rev[y], pct[y])
    return {'annees': years, 'ecart_meur': [gap[y] for y in years], 'recettes_meur': [rev[y] for y in years],
            'ecart_pct_tva_due': [round(100 * share[y], 1) for y in years],
            'provisoires': [y for y in years if forecast and y >= forecast[0]],
            'estimations_completes_depuis': full_from[0] if full_from else None,
            'definition': 'TVA due d’après la comptabilité nationale moins la TVA perçue : fraude, faillites, erreurs et '
                          'optimisation mêlées.'}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--force', action='store_true', help='retélécharge les deux fichiers')
    ap.add_argument('--text', help='texte du PDF déjà extrait (pages marquées « === PAGE n »)')
    ap.add_argument('--xlsx', help='tableaux de la Commission déjà téléchargés')
    a = ap.parse_args()
    if a.text:
        pages, cour_src = text_pages(Path(a.text)), {'titre': COUR['title'], 'url': COUR['url']}
    else:
        path = download(COUR, a.force)
        pages, cour_src = pdf_pages(path), provenance(COUR, path)
    vpath = Path(a.xlsx) if a.xlsx else download(VAT, a.force)
    data = {'source': 'python scripts/fraude-data.py', 'sources': {'cour': cour_src, 'commission': provenance(VAT, vpath) | {'page': VAT['page']}},
            **cour(pages), 'ecart_tva_commission': vat(vpath)}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    c, v = data['controle'], data['ecart_tva_commission']
    print(f'{OUT.relative_to(ROOT)} : contrôle {c["annees"][0]}-{c["annees"][-1]} ({c["resultats_totaux"][0]} → {c["resultats_totaux"][-1]} Md€), '
          f'écart de TVA {v["annees"][0]}-{v["annees"][-1]} ({v["ecart_meur"][-1]:.0f} M€ en {v["annees"][-1]}, provisoire {v["provisoires"]})')


if __name__ == '__main__':
    main()
