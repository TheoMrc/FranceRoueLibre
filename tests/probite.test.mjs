// node --test tests/probite.test.mjs : page Probité (dist/probite.html, data/probite.json from scripts/probite-data.py)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const read = path => fs.readFileSync(new URL(path, dist), 'utf8');
const data = JSON.parse(read('data/probite.json'));
const isMask = v => v === '<5' || v === 'n.d.';
const ok = v => v === null || Number.isInteger(v) || isMask(v);

test('years 2021-2025 and published totals', () => {
  assert.deepEqual(data.years, [2021, 2022, 2023, 2024, 2025]);
  assert.equal(data.total.affaires, 1841);
  assert.equal(data.total.unites, 3123);
  assert.deepEqual(data.perYear.map(p => p.affaires), [273, 256, 263, 412, 658]);
});

test('per-year units add up to the period total; cases may be counted in two years', () => {
  assert.equal(data.checks.sumYearsUnites, data.checks.periodUnites);
  assert.ok(data.checks.sumYearsAffaires >= data.checks.periodAffaires);
});

test('every offence label is mapped, values are counts or producer masks, never estimates', () => {
  assert.equal(data.infractions.length, 15);
  for (const r of data.infractions) {
    assert.ok(r.label && r.family && r.code);
    assert.equal(r.affaires.length, 5);
    r.affaires.concat(r.unites).forEach(v => assert.ok(ok(v), `${r.code}: ${v}`));
    for (const d of Object.values(r.decisions)) d.affaires.forEach(v => assert.ok(ok(v)));
  }
  const pub = data.infractions.find(r => r.code === 'Corruption | Publique');
  assert.deepEqual(pub.affaires, [61, 62, 69, 72, 68]);
});

test('penalties: prison with full suspension 2025', () => {
  const s = data.penaltiesDetail.find(p => p.category === 'Prison' && p.modalite === 'Sursis total');
  assert.equal(s.affaires[4], 132);
});

test('page wiring and writing rules', () => {
  const html = read('probite.html'), js = read('probite.js');
  for (const id of ['pbKpis', 'pbYears', 'pbAuthors', 'pbMultiples', 'pbDecTable', 'pbPrison', 'pbCompl', 'pbPenTable', 'pbSources', 'non-publie']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('probite.css') && html.includes('probite.js') && html.includes('aria-current="page"><strong>Probité'));
  assert.ok(!html.slice(html.indexOf('<main'), html.indexOf('</main>')).includes('—'), 'no em dash in page text');
});
