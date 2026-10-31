// UGAP page: data consistency and page wiring. Run: node --test tests/ugap.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const D = JSON.parse(readFileSync('dist/data/ugap.json', 'utf8'));
const C = D.comparison;
const rows = C.table.map(r => Object.fromEntries(C.tableFields.map((f, i) => [f, r[i]])));
const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

test('data file stays small', () => {
  assert.ok(statSync('dist/data/ugap.json').size < 2e6);
});

test('one table row per compared product, with both links', () => {
  assert.equal(rows.length, C.productsCompared);
  assert.equal(C.all.n, rows.length);
  assert.equal(new Set(rows.map(r => r.ugapUrl)).size, rows.length);
  for (const r of rows) {
    assert.match(r.ugapUrl, /^https:\/\/www\.ugap\.fr\//);
    assert.match(r.retailUrl, /^https:\/\//);
    assert.ok(r.ugapTtc > 0 && r.retailTtc > 0);
    assert.ok(Math.abs(r.ratio - r.ugapTtc / r.retailTtc) < 0.002, r.title);
  }
});

test('headline statistics are recomputed from the published pairs', () => {
  assert.ok(Math.abs(C.all.median - median(rows.map(r => r.ratio))) < 0.0015);
  const more = rows.filter(r => r.ratio > 1).length / rows.length;
  assert.ok(Math.abs(C.all.moreExpensive - more) < 0.001);
  const basket = rows.reduce((s, r) => s + r.ugapTtc, 0) / rows.reduce((s, r) => s + r.retailTtc, 0);
  assert.ok(Math.abs(C.all.basket - basket) < 0.001);
  assert.equal(C.histogram.reduce((s, b) => s + b[2], 0), rows.length);
  assert.equal(C.byRetailer.reduce((s, g) => s + g.n, 0), rows.length);
  assert.equal(C.byUniverse.reduce((s, g) => s + g.n, 0), rows.length);
  assert.equal(C.refSeen.n, rows.filter(r => r.refSeen).length);
});

test('coverage counts are coherent', () => {
  const V = D.coverage;
  assert.ok(V.crawled + V.errors <= V.catalogue);
  assert.equal(V.universes.reduce((s, u) => s + u.catalogue, 0), V.catalogue);
  assert.equal(V.universes.reduce((s, u) => s + u.crawled, 0), V.crawled);
  assert.ok(V.publicPrice <= V.crawled);
  for (const r of V.retailers) assert.ok(r.usable <= r.parsed && r.parsed <= r.fetched && r.fetched <= r.urls);
});

test('DECP section keeps frameworks apart and cites its sources', () => {
  const P = D.decp;
  assert.ok(P, 'DECP section built');
  assert.equal(P.siren, '776056467');
  assert.equal(P.asBuyer.perYear.reduce((s, r) => s + r[1], 0), P.asBuyer.rows);
  assert.equal(P.asSupplier.perYear.reduce((s, r) => s + r[1], 0), P.asSupplier.rows);
  for (const r of P.asBuyer.perYear) assert.equal(r[2] + r[3], r[1]);
  assert.ok(D.sources.length >= 1 && D.sources.every(s => s.url.startsWith('https://')));
});

test('page wiring and writing rules', () => {
  const html = readFileSync('dist/ugap.html', 'utf8'), js = readFileSync('dist/ugap.js', 'utf8');
  assert.match(html, /<script defer src="\.\/ugap\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/ugap\.css">/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /og:title/);
  for (const id of ['ugStatus', 'ugKpis', 'ugHist', 'ugRange', 'ugUniverses', 'ugRetailers', 'ugBuyerYears', 'ugLargest', 'ugTable', 'ugMethod', 'ugTodo', 'ugAsk'])
    assert.ok(html.includes(`id="${id}"`), id);
  for (const text of [html, js, readFileSync('dist/ugap.css', 'utf8'), readFileSync('scripts/ugap-data.py', 'utf8')])
    assert.ok(!text.includes('—'), 'no em dash');
  assert.match(html, /tude en cours/);
});
