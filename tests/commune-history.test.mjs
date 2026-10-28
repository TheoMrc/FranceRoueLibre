import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const load = year => JSON.parse(fs.readFileSync(`dist/data/commune-spending-${year}.json`, 'utf8'));
test('annual extracts report their full matching coverage and unique codes', () => {
  for (let year = 2012; year <= 2025; year++) {
    const data = load(year);
    assert.equal(data.year, year);
    assert.equal(data.rows.length + data.unmatched + data.missingValues + data.ambiguousRecords, data.sourceRecords);
    assert.equal(new Set(data.rows.map(row => row[0])).size, data.rows.length);
    assert.ok(data.rows.every(row => Number.isFinite(row[1]) && (row[2] === null || Number.isFinite(row[2]))));
  }
});
test('published Bolazec accounts retain yearly amounts and population', () => {
  assert.deepEqual(load(2018).rows.find(row => row[0] === '29012').slice(0, 3), ['29012', 326488.32, 210]);
  assert.deepEqual(load(2025).rows.find(row => row[0] === '29012').slice(0, 3), ['29012', 622818.06, 174]);
});
test('a commune without a 2025 account is not silently converted to zero', () => {
  assert.ok(load(2024).rows.some(row => row[0] === '60198' && row[1] === 409696.45));
  assert.equal(load(2025).rows.find(row => row[0] === '60198'), undefined);
  assert.equal(load(2025).rows.length, 34778);
});

test('2025 unmatched contours stay separate from available account totals', () => {
  const metadata = JSON.parse(fs.readFileSync('dist/data/budgets-2025.json', 'utf8')).communes;
  const available = new Set(load(2025).rows.map(row => row[0]));
  const unmatched = metadata.filter(row => !available.has(row.code));
  assert.equal(unmatched.length, 97);
  assert.ok(unmatched.some(row => row.code === '60198'));
  assert.ok(!available.has('60198'));
});

test('ambiguous transition-year codes are excluded rather than silently merged', () => {
  const a = load(2015), b = load(2016);
  assert.equal(a.ambiguousRecords, 2);
  assert.equal(b.ambiguousRecords, 4);
  assert.equal(a.rows.find(row => row[0] === '70418'), undefined);
  assert.equal(b.rows.find(row => row[0] === '52064'), undefined);
  assert.equal(b.rows.find(row => row[0] === '25575'), undefined);
});
