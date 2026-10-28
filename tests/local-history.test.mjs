import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const load = year => JSON.parse(fs.readFileSync(`dist/data/local-spending-${year}.json`, 'utf8'));
test('annual local extracts retain distinct accounts and valid population', () => {
  for (let year = 2012; year <= 2025; year++) {
    const data = load(year);
    assert.equal(data.year, year);
    for (const rows of [data.departments, data.regions]) {
      assert.equal(new Set(rows.map(row => row.siren)).size, rows.length);
      assert.ok(rows.every(row => Number.isFinite(row.total) && row.population > 0));
    }
  }
});
test('Alsace merger and Rhône institutions retain their source identities', () => {
  const old = load(2020).departments;
  assert.equal(old.find(x => x.code === '67').siren, '226700011');
  assert.equal(old.find(x => x.code === '68').siren, '226800019');
  const current = load(2025).departments;
  assert.equal(current.find(x => x.code === '67A').siren, '200094332');
  assert.equal(current.find(x => x.code === '69').total, 546100068.6);
  assert.equal(current.find(x => x.code === '691').total, 3369992899.44);
});

test('pre-2016 regions are grouped onto current boundaries', () => {
  const regions = load(2015).regions;
  assert.equal(regions.length, 17);
  assert.ok(regions.some(row => row.institutions > 1));
  assert.equal(new Set(regions.map(row => row.code)).size, regions.length);
});
