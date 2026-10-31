import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTaxesData } from '../scripts/taxes-data.mjs';

const detail = JSON.parse(fs.readFileSync('sources/taxes-insee-detail.json', 'utf8'));
const categories = JSON.parse(fs.readFileSync('sources/national-taxes-insee.json', 'utf8'));
const data = buildTaxesData('.');

test('Insee detail lines agree with the category extract used on the home page', () => {
  for (const row of categories.years.filter(r => r.categories.length)) {
    const i = detail.years.indexOf(row.year);
    for (const c of row.categories) assert.ok(Math.abs(detail.lines.find(l => l.id === c.id).values[i] - c.value) < 0.051, `${row.year} ${c.id}`);
  }
  const i = detail.years.indexOf(2025);
  assert.equal(detail.lines.find(l => l.id === 'vat').values[i], 208.821);
  // « dont » lines never exceed their category (they are already inclus in it).
  for (const l of detail.lines.filter(l => l.parent)) {
    const parent = detail.lines.find(p => p.id === l.parent);
    l.values.forEach((v, k) => assert.ok(v == null || v <= parent.values[k] + 1e-9, `${l.id} ${detail.years[k]}`));
  }
});

test('page totals come from the national accounts, not from the sum of the list', () => {
  assert.equal(data.totals.year, 2025);
  assert.equal(data.totals.levyRate, 43.6);
  assert.ok(Math.abs(data.totals.taxes - detail.lines.filter(l => !l.parent).reduce((s, l) => s + l.values.at(-1), 0)) < 0.06);
  assert.ok(data.totals.contributions > 0 && data.totals.contributions < data.totals.taxesAndContributions);
  assert.equal(data.macro.length, detail.years.length);
  assert.ok(data.macro.every(m => m.gdp > 0));
});

test('one list for every chart: every tax once, sourced, fractions never added twice', () => {
  const all = data.all;
  const ids = new Set(all.map(t => t.id));
  assert.equal(ids.size, all.length);
  // Curated list + Cour des comptes inventory, overlaps merged once.
  const courIds = all.filter(t => t.courId != null).map(t => t.courId);
  assert.equal(new Set(courIds).size, courIds.length);
  assert.equal(courIds.length, 319);
  assert.equal(all.filter(t => t.inForce).length, 292);
  for (const t of all) {
    assert.ok(t.name && t.base && t.beneficiary && t.collector && t.payer, t.id);
    assert.ok(['Consommation', 'Revenus des ménages', 'Production', 'Salaires', 'Patrimoine', 'Bénéfices des sociétés'].includes(t.base), t.id);
    if (t.amount != null) assert.match(t.source.url, /^https:\/\//, t.id);
    if (t.partOf) assert.ok(ids.has(t.partOf), t.id);
    if (t.cost) assert.match(t.cost.url, /^https:\/\//, t.id);
    // Lines read in the versioned Insee or Cour des comptes files carry check: 'source'; excerpt readings are flagged.
    assert.ok(['source', 'extrait'].includes(t.check), t.id);
    if (t.origin === 'cour' || t.insee) assert.equal(t.check, 'source', t.id);
  }
  // A Cour line that is a fraction of a listed tax points to it and is not added.
  assert.equal(all.find(t => t.courId === 63).partOf, 'tobacco');
  // Merged lines: the cinema ticket tax takes the amount read in the Cour file.
  const tsa = all.find(t => t.id === 'cnc-tsa');
  assert.equal(tsa.courId, 332); assert.equal(tsa.amount, 143); assert.equal(tsa.check, 'source');
  // Unknown amounts stay unknown.
  assert.ok(all.filter(t => t.inForce && t.amount == null).length >= 117);
});

test('published collection costs carry their source', () => {
  const c = data.costs;
  for (const r of c.dgfip) { assert.ok(r.year >= 1990 && r.year <= 2026); assert.match(r.url, /^https:\/\//); }
  for (const r of [...c.collectors, ...c.localFees, ...c.costDots, ...c.perTax, ...c.gaps]) assert.match(r.url, /^https:\/\//);
  for (const r of c.costDots) assert.ok(r.per100 > 0 && r.per100 < 100, r.name);
  // The series breaks are documented, and the latest DGFiP rate stays below the 1999 level.
  assert.ok(c.dgfip.at(-1).gross < c.dgfip.find(r => r.year === 2010).gross);
});

test('built file is up to date', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync('dist/data/impots.json', 'utf8')), JSON.parse(JSON.stringify(data)));
});

test('low-yield tax inventory reproduces the Cour des comptes totals', () => {
  const ly = { ...data.lowYield, taxes: JSON.parse(fs.readFileSync('sources/taxes-faible-rendement.json', 'utf8')).taxes };
  const active = ly.taxes.filter(t => t.state === 'en vigueur' || t.state === 'créée');
  assert.equal(ly.taxes.length, 319);
  assert.equal(active.length, 243);
  const known = active.filter(t => t.y2024 != null);
  assert.equal(known.length, 126);
  assert.ok(Math.abs(known.reduce((s, t) => s + t.y2024, 0) - 5978) < 1);
  // Unknown yields stay unknown: never zero.
  assert.ok(ly.taxes.every(t => t.y2024 === null || t.y2024 > 0));
  assert.equal(new Set(ly.taxes.map(t => t.id)).size, ly.taxes.length);
  for (const t of ly.taxes) for (const s of t.scenarios) assert.ok([1, 2, 3].includes(s.scenario), t.label);
  assert.ok(ly.unmatchedScenarioLines.length <= 6);
  assert.match(data.costs.noLossQuote.text, /aucune taxe prise individuellement/);
});

test('the four yields filled from budget and OFGL files keep the frozen extract figures; electricity stays unknown', () => {
  const extract = JSON.parse(fs.readFileSync('sources/taxes-affectees.json', 'utf8'));
  const byId = new Map(data.all.map(t => [t.id, t]));
  assert.equal(byId.get('tgap').amount, extract.budgetLines.lines['1756'].amount);
  assert.equal(byId.get('tgap').amount, 1294);
  assert.equal(byId.get('malus-co2-masse').amount, 1386.3);
  assert.equal(byId.get('cartes-grises').amount, extract.cartesGrises.years.find(y => y.year === 2024).amount);
  for (const id of ['tgap', 'malus-co2-masse', 'cartes-grises']) {
    const t = byId.get(id);
    assert.equal(t.check, 'source', id); assert.match(t.source.url, /^https:\/\//, id); assert.ok(t.source.ref, id);
  }
  assert.equal(byId.get('accise-electricite').amount, undefined);
});

test('taxes affectées: every capped line gives back exactly what exceeds its ceiling', () => {
  const A = data.affected;
  assert.equal(A.rows.length, 267);
  assert.equal(A.years.length, 3);
  for (const r of A.rows) {
    assert.equal(r.y.length, 3); assert.ok(r.tax && r.beneficiary && r.sector, r.tax);
    r.cap.forEach((c, k) => { if (c != null && r.y[k] != null) assert.ok(Math.abs(Math.max(0, r.y[k] - c) - r.back[k]) < 0.001, `${r.tax} ${k}`); });
  }
  const y24 = A.years[2];
  assert.equal(y24.capped, A.rows.filter(r => r.cap[2] != null).length);
  assert.ok(Math.abs(y24.back - A.rows.reduce((s, r) => s + (r.back[2] || 0), 0)) < 0.1);
  assert.ok(Math.abs(A.sectors.reduce((s, x) => s + x.yield, 0) - y24.yield) < 0.5);
  assert.match(A.url, /^https:\/\//);
});

test('costs found outside the list are attached to their tax, and every publication request is sourced', () => {
  const c = data.costs, byId = new Map(data.all.map(t => [t.id, t]));
  for (const id of Object.keys(c.attach)) assert.match(byId.get(id).cost?.url || '', /^https:\/\//, id);
  assert.equal(byId.get('ir').cost.pct, 1.05);
  assert.equal(byId.get('cc-226').cost.pct, 3.24);
  // The 18 M€ often quoted for the flour tax covered a block of about twelve taxes: never shown as the flour tax alone.
  assert.ok(!c.perTax.some(r => /farines/.test(r.tax) && r.meur === 18.3));
  for (const r of [...c.lawFees, ...c.publish.items.map(i => i.proof)]) assert.match(r.url, /^https:\/\//);
  for (const r of c.byTax.rows) assert.equal(r[1].length, c.byTax.years.length, r[0]);
  for (const r of c.lawFees) assert.ok(r.rate > 0 && r.rate <= 10, r.tax);
});
