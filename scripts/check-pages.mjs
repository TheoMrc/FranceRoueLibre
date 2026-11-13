// Every page of dist/ opened at phone and desktop width (scripts/check.py starts the local server first):
// JavaScript errors, horizontal scroll, files of the site that do not load. Prints one line per problem,
// then a summary line; exit code 1 when a page has a problem.
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.FRL_BASE || 'http://127.0.0.1:4173/';
// pages with a query, as readers open them (search, a commune, a place in a sentence)
const EXTRA = ['recherche.html?q=cantine', 'recherche.html?q=' + encodeURIComponent('Analyse les dépenses a Alès'),
  'recherche.html?q=Paris%2012', 'recherche.html?q=382550184', 'index.html?commune=77284#explorer'];
const pages = readdirSync('dist').filter(f => f.endsWith('.html')).sort().concat(EXTRA);
const sizes = [['tel', { width: 390, height: 844 }], ['large', { width: 1366, height: 900 }]];

// Six pages open at once (FRL_PAGES_PARALLEL to change it): the wait is the network going idle, not the processor.
const PARALLEL = Math.max(1, +process.env.FRL_PAGES_PARALLEL || 6);
const browser = await chromium.launch();
let opened = 0;
const found = [];   // [order, line] so that the report keeps the order of the pages whatever finishes first
const jobs = [];
for (const [label, viewport] of sizes) {
  const ctx = await browser.newContext({ viewport });
  pages.forEach(page => jobs.push({ label, page, ctx, order: jobs.length }));
}
async function open({ label, page, ctx, order }) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(`erreur JS : ${String(e.message).slice(0, 160)}`));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(`console : ${m.text().slice(0, 160)}`); });
  p.on('response', r => {
    const u = r.url();
    if (u.startsWith(BASE) && r.status() >= 400 && !u.includes('/api/assistant/')) errs.push(`${r.status()} ${u.slice(BASE.length, BASE.length + 100)}`);
  });
  try {
    await p.goto(BASE + page, { waitUntil: 'networkidle', timeout: 45000 });
    await p.waitForTimeout(400);
    const w = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (w > 1) errs.push(`défile en largeur de ${w} px`);
  } catch (e) {
    errs.push(`ne s’ouvre pas : ${String(e.message).split('\n')[0].slice(0, 120)}`);
  }
  opened++;
  for (const e of [...new Set(errs)]) found.push([order, `${label} ${page} : ${e}`]);
  await p.close();
}
let next = 0;
await Promise.all(Array.from({ length: PARALLEL }, async () => { while (next < jobs.length) await open(jobs[next++]); }));
await browser.close();
found.sort((a, b) => a[0] - b[0]).forEach(([, line]) => console.log(line));
const problems = found.length;
console.log(`${opened} ouvertures (${pages.length} pages × 2 largeurs), ${problems} problème(s)`);
process.exit(problems ? 1 : 0);
