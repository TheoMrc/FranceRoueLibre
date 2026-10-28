import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const taxes = JSON.parse(fs.readFileSync('sources/national-taxes-insee.json', 'utf8'));
const ratios = JSON.parse(fs.readFileSync('sources/national-ratios-insee.json', 'utf8'));
const accounts = JSON.parse(fs.readFileSync('sources/national-accounts-3201.json', 'utf8'));
const sectors = JSON.parse(fs.readFileSync('sources/national-sectors-3215.json', 'utf8'));
const debt = JSON.parse(fs.readFileSync('sources/national-debt.json', 'utf8'));
test('tax extract preserves Insee annual values and category hierarchy', () => {
  assert.equal(ratios.years[0].year, 1960);
  assert.equal(taxes.years.find(x => x.categories.length).year, 1995);
  assert.ok(ratios.years.every(row => taxes.years.some(item => item.year === row.year))); 
  const current = taxes.years.at(-1);
  assert.equal(current.levyRate, 43.6);
  assert.equal(current.categories.find(x => x.id === 'vat').value, 208.8);
  assert.equal(current.categories.find(x => x.id === 'income').value, 383.3);
  for (const row of taxes.years) {
    assert.equal(row.categories.length, row.year >= 1995 ? 8 : 0);
    assert.ok(row.details.every(detail => row.categories.some(category => category.id === detail.parent && detail.value <= category.value)));
  }
  assert.deepEqual(JSON.parse(fs.readFileSync('dist/data/national-taxes-insee.json', 'utf8')), taxes);
});
async function renderFixture(failTaxes = false) {
  const select = { options: [], set value(v) { this._value = String(v); }, get value() { return this._value; }, appendChild(o) { this.options.push(o); }, addEventListener(_, fn) { this.change = fn; } };
  const elements = { nationalYear: select, nationalContent: {}, taxContent: {}, levyRate: {}, reconciliationContent: {}, sectorContent: {}, debtContent: {}, historyMetric: { value: 'spending', addEventListener() {} }, historyBars: { innerHTML: '', querySelectorAll: () => [], addEventListener() {} }, historyScroll: { scrollWidth: 2000 }, historyHint: {}  };
  const document = { getElementById: id => elements[id], createElement: () => ({}) };
  const fetch = async path => ({ ok: !failTaxes || !path.includes('taxes'), json: async () => path.includes('taxes') ? taxes : path.includes('3201') ? accounts : path.includes('3215') ? sectors : path.includes('debt') ? debt : ratios });
  vm.runInNewContext(fs.readFileSync('dist/national.js', 'utf8'), { document, fetch });
  await new Promise(resolve => setImmediate(resolve));
  return elements;
}
test('year selection changes fiscal values and keeps nested taxes separate', async () => {
  const elements = await renderFixture();
  assert.match(elements.taxContent.innerHTML, /208,8 Md€/);
  assert.match(elements.levyRate.innerHTML, /43,6 %/);
  assert.match(elements.taxContent.innerHTML, /déjà inclus/);
  elements.nationalYear.value = 2020;
  elements.nationalYear.change();
  assert.match(elements.taxContent.innerHTML, /162,1 Md€/);
  assert.match(elements.levyRate.innerHTML, /44,3 %/);
});
test('national accounts remain available when tax data cannot load', async () => {
  const elements = await renderFixture(true);
  assert.match(elements.nationalContent.innerHTML, /115,7 %/);
  assert.match(elements.taxContent.textContent, /indisponible/);
});

test('published revenue and spending subtotals reproduce the financing balance', () => {
  for (const year of accounts.years) {
    assert.ok(Math.abs(year.revenue - year.spending - year.balance) < 0.001);
    assert.ok(Math.abs(year.spendingBreakdown.reduce((sum, x) => sum + x.value, 0) - year.spending) < 0.001);
    assert.ok(Math.abs(year.revenueBreakdown.reduce((sum, x) => sum + x.value, 0) - year.revenue) < 0.001);
  }
  assert.equal(accounts.years.at(-1).balance, -151.592);
});
test('reconciliation follows the selected year', async () => {
  const elements = await renderFixture();
  assert.match(elements.reconciliationContent.innerHTML, /151,6 Md€/);
  elements.nationalYear.value = 2020; elements.nationalYear.change();
  assert.match(elements.reconciliationContent.innerHTML, /207,1 Md€/);
});

test('sector accounting preserves the published 2024 discrepancy', async () => {
  const year = sectors.years.find(x => x.year === 2024);
  const whole = accounts.years.find(x => x.year === 2024);
  assert.ok(Math.abs(year.totalSpending - whole.spending - .119) < .0001);
  assert.ok(Math.abs(year.sectors.reduce((sum, x) => sum + x.balance, 0) - whole.balance) < .0001);
  const elements = await renderFixture();
  assert.doesNotMatch(elements.sectorContent.innerHTML, /Écart entre chiffres publiés/);
  elements.nationalYear.value = 2024; elements.nationalYear.change();
  assert.match(elements.sectorContent.innerHTML, /Écart entre chiffres publiés/);
  assert.match(elements.sectorContent.innerHTML, /0,119 Md€/);
});
test('2025 sector balances sum to the consolidated total', () => {
  const year = sectors.years.find(x => x.year === 2025);
  assert.ok(Math.abs(year.sectors.reduce((sum, x) => sum + x.balance, 0) - (year.totalRevenue - year.totalSpending)) < .0001);
  assert.ok(year.sectors.reduce((sum, x) => sum + x.spending, 0) > year.totalSpending);
});

test('published debt bridge connects deficit, adjustments and year-end stocks', () => {
  for (const year of debt.years) {
    if (year.change != null) {
      assert.ok(Math.abs(year.deficit + year.adjustments.reduce((sum, x) => sum + x.value, 0) - year.change) < .11);
      if (year.year !== 2014) assert.ok(Math.abs(year.debt - year.previousDebt - year.change) < .11);
    }
    assert.ok(Math.abs(year.sectors.reduce((sum, x) => sum + x.value, 0) - year.debt) < .21);
  }
  const row = debt.years.at(-1);
  assert.equal(row.debt, 3460.1); assert.equal(row.deficit, 151.6); assert.equal(row.change, 154);
});
test('debt bridge updates with the selected year', async () => {
  const elements = await renderFixture();
  assert.match(elements.debtContent.innerHTML, /3 460,1 Md€/);
  assert.match(elements.debtContent.innerHTML, /−14,2 Md€/);
  elements.nationalYear.value = 2020; elements.nationalYear.change();
  assert.match(elements.debtContent.innerHTML, /276,5 Md€/);
});

test('early years show available figures and explicitly identify absent series', async () => {
  const elements = await renderFixture();
  elements.nationalYear.value = 1970; elements.nationalYear.change();
  assert.match(elements.nationalContent.innerHTML, /Dette brute<\/span><strong>—/);
  assert.match(elements.taxContent.textContent, /1995/);
  assert.match(elements.reconciliationContent.innerHTML, /Recettes/);
  elements.nationalYear.value = 2014; elements.nationalYear.change();
  assert.match(elements.debtContent.innerHTML, /Écart entre la variation des stocks/);
});
