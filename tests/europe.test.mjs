// node --test tests/europe.test.mjs : page « La France et ses voisins » (dist/europe.html, data/europe.json from scripts/europe-data.py)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const dist = new URL('../dist/', import.meta.url);
const read = path => fs.readFileSync(new URL(path, dist), 'utf8');
const data = JSON.parse(read('data/europe.json'));
const csv = fs.readFileSync(new URL('../sources/resultats/eurostat_gov_remuneration_salaries_ue.csv', import.meta.url), 'utf8').trim().split('\n').map(l => l.split(','));
const head = csv[0], rows = csv.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
const src = (geo, year, col) => { const r = rows.find(x => x.geo === geo && x.annee === String(year)); return r && r[col] !== '' ? Number(r[col]) : null; };
const num = v => typeof v === 'number' && Number.isFinite(v);

test('27 EU countries, the published EU aggregate, one value per year', () => {
  assert.equal(data.eu27.length, 27);
  assert.equal(data.aggregate, 'EU27_2020');
  assert.equal(data.years[0], 1995);
  for (const m of Object.values(data.metrics)) {
    assert.ok(m.label && m.unit && m.source && m.url && ['asc', 'desc'].includes(m.order));
    for (const [geo, values] of Object.entries(m.values)) {
      assert.equal(values.length, data.years.length, geo);
      assert.ok(data.names[geo], `nom français manquant : ${geo}`);
      values.forEach(v => assert.ok(v === null || num(v)));
    }
  }
});

test('values are those of the versioned Eurostat extract, never retyped', () => {
  for (const [metric, col] of [['depenses', 'TE_PC_GDP'], ['remunerations', 'D1PAY_PC_GDP']]) {
    for (const geo of ['FR', 'DE', 'IE', 'EU27_2020']) {
      data.years.forEach((y, i) => assert.equal(data.metrics[metric].values[geo][i], src(geo, y, col), `${metric} ${geo} ${y}`));
    }
  }
});

test('gap, rank and euros are recomputed from the published series', () => {
  const te = data.metrics.depenses.values;
  for (const g of data.gap) {
    const i = data.years.indexOf(g.year);
    assert.equal(g.france, te.FR[i]);
    assert.equal(g.eu, te.EU27_2020[i]);
    assert.ok(Math.abs(g.points - (g.france - g.eu)) < 0.051);
    const pool = data.eu27.map(c => te[c][i]).filter(num).sort((a, b) => b - a);
    assert.equal(g.rank, pool.indexOf(g.france) + 1);
    assert.equal(g.of, pool.length);
    const gdp = src('FR', g.year, 'TE_MIO_EUR') / g.france * 100 / 1000;   // Md€
    assert.ok(Math.abs(g.mdEur - g.points / 100 * gdp) < 0.06, `${g.year}`);
    assert.ok(Math.abs(data.gdpFrance[g.year] - gdp) < 0.06);
  }
  assert.deepEqual(data.france, data.gap[data.gap.length - 1]);
  assert.equal(data.computed.length, 5);
});

test('a series whose file is not downloaded is listed as pending, never drawn empty', () => {
  for (const key of ['recettes', 'solde', 'dette', 'interets', 'taux']) assert.notEqual(key in data.metrics, data.pending.includes(key), key);
  assert.equal(data.cofog === null, data.pending.includes('cofog'));
  assert.equal(data.imf === null, data.pending.includes('fmi'));
});

test('decoders of the raw formats (synthetic shapes, no real figure)', () => {
  const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('europe', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
doc = {'id': ['unit', 'geo', 'time'], 'size': [1, 2, 3], 'updated': 'x', 'status': {'5': 'p'}, 'value': {'0': 1.5, '2': 3, '5': 6},
       'dimension': {'unit': {'category': {'index': {'PC_GDP': 0}}}, 'geo': {'category': {'index': {'FR': 1, 'DE': 0}}}, 'time': {'category': {'index': ['2023', '2024', '2025']}}}}
rows, upd = m.jsonstat(doc)
out = {'rows': [[r['geo'], r['time'], r['value'], r['flag']] for r in rows], 'imf': m.imf_series({'values': {'X': {'FRA': {'2030': 1.25, '2031': None}}}}, 'X')}
try: m.select(rows, {'sector': 'S13'}); out['strict'] = False
except ValueError: out['strict'] = True
try: m.imf_series({'values': {}}, 'X'); out['strict2'] = False
except ValueError: out['strict2'] = True
print(json.dumps(out))`;
  const out = JSON.parse(execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', py, new URL('../scripts/europe-data.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' }));
  assert.deepEqual(out.rows, [['DE', '2023', 1.5, ''], ['DE', '2025', 3, ''], ['FR', '2025', 6, 'p']]);
  assert.deepEqual(out.imf, { FRA: { 2030: 1.25 } });
  assert.ok(out.strict && out.strict2);
});

test('page wiring: menu, scripts, hidden optional sections, no em dash', () => {
  const html = read('europe.html'), js = read('europe.js');
  assert.ok(html.includes('europe.css') && html.includes('europe.js'));
  assert.ok(/aria-current="page"><span class="nav__txt"><strong>(<svg[^>]*>.*?<\/svg>)?La France et ses voisins/.test(html));
  for (const id of ['euLead', 'euMetric', 'euYear', 'euKpis', 'euRank', 'euLines', 'euPick', 'euRankLine', 'euGap', 'euGapUnit', 'euQuestions', 'euCofog', 'euImf', 'euPending', 'euSources']) {
    assert.ok(html.includes(`id="${id}"`), id);
    assert.ok(js.includes(`'${id}'`), id);
  }
  assert.ok(/<section[^>]*id="fonctions"[^>]*hidden/.test(html) && /<section[^>]*id="fmi"[^>]*hidden/.test(html));
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.ok(!main.includes('—') && !js.replace(/\/\*[\s\S]*?\*\//g, '').includes('—'));
  assert.ok(read('index.html').includes('href="europe.html"'));
});
