import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Built by: python3 scripts/secu-data.py
const data = JSON.parse(fs.readFileSync('dist/data/secu.json', 'utf8'));
const html = fs.readFileSync('dist/secu.html', 'utf8');
const js = fs.readFileSync('dist/secu.js', 'utf8');

test('branch accounts: published totals and balances agree with the lines', () => {
  const a = data.accounts;
  assert.deepEqual(a.years, [2009, 2010]);
  assert.deepEqual(a.branches.map(b => b.id), ['maladie', 'atmp', 'famille', 'vieillesse', 'total']);
  const by = Object.fromEntries(a.lines.map(l => [l.id, l]));
  for (const scope of ['tous', 'rg']) {
    a.years.forEach((year, yi) => {
      for (let b = 0; b < 5; b++) {
        const lvl1 = (from, to) => { const ids = a.lines.map(l => l.id); return a.lines.slice(ids.indexOf(from), ids.indexOf(to)).filter(l => l.level === 1).reduce((s, l) => s + l[scope][yi][b], 0); };
        assert.ok(Math.abs(lvl1('prestations', 'produits') - by.charges[scope][yi][b]) < 0.5, `${scope} ${year} ${b} charges`);
        assert.ok(Math.abs(lvl1('cotis', 'solde') - by.produits[scope][yi][b]) < 0.5, `${scope} ${year} ${b} produits`);
        assert.ok(Math.abs(by.produits[scope][yi][b] - by.charges[scope][yi][b] - by.solde[scope][yi][b]) < 0.5, `${scope} ${year} ${b} solde`);
      }
    });
  }
  assert.ok(a.maxCheckGap < 0.5);
  // Published figure, Tous régimes 2009, toutes branches: solde −21 694 M€.
  assert.equal(Math.round(by.solde.tous[0][4]), -21694);
  // The consolidated total is below the sum of the four branches (transfers between branches removed).
  const sum = [0, 1, 2, 3].reduce((s, b) => s + by.charges.tous[1][b], 0);
  assert.ok(sum > by.charges.tous[1][4]);
});

test('regions: 22 regions, sum equals the published national row, per-capita ratios consistent', () => {
  const r = data.regions;
  assert.equal(r.regions.length, 22);
  assert.equal(new Set(r.regions.flatMap(x => x.deps)).size, 96);
  for (const p of ['ville', 'etab', 'medsoc', 'total']) {
    const sum = r.regions.reduce((s, x) => s + x.amounts[p], 0);
    assert.ok(Math.abs(sum - r.france.amounts[p]) < 10, p);
  }
  for (const x of r.regions) {
    assert.ok(x.population > 250000 && x.population < 13e6, x.name);
    assert.ok(Math.abs(x.perHab.total - x.amounts.total / x.population) < 0.1, x.name);
    assert.ok(Math.abs(x.amounts.ville + x.amounts.etab + x.amounts.medsoc - x.amounts.total) < 10, x.name);
  }
  const pop = r.regions.reduce((s, x) => s + x.population, 0);
  assert.ok(pop > 62e6 && pop < 66e6, String(pop));
});

test('series files are described, never invented', () => {
  for (const key of ['ville', 'cliniques']) {
    const f = data.seriesFiles[key];
    assert.equal(f.years.length, 16);
    assert.ok(f.years.every(y => y.url.startsWith('http') && y.files.length >= 1));
    assert.ok(f.counts.serie > 30);
  }
  assert.ok(!('amounts' in data.seriesFiles.ville));
});

test('context: Insee social security sector up to 2025', () => {
  const last = data.context.years.at(-1);
  assert.equal(last.year, 2025);
  assert.ok(last.spending > 700 && last.shareOfApu > 0.4 && last.shareOfApu < 0.6);
});

test('page: sources linked, no em dash, sections present', () => {
  for (const id of ['ensemble', 'branches', 'recettes', 'regions', 'postes', 'non-publie', 'methode']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(!html.includes('—') && !js.includes('—'));
  assert.ok(html.includes('secu.js') && html.includes('secu.css') && html.includes('<title>Sécurité sociale'));
  for (const s of [data.accounts.source, data.regions.source, data.seriesFiles.ville.source, data.seriesFiles.cliniques.source]) assert.match(s.page, /^https:\/\/www\.data\.gouv\.fr\/datasets\//);
  assert.ok(fs.statSync('dist/data/secu.json').size < 2e6);
});
