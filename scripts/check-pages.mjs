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
  'recherche.html?q=Paris%2012', 'index.html?commune=77284#explorer'];
const pages = readdirSync('dist').filter(f => f.endsWith('.html')).sort().concat(EXTRA);
const sizes = [['tel', { width: 390, height: 844 }], ['large', { width: 1366, height: 900 }]];

const browser = await chromium.launch();
let problems = 0, opened = 0;
for (const [label, viewport] of sizes) {
  const ctx = await browser.newContext({ viewport });
  for (const page of pages) {
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
    for (const e of [...new Set(errs)]) { problems++; console.log(`${label} ${page} : ${e}`); }
    await p.close();
  }
  await ctx.close();
}
await browser.close();
console.log(`${opened} ouvertures (${pages.length} pages × 2 largeurs), ${problems} problème(s)`);
process.exit(problems ? 1 : 0);
