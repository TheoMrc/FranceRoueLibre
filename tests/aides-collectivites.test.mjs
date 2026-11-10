// node --test tests/aides-collectivites.test.mjs : section « Subventions des collectivités » of dist/aides.html
// (data/aides/collectivites.json and collectivites-index.json from scripts/subventions-collectivites.py)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const dist = new URL('../dist/', import.meta.url);
const read = path => fs.readFileSync(new URL(path, dist), 'utf8');
const data = JSON.parse(read('data/aides/collectivites.json'));
const index = JSON.parse(read('data/aides/collectivites-index.json'));

test('totals add up across years and types of grantor', () => {
  const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
  assert.equal(sum(data.perYear, 'lines'), data.totals.lines);
  assert.equal(sum(data.types, 'lines'), data.totals.lines);
  assert.ok(Math.abs(sum(data.perYear, 'amount') - data.totals.amount) <= data.perYear.length);
  assert.ok(Math.abs(sum(data.types, 'amount') - data.totals.amount) <= data.types.length);
  assert.equal(sum(data.types, 'givers'), data.totals.givers);
  assert.equal(data.threshold, 23000);
  for (const row of data.perYear) assert.ok(row.year === null || (row.year >= 2000 && row.year <= new Date().getFullYear() + 1));
});

test('coverage: every region and département is listed, published or not', () => {
  assert.ok(data.regions.length >= 13 && data.regions.length <= 18, `${data.regions.length} régions`);
  assert.ok(data.departments.length >= 96 && data.departments.length <= 101, `${data.departments.length} départements`);
  for (const [rows, key] of [[data.regions, 'regions'], [data.departments, 'departments']]) {
    assert.deepEqual(data.coverage[key], [rows.filter(r => r.published).length, rows.length]);
    assert.equal(new Set(rows.map(r => r.siren)).size, rows.length);
    for (const row of rows) {
      assert.match(row.siren, /^\d{9}$/);
      assert.ok(row.name && row.code);
      if (row.published) assert.ok(row.lines > 0 && Array.isArray(row.years) && row.underThreshold >= 0 && row.underThreshold <= row.lines);
      else assert.ok(!('lines' in row));
    }
  }
  assert.ok(data.regions.some(r => !r.published), 'au moins une région ne publie rien : le trou doit rester visible');
});

test('grantors: sorted by amount, typed, with the page of their dataset', () => {
  const types = new Set(data.types.map(t => t.type));
  data.givers.forEach((g, i) => {
    assert.ok(g.name && types.has(g.type) && g.lines > 0 && g.pages.length > 0);
    assert.ok(g.pages.every(p => p.startsWith('https://www.data.gouv.fr/datasets/')));
    if (i) assert.ok(data.givers[i - 1].amount >= g.amount);
  });
});

test('beneficiary index: one row per SIREN, sorted by total', () => {
  assert.deepEqual(index.fields, ['siren', 'name', 'total', 'years', 'givers', 'lines']);
  assert.equal(index.rows.length, data.totals.beneficiaries);
  assert.equal(new Set(index.rows.map(r => r[0])).size, index.rows.length);
  index.rows.forEach((row, i) => {
    assert.match(row[0], /^\d{9}$/);
    assert.ok(row[4] >= 1 && row[5] >= 1);
    if (i) assert.ok(index.rows[i - 1][2] >= row[2]);
  });
});

test('parsers: amounts, years and identifiers as they are written in the files', () => {
  const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('sc', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps({
  'amounts': [m.amount_of(x) for x in ['23 000,50 €', '23000.5', '1.234.567,8', '1,234,567.8', '', 'néant', '-1500']],
  'years': [m.year_of('2021-05-03', ''), m.year_of('03/05/2021', ''), m.year_of('', '2019'), m.year_of('date inconnue', ''), m.year_of('1899-01-01', '')],
  'sirens': [m.siren_of('22330001300016'), m.siren_of('827 585 928'), m.siren_of('W332021273'), m.siren_of('')],
  'norm': m.norm('Nom_Bénéficiaire'),
}))`;
  const out = JSON.parse(execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', py, new URL('../scripts/subventions-collectivites.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' }));
  assert.deepEqual(out.amounts, [23000.5, 23000.5, 1234567.8, 1234567.8, null, null, -1500]);
  assert.deepEqual(out.years, [2021, 2021, 2019, null, null]);
  assert.deepEqual(out.sirens, ['223300013', '827585928', null, null]);
  assert.equal(out.norm, 'nombeneficiaire');
});

test('page wiring: section, search, empty-result explanation, seventh search source', () => {
  const html = read('aides.html'), js = read('aides.js');
  for (const id of ['collectivites', 'colKpis', 'colSearch', 'colTable', 'colRegions', 'colDeps', 'colBars', 'colTypes', 'colGaps']) {
    assert.ok(html.includes(`id="${id}"`), id);
    assert.ok(js.includes(`'${id}'`), id);
  }
  assert.ok(js.includes('col-empty') && js.includes('demandes.html'));
  assert.ok(read('search-core.js').includes("7: { label: 'Subventions des collectivités'"));
  const section = html.slice(html.indexOf('id="collectivites"'), html.indexOf('id="entreprises"'));
  assert.ok(!section.includes('—'));
});
