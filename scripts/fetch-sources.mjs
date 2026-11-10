// Downloads every open public-finance source used by FranceRoueLibre into sources/raw/.
// Usage (Node 18+, from the project folder):  node scripts/fetch-sources.mjs [--only=<id,...>] [--force]
// Files are stored gzip-compressed with a provenance manifest (URL, date, size, SHA-256).
// Already-downloaded files are skipped unless --force is given, so the script can be re-run after an interruption.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const OUT = path.resolve('sources/raw');
const MANIFEST = path.join(OUT, 'manifest.json');
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [k, v] = arg.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const only = args.only ? new Set(String(args.only).split(',')) : null;

const OFGL = 'data.ofgl.fr';
const ECO = 'data.economie.gouv.fr';

// kind "ods": OpenDataSoft dataset export (CSV). `select` lists wanted fields; absent ones are ignored.
// kind "datagouv": every CSV/XLSX/JSON resource of a data.gouv.fr dataset.
// kind "insee": BDM series (SDMX XML).
const SOURCES = [
  // ---- Local authorities: all 54 OFGL aggregates (revenues, taxes, grants, spending, debt) ----
  { id: 'ofgl-communes', kind: 'ods', host: OFGL, dataset: 'ofgl-base-communes-consolidee', chunk: 'exer', select: ['exer', 'insee', 'siren', 'dep_code', 'agregat', 'montant', 'ptot'], note: 'Communes 2018–2025, budgets principaux + annexes consolidés' },
  { id: 'ofgl-gfp', kind: 'ods', host: OFGL, dataset: 'ofgl-base-gfp-consolidee', select: ['exer', 'siren', 'siren_25', 'epci_name', 'lbudg', 'dep_code', 'reg_code', 'nat_juridique', 'agregat', 'montant', 'ptot'], note: 'Intercommunalités à fiscalité propre' },
  { id: 'ofgl-departements', kind: 'ods', host: OFGL, dataset: 'ofgl-base-departements-consolidee', select: ['exer', 'dep_code', 'dep_name', 'reg_code', 'siren', 'lbudg', 'categ', 'agregat', 'montant', 'ptot'] },
  { id: 'ofgl-departements-fonctionnelle', kind: 'ods', host: OFGL, dataset: 'ofgl-base-departements-fonctionnelle', select: ['exer', 'dep_code', 'siren', 'type_de_budget', 'agregat', 'montant', 'ptot', 'niveau_hierarchique', 'fonction', 'nom_fonction', 'fonction2'], note: 'Dépenses des départements par fonction (social, routes, collèges…)' },
  { id: 'ofgl-regions', kind: 'ods', host: OFGL, dataset: 'ofgl-base-regions-consolidee', select: ['exer', 'reg_code', 'reg_name', 'siren', 'lbudg', 'categ', 'agregat', 'montant', 'ptot'] },
  { id: 'ofgl-syndicats', kind: 'ods', host: OFGL, dataset: 'ofgl-base-syndicats-consolidee', chunk: 'exer', select: ['exer', 'siren', 'synd_name', 'categorie_synd', 'dep_current_code', 'reg_code', 'agregat', 'montant'] },
  { id: 'ofgl-sdis', kind: 'ods', host: OFGL, dataset: 'ofgl-base-sdis', select: ['exer', 'code_dep', 'siren', 'lbudg', 'agregat', 'montant', 'population_totale', 'nb_intervention_2025'] },
  { id: 'ofgl-epl', kind: 'ods', host: OFGL, dataset: 'ofgl-base-epl-consolidee', select: ['exer', 'siren', 'nom_epl', 'dep_code', 'categorie_epl_abr', 'libelle_cacti_simplifie', 'agregat', 'montant'], note: 'Établissements publics locaux' },
  { id: 'ofgl-ccas', kind: 'ods', host: OFGL, dataset: 'ofgl-base-ccas-cias', chunk: 'exer', select: ['exer', 'siren', 'nom_ccas', 'type', 'code_dep', 'agregat', 'montant'] },
  { id: 'ofgl-dotations-departements', kind: 'ods', host: OFGL, dataset: 'dotations-departements' },
  { id: 'ofgl-dotations-regions', kind: 'ods', host: OFGL, dataset: 'dotations-regions' },
  { id: 'ofgl-dotations-gfp', kind: 'ods', host: OFGL, dataset: 'dotations-gfp' },
  { id: 'ofgl-fiscalite', kind: 'ods', host: OFGL, dataset: 'base-fiscale-simplifiee', chunk: 'exer', select: ['exer', 'idcom', 'siren', 'epci_code', 'dep_code', 'dispositif_fiscal', 'destinataire', 'base', 'taux_net', 'taux_vote', 'produit', 'secret_statistique'], note: 'Bases, taux et produits de la fiscalité locale' },
  { id: 'ofgl-flux-communes', kind: 'ods', host: OFGL, dataset: 'base-communale-flux-financiers', note: 'Flux financiers entre communes et groupements' },
  { id: 'ofgl-populations-communes', kind: 'ods', host: OFGL, dataset: 'populations-ofgl-communes', select: ['annee', 'insee', 'siren', 'epci_code', 'dep_code', 'ptot', 'pmun'] },
  { id: 'delais-paiement-2025', kind: 'ods', host: ECO, dataset: 'delai-paiement-moyen-collectivites-2025' },
  { id: 'delais-paiement-2024', kind: 'ods', host: ECO, dataset: 'delai-paiement-moyen-collectivites-2024' },

  // ---- State budget and accounts ----
  { id: 'etat-balances', kind: 'ods', host: ECO, dataset: 'balances_des_comptes_etat', note: 'Comptabilité générale de l’État par compte, mission, programme' },
  { id: 'etat-situations-mensuelles', kind: 'ods', host: ECO, dataset: 'situations-mensuelles-budgetaires-series-longues' },
  { id: 'etat-situation-mensuelle', kind: 'ods', host: ECO, dataset: 'situation-mensuelle-de-l-etat' },
  { id: 'plf25-depenses-destination', kind: 'ods', host: ECO, dataset: 'plf25-depenses-2025-selon-destination' },
  { id: 'plf25-depenses-nature', kind: 'ods', host: ECO, dataset: 'plf25-depenses-2025-du-bg-et-des-ba-selon-nomenclatures-destination-et-nature' },
  { id: 'plf25-recettes', kind: 'ods', host: ECO, dataset: 'plf25-recettes-du-budget-general' },
  { id: 'plf25-recettes-cas-ccf', kind: 'ods', host: ECO, dataset: 'plf25-recettes-des-cas-et-des-ccf' },
  { id: 'plf24-taxes-affectees', kind: 'ods', host: ECO, dataset: 'plf2024-v-and-m-t1-liste-des-taxes-affectees' },
  { id: 'rap-2025-performance', kind: 'ods', host: ECO, dataset: 'performance-de-la-depense-rap-2025' },
  { id: 'plf26-budget-vert', kind: 'ods', host: ECO, dataset: 'plf-2026-budget-vert' },
  { id: 'aide-publique-developpement', kind: 'ods', host: ECO, dataset: 'aide-publique-au-developpement' },
  { id: 'datagouv-depenses-fiscales', kind: 'datagouv', slug: 'plf-2024-vm-tome-2-depenses-fiscales' },
  { id: 'datagouv-operateurs-2026', kind: 'datagouv', slug: 'projet-de-loi-de-finances-pour-2026-plf-2026-jaune-operateurs-de-letat-liste-des-operateurs-et-categories' },
  { id: 'datagouv-criteres-dotations', kind: 'datagouv', slug: 'criteres-de-repartition-des-dotations-versees-par-letat-aux-collectivites-territoriales' },

  // ---- Subsidies and aid ----
  ...[
    ['jaune-associations-2025', 'plf25-donnees-de-l-annexe-jaune-effort-financier-de-l-etat-en-faveur-des-associations'],
    ['jaune-associations-2020', 'projet-de-loi-de-finances-pour-2020-plf-2020-donnees-de-lannexe-jaune-effort-fin'],
    ['jaune-associations-2018', 'projet-de-loi-de-finances-pour-2018-plf-2018-donnees-de-lannexe-jaune-effort-fin'],
    ['jaune-associations-2017', 'projet-de-loi-de-finances-pour-2017-plf-2017-jaune-effort-financier-de-letat-en-'],
    ['jaune-associations-2016', 'plf-2016-jaune-effort-financier-de-letat-en-faveur-des-associations-'],
    ['jaune-associations-2015', 'plf-2015-jaune-effort-financier-de-letat-en-faveur-des-associations-'],
    ['jaune-associations-2014', 'plf-2014-jaune-donnees-associations-subventionnees-2012'],
    ['jaune-associations-2013', 'plf2013-jaune-donnees-associations-subventionnees'],
    ['jaune-associations-2012', 'plf2012-jaune-donnees-associations-subventionnees']
  ].map(([id, dataset]) => ({ id, kind: 'ods', host: ECO, dataset, note: 'Subventions de l’État aux associations (annexe jaune)' })),
  // Annexes whose list of grants is published only as an attached file (their datasets hold no rows). The PLF 2024 annex
  // (grants of 2022) has no such file: its dataset holds a single column of numbers without names, so 2022 stays missing.
  { id: 'jaune-associations-2023', kind: 'files', note: 'Subventions de l’État aux associations en 2021 (annexe jaune au PLF 2023, fichier joint)', files: [
    { path: 'credits-attribues-2021.xlsx', url: 'https://data.economie.gouv.fr/api/v2/catalog/datasets/plf-2023-effort-financier-de-l-etat-en-faveur-des-associations-liste-des-credits/attachments/plf_2023_effort_financier_de_l_etat_en_faveur_des_associations_liste_des_credits_attribues_xlsx' },
  ] },
  { id: 'jaune-associations-2022', kind: 'files', note: 'Subventions de l’État aux associations en 2020 (annexe jaune au PLF 2022, fichier joint)', files: [
    { path: 'PLF_2022-jaune_associations.csv', url: 'https://data.economie.gouv.fr/api/v2/catalog/datasets/projet-de-loi-de-finances-pour-2022-plf-2022-donnees-de-lannexe-jaune-effort-fin/attachments/plf_2022_jaune_associations_csv' },
  ] },
  { id: 'jaune-associations-2021', kind: 'files', note: 'Subventions de l’État aux associations en 2019 (annexe jaune au PLF 2021, fichier joint)', files: [
    { path: 'credits-attribues-2019.xlsx', url: 'https://data.economie.gouv.fr/api/v2/catalog/datasets/projet-de-loi-de-finances-pour-2021-plf-2021-donnees-de-lannexe-jaune-effort-fin/attachments/plf_2021_credits_attribues_au_monde_associatif_2019_xlsx' },
  ] },
  { id: 'jaune-associations-2019', kind: 'files', note: 'Subventions de l’État aux associations en 2017 (annexe jaune au PLF 2019, fichier joint)', files: [
    { path: 'liste-associations-2017.xlsx', url: 'https://data.economie.gouv.fr/api/v2/catalog/datasets/projet-de-loi-de-finances-pour-2019-plf-2019-donnees-de-lannexe-jaune-effort-fin/attachments/plf2019_jaune_asso_liste_associations2017_xlsx' },
  ] },
  { id: 'aides-minimis', kind: 'ods', host: ECO, dataset: 'aides_minimis', note: 'Aides de minimis aux entreprises' },
  { id: 'france-relance', kind: 'ods', host: ECO, dataset: 'france-relance-donnees-agregees' },
  { id: 'plan-de-relance', kind: 'ods', host: ECO, dataset: 'plan-de-relance' },
  { id: 'datagouv-fonds-vert', kind: 'datagouv', slug: 'fonds-vert-liste-des-projets-subventionnes' },
  { id: 'datagouv-ars-pdl-fir', kind: 'datagouv', slug: 'subventions-de-lars-des-pays-de-la-loire-au-titre-du-fonds-dintervention-regional-fir-2025' },

  // ---- Public procurement ----
  { id: 'decp-v3', kind: 'ods', host: ECO, dataset: 'decp-v3-marches-valides', chunkDate: 'datenotification', note: 'Données essentielles de la commande publique (format 2024+)' },
  { id: 'decp-2022', kind: 'ods', host: ECO, dataset: 'decp-2022-marches-valides', chunkDate: 'datenotification', note: 'Données essentielles de la commande publique (format 2022)' },
  { id: 'decp-concessions', kind: 'ods', host: ECO, dataset: 'decp-v3-concessions-valides' },

  // ---- Health insurance ----
  { id: 'datagouv-cnam-regions', kind: 'datagouv', slug: 'depenses-de-sante-remboursees-par-l-assurance-maladie-par-region-soins-de-ville-etablissement-571512' },
  { id: 'datagouv-cnam-ville', kind: 'datagouv', slug: 'donnees-nationales-sur-les-depenses-dassurance-maladie-relatives-aux-soins-de-ville' },
  { id: 'datagouv-cnam-cliniques', kind: 'datagouv', slug: 'donnees-par-cpam-sur-les-depenses-dassurance-maladie-relatives-aux-etablissements-de-sante-prives' },
  { id: 'datagouv-secu-comptes', kind: 'datagouv', slug: 'comptes-simplifies-des-regimes-de-base-de-securite-sociale-30378403' },

  // ---- Public employment and elected officials ----
  { id: 'datagouv-rne', kind: 'datagouv', slug: 'repertoire-national-des-elus-1', note: 'Répertoire national des élus (ministère de l’Intérieur), tous les mandats' },
  { id: 'fonction-publique', kind: 'files', note: 'DGAFP, rapport annuel 2026 (données au 31/12/2024) ; Insee, effectifs par versant et ministère ; ETPT LFI 2023', files: [
    { path: 'dgafp-ra2026/ra_2026_postes.zip', url: 'https://www.fonction-publique.gouv.fr/files/files/publications/vue-rapport-annuel/2026/ra_2026_postes.zip' },
    { path: 'dgafp-ra2026/ra_2026_effectifs.zip', url: 'https://www.fonction-publique.gouv.fr/files/files/publications/vue-rapport-annuel/2026/ra_2026_effectifs.zip' },
    { path: 'dgafp-ra2026/ra_2026_remu_niveaux.zip', url: 'https://www.fonction-publique.gouv.fr/files/files/publications/vue-rapport-annuel/2026/ra_2026_remu_niveaux.zip' },
    { path: 'insee/marc-empl-eff-fonc-pub.xlsx', url: 'https://www.insee.fr/fr/statistiques/fichier/2493501/marc-empl-eff-fonc-pub.xlsx' },
    { path: 'data-economie/etpt-par-ministere-mission-programme-pour-le-bg-et-les-ba-lfi-2023.csv', url: 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/etpt-par-ministere-mission-programme-pour-le-bg-et-les-ba-lfi-2023/exports/csv?delimiter=%3B' },
  ] },

  { id: 'dette-trimestrielle', kind: 'files', note: 'Insee, dette des administrations publiques au sens de Maastricht, données trimestrielles (réponses enregistrées de la Loupe)', files: [
    { path: 'dette-trimestrielle/econ-gen-dette-trim-adm-pub-2.xlsx', url: 'https://www.insee.fr/fr/statistiques/fichier/2830301/econ-gen-dette-trim-adm-pub-2.xlsx' },
  ] },

  { id: 'senat-comptes', kind: 'files', note: 'Sénat, comptes de l’exercice 2025 (rapport n° 628, 2025-2026), restaurants : réponses enregistrées de la Loupe', files: [
    { path: 'r25-628-chapitre-4.html', url: 'https://www.senat.fr/rap/r25-628/r25-6284.html' },
  ] },

  { id: 'resultats', kind: 'files', note: 'Inflation (Insee), Eurostat et OCDE (comparaisons UE), commerce extérieur, PISA, personnel hospitalier (DREES)', files: [
    { path: 'raw/insee/bdm_000008965.xml', url: 'https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/000008965' },
    { path: 'raw/insee/bdm_001765177.xml', url: 'https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/001765177' },
    { path: 'raw/insee/bdm_011814653.xml', url: 'https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/011814653' },
    { path: 'raw/insee/bdm_011779990.xml', url: 'https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/011779990' },
    { path: 'raw/insee/bdm_011779991.xml', url: 'https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/011779991' },
    { path: 'raw/insee/bdm_011779992.xml', url: 'https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/011779992' },
    { path: 'raw/insee/bdm_011791813.xml', url: 'https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/011791813' },
    { path: 'raw/insee/bdm_011792506.xml', url: 'https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/011792506' },
    { path: 'raw/eurostat/gov_10a_main_S13_D1PAY_D11PAY_TE.json', url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/gov_10a_main?sector=S13&na_item=D1PAY&na_item=D11PAY&na_item=TE&unit=MIO_EUR&unit=PC_GDP&sinceTimePeriod=1995' },
    { path: 'raw/eurostat/gov_10a_exp_S13_D1_cofog.json', url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/gov_10a_exp?sector=S13&na_item=D1&unit=MIO_EUR&unit=PC_GDP&unit=PC_TOT&cofog99=TOTAL&cofog99=GF01&cofog99=GF02&cofog99=GF03&cofog99=GF04&cofog99=GF05&cofog99=GF06&cofog99=GF07&cofog99=GF08&cofog99=GF09&cofog99=GF10&sinceTimePeriod=2015' },
    { path: 'raw/eurostat/nama_10_a10_e_EMP_DC_O-Q.json', url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10_a10_e?na_item=EMP_DC&unit=THS_PER&unit=PC_TOT_PER&nace_r2=TOTAL&nace_r2=O-Q' },
    { path: 'raw/eurostat/nama_10_gdp_FR_trade.json', url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10_gdp?geo=FR&unit=CP_MEUR&na_item=P61&na_item=P71&na_item=P62&na_item=P72&na_item=B1GQ' },
    { path: 'raw/oecd/oecd_gov_glance_DF_GOV_EMPPS_REP_YU.csv', url: 'https://sdmx.oecd.org/public/rest/data/OECD.GOV.GIP,DSD_GOV@DF_GOV_EMPPS_REP_YU,1.0/all?dimensionAtObservation=AllDimensions&format=csvfilewithlabels' },
    { path: 'raw/worldbank/wb_edstats_FRA_LO.PISA.MAT.json', url: 'https://api.worldbank.org/v2/country/FRA/indicator/LO.PISA.MAT?format=json&source=12&per_page=200' },
    { path: 'raw/worldbank/wb_edstats_FRA_LO.PISA.REA.json', url: 'https://api.worldbank.org/v2/country/FRA/indicator/LO.PISA.REA?format=json&source=12&per_page=200' },
    { path: 'raw/worldbank/wb_edstats_FRA_LO.PISA.SCI.json', url: 'https://api.worldbank.org/v2/country/FRA/indicator/LO.PISA.SCI?format=json&source=12&per_page=200' },
    { path: 'raw/drees/Effectifs_salaries_hospitaliers_Prod2026_DSN.xlsx', url: 'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1/catalog/datasets/effectifs-salaries-hospitaliers-series-longues/attachments/effectifs_salaries_hospitaliers_prod2026_dsn_xlsx' },
    { path: 'raw/drees/drees_effectifs_salaries_hospitaliers_series_longues.csv', url: 'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1/catalog/datasets/effectifs-salaries-hospitaliers-series-longues/exports/csv?delimiter=%3B' },
    { path: 'raw/drees/capact_pm_pnm.7z', url: 'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1/catalog/datasets/708_bases-statistiques-sae/attachments/capact_pm_pnm_7z' },
  ] },

  // ---- France compared with the other EU countries (Eurostat) and IMF projections: page europe.html, scripts/europe-data.py ----
  // Every file is optional for the page: a file that is missing or unreadable leaves its section out.
  { id: 'international', kind: 'files', note: 'Eurostat (recettes, déficit, dette, intérêts, taux à dix ans, dépenses par fonction, 27 pays de l’UE) ; FMI, Perspectives de l’économie mondiale (prévisions)', files: [
    { path: 'eurostat/gov_10a_main.json', url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/gov_10a_main?sector=S13&na_item=TR&na_item=TE&na_item=D41PAY&na_item=B9&unit=PC_GDP&unit=MIO_EUR&sinceTimePeriod=1995' },
    { path: 'eurostat/gov_10dd_edpt1.json', url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/gov_10dd_edpt1?sector=S13&na_item=B9&na_item=GD&unit=PC_GDP&unit=MIO_EUR&sinceTimePeriod=1995' },
    { path: 'eurostat/gov_10a_exp_TE_cofog.json', url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/gov_10a_exp?sector=S13&na_item=TE&unit=PC_GDP&cofog99=TOTAL&cofog99=GF01&cofog99=GF02&cofog99=GF03&cofog99=GF04&cofog99=GF05&cofog99=GF06&cofog99=GF07&cofog99=GF08&cofog99=GF09&cofog99=GF10&sinceTimePeriod=1995' },
    { path: 'eurostat/irt_lt_mcby_a.json', url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/irt_lt_mcby_a?sinceTimePeriod=1995' },
    { path: 'fmi/GGXWDG_NGDP.json', url: 'https://www.imf.org/external/datamapper/api/v1/GGXWDG_NGDP' },
    { path: 'fmi/GGXCNL_NGDP.json', url: 'https://www.imf.org/external/datamapper/api/v1/GGXCNL_NGDP' },
    { path: 'fmi/NGDP_RPCH.json', url: 'https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH' },
    { path: 'fmi/PCPIPCH.json', url: 'https://www.imf.org/external/datamapper/api/v1/PCPIPCH' },
  ] },

  // ---- Subsidies granted by local authorities and public bodies (regions, départements, communes, EPCI, ministries) ----
  // No national file exists: each authority publishes its own "données essentielles des conventions de subvention"
  // (décret 2017-779, SCDL schema), compulsory only above 23 000 €. Every CSV of every data.gouv.fr dataset that
  // declares the schema, carries one of the tags or matches the word is downloaded; scripts/subventions-collectivites.py
  // keeps the files whose columns are those of the schema and reports who publishes and who does not.
  { id: 'subventions-collectivites', kind: 'datagouv-search', note: 'Subventions attribuées par les collectivités et organismes publics (data.gouv.fr, schéma SCDL « subventions »)',
    queries: ['schema=scdl/subventions', 'tag=scdl', 'tag=subvention', 'tag=subventions', 'q=subvention', 'q=subventions'], maxBytes: 300 * 1048576 },

  // ---- Indemnities actually paid to local elected officials (accounts 653) ----
  { id: 'balances-653-communes-2017', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-communes-en-2017', where: 'startswith(compte,"653")', note: 'Comptes 653 (indemnités et frais des élus) des communes, 2017' },
  { id: 'balances-653-communes-2018', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-communes-en-2018', where: 'startswith(compte,"653")', note: 'Comptes 653 (indemnités et frais des élus) des communes, 2018' },
  { id: 'balances-653-communes-2019', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-communes-en-2019', where: 'startswith(compte,"653")', note: 'Comptes 653 (indemnités et frais des élus) des communes, 2019' },
  { id: 'balances-653-communes-2020', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-communes-en-2020', where: 'startswith(compte,"653")', note: 'Comptes 653 (indemnités et frais des élus) des communes, 2020' },
  { id: 'balances-653-communes-2021', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-communes-en-2021', where: 'startswith(compte,"653")', note: 'Comptes 653 (indemnités et frais des élus) des communes, 2021' },
  { id: 'balances-653-communes-2022', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-communes-en-2022', where: 'startswith(compte,"653")', note: 'Comptes 653 (indemnités et frais des élus) des communes, 2022' },
  { id: 'balances-653-communes-2023', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-communes-en-2023', where: 'startswith(compte,"653")', note: 'Comptes 653 (indemnités et frais des élus) des communes, 2023' },
  { id: 'balances-653-communes-2024', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-communes-en-2024', where: 'startswith(compte,"653")', note: 'Comptes 653 (indemnités et frais des élus) des communes, 2024' },
  { id: 'balances-653-communes-2025', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-communes-en-2025', where: 'startswith(compte,"653")', note: 'Comptes 653 (indemnités et frais des élus) des communes, 2025' },
  { id: 'balances-653-gfp', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-groupements-a-fiscalite-propre-depuis-2010', where: 'startswith(compte,"653")', note: 'Comptes 653 (élus), toutes années de l’export' },
  { id: 'balances-653-dept', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-departements', where: 'startswith(compte,"653")', note: 'Comptes 653 (élus), toutes années de l’export' },
  { id: 'balances-653-reg', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-regions-', where: 'startswith(compte,"653")', note: 'Comptes 653 (élus), toutes années de l’export' },
  { id: 'balances-653-synd', kind: 'ods', host: ECO, dataset: 'balances-comptables-des-syndicats-depuis-2010', where: 'startswith(compte,"653")', note: 'Comptes 653 (élus), toutes années de l’export' },
  { id: 'balances-653-pj', kind: 'files', note: 'Balances complètes 2017–2019 publiées en pièces jointes (années absentes des exports)', files: [
    { path: 'reg_2017.csv', url: 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/balances-comptables-des-regions-/attachments/balance_reg_2017_dec2018_csv' },
    { path: 'reg_2018.csv', url: 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/balances-comptables-des-regions-/attachments/balance_reg_2018_dec2019_csv' },
    { path: 'reg_2019.csv', url: 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/balances-comptables-des-regions-/attachments/balance_reg_2019_dec2020_csv' },
    { path: 'dept_2017.csv', url: 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/balances-comptables-des-departements/attachments/balance_deptctu_2017_dec2018_csv' },
    { path: 'dept_2018.csv', url: 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/balances-comptables-des-departements/attachments/balance_deptctu_2018_dec2019_csv' },
    { path: 'gfp_2018.csv', url: 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/balances-comptables-des-groupements-a-fiscalite-propre-depuis-2010/attachments/balance_gfpeptml_2018_dec2019_csv' },
    { path: 'gfp_2017.zip', url: 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/balances-comptables-des-groupements-a-fiscalite-propre-depuis-2010/attachments/balance_gfp_2017_zip' },
  ] },

  // ---- Integrity context ----
  { id: 'atteintes-probite', kind: 'ods', host: ECO, dataset: 'atteintes-a-la-probite-dans-les-decisions-de-justice-donnees-nationales-agregees-2021-2025' },

  // ---- Macro series ----
  { id: 'insee-population', kind: 'insee', idbank: '001641586', note: 'Population au 1er janvier, France' }
];

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const saveManifest = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mb = bytes => `${(bytes / 1048576).toFixed(1)} Mo`;

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function download(url, file, { gzip = true } = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const tmp = `${file}.part`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const hash = crypto.createHash('sha256');
      let bytes = 0, lines = 0, lastLog = Date.now();
      const counter = new TransformStream({
        transform(chunk, controller) {
          bytes += chunk.byteLength; hash.update(chunk);
          for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) lines++;
          if (Date.now() - lastLog > 5000) { process.stdout.write(`\r    ${mb(bytes)}…   `); lastLog = Date.now(); }
          controller.enqueue(chunk);
        }
      });
      const source = Readable.fromWeb(response.body.pipeThrough(counter));
      await pipeline(source, ...(gzip ? [zlib.createGzip({ level: 6 })] : []), fs.createWriteStream(tmp));
      fs.renameSync(tmp, file);
      process.stdout.write('\r');
      return { bytes, lines, sha256: hash.digest('hex') };
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      console.warn(`    tentative ${attempt} échouée : ${error.message}`);
      if (attempt === 4) throw error;
      await sleep(5000 * attempt);
    }
  }
}

async function countRecords(source, where) {
  const params = new URLSearchParams({ limit: '0' });
  if (where) params.set('where', where);
  const json = await getJson(`https://${source.host}/api/explore/v2.1/catalog/datasets/${source.dataset}/records?${params}`);
  return json.total_count;
}

// Large exports can be cut off silently by the server: big datasets are fetched in yearly chunks,
// and every file is checked against the record count announced by the API (retried when short).
async function fetchOds(source) {
  const meta = await getJson(`https://${source.host}/api/explore/v2.1/catalog/datasets/${source.dataset}`);
  const fields = (meta.fields || []).filter(field => !/^geo_/.test(field.type) && !/geo_shape|geo_point|coordonnees_gps/.test(field.name));
  const available = new Set(fields.map(field => field.name));
  // Explicit selection when given; otherwise every column except embedded map geometries (which can weigh GBs).
  const select = source.select ? source.select.filter(name => available.has(name)) : fields.length < (meta.fields || []).length ? fields.map(field => field.name) : null;
  const chunks = [];
  if (source.chunk) {
    const facets = await getJson(`https://${source.host}/api/explore/v2.1/catalog/datasets/${source.dataset}/facets?facet=${source.chunk}`);
    const values = (facets.facets?.[0]?.facets || []).map(item => item.value || item.name).sort();
    const isDate = (meta.fields || []).find(field => field.name === source.chunk)?.type === 'date';
    values.forEach(value => chunks.push({ suffix: `--${String(value).slice(0, 4)}`, where: isDate ? `${source.chunk}=date'${String(value).slice(0, 4)}'` : `${source.chunk}="${value}"` }));
  } else if (source.chunkDate) {
    const field = source.chunkDate, year = new Date().getFullYear();
    chunks.push({ suffix: '--avant-2015', where: `${field} < date'2015-01-01'` });
    for (let y = 2015; y <= year + 1; y++) chunks.push({ suffix: `--${y}`, where: `${field} >= date'${y}-01-01' and ${field} < date'${y + 1}-01-01'` });
    chunks.push({ suffix: '--sans-date', where: `${field} is null` });
  } else chunks.push({ suffix: '', where: source.where || '' });
  const files = [];
  for (const chunk of chunks) {
    const expected = await countRecords(source, chunk.where);
    if (!expected) continue;
    const params = new URLSearchParams({ delimiter: ';', with_bom: 'false' });
    if (select?.length) params.set('select', select.join(','));
    if (chunk.where) params.set('where', chunk.where);
    const url = `https://${source.host}/api/explore/v2.1/catalog/datasets/${source.dataset}/exports/csv?${params}`;
    const file = path.join(OUT, `${source.id}${chunk.suffix}.csv.gz`);
    let result = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (chunks.length > 1) console.log(`    ${chunk.suffix.replace('--', '') || 'tout'} · ${expected.toLocaleString('fr-FR')} lignes attendues`);
      result = await download(url, file);
      if (result.lines - 1 >= expected * 0.999) break;
      console.warn(`    fichier incomplet (${(result.lines - 1).toLocaleString('fr-FR')} / ${expected.toLocaleString('fr-FR')} lignes), nouvelle tentative`);
      if (attempt === 3) result.incomplete = true;
    }
    files.push({ file: path.basename(file), url, expected, ...result, records: expected, modified: meta.metas?.default?.modified ?? null });
  }
  // A previous unchunked export of the same dataset is superseded by the yearly files.
  if (chunks.length > 1) fs.rmSync(path.join(OUT, `${source.id}.csv.gz`), { force: true });
  if (files.some(item => item.incomplete)) throw new Error(`export incomplet : ${files.filter(item => item.incomplete).map(item => item.file).join(', ')}`);
  return files;
}

async function fetchDatagouv(source) {
  const meta = await getJson(`https://www.data.gouv.fr/api/1/datasets/${source.slug}/`);
  const files = [];
  const resources = meta.resources.filter(resource => /^(csv|xlsx|xls|json|zip)$/i.test(resource.format || '') && (!resource.filesize || resource.filesize < 800 * 1048576));
  for (const [index, resource] of resources.entries()) {
    const extension = (resource.format || 'bin').toLowerCase();
    const file = path.join(OUT, `${source.id}--${index + 1}.${extension}${extension === 'csv' || extension === 'json' ? '.gz' : ''}`);
    console.log(`    ${resource.title}`);
    const result = await download(resource.url, file, { gzip: extension === 'csv' || extension === 'json' });
    files.push({ file: path.basename(file), url: resource.url, title: resource.title, ...result, modified: resource.last_modified });
  }
  return files;
}

// kind "files": plain files (zip, xlsx, csv) kept as published, under sources/raw/<id>/<path>.
async function fetchFiles(source) {
  const files = [];
  for (const item of source.files) {
    const file = path.join(OUT, source.id, item.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    console.log(`    ${item.path}`);
    files.push({ file: path.join(source.id, item.path), url: item.url, ...(await download(item.url, file, { gzip: false })) });
  }
  return files;
}

// kind "datagouv-search": every CSV resource of every dataset returned by a list of data.gouv.fr API queries, under
// sources/raw/<id>/<dataset id>--<resource id>.csv.gz, with index.json (dataset, organisation, page, resource).
// A dead link or a file that is too large is recorded in index.json and never stops the others.
async function fetchDatagouvSearch(source) {
  const dir = path.join(OUT, source.id);
  fs.mkdirSync(dir, { recursive: true });
  const datasets = new Map();
  for (const query of source.queries) {
    let url = `https://www.data.gouv.fr/api/1/datasets/?page_size=100&${query}`;
    while (url) {
      const page = await getJson(url);
      for (const item of page.data) if (!datasets.has(item.id)) datasets.set(item.id, item);
      url = page.next_page;
    }
    console.log(`    ${query} : ${datasets.size} jeux de données cumulés`);
  }
  const todo = [];
  for (const dataset of datasets.values()) {
    for (const resource of dataset.resources || []) {
      if ((resource.format || '').toLowerCase() !== 'csv' || !resource.url) continue;
      todo.push({ dataset: dataset.id, slug: dataset.slug, title: dataset.title, organization: dataset.organization?.name || dataset.owner?.last_name || null, organizationId: dataset.organization?.id || null,
        page: `https://www.data.gouv.fr/datasets/${dataset.slug}/`, resource: resource.id, resourceTitle: resource.title, url: resource.url, schema: resource.schema?.name || null,
        modified: resource.last_modified, announced: resource.filesize || null, file: `${dataset.id}--${resource.id}.csv.gz` });
    }
  }
  console.log(`    ${todo.length} fichiers CSV à télécharger`);
  let next = 0, done = 0;
  const one = async item => {
    if (item.announced && item.announced > source.maxBytes) { item.error = 'fichier trop volumineux'; return; }
    for (let attempt = 1; attempt <= 2 && item.bytes == null; attempt++) {
      try {
        const response = await fetch(item.url, { signal: AbortSignal.timeout(180000), headers: { 'user-agent': 'francerouelibre-fetch' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > source.maxBytes) throw new Error('fichier trop volumineux');
        fs.writeFileSync(path.join(dir, item.file), zlib.gzipSync(buffer, { level: 6 }));
        item.bytes = buffer.length; item.sha256 = crypto.createHash('sha256').update(buffer).digest('hex'); delete item.error;
      } catch (error) { item.error = error.message; if (attempt < 2) await sleep(1500); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < todo.length) { await one(todo[next++]); if (++done % 100 === 0) console.log(`    ${done}/${todo.length}`); }
  }));
  const ok = todo.filter(item => item.bytes != null);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ downloadedAt: new Date().toISOString(), queries: source.queries, datasets: datasets.size, resources: todo }, null, 1));
  console.log(`    ${ok.length} fichiers téléchargés, ${todo.length - ok.length} inaccessibles ou trop volumineux`);
  if (!ok.length) throw new Error('aucun fichier téléchargé');
  return [{ file: path.join(source.id, 'index.json'), url: 'https://www.data.gouv.fr/api/1/datasets/', bytes: ok.reduce((total, item) => total + item.bytes, 0), datasets: datasets.size, resources: ok.length }];
}

async function fetchInsee(source) {
  const url = `https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/${source.idbank}`;
  const file = path.join(OUT, `${source.id}.xml.gz`);
  return [{ file: path.basename(file), url, ...(await download(url, file)) }];
}

fs.mkdirSync(OUT, { recursive: true });
const selected = SOURCES.filter(source => !only || only.has(source.id));
const failures = [];
console.log(`FranceRoueLibre · ${selected.length} sources → ${OUT}\n`);
for (const [index, source] of selected.entries()) {
  const label = `[${index + 1}/${selected.length}] ${source.id}`;
  const done = manifest[source.id]?.files?.length && manifest[source.id].files.every(item => fs.existsSync(path.join(OUT, item.file)) && (item.lines == null || item.expected == null || item.lines - 1 >= item.expected * 0.999))
    && (!source.chunk && !source.chunkDate || manifest[source.id].files.length > 1);
  if (!args.force && done) { console.log(`${label} · déjà téléchargé`); continue; }
  console.log(`${label} · ${source.note || source.dataset || source.slug || source.idbank}`);
  const started = Date.now();
  try {
    const files = source.kind === 'ods' ? await fetchOds(source) : source.kind === 'datagouv' ? await fetchDatagouv(source) : source.kind === 'files' ? await fetchFiles(source) : source.kind === 'datagouv-search' ? await fetchDatagouvSearch(source) : await fetchInsee(source);
    manifest[source.id] = { ...source, downloadedAt: new Date().toISOString(), files };
    saveManifest();
    console.log(`    ✓ ${mb(files.reduce((total, item) => total + item.bytes, 0))} en ${Math.round((Date.now() - started) / 1000)} s`);
  } catch (error) {
    failures.push(source.id);
    console.error(`    ✗ ${error.message}`);
  }
}
console.log(failures.length ? `\nTerminé avec ${failures.length} échec(s) : ${failures.join(', ')}. Relancez la commande pour réessayer.` : '\nTerminé : toutes les sources sont téléchargées.');
