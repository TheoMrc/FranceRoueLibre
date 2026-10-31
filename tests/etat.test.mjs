// Budget de l'État page: data consistency (dist/data/etat.json, built by scripts/etat-data.py) and page wiring.
// Run: node --test tests/etat.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const data = JSON.parse(readFileSync(new URL('dist/data/etat.json', root), 'utf8'));
const html = readFileSync(new URL('dist/etat.html', root), 'utf8');
const js = readFileSync(new URL('dist/etat.js', root), 'utf8');
const sum = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('PLF 2025: missions add up to programmes and to actions', () => {
  assert.ok(data.missions.length >= 40);
  for (const m of data.missions) {
    close(sum(m.progs, p => p.cp), m.cp, 0.5, `CP ${m.name}`);
    close(sum(m.progs, p => p.ae), m.ae, 0.5, `AE ${m.name}`);
    for (const p of m.progs) close(sum(p.actions, a => a.cp), p.cp, 0.5, `CP programme ${p.code}`);
  }
  assert.ok(data.missions.some(m => m.type === 'BG' && m.code === 'RD'), 'Remboursements et dégrèvements present');
});

test('PLF 2025: destination and nature files give the same budget general total', () => {
  const dest = sum(data.missions.filter(m => m.type === 'BG'), m => m.cp);
  const nature = sum(data.nature.titres.filter(t => t.budget === 'BG'), t => t.cp);
  close(dest, nature, 1, 'BG CP');
});

test('Monthly situation: the six published components give the published balance every month', () => {
  const line = label => data.monthly.lines.find(l => l.label === label).values;
  const parts = [['Total recettes nettes du budget général', 1], ['Fonds de concours et attribution de produits', 1], ['Total dépenses nettes du budget général', -1],
    ['Total prélèvements sur recettes', -1], ['Solde des comptes spéciaux', 1], ['Solde des Budgets annexes', 1]];
  const solde = line('Solde budgétaire');
  assert.ok(data.monthly.dates.length >= 24);
  data.monthly.dates.forEach((d, i) => close(sum(parts, ([label, s]) => s * line(label)[i]), solde[i], 0.5, `solde ${d}`));
  assert.deepEqual([...data.monthly.dates].sort(), data.monthly.dates, 'dates sorted');
});

test('Monthly situation: net expenditure equals the sum of its natures', () => {
  const lines = data.monthly.lines.filter(l => l.cat === 'Dépenses' && l.sub === 'Budget général' && l.level === 2);
  const total = data.monthly.lines.find(l => l.label === 'Total dépenses nettes du budget général');
  data.monthly.dates.forEach((d, i) => close(sum(lines, l => l.values[i]), total.values[i], 1, `dépenses ${d}`));
});

test('RAP 2025: every row has a known status and gaps only for true percentages', () => {
  const statuses = new Set(['ok', 'up', 'no', 'nd', 'nr', 'na']);
  assert.ok(data.rap.rows.length > 2000);
  for (const r of data.rap.rows) {
    assert.ok(statuses.has(r[8]), r[8]);
    assert.ok(data.rap.missions[r[0]], 'mission index');
    if (r[9] != null) assert.equal(r[4], '%');
  }
});

test('Green budget and ODA: totals are positive and consistent', () => {
  const fav = sum(data.green.totals.filter(t => t.c === 'Favorable'), t => t.v26);
  assert.ok(fav > 10000 && fav < 100000, `favorable ${fav}`);
  for (const y of data.apd.years) assert.ok(y.ge > 0 && y.paid > 0 && Math.abs(y.bi + y.multi - y.ge) < 1, `APD ${y.year}`);
});

test('General accounts: the trial balance balances every year', () => {
  const t = (cat, i) => sum(data.balances.postes.filter(p => p.cat === cat), p => p.v[i]);
  data.balances.years.forEach((y, i) => close(t('Actif', i) + t('Charges', i), t('Passif', i) + t('Produits', i) + t('Situation nette', i), 1, `balance ${y}`));
});

test('Page: every element the script fills exists, sources are cited, no em dash', () => {
  const ids = [...js.matchAll(/\$\('(et[A-Za-z]+)'\)/g)].map(m => m[1]);
  for (const id of new Set(ids)) assert.ok(html.includes(`id="${id}"`), `#${id} missing in etat.html`);
  assert.ok(html.includes('src="./etat.js"') && html.includes('href="./etat.css"'));
  assert.ok(!html.includes('—') && !js.includes('—'), 'no em dash');
  for (const [id, s] of Object.entries(data.sources)) assert.ok(s.page || s.download, `source URL for ${id}`);
});
