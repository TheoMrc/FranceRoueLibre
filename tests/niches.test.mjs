import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

const data = JSON.parse(fs.readFileSync('dist/data/niches.json', 'utf8'));
const M = data.measures;

test('one row per measure code, amounts sane, statuses consistent', () => {
  assert.equal(new Set(M.map(m => m.id)).size, M.length);
  // Codes are unique except when a new measure takes over an old code (two labels, each with its full cost).
  assert.ok(new Set(M.map(m => m.c)).size >= M.length - 2);
  assert.equal(M.length, data.counts.measures);
  for (const m of M) {
    assert.match(m.c, /^\d{5,6}$/, m.c); assert.ok(m.id === m.c || m.id.startsWith(`${m.c}-`), m.id);
    assert.ok(m.l && m.i && m.m, m.c);
    assert.equal(m.v.length, 3);
    for (const v of m.v) assert.ok(v === null || (Number.isFinite(v) && v > 0), `${m.c} ${v}`);
    // ε and nc never carry a 2026 amount; a measure with a 2026 amount is « chiffré ».
    if (m.v[2] != null) assert.equal(m.st, 'chiffré', m.c);
    else assert.ok(['nc', 'ε', 'vide'].includes(m.st), m.c);
    if (m.f) assert.equal(m.v[2], null, m.c);
    // Environmental shares of a split measure add up to the whole measure.
    assert.ok(Math.abs(m.g.reduce((s, [, share]) => s + share, 0) - 1) < 0.011, m.c);
  }
  const c = data.counts;
  assert.equal(c.known2026 + c.nc + c.eps + c.empty, c.measures);
});

test('totals: per-year sums of costed measures, equal to the sum of the file lines', () => {
  data.years.forEach((year, k) => {
    const vals = M.map(m => m.v[k]).filter(v => v != null);
    assert.equal(data.totals[k].year, year);
    assert.equal(data.totals[k].count, vals.length);
    assert.ok(Math.abs(data.totals[k].total - vals.reduce((s, v) => s + v, 0)) < 0.5);
    // Splitting a measure across ratings never changes its cost: per-measure sums = line sums.
    assert.ok(Math.abs(data.totals[k].total - data.linesTotal[k]) < 0.5);
  });
  const byTax = data.byTax.reduce((s, g) => s + g.v26, 0), byMission = data.byMission.reduce((s, g) => s + g.v26, 0);
  assert.ok(Math.abs(byTax - data.totals[2].total) < 0.5 && Math.abs(byMission - data.totals[2].total) < 0.5);
  assert.equal(data.byTax.reduce((s, g) => s + g.n, 0), M.length);
});

test('PLF 2024 list: no amounts in the published file, codes matched once', () => {
  const c = data.counts;
  assert.equal(c.plf24CostCells, 0);
  assert.equal(c.inBoth + c.new, c.measures);
  assert.equal(c.inBoth + c.gone, c.plf24);
  for (const g of data.gone) assert.ok(!M.some(m => m.c === g.c), g.c);
  assert.equal(c.inBoth, new Set(M.filter(m => m.in24).map(m => m.c)).size);
  for (const s of Object.values(data.sources)) assert.match(s.url, /^https:\/\//);
});

test('raw file reproduces the 2026 total (when sources/raw is present)', { skip: !fs.existsSync('sources/raw/plf26-budget-vert.csv.gz') }, () => {
  const text = zlib.gunzipSync(fs.readFileSync('sources/raw/plf26-budget-vert.csv.gz')).toString('utf8');
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(';'), kType = cols.indexOf('type_depense'), k26 = cols.indexOf('plf_2026_cp_ou_prevision_2026_si_depense_fiscale');
  // Labels can contain quoted semicolons: parse each line properly.
  const parse = line => { const out = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ';' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const df = lines.map(parse).filter(r => r[kType] === 'Dépenses fiscales');
  assert.equal(df.length, data.counts.lines);
  const sum = df.reduce((s, r) => s + (r[k26] ? Number(r[k26]) : 0), 0) / 1e6;
  assert.ok(Math.abs(sum - data.totals[2].total) < 0.5, `${sum}`);
});
