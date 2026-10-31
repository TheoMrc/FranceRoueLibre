// node --test tests/aides-relance.test.mjs : section « Plan de relance » of dist/aides.html (data/aides/relance.json from scripts/relance-data.py)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const read = path => fs.readFileSync(new URL(path, dist), 'utf8');
const data = JSON.parse(read('data/aides/relance.json'));
const byId = Object.fromEntries(data.indicators.map(i => [i.id, i]));

test('indicators: euro amounts by nature, department values add up to the total', () => {
  assert.ok(data.indicators.length >= 10);
  for (const i of data.indicators) {
    assert.ok(['aide', 'aide-validee', 'fiscal', 'projet'].includes(i.nature), i.id);
    assert.ok(Math.abs(i.depts.reduce((s, d) => s + d[1], 0) - i.total) <= i.depts.length, i.id); // each value rounded to the euro
    assert.equal(i.series.at(-1)[0] <= i.lastDate, true);
  }
  assert.equal(byId.MPR1.total, 1906531175);
  assert.equal(byId.MPR1.lastDate, '2022-04');
});

test('cumulative series: last monthly national sum equals the department total when all report the same month', () => {
  assert.ok(Math.abs(byId.MPR1.series.at(-1)[1] - byId.MPR1.total) <= 1);
});

test('series breaks are reported, not corrected', () => {
  assert.equal(byId.IDF1.drops.length, 1);
  assert.equal(byId.IDF1.drops[0][0], '2022-02');
});

test('laureates: 3080 rows, no amount column', () => {
  assert.equal(data.laureates.count, 3080);
  assert.equal(data.laureates.rows.length, 3080);
  assert.equal(data.laureates.byMeasure.reduce((s, m) => s + m[1], 0), 3080);
  assert.ok(data.laureates.rows.every(r => r.length === 8));
});

test('aides page keeps its sections and gains the relance one', () => {
  const html = read('aides.html'), js = read('aides.js');
  for (const id of ['associations', 'entreprises', 'fondsvert', 'relance', 'relKpis', 'relAid', 'relProjects', 'relPick', 'relSeries', 'relDepts', 'relTable', 'relSources']) assert.ok(html.includes(`id="${id}"`), id);
  for (const fn of ['initAsso', 'initEntreprises', 'initFondsVert', 'initRelance']) assert.ok(js.includes(`lazy($(`) && js.includes(fn), fn);
  assert.ok(html.includes('aides.css'));
});
