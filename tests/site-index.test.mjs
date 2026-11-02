import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Built by: python3 scripts/site-index.py
const index = JSON.parse(fs.readFileSync('dist/data/site-index.json', 'utf8')).entries;

test('site index: every entry points to an existing page and section', () => {
  for (const e of index) {
    const [page, id] = e.url.split('#');
    const html = fs.readFileSync(`dist/${page}`, 'utf8');
    if (id) assert.match(html, new RegExp(`id="${id}"`), `${e.url} : ancre absente`);
    assert.ok(e.title, `${e.url} : titre vide`);
  }
});

test('site index: every page of the menu is indexed', () => {
  const pages = fs.readdirSync('dist').filter(f => f.endsWith('.html') && !['recherche.html', 'mentions.html'].includes(f));
  const indexed = new Set(index.map(e => e.url.split('#')[0]));
  for (const p of pages) assert.ok(indexed.has(p), `${p} absent de l’index`);
  assert.ok(index.some(e => e.url === 'emplois.html#synthese' && /fonctionnaires/.test(e.keywords)));
});
