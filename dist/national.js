const yearSelect = document.getElementById('nationalYear');
const nationalContent = document.getElementById('nationalContent');
const taxContent = document.getElementById('taxContent');
const levyRate = document.getElementById('levyRate');
const reconciliationContent = document.getElementById('reconciliationContent');
const sectorContent = document.getElementById('sectorContent');
const debtContent = document.getElementById('debtContent');
const historyMetric = document.getElementById('historyMetric');
const historyBars = document.getElementById('historyBars');
const historyScroll = document.getElementById('historyScroll');
const historyHint = document.getElementById('historyHint');
const unitSelect = document.getElementById('nationalUnit');
const UNIT_LABELS = { mixed: 'en % du PIB', md: 'en milliards d’euros courants', pib: 'en % du PIB', hab: 'en euros courants par habitant' };
const ratio = value => `${value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const preciseBillions = value => `${value.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} Md€`;
const billions = value => `${value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Md€`;

async function loadNationalFile(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Données indisponibles');
  return response.json();
}

function loadNational() {
return Promise.allSettled([
  loadNationalFile('./data/national-ratios-insee.json'),
  loadNationalFile('./data/national-taxes-insee.json'),
  loadNationalFile('./data/national-accounts-3201.json'),
  loadNationalFile('./data/national-sectors-3215.json'),
  loadNationalFile('./data/national-debt.json'),
  loadNationalFile('./data/insee-population.json')
]).then(([accountsResult, taxesResult, reconciliationResult, sectorsResult, debtResult, populationResult]) => {
  if (accountsResult.status !== 'fulfilled') {
    nationalContent.textContent = 'Impossible de charger les comptes nationaux. Vérifiez que le site est servi par HTTP.';
    taxContent.textContent = 'La sélection des années est indisponible.';
    reconciliationContent.textContent = 'La sélection des années est indisponible.';
    sectorContent.textContent = 'La sélection des années est indisponible.';
    debtContent.textContent = 'La sélection des années est indisponible.';
    yearSelect.disabled = true;
    return;
  }
  const data = accountsResult.value;
  const taxes = taxesResult.status === 'fulfilled' ? taxesResult.value : null;
  const reconciliation = reconciliationResult.status === 'fulfilled' ? reconciliationResult.value : null;
  const sectors = sectorsResult.status === 'fulfilled' ? sectorsResult.value : null;
  const debts = debtResult.status === 'fulfilled' ? debtResult.value : null;
  const january = new Map((populationResult?.status === 'fulfilled' && Array.isArray(populationResult.value?.january1) ? populationResult.value.january1 : []).map(item => [item.year, item.population]));
  // Average population over the year; GDP is recovered from Insee's own Md€ and %-of-GDP pairs.
  const population = year => january.has(year) && january.has(year + 1) ? (january.get(year) + january.get(year + 1)) / 2 : january.get(year) ?? null;
  const gdp = year => {
    const ratios = data.years.find(item => item.year === year);
    const debtRow = debts?.years.find(item => item.year === year);
    if (ratios?.debt && debtRow?.debt) return debtRow.debt / (ratios.debt / 100);
    const account = reconciliation?.years.find(item => item.year === year);
    if (ratios?.spending && account?.spending) return account.spending / (ratios.spending / 100);
    return null;
  };
  let unit = unitSelect?.value || 'mixed';
  const money = (value, year) => {
    if (value == null || !Number.isFinite(value)) return '–';
    if (unit === 'pib') { const base = gdp(year); return base ? `${(100 * value / base).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: Math.abs(100 * value / base) < 1 ? 2 : 1 })} % du PIB` : '–'; }
    if (unit === 'hab') { const people = population(year); return people ? `${Math.round(value * 1e9 / people).toLocaleString('fr-FR')} €/hab.` : '–'; }
    return billions(value);
  };
  const amountFor = (year, key) => key === 'debt' ? debts?.years.find(item => item.year === year)?.debt ?? null : reconciliation?.years.find(item => item.year === year)?.[key] ?? null;
  // Top tiles and history chart: % of GDP by default, otherwise the chosen unit.
  const headline = (row, key) => {
    if (unit === 'mixed' || unit === 'pib') return row[key] == null ? '–' : ratio(row[key]);
    return money(amountFor(row.year, key), row.year);
  };
  for (const row of data.years) {
    const option = document.createElement('option');
    option.value = row.year;
    option.textContent = row.year;
    yearSelect.appendChild(option);
  }
  yearSelect.value = data.years[data.years.length - 1].year;
  /* History chart: every year since 1960 on one full-width SVG. The vertical axis is fitted to the series
     (it does not start at zero) so that year-to-year movements stay visible; the balance is drawn as bars around zero. */
  const EVENTS = [[1975, 'Choc pétrolier'], [1993, 'Récession'], [2009, 'Crise financière'], [2020, 'Covid']];
  const HISTORY_LABELS = { balance: 'Solde public', spending: 'Dépenses', revenue: 'Recettes', debt: 'Dette brute' };
  let historyShown = null, historyAnim = 0, historyHover = null, historyGeom = { left: 0, width: 1, n: 0 };
  const niceStep = range => { const raw = range / 5, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag; };
  function seriesFor(metric) {
    return data.years.map(row => {
      if (unit === 'mixed' || unit === 'pib') return row[metric] ?? null;
      const amount = amountFor(row.year, metric);
      if (amount == null) return null;
      if (unit === 'md') return amount;
      const people = population(row.year);
      return people ? amount * 1e9 / people : null;
    });
  }
  const describeValue = value => unit === 'md' ? billions(value) : unit === 'hab' ? `${Math.round(value).toLocaleString('fr-FR')} €/hab.` : `${value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % du PIB`;
  const shortValue = value => unit === 'md' ? `${Math.round(value).toLocaleString('fr-FR')}` : unit === 'hab' ? `${Math.round(value).toLocaleString('fr-FR')}` : `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
  function drawHistory() {
    const metric = historyMetric.value;
    const target = { metric, values: seriesFor(metric), ghost: metric === 'spending' ? seriesFor('revenue') : metric === 'revenue' ? seriesFor('spending') : null };
    const from = historyShown && historyShown.metric === metric ? null : historyShown;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(historyAnim);
    if (!from || typeof requestAnimationFrame !== 'function' || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) { historyShown = target; paintHistory(target); return; }
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / 520), e = 1 - (1 - t) ** 3;
      const mix = (a, b) => b.map((value, i) => value == null ? null : a[i] == null ? value : a[i] + (value - a[i]) * e);
      historyShown = { ...target, values: mix(from.values, target.values), ghost: target.ghost && mix(from.ghost || target.ghost, target.ghost) };
      paintHistory(historyShown, t < 1 ? null : target);
      if (t < 1) historyAnim = requestAnimationFrame(step); else historyShown = target;
    };
    historyAnim = requestAnimationFrame(step);
  }
  function paintHistory(shown) {
    const { metric, values, ghost } = shown;
    const W = Math.max(320, historyScroll.clientWidth || 960), H = 230, L = 46, R = 12, T = 22, B = 26;
    const years = data.years.map(row => row.year), n = years.length;
    const x = i => L + (W - L - R) * (i + .5) / n;
    const finite = [...values, ...(ghost || [])].filter(Number.isFinite);
    let lo = Math.min(...finite), hi = Math.max(...finite);
    if (metric === 'balance') { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    const pad = (hi - lo) * .08 || 1; lo -= metric === 'balance' && lo === 0 ? 0 : pad; hi += metric === 'balance' && hi === 0 ? 0 : pad;
    const stepV = niceStep(hi - lo); lo = Math.floor(lo / stepV) * stepV; hi = Math.ceil(hi / stepV) * stepV;
    const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const ticks = []; for (let v = lo; v <= hi + stepV / 2; v += stepV) ticks.push(v);
    const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="hc-grid${Math.abs(v) < 1e-9 ? ' zero' : ''}"/><text x="${L - 8}" y="${y(v) + 4}" class="hc-tick" text-anchor="end">${shortValue(v)}</text>`).join('') + (unit === 'md' || unit === 'hab' ? `<text x="${L - 8}" y="${T - 8}" class="hc-tick" text-anchor="end">${unit === 'md' ? 'Md€' : '€/hab.'}</text>` : '');
    const slot = (W - L - R) / n, labelEvery = [1, 2, 5, 10, 20].find(k => k * slot >= 40) || 25;
    const xTicks = years.map((year, i) => year % labelEvery === 0 ? `<text x="${x(i)}" y="${H - 6}" class="hc-tick" text-anchor="middle">${year}</text>` : '').join('');
    const events = EVENTS.map(([year, label]) => { const i = years.indexOf(year); return i < 0 ? '' : `<line x1="${x(i)}" x2="${x(i)}" y1="${T - 6}" y2="${H - B}" class="hc-event"/>${W >= 760 ? `<text x="${x(i) + 4}" y="${T - 8}" class="hc-event-label">${label}</text>` : ''}`; }).join('');
    const path = series => { let d = '', open = false; series.forEach((v, i) => { if (!Number.isFinite(v)) { open = false; return; } d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; open = true; }); return d; };
    let body = '';
    if (metric === 'balance') {
      const bw = Math.max(2, (W - L - R) / n * .7);
      body = values.map((v, i) => Number.isFinite(v) ? `<rect x="${x(i) - bw / 2}" y="${Math.min(y(v), y(0))}" width="${bw}" height="${Math.max(1, Math.abs(y(v) - y(0)))}" rx="1.5" class="${v < 0 ? 'hc-neg' : 'hc-pos'}"/>` : '').join('');
    } else {
      const first = values.findIndex(Number.isFinite), last = values.length - 1 - [...values].reverse().findIndex(Number.isFinite);
      const area = `${path(values)}L${x(last)},${y(lo)}L${x(first)},${y(lo)}Z`;
      body = `${ghost ? `<path d="${path(ghost)}" class="hc-ghost"/>` : ''}<path d="${area}" class="hc-area"/><path d="${path(values)}" class="hc-line"/>`;
    }
    const sel = years.indexOf(Number(yearSelect.value)), focus = historyHover ?? sel;
    let marker = '';
    if (focus >= 0 && Number.isFinite(values[focus])) {
      const fx = x(focus), fy = y(values[focus]), right = fx > W - 190;
      const g = ghost && Number.isFinite(ghost[focus]) ? ` · ${metric === 'spending' ? 'recettes' : 'dépenses'} ${describeValue(ghost[focus])}` : '';
      const text = `${years[focus]} · ${describeValue(values[focus])}${W >= 560 ? g : ''}`, tw = text.length * 6.9 + 18;
      const bx = Math.max(L, Math.min(W - R - tw, right ? fx - tw - 10 : fx + 10)), by = T + 2;
      marker = `<line x1="${fx}" x2="${fx}" y1="${T}" y2="${H - B}" class="hc-cursor"/>${metric === 'balance' ? '' : `<circle cx="${fx}" cy="${fy}" r="5" class="hc-dot"/>`}
        <rect x="${bx}" y="${by}" width="${tw}" height="24" rx="12" class="hc-pill"/><text x="${bx + tw / 2}" y="${by + 16}" text-anchor="middle" class="hc-value">${text}</text>`;
    }
    historyBars.innerHTML = `<svg class="history-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${HISTORY_LABELS[metric]} de ${years[0]} à ${years[n - 1]}">${grid}${events}${body}${xTicks}${marker}<rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent" class="hc-hit"/></svg>`;
    historyGeom = { left: L, width: W - L - R, n };
    const valid = values.filter(Number.isFinite);
    const range = `de ${describeValue(Math.min(...valid))} à ${describeValue(Math.max(...valid))}`;
    historyHint.textContent = metric === 'balance'
      ? `Barres rouges : déficit ; vertes : excédent. Le solde varie ${range} sur la période.${unit === 'hab' ? ' Population Insee disponible depuis 1982.' : ''}`
      : `Axe vertical resserré sur l’amplitude de la série (${range}) : il ne part pas de zéro, pour rendre visibles les variations d’une année à l’autre.${ghost ? ` En pointillé : ${metric === 'spending' ? 'les recettes' : 'les dépenses'} ; l’écart entre les deux courbes est le solde.` : ''}${metric === 'debt' ? ' Dette disponible depuis 1978 dans cette série.' : ''} Euros courants${unit === 'hab' ? ' ; population Insee disponible depuis 1982' : ''}.`;
  }
  const indexAt = event => {
    const box = historyBars.getBoundingClientRect?.() || { left: 0 }, { left, width, n } = historyGeom;
    const i = Math.floor((event.clientX - box.left - left) / width * n);
    return i >= 0 && i < n ? i : null;
  };
  function updateHistorySelection() { if (historyShown) paintHistory(historyShown); }
  historyBars.addEventListener('pointermove', event => { const i = indexAt(event); if (i !== historyHover) { historyHover = i; if (historyShown) paintHistory(historyShown); } });
  historyBars.addEventListener('pointerleave', () => { historyHover = null; if (historyShown) paintHistory(historyShown); });
  historyBars.addEventListener('click', event => {
    const i = indexAt(event);
    if (i == null) return;
    yearSelect.value = data.years[i].year;
    render();
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (historyShown) paintHistory(historyShown); }).observe(historyScroll);
  historyMetric.addEventListener('change', drawHistory);
  function render() {
    const row = data.years.find(item => String(item.year) === yearSelect.value);
    if (!row) return;
    updateHistorySelection();
    nationalContent.innerHTML = `<p class="national-status">${row.year} · ${row.status || 'définitif'} · ${UNIT_LABELS[unit]}</p>
      <div class="national-grid">
        <div class="national-flow"><div class="national-line"><span>Recettes</span><strong>${headline(row, 'revenue')}</strong></div><div class="national-track"><div class="national-bar revenue" style="width:${row.revenue / 70 * 100}%"></div></div>
        <div class="national-line"><span>Dépenses</span><strong>${headline(row, 'spending')}</strong></div><div class="national-track"><div class="national-bar spending" style="width:${row.spending / 70 * 100}%"></div></div><p>Barres : échelle commune de 0 à 70 % du PIB</p></div>
        <div class="national-metric"><span>Solde public</span><strong>${headline(row, 'balance')}</strong><small>Recettes moins dépenses</small></div>
        <div class="national-metric"><span>Dette brute</span><strong>${headline(row, 'debt')}</strong><small>Au sens de Maastricht, fin ${row.year}</small></div>
      </div>`;
    const account = reconciliation?.years.find(item => item.year === row.year);
    if (account) {
      const breakdown = (title, items, total) => `<div class="recon-column"><h4>${title}</h4><ul>${items.map(item => `<li><span>${item.label}</span><strong>${money(item.value, row.year)}</strong></li>`).join('')}</ul><div class="recon-total"><span>Total</span><strong>${money(total, row.year)}</strong></div></div>`;
      reconciliationContent.innerHTML = `<div class="recon-equation"><span>Recettes <strong>${money(account.revenue, row.year)}</strong></span><span aria-hidden="true">−</span><span>Dépenses <strong>${money(account.spending, row.year)}</strong></span><span aria-hidden="true">=</span><span>Solde publié <strong>${money(account.balance, row.year)}</strong></span></div><div class="recon-grid">${breakdown('Recettes', account.revenueBreakdown, account.revenue)}${breakdown('Dépenses', account.spendingBreakdown, account.spending)}</div>`;
    } else reconciliationContent.textContent = 'Détail des comptes indisponible pour cet exercice.';
    const sector = sectors?.years.find(item => item.year === row.year);
    if (sector) {
      const spendingSum = sector.sectors.reduce((sum, item) => sum + item.spending, 0);
      const revenueSum = sector.sectors.reduce((sum, item) => sum + item.revenue, 0);
      const sectorBalance = sector.sectors.reduce((sum, item) => sum + item.balance, 0);
      const totalBalance = sector.totalRevenue - sector.totalSpending;
      const anomaly = account && (Math.abs(sector.totalRevenue - account.revenue) >= .0005 || Math.abs(sector.totalSpending - account.spending) >= .0005 || Math.abs(sectorBalance - totalBalance) >= .0005);
      const discrepancy = anomaly ? `<p class="sector-warning"><strong>Écart entre chiffres publiés :</strong> recettes totales 3.215 − 3.201 = ${preciseBillions(sector.totalRevenue - account.revenue)} ; dépenses totales 3.215 − 3.201 = ${preciseBillions(sector.totalSpending - account.spending)}. La somme des soldes sectoriels diffère du solde total 3.215 de ${preciseBillions(sectorBalance - totalBalance)}. Écart à expliquer ; il ne prouve pas une dépense manquante.</p>` : '';
      sectorContent.innerHTML = `<div class="sector-table-wrap"><table class="sector-table"><thead><tr><th scope="col">Sous-secteur</th><th scope="col">Recettes</th><th scope="col">Dépenses</th><th scope="col">Solde calculé</th></tr></thead><tbody>${sector.sectors.map(item => `<tr><th scope="row">${item.label}</th><td>${money(item.revenue, row.year)}</td><td>${money(item.spending, row.year)}</td><td>${money(item.balance, row.year)}</td></tr>`).join('')}</tbody></table></div><p class="national-note">Somme des recettes sectorielles : ${money(revenueSum, row.year)} ; somme des dépenses sectorielles : ${money(spendingSum, row.year)}. Totaux consolidés publiés dans 3.215 : ${money(sector.totalRevenue, row.year)} et ${money(sector.totalSpending, row.year)}. Les écarts reflètent principalement les flux entre secteurs éliminés lors de la consolidation.</p>${discrepancy}`;
    } else sectorContent.textContent = 'Détail par secteur indisponible pour cet exercice.';
    const debt = debts?.years.find(item => item.year === row.year);
    if (debt) {
      const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value), row.year)}`;
      const debtMax = Math.max(...debt.sectors.map(item => item.value));
      const stockChange = debt.previousDebt == null ? null : debt.debt - debt.previousDebt;
      const changeLabel = debt.change == null ? 'Variation calculée' : 'Variation publiée';
      const changeValue = debt.change == null ? stockChange : debt.change;
      const bridge = debt.deficit == null ? '<p>Le détail du passage du déficit à la dette est disponible à partir de 2009 dans cette source.</p>' : `<ul><li><span>Déficit à financer</span><strong>${signed(debt.deficit)}</strong></li>${debt.adjustments.map(item => `<li><span>${item.label}</span><strong>${signed(item.value)}</strong></li>`).join('')}</ul><div class="recon-total"><span>Variation de dette publiée</span><strong>${signed(debt.change)}</strong></div>`;
      const mismatch = Math.abs(debt.stockDifference ?? 0) > .11 ? `<p class="sector-warning">Écart entre la variation des stocks (tableau 3.101) et la variation publiée (3.105) : ${preciseBillions(debt.stockDifference)}. Écart de sources à expliquer.</p>` : '';
      debtContent.innerHTML = `<div class="debt-summary"><div><span>Dette fin ${row.year - 1}</span><strong>${debt.previousDebt == null ? '–' : money(debt.previousDebt, row.year - 1)}</strong></div><div><span>${changeLabel}</span><strong>${changeValue == null ? '–' : signed(changeValue)}</strong></div><div><span>Dette fin ${row.year}</span><strong>${money(debt.debt, row.year)}</strong></div></div><div class="recon-grid"><div class="recon-column"><h4>Passage du déficit à la dette</h4>${bridge}</div><div class="recon-column"><h4>Contribution à la dette en fin d’année</h4><div class="debt-bars">${debt.sectors.map(item => `<div><div class="tax-line"><span>${item.label}</span><strong>${money(item.value, row.year)}</strong></div><div class="tax-track" aria-hidden="true"><div class="tax-bar" style="width:${100 * item.value / debtMax}%"></div></div></div>`).join('')}</div></div></div>${mismatch}`;
    } else debtContent.textContent = 'Détail de la dette indisponible pour cet exercice.';
    const tax = taxes?.years.find(item => item.year === row.year);
    if (!tax) {
      levyRate.textContent = '';
      taxContent.textContent = 'Détail fiscal indisponible pour cet exercice.';
      return;
    }
    levyRate.innerHTML = `<span>Prélèvements obligatoires</span><strong>${ratio(tax.levyRate)}</strong><small>du PIB · ${row.year}</small>`;
    if (!tax.categories.length) { taxContent.textContent = 'Le détail par catégorie commence en 1995 dans cette source.'; return; }
    const maximum = Math.max(...tax.categories.map(item => item.value));
    taxContent.innerHTML = `<div class="tax-bars">${tax.categories.map(item => `<div class="tax-row"><div class="tax-line"><span>${item.label}</span><strong>${money(item.value, row.year)}</strong></div><div class="tax-track" aria-hidden="true"><div class="tax-bar" style="width:${100 * item.value / maximum}%"></div></div></div>`).join('')}</div>
      <details class="tax-details"><summary>Voir quelques impôts compris dans ces catégories</summary><p>Ces montants sont déjà inclus dans les catégories ci-dessus ; ne les additionnez pas une seconde fois.</p><ul>${tax.details.map(item => `<li><span>${item.label}</span><strong>${money(item.value, row.year)}</strong></li>`).join('')}</ul><p>La CSG et la CRDS sur les jeux figurent dans les impôts sur les produits.</p></details>`;
  }
  yearSelect.addEventListener('change', render);
  unitSelect?.addEventListener('change', () => { unit = unitSelect.value; drawHistory(); render(); });
  drawHistory();
  render();
});
}

// Load the national accounts only when their section approaches the viewport,
// so the map's data gets the network first.
const nationalSection = document.getElementById('comptes');
if (typeof IntersectionObserver === 'function' && nationalSection) {
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    loadNational();
  }, { rootMargin: '800px 0px' });
  observer.observe(nationalSection);
} else loadNational();
