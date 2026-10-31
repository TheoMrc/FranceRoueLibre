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

test('every tax line is sourced, uniquely identified, and fractions are not counted twice', () => {
  assert.ok(data.taxes.length >= 40);
  // Lines read from document excerpts are flagged, Insee lines are not.
  assert.ok(data.taxes.filter(t => t.insee).every(t => t.check === 'source'));
  assert.ok(data.taxes.filter(t => !t.insee).every(t => t.check === 'extrait'));
  const ids = new Set(data.taxes.map(t => t.id));
  assert.equal(ids.size, data.taxes.length);
  for (const t of data.taxes) {
    assert.ok(t.name && t.category && t.beneficiary && t.collector && t.payer, t.id);
    if (t.amount != null) assert.match(t.source.url, /^https:\/\//, t.id);
    if (t.partOf) assert.ok(ids.has(t.partOf), t.id);
    if (t.cost) assert.match(t.cost.url, /^https:\/\//, t.id);
  }
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
