import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Built by: python3 scripts/emplois-data.py
const data = JSON.parse(fs.readFileSync('dist/data/emplois.json', 'utf8'));
const communes = JSON.parse(fs.readFileSync('dist/data/emplois-communes.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync('dist/data/web/communes-meta.json', 'utf8'));
const html = fs.readFileSync('dist/emplois.html', 'utf8');
const js = fs.readFileSync('dist/emplois.js', 'utf8');

test('national series: Insee remuneration of public employees, 1960 to 2025', () => {
  const years = data.national.years;
  assert.equal(years[0].year, 1960);
  const last = years.at(-1);
  assert.equal(last.year, 2025);
  assert.ok(Math.abs(last.d1 - 370.012) < 0.01, 'D1 2025 as published in table 3.201');
  assert.ok(last.d1 / last.spending > 0.2 && last.d1 / last.spending < 0.23);
  assert.ok(last.d1 / last.gdp > 0.11 && last.d1 / last.gdp < 0.14);
  assert.ok(years.every(r => r.imputed == null || r.imputed < r.d1));
});

test('functions add up to the published total', () => {
  const f = data.functions;
  assert.equal(f.items.length, 10);
  assert.ok(f.maxGap < 0.1);
  const yi = f.years.length - 1;
  const top = [...f.items].sort((a, b) => b.d1[yi] - a.d1[yi])[0];
  assert.equal(top.code, 'GF09'); // education is the largest payroll
});

test('State: titre 2 by mission, pensions apart, no double count', () => {
  const s = data.state;
  const total = s.missions.reduce((sum, m) => sum + m.t2, 0);
  assert.ok(total > 150000 && total < 170000, String(total));
  assert.ok(!s.missions.some(m => m.code === 'YD' || m.code === 'PB'));
  assert.ok(s.pensions.cp > 60000);
  assert.equal(s.missions[0].code, 'EC');
  for (const m of s.missions) assert.ok(m.t2 <= m.cp + 0.5, m.name);
});

test('local levels: Paris and Lyon are not counted twice', () => {
  const dep = data.local.levels.find(l => l.id === 'departements');
  const i = dep.years.indexOf(2025);
  assert.ok(dep.personnel[i] > 14e9 && dep.personnel[i] < 17e9, String(dep.personnel[i]));
  // the département map adds up to communes + intercommunalités + départements + régions of the national totals
  const lv = id => { const l = data.local.levels.find(x => x.id === id); return l.personnel[l.years.indexOf(2025)]; };
  const deps = data.territory.departments;
  const sum = deps.reduce((s, d) => s + d.personnelTotal, 0);
  const expected = lv('communes') + lv('gfp') + lv('departements') + lv('regions');
  assert.ok(Math.abs(sum - expected) / expected < 0.002, `${sum} vs ${expected}`);
  assert.equal(deps.length, 101);
  assert.equal(deps.find(d => d.code === '75').personnel.departement, 0);
});

test('legal municipal seats: the CGCT scale, Paris, Marseille, Lyon', () => {
  const t = data.territory.totals;
  assert.equal(t.communes, 34875);
  assert.ok(t.seats > 490000 && t.seats < 530000, String(t.seats));
  const seatsByStrata = data.territory.strata.reduce((s, x) => s + x.seats, 0);
  assert.equal(seatsByStrata, t.seats);
  assert.equal(data.territory.departments.reduce((s, d) => s + d.seats, 0), t.seats);
  const ref = data.reference.municipalSeats;
  assert.deepEqual(ref.special, { 75056: 163, 13055: 111, 69123: 73 });
  assert.equal(ref.strata[0][1], 7);
  assert.equal(ref.strata.at(-1)[1], 69);
  // regional seats: 1 757 in the 13 + 2 regions of art. L. 337, plus Corse 63, Guyane 51, Martinique 51
  assert.equal(data.mandates.find(m => m.id === 'regionaux').count, 1757 + 63 + 51 + 51);
});

test('indemnity ceiling: mayors and deputies, IB 1027', () => {
  const ind = data.reference.indemnities;
  assert.equal(ind.indexMonthly, 4110.52);
  const cap = data.territory.totals.cap;
  assert.ok(cap > 1.5e9 && cap < 2.2e9, String(cap));
  // commune of 50 inhabitants: 7 seats, 2 deputies -> 12 × 4110.52 × (28.1 + 2 × 10.89) %
  const expected = 12 * 4110.52 * (28.1 + 2 * 10.89) / 100;
  assert.ok(Math.abs(expected - 24603) < 5);
});

test('commune rows are aligned with communes-meta', () => {
  assert.equal(communes.rows.length, meta.rows.length);
  const paris = meta.rows.findIndex(r => r[0] === '75056');
  assert.ok(communes.rows[paris][0] > 2e6);
  assert.ok(communes.rows[paris][1] > 2.5e6); // k€
});

test('page wiring', () => {
  for (const id of ['emNatChart', 'emWfBar', 'emFnBars', 'emStBars', 'emLocStack', 'emStrata', 'emMap', 'emDepTable', 'emMandates', 'emComInput', 'emGaps']) {
    assert.ok(html.includes(`id="${id}"`), id);
    assert.ok(js.includes(`'${id}'`), id);
  }
  assert.ok(html.includes('emplois.js') && html.includes('emplois.css'));
});
