// dist/data/impots.json for the Impôts page: Insee tax lines 1995-2025 (sources/taxes-insee-detail.json), the curated list of
// every tax with its yield and source (sources/impots-liste.json), the published costs of collection (sources/impots-couts.json)
// and the Cour des comptes inventory of low-yield taxes (sources/taxes-faible-rendement.json).
// GDP is recovered from Insee's own Md€ / %-of-GDP pairs, as on the home page. Run alone: node scripts/taxes-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function buildTaxesData(root = '.') {
  const src = name => path.join(root, 'sources', name);
  const insee = read(src('taxes-insee-detail.json'));
  const levies = read(src('national-taxes-insee.json'));
  const ratios = read(src('national-ratios-insee.json'));
  const debt = read(src('national-debt.json'));
  const accounts = read(src('national-accounts-3201.json'));
  const population = read(src('insee-population.json'));
  const list = read(src('impots-liste.json'));
  const costs = read(src('impots-couts.json'));
  const lowYield = read(src('taxes-faible-rendement.json'));

  const jan = new Map(population.january1.map(r => [r.year, r.population]));
  const pop = year => jan.has(year) && jan.has(year + 1) ? (jan.get(year) + jan.get(year + 1)) / 2 : jan.get(year) ?? null;
  const gdp = year => {
    const r = ratios.years.find(x => x.year === year), d = debt.years.find(x => x.year === year), a = accounts.years.find(x => x.year === year);
    if (r?.debt && d?.debt) return d.debt / (r.debt / 100);
    if (r?.spending && a?.spending) return a.spending / (r.spending / 100);
    return null;
  };
  const round = (v, k = 1) => v == null ? null : Math.round(v * 10 ** k) / 10 ** k;
  const macro = insee.years.map(year => ({ year, gdp: round(gdp(year), 1), population: pop(year) }));

  const last = insee.years.length - 1, year = insee.years[last];
  const taxes = insee.lines.filter(l => !l.parent).reduce((s, l) => s + l.values[last], 0);
  const levyRate = levies.years.find(r => r.year === year)?.levyRate;
  const taxesAndContributions = accounts.years.find(r => r.year === year)?.revenueBreakdown.find(b => /cotisations/.test(b.label))?.value;
  const totals = {
    year, status: insee.status[String(year)] || 'définitif', taxes: round(taxes, 1), levyRate, levy: round(levyRate * gdp(year) / 100, 0),
    taxesAndContributions: round(taxesAndContributions, 1), contributions: round(taxesAndContributions - taxes, 0), gdp: round(gdp(year), 0), population: pop(year)
  };

  // Every line must say where its number comes from; fractions must point to a line of the list.
  const ids = new Set();
  for (const t of list.taxes) {
    if (!t.id || ids.has(t.id)) throw new Error(`Duplicate or missing id: ${t.id}`);
    ids.add(t.id);
    if (!BASES.includes(t.base)) throw new Error(`Unknown base: ${t.id} → ${t.base}`);
    if (t.amount != null && !(Number.isFinite(t.amount) && t.amount >= 0)) throw new Error(`Bad amount: ${t.id}`);
    if (t.amount != null && !t.source?.url) throw new Error(`Amount without source: ${t.id}`);
    if (t.insee && !insee.lines.some(l => l.id === t.insee)) throw new Error(`Unknown Insee line: ${t.id} → ${t.insee}`);
  }
  for (const t of list.taxes) if (t.partOf && !ids.has(t.partOf)) throw new Error(`partOf points nowhere: ${t.id} → ${t.partOf}`);

  const all = mergeTaxes(list.taxes, lowYield, list.courPartOf || {});
  const { taxes: _inventory, ...lowYieldMeta } = lowYield;
  return {
    generated: list.retrieved, totals, macro,
    insee: { source: insee.source, publication: insee.publication, years: insee.years, status: insee.status, lines: insee.lines },
    all, counts: list.counts || [], costs, lowYield: lowYieldMeta,
    sources: [...(list.sources || []), ...(costs.sources || [])]
  };
}

/* One list for every chart of the page: the curated list (large taxes, from the national accounts and budget documents) and the
   Cour des comptes inventory of taxes yielding less than 175 M€, each tax once. A curated line that is also in the inventory
   carries its courId: it takes the Cour's scenario and state, and its amount too when marked amountFrom: 'cour'
   (the inventory is read from the published file, the curated amount from a document excerpt). */
export const BASES = ['Consommation', 'Revenus des ménages', 'Production', 'Salaires', 'Patrimoine', 'Bénéfices des sociétés'];
const COUR_BASE = { Consommation: 'Consommation', Production: 'Production', Capital: 'Patrimoine', 'Masse salariale': 'Salaires', 'Bénéfice': 'Bénéfices des sociétés' };
const COUR_PAYER = { Entreprises: 'Entreprises', Particuliers: 'Ménages', Autres: 'Ménages et entreprises' };
export function courBeneficiary(label) {
  if (/^Budget général$/.test(label)) return 'État';
  if (/^Budget général \//.test(label)) return 'Partagé';
  if (/assurance-maladie|assurance-vieillesse|allocations familiales|dette sociale|mutualité sociale|sécurité sociale|barreaux|accidents|accident du travail/i.test(label)) return 'Sécurité sociale';
  if (/^(Communes?\b|Départements|Régions?\b|Région |Collectivit|Autorités organisatrices|Centre communal|Zone des 50 pas)/.test(label)) return 'Collectivités locales';
  if (/^Inconnu$/.test(label)) return 'Non précisé';
  return 'Opérateurs et agences';
}
export function courCollector(label) {
  if (/^DGFiP/.test(label)) return 'DGFiP';
  if (/^DGDDI/.test(label)) return 'Douane (DGDDI)';
  if (/^(URSSAF|ACOSS)/i.test(label)) return 'Urssaf';
  return 'Autres collecteurs';
}
export function mergeTaxes(listTaxes, lowYield, courPartOf = {}) {
  const names = new Map(listTaxes.map(t => [t.id, t.short || t.name]));
  const cour = new Map(lowYield.taxes.map(t => [t.id, t]));
  const scenarioOf = t => t.scenarios.length ? Math.min(...t.scenarios.map(s => s.scenario)) : 0;
  const inForce = t => t.state === 'en vigueur' || t.state === 'créée';
  const courSource = t => ({ url: lowYield.url, title: 'Cour des comptes, inventaire des taxes à faible rendement (annexe au rapport, avril 2025)', ref: `ligne n° ${t.id}` });
  const used = new Set();
  const rows = listTaxes.map(t => {
    const c = t.courId != null ? cour.get(t.courId) : null;
    if (t.courId != null && !c) throw new Error(`courId points nowhere: ${t.id} → ${t.courId}`);
    if (c) used.add(c.id);
    const row = { ...t, origin: 'liste', state: c ? c.state : 'en vigueur', scenario: c ? scenarioOf(c) : null };
    if (c) { row.y2019 = c.y2019; row.objective = c.objective; }
    if (c && t.amountFrom === 'cour') Object.assign(row, { amount: c.y2024, year: '2024', status: 'exécution', check: 'source', source: courSource(c) });
    delete row.amountFrom;
    return row;
  });
  for (const c of lowYield.taxes) {
    if (used.has(c.id)) continue;
    const base = c.label.replace(/\s*\(.*$/, '').replace(/\s*[;,–-]\s.*$/, '');
    const short = base.length <= 56 ? base : `${base.slice(0, 54).replace(/\s+\S*$/, '')}…`;
    rows.push({
      id: `cc-${c.id}`, courId: c.id, origin: 'cour', name: c.label, short, amount: c.y2024, year: '2024', status: c.y2024 == null ? 'rendement inconnu' : 'exécution',
      base: COUR_BASE[c.base], beneficiary: courBeneficiary(c.beneficiary), beneficiaryDetail: c.beneficiary,
      collector: courCollector(c.collector), collectorDetail: c.collector, payer: COUR_PAYER[c.payer], objective: c.objective,
      y2019: c.y2019, state: c.state, scenario: scenarioOf(c), check: 'source', source: courSource(c)
    });
    const parent = courPartOf[String(c.id)];
    if (parent) {
      if (!names.has(parent)) throw new Error(`courPartOf points nowhere: ${c.id} → ${parent}`);
      Object.assign(rows.at(-1), { partOf: parent, note: `Fraction de « ${names.get(parent)} », déjà comprise dans cette ligne : non additionnée.` });
    }
    if (!rows.at(-1).base || !rows.at(-1).payer) throw new Error(`Unmapped inventory line ${c.id}`);
  }
  for (const r of rows) r.inForce = r.origin === 'liste' ? r.state === 'en vigueur' || r.state === 'créée' : inForce(r);
  return rows;
}

export function writeTaxesData(root = '.') {
  const data = buildTaxesData(root);
  fs.mkdirSync(path.join(root, 'dist/data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/data/impots.json'), JSON.stringify(data));
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = writeTaxesData(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  console.log(`impots.json: ${data.all.length} lignes (${data.all.filter(t => t.inForce).length} en vigueur), totals ${data.totals.year}: ${data.totals.taxes} Md€`);
}
