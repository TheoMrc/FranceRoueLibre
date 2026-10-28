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
    const files = source.kind === 'ods' ? await fetchOds(source) : source.kind === 'datagouv' ? await fetchDatagouv(source) : await fetchInsee(source);
    manifest[source.id] = { ...source, downloadedAt: new Date().toISOString(), files };
    saveManifest();
    console.log(`    ✓ ${mb(files.reduce((total, item) => total + item.bytes, 0))} en ${Math.round((Date.now() - started) / 1000)} s`);
  } catch (error) {
    failures.push(source.id);
    console.error(`    ✗ ${error.message}`);
  }
}
console.log(failures.length ? `\nTerminé avec ${failures.length} échec(s) : ${failures.join(', ')}. Relancez la commande pour réessayer.` : '\nTerminé : toutes les sources sont téléchargées.');
