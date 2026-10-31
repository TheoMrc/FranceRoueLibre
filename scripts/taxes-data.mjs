// dist/data/impots.json for the Impôts page: Insee tax lines 1995-2025 (sources/taxes-insee-detail.json), the curated list of
// every tax with its yield and source (sources/impots-liste.json) and the published costs of collection (sources/impots-couts.json).
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
    if (t.amount != null && !(Number.isFinite(t.amount) && t.amount >= 0)) throw new Error(`Bad amount: ${t.id}`);
    if (t.amount != null && !t.source?.url) throw new Error(`Amount without source: ${t.id}`);
    if (t.insee && !insee.lines.some(l => l.id === t.insee)) throw new Error(`Unknown Insee line: ${t.id} → ${t.insee}`);
  }
  for (const t of list.taxes) if (t.partOf && !ids.has(t.partOf)) throw new Error(`partOf points nowhere: ${t.id} → ${t.partOf}`);

  return {
    generated: list.retrieved, totals, macro,
    insee: { source: insee.source, publication: insee.publication, years: insee.years, status: insee.status, lines: insee.lines },
    taxes: list.taxes, counts: list.counts || [], costs,
    sources: [...(list.sources || []), ...(costs.sources || [])]
  };
}

export function writeTaxesData(root = '.') {
  const data = buildTaxesData(root);
  fs.mkdirSync(path.join(root, 'dist/data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/data/impots.json'), JSON.stringify(data));
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = writeTaxesData(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  console.log(`impots.json: ${data.taxes.length} taxes, totals ${data.totals.year}: ${data.totals.taxes} Md€`);
}
