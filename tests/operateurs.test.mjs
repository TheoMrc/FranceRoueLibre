import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

const data = JSON.parse(fs.readFileSync('dist/data/operateurs.json', 'utf8'));
const OPS = data.operators, T = data.totals;
const RAW = 'sources/raw/datagouv-operateurs-2026--1.csv.gz';

test('the list has the 431 operators announced by the PLF 2026 jaune, each counted once', () => {
  assert.equal(OPS.length, 431);
  assert.equal(T.operators, T.published);
  assert.equal(T.standalone + T.inCategories, T.operators);
  assert.equal(new Set(OPS.map(o => o.id)).size, OPS.length);
  assert.equal(new Set(OPS.filter(o => o.category).map(o => o.category)).size, T.categories);
  for (const o of OPS) {
    assert.ok(o.name && o.statut && o.mission, o.name);
    assert.match(o.programme, /^\d{3}$/, o.name);
    assert.ok(data.programmes.some(p => p.code === o.programme), o.programme);
    assert.ok(data.statuts[o.statut], o.statut);
  }
  // Known lines and networks.
  assert.ok(OPS.some(o => o.acronym === 'CNRS'));
  assert.equal(OPS.filter(o => o.category === 'Agences de l\'eau').length, 6);
  assert.equal(OPS.filter(o => o.category === 'ARS - Agences régionales de santé').length, 18);
});

test('the list matches the raw file when it is present', { skip: !fs.existsSync(RAW) }, () => {
  const text = new TextDecoder('windows-1252').decode(zlib.gunzipSync(fs.readFileSync(RAW)));
  const records = (text.match(/;2026\r?$/gm) || []).length; // every record ends with its PLF year
  assert.equal(records, OPS.length);
});

test('subsidies stay at programme level and add up to the PLF 2025 total', () => {
  const sum = data.programmes.reduce((s, p) => s + (p.scspCp || 0), 0);
  assert.ok(Math.abs(sum - T.scspCp) < data.programmes.length, `${sum} vs ${T.scspCp}`);
  const chef = data.programmes.filter(p => p.operators > 0).reduce((s, p) => s + (p.scspCp || 0), 0);
  assert.ok(Math.abs(chef - T.scspChefCp) < data.programmes.length);
  assert.ok(T.scspCp > 30e9 && T.scspCp < 40e9);
  // No per-operator subsidy is ever stored: it is not published.
  for (const o of OPS) assert.equal(o.scsp, undefined, o.name);
  assert.equal(data.programmes.reduce((s, p) => s + p.operators, 0), OPS.length);
  // Programmes missing from the PLF 2025 keep an empty ministry and amount.
  for (const p of data.programmes.filter(p => !p.inPlf25)) { assert.equal(p.ministere, null); assert.equal(p.scspCp, null); }
});

test('earmarked taxes: kept = yield - returned, and every line attached once', () => {
  const check = t => { for (const y of ['y2022', 'y2023', 'y2024']) { const v = t[y]; if (v.yield != null) assert.equal(v.kept, v.yield - (v.returned || 0)); } };
  const groups = [...OPS.filter(o => o.taxes).map(o => o.taxes), ...Object.values(data.categoryTaxes), ...data.unmatchedTaxes];
  groups.forEach(g => { check(g); g.items.forEach(check); assert.equal(g.count, g.items.length); });
  const lines = groups.reduce((s, g) => s + g.count, 0);
  assert.equal(lines, T.taxesOperatorsLines);
  const kept = groups.reduce((s, g) => s + (g.y2024.kept || 0), 0);
  assert.ok(Math.abs(kept - T.taxesOperators2024.kept) < lines + 1);
  assert.ok(OPS.find(o => o.name === 'France Compétences').taxes.y2024.kept > 11e9);
  assert.ok(data.categoryTaxes['Agences de l\'eau']);
});

test('page files: no em dash, every id used by the script exists in the page, sources linked', () => {
  const html = fs.readFileSync('dist/operateurs.html', 'utf8'), js = fs.readFileSync('dist/operateurs.js', 'utf8'), css = fs.readFileSync('dist/operateurs.css', 'utf8');
  for (const [name, text] of [['html', html], ['js', js], ['css', css]]) assert.ok(!text.includes('—'), `em dash in ${name}`);
  const ids = [...js.matchAll(/\$\('([A-Za-z]+)'\)/g)].map(m => m[1]);
  for (const id of new Set(ids)) assert.ok(html.includes(`id="${id}"`) || js.includes(`id="${id}"`), id);
  assert.ok(html.includes('./operateurs.css') && html.includes('./operateurs.js'));
  assert.ok(html.includes('id="non-publie"'));
  for (const s of Object.values(data.sources)) assert.match(s.url, /^https:\/\//);
});
