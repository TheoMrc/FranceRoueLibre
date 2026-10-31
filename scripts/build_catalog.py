"""Inventory of sources (from sources/raw/manifest.json) and known blind spots → dist/data/catalog.json."""
import json
import re
import os

MANIFEST = 'sources/raw/manifest.json'

TOPICS = [
    ('ofgl-', 'Collectivités locales', 'OFGL'),
    ('delais-', 'Collectivités locales', 'DGFiP'),
    ('etat-', 'État', 'DGFiP / Direction du budget'),
    ('plf', 'État', 'Direction du budget'),
    ('rap-', 'État', 'Direction du budget'),
    ('aide-publique', 'État', 'DG Trésor'),
    ('jaune-', 'Subventions', 'Direction du budget'),
    ('aides-', 'Subventions', 'DGE / registre de transparence'),
    ('france-relance', 'Subventions', 'Secrétariat général France Relance'),
    ('plan-de-relance', 'Subventions', 'Secrétariat général France Relance'),
    ('datagouv-fonds-vert', 'Subventions', 'Ministère de la Transition écologique'),
    ('datagouv-ars', 'Santé', 'ARS Pays de la Loire'),
    ('decp', 'Commande publique', 'DAJ / DGFiP'),
    ('datagouv-cnam', 'Santé', 'Assurance maladie'),
    ('datagouv-secu', 'Sécurité sociale', 'Ministère des Solidarités'),
    ('datagouv-', 'État', 'data.gouv.fr'),
    ('atteintes-probite', 'Intégrité', 'Ministère de la Justice'),
    ('insee-', 'Macroéconomie', 'Insee'),
]

STATIC = [
    {'id': 'insee-comptes', 'title': 'Comptes nationaux des administrations publiques (tableaux 3.101, 3.105, 3.201, 3.215, ratios, impôts)', 'topic': 'Comptes nationaux', 'publisher': 'Insee', 'period': '1959–2025', 'url': 'https://www.insee.fr/fr/statistiques/8988845'},
    {'id': 'impots-rendements', 'title': 'Rendement de chaque impôt et taxe : Insee (comptes nationaux), Voies et moyens, Cour des comptes, Sécurité sociale, OFGL/DGCL, rapports parlementaires (relevé manuel, sources/impots-liste.json)', 'topic': 'Fiscalité', 'publisher': 'Insee, Cour des comptes, Parlement, DGCL', 'period': '2022–2025', 'url': 'https://www.insee.fr/fr/statistiques/2381408'},
    {'id': 'impots-couts', 'title': 'Coût de collecte des impôts : taux d’intervention DGFiP, douane, Urssaf, frais de gestion (CGI art. 1641), Cour des comptes (relevé manuel, sources/impots-couts.json)', 'topic': 'Fiscalité', 'publisher': 'DGFiP, DGDDI, Urssaf, Cour des comptes', 'period': '1999–2025', 'url': 'https://www.assemblee-nationale.fr/dyn/dyn/contenu/visualisation/906955/file/Gestion_finances_publiques.pdf'},
    {'id': 'dgcl-projets', 'title': 'Projets financés par les dotations d’investissement (DETR, DSIL, DPV, DSID)', 'topic': 'Subventions', 'publisher': 'DGCL', 'period': '2025', 'url': 'https://www.data.gouv.fr/datasets/projets-finances-par-les-dotations-de-soutien-a-linvestissement-des-collectivites-territoriales'},
    {'id': 'eurostat-cofog', 'title': 'Dépenses des administrations publiques par fonction et par nature (CFAP/COFOG)', 'topic': 'Comptes nationaux', 'publisher': 'Eurostat (données Insee)', 'period': '1995–2024', 'url': 'https://ec.europa.eu/eurostat/databrowser/view/gov_10a_exp/default/table?lang=fr'},
    {'id': 'cpv-2008', 'title': 'Vocabulaire commun pour les marchés publics (CPV 2008), libellés français', 'topic': 'Commande publique', 'publisher': 'Office des publications de l’UE', 'period': '2008', 'url': 'https://op.europa.eu/fr/web/eu-vocabularies/cpv'},
    {'id': 'etalab-contours', 'title': 'Contours administratifs 2025', 'topic': 'Géographie', 'publisher': 'Etalab', 'period': '2025', 'url': 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025/geojson/'},
]

# Checked in the data.gouv.fr, data.economie.gouv.fr and data.ofgl.fr catalogues on 27 October 2026.
GAPS = [
    {'title': 'Coût de collecte de chaque impôt', 'state': 'none', 'text': 'La DGFiP ne publie qu’un taux de gestion global (0,54 % des recettes brutes en 2024) : aucun coût par impôt (IR, IS, TVA, taxe foncière, successions…). La Cour des comptes ignore même le rendement de 117 des 243 petites taxes recensées en 2024.'},
    {'title': 'Hôpitaux publics', 'state': 'none', 'text': 'Aucun jeu national ouvert des comptes financiers des ≈ 1 300 établissements publics de santé (≈ 100 Md€ de charges). Les indicateurs Hospidiag/ScanSanté sont consultables mais pas téléchargeables en masse.'},
    {'title': 'Agences régionales de santé et FIR', 'state': 'partial', 'text': 'Le fonds d’intervention régional (plusieurs Md€ par an) n’est publié ligne à ligne que par l’ARS Pays de la Loire (2025). Les 17 autres ARS ne publient pas leurs subventions en données ouvertes.'},
    {'title': 'CPTS et exercice coordonné', 'state': 'none', 'text': 'Les financements des communautés professionnelles territoriales de santé (accord conventionnel interprofessionnel) ne sont pas publiés par structure.'},
    {'title': 'Agences sanitaires (HAS, ANSM, Santé publique France…)', 'state': 'partial', 'text': 'Budgets visibles seulement agrégés dans l’annexe « opérateurs » du projet de loi de finances ; ni dépenses détaillées ni marchés hors DECP.'},
    {'title': 'Sécurité sociale par branche et par caisse', 'state': 'partial', 'text': 'Comptes publiés en rapports PDF (Commission des comptes, Cour des comptes). En données : dépenses remboursées par région et Open Damir (très volumineux).'},
    {'title': 'Collèges, lycées et écoles', 'state': 'none', 'text': 'Les budgets des ≈ 7 800 établissements publics locaux d’enseignement ne sont pas publiés en données ouvertes ; seul le compte de l’éducation donne des agrégats nationaux.'},
    {'title': 'Universités', 'state': 'partial', 'text': 'Pas de jeu consolidé des comptes financiers par université trouvé dans les catalogues ; les rapports annuels restent en PDF.'},
    {'title': 'Subventions des collectivités', 'state': 'partial', 'text': 'Les montants totaux sont connus (OFGL : « subventions aux personnes de droit privé »), mais les bénéficiaires ne sont publiés que par une minorité de collectivités, sans consolidation nationale.'},
    {'title': 'Aides fiscales aux entreprises (CIR, crédits d’impôt…)', 'state': 'none', 'text': 'Les dépenses fiscales sont chiffrées par mesure dans le PLF, mais aucun bénéficiaire n’est publié (secret fiscal), y compris pour les montants les plus élevés.'},
    {'title': 'Prix unitaires et quantités achetées', 'state': 'none', 'text': 'Les marchés publics ne publient que le montant total du contrat, jamais les quantités ni les prix à l’unité. Les bordereaux de prix restent dans les dossiers de chaque marché, le catalogue de l’UGAP n’est pas public, et les factures (transmises par Chorus Pro) ne sont pas ouvertes : impossible de comparer le prix d’une lampe ou d’une ampoule au prix du commerce sans demande d’accès aux documents (CADA).'},
    {'title': 'Petits marchés publics', 'state': 'none', 'text': 'Les marchés de moins de 40 000 € HT n’ont pas à être publiés dans les DECP : ils échappent à tout suivi ouvert.'},
    {'title': 'Opérateurs de l’État', 'state': 'partial', 'text': 'La liste des ≈ 430 opérateurs est ouverte, leurs budgets détaillés et effectifs restent dans des annexes PDF.'},
    {'title': 'Rémunérations des dirigeants publics', 'state': 'partial', 'text': 'Seules les « dix plus hautes rémunérations » de certains ministères et collectivités sont publiées, de manière dispersée et non standardisée.'},
]


def topic_for(source_id):
    for prefix, topic, publisher in TOPICS:
        if source_id.startswith(prefix):
            return topic, publisher
    return 'Autres', ''


TITLES = {
    'ofgl-departements': 'Départements 2012–2025, comptes consolidés', 'ofgl-regions': 'Régions 2012–2025, comptes consolidés',
    'ofgl-syndicats': 'Syndicats intercommunaux, comptes consolidés', 'ofgl-sdis': 'Services départementaux d’incendie et de secours (SDIS)',
    'ofgl-ccas': 'Centres d’action sociale (CCAS, CIAS)', 'ofgl-dotations-departements': 'Dotations de l’État aux départements',
    'ofgl-dotations-regions': 'Dotations de l’État aux régions', 'ofgl-dotations-gfp': 'Dotations de l’État aux intercommunalités',
    'ofgl-populations-communes': 'Populations légales des communes (OFGL)', 'delais-paiement-2025': 'Délais de paiement des collectivités · 2025',
    'delais-paiement-2024': 'Délais de paiement des collectivités · 2024', 'etat-situations-mensuelles': 'Situations mensuelles budgétaires de l’État (séries longues)',
    'etat-situation-mensuelle': 'Situation mensuelle de l’État', 'plf25-depenses-destination': 'PLF 2025 : dépenses par mission et programme',
    'plf25-depenses-nature': 'PLF 2025 : dépenses par destination et nature', 'plf25-recettes': 'PLF 2025 : recettes du budget général',
    'plf25-recettes-cas-ccf': 'PLF 2025 : recettes des comptes spéciaux', 'plf24-taxes-affectees': 'PLF 2024 : taxes affectées à des organismes',
    'rap-2025-performance': 'Rapports annuels de performance 2025', 'plf26-budget-vert': 'PLF 2026 : budget vert',
    'aide-publique-developpement': 'Aide publique au développement', 'datagouv-depenses-fiscales': 'Dépenses fiscales (niches) par mesure, PLF 2024',
    'datagouv-operateurs-2026': 'Opérateurs de l’État, PLF 2026', 'datagouv-criteres-dotations': 'Critères de répartition des dotations aux collectivités',
    'france-relance': 'France Relance : données agrégées', 'plan-de-relance': 'Plan de relance : mesures territorialisées',
    'datagouv-fonds-vert': 'Fonds vert : projets subventionnés', 'datagouv-ars-pdl-fir': 'ARS Pays de la Loire : subventions du FIR 2025',
    'decp-v3': 'Marchés publics (DECP, format v3)', 'decp-2022': 'Marchés publics (DECP, format 2022)', 'decp-concessions': 'Contrats de concession (DECP)',
    'atteintes-probite': 'Atteintes à la probité enregistrées', 'insee-population': 'Population de la France (Insee)',
    'datagouv-cnam-ville': 'Assurance maladie : dépenses de soins de ville', 'datagouv-cnam-cliniques': 'Assurance maladie : dépenses des cliniques privées',
    'datagouv-cnam-regions': 'Assurance maladie : dépenses par région', 'datagouv-secu-comptes': 'Comptes de la Sécurité sociale',
}


def pretty_title(source_id, item):
    if source_id in TITLES:
        return TITLES[source_id]
    """Readable title: the manifest note, else the dataset slug turned into words; the edition year is appended when the id carries one."""
    title = item.get('note') or (item.get('dataset') or item.get('slug') or source_id).replace('-', ' ').replace('_', ' ')
    title = title[:1].upper() + title[1:]
    match = re.search(r'(20\d\d)$', source_id)
    if match and match.group(1) not in title:
        title += f' · PLF {match.group(1)}' if source_id.startswith('jaune-') else f' · {match.group(1)}'
    return title


def main():
    manifest = json.load(open(MANIFEST, encoding='utf-8')) if os.path.exists(MANIFEST) else {}
    sources = list(STATIC)
    for source_id, item in manifest.items():
        topic, publisher = topic_for(source_id)
        files = item.get('files', [])
        sources.append({
            'id': source_id, 'title': pretty_title(source_id, item), 'topic': topic, 'publisher': publisher,
            'records': sum(f.get('records') or 0 for f in files) or None, 'bytes': sum(f.get('bytes') or 0 for f in files),
            'downloadedAt': item.get('downloadedAt'), 'modified': next((f.get('modified') for f in files if f.get('modified')), None),
            'url': f"https://{item['host']}/explore/dataset/{item['dataset']}/" if item.get('host') else (f"https://www.data.gouv.fr/datasets/{item['slug']}/" if item.get('slug') else files[0]['url'] if files else None),
        })
    os.makedirs('dist/data', exist_ok=True)
    json.dump({'generated': max([s.get('downloadedAt') or '' for s in sources] or ['']), 'sources': sources, 'gaps': GAPS},
              open('dist/data/catalog.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'✓ catalogue : {len(sources)} sources, {len(GAPS)} angles morts')


if __name__ == '__main__':
    main()
