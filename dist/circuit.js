/* Le circuit de l'argent public — animated Sankey built from Insee national accounts.
   Left: where the money comes from (taxes by category, social contributions, other revenue, borrowing).
   Middle: all general government (APU, consolidated). Right: what it is spent on.
   Bottom: how the year's deficit turns into the change in Maastricht debt.
   Every flow is a published Insee figure, except the "cotisations sociales et autres" node, which is
   computed as (impôts et cotisations sociales, table 3.201) − (sum of tax categories, table "Impôts")
   and labelled as such. */
(() => {
  const root = document.getElementById('circuit');
  if (!root) return;
  const svg = document.getElementById('circuitSvg');
  const yearInput = document.getElementById('circuitYear');
  const yearLabel = document.getElementById('circuitYearLabel');
  const playButton = document.getElementById('circuitPlay');
  const unitSelect = document.getElementById('circuitUnit');
  const scopeSelect = document.getElementById('circuitScope');
  const tooltip = document.getElementById('circuitTooltip');
  const summary = document.getElementById('circuitSummary');
  const debtBox = document.getElementById('circuitDebt');
  const checks = document.getElementById('circuitChecks');
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000, H = 540, NODE_W = 14, GAP = 7;
  const COLX = [150, 486, 836];
  const fmt = (value, digits = 1) => value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  const COLORS = {
    vat: '#0e7490', income: '#0891b2', products: '#22a5c0', production: '#2b8fb5', payroll: '#3a7fc4', otherTaxes: '#5ea7c9',
    social: '#1d4ed8', taxesAll: '#0e7490', production_sales: '#64748b', property: '#7c8ca3', transfers: '#94a3b8',
    deficit: '#e11d48', surplus: '#16a34a', apu: '#1e3a8a',
    operating: '#2563eb', interest: '#f59e0b', benefits: '#4f46e5', investment: '#0ea5e9',
    l_tax: '#0e7490', l_othertax: '#0891b2', l_reversed: '#22a5c0', l_state: '#1d4ed8', l_grants: '#3a7fc4', l_sales: '#64748b', l_otherrev: '#94a3b8', l_invrev: '#5ea7c9', l_loans: '#e11d48',
    l_staff: '#2563eb', l_purchases: '#3b82f6', l_intervention: '#4f46e5', l_interest: '#f59e0b', l_otherop: '#6366f1', l_equipment: '#0ea5e9', l_equipgrants: '#06b6d4', l_otherinv: '#38bdf8', l_repay: '#be123c', l_negative: '#a855f7'
  };
  const SCOPE_LABELS = { apu: 'Administrations publiques', communes: 'Communes', gfp: 'Intercommunalités', departements: 'Départements', regions: 'Régions', syndicats: 'Syndicats', sdis: 'Pompiers (SDIS)', epl: 'Établissements publics locaux', ccas: 'CCAS et CIAS' };
  let scope = 'apu', localIndex = null;
  const LOCAL_SOURCES = [
    ['l_tax', 'impots-locaux', 'Impôts locaux'], ['l_othertax', 'autres-impots-et-taxes', 'Autres impôts et taxes (TVA, DMTO…)'],
    ['l_state', 'concours-de-l-etat', 'Dotations de l’État (DGF…)'], ['l_grants', 'subventions-recues-et-participations', 'Subventions reçues et participations'],
    ['l_sales', 'ventes-de-biens-et-services', 'Ventes, redevances, services'], ['l_otherrev', 'autres-recettes-de-fonctionnement', 'Autres recettes de fonctionnement'],
    ['l_invrev', 'recettes-d-investissement-hors-emprunts', 'Recettes d’invest. (FCTVA…)'], ['l_loans', 'emprunts-hors-gad', 'Emprunts nouveaux']
  ];
  const LOCAL_USES = [
    ['l_staff', 'frais-de-personnel', 'Frais de personnel'], ['l_purchases', 'achats-et-charges-externes', 'Achats et charges externes'], ['l_intervention', 'depenses-d-intervention', 'Interventions (aides, subv.…)'],
    ['l_interest', 'charges-financieres', 'Intérêts de la dette'], ['l_otherop', 'autres-depenses-de-fonctionnement', 'Autres dépenses de fonctionnement'],
    ['l_equipment', 'depenses-d-equipement', 'Équipement (travaux…)'], ['l_equipgrants', 'subventions-d-equipement-versees', 'Subventions d’équipement versées'],
    ['l_otherinv', 'autres-depenses-d-investissement', 'Autres dépenses d’investissement'], ['l_repay', 'remboursements-d-emprunts-hors-gad', 'Remboursement de la dette']
  ];
  const localValue = (slug, year) => { const v = localIndex?.totals?.[scope]?.[slug]?.[String(year)]; return v == null ? null : v / 1e9; };

  /* Flows of one local level (OFGL national totals), in Md€. Negative net items are moved to the other side. */
  function localFlowsFor(year) {
    const revenue = localValue('recettes-totales', year), spending = localValue('depenses-totales', year);
    if (revenue == null || spending == null) return null;
    const src = 'OFGL · comptes consolidés';
    const sources = [], uses = [];
    LOCAL_SOURCES.forEach(([id, slug, label]) => { const v = localValue(slug, year) ?? 0; (v >= 0 ? sources : uses).push({ id, label: v >= 0 ? label : `${label} (solde négatif)`, value: Math.abs(v), source: src }); });
    LOCAL_USES.forEach(([id, slug, label]) => { const v = localValue(slug, year) ?? 0; (v >= 0 ? uses : sources).push({ id, label: v >= 0 ? label : `${label} (solde négatif)`, value: Math.abs(v), source: src }); });
    const balance = revenue - spending;
    sources.push({ id: 'deficit', label: 'Prélevé sur la trésorerie', value: Math.max(0, -balance), source: 'Recettes − dépenses totales' });
    uses.push({ id: 'surplus', label: 'Ajouté à la trésorerie', value: Math.max(0, balance), source: 'Recettes − dépenses totales' });
    const sum = slugs => slugs.reduce((t, slug) => t + (localValue(slug, year) ?? 0), 0);
    const checks = [
      ['Recettes de fonctionnement (somme des postes)', sum(LOCAL_SOURCES.slice(0, 6).map(x => x[1])), localValue('recettes-de-fonctionnement', year)],
      ['Dépenses de fonctionnement (somme des postes)', sum(LOCAL_USES.slice(0, 5).map(x => x[1])), localValue('depenses-de-fonctionnement', year)],
      ['Dépenses d’investissement hors dette', sum(LOCAL_USES.slice(5, 8).map(x => x[1])), localValue('depenses-d-investissement-hors-remb', year)],
      ['Recettes totales', sum(LOCAL_SOURCES.map(x => x[1])), revenue],
      ['Dépenses totales', sum(LOCAL_USES.map(x => x[1])), spending]
    ];
    return { year, sources, uses, revenue, spending, balance, checks, local: true, loans: localValue('emprunts-hors-gad', year) ?? 0, reversed: localValue('fiscalite-reversee', year) };
  }

  let data = null;
  let unit = 'md';
  let shown = null; // currently drawn values (tweened)
  let animation = 0;
  let playing = 0;

  function load(path) { return fetch(path).then(response => { if (!response.ok) throw new Error(path); return response.json(); }); }

  function population(year) {
    const jan = data.population;
    return jan.has(year) && jan.has(year + 1) ? (jan.get(year) + jan.get(year + 1)) / 2 : jan.get(year) ?? null;
  }

  function gdp(year) {
    const ratios = data.ratios.get(year), debt = data.debt.get(year), account = data.accounts.get(year);
    if (ratios?.debt && debt?.debt) return debt.debt / (ratios.debt / 100);
    if (ratios?.spending && account?.spending) return account.spending / (ratios.spending / 100);
    return null;
  }

  function convert(value, year) {
    if (unit === 'pib') { const base = gdp(year); return base ? 100 * value / base : null; }
    if (unit === 'hab') { const people = population(year); return people ? value * 1e9 / people : null; }
    return value;
  }

  function display(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    if (unit === 'pib') return `${fmt(value, Math.abs(value) < 1 ? 2 : 1)} % du PIB`;
    if (unit === 'hab') return `${Math.round(value).toLocaleString('fr-FR')} €/hab.`;
    return `${fmt(value)} Md€`;
  }

  /* Build the flows of one year, in Md€. */
  function flowsFor(year) {
    if (scope !== 'apu') return localFlowsFor(year);
    const account = data.accounts.get(year);
    if (!account) return null;
    const tax = data.taxes.get(year);
    const revenue = Object.fromEntries(account.revenueBreakdown.map(item => [item.label, item.value]));
    const taxAndSocial = revenue['Impôts et cotisations sociales'] ?? 0;
    const sources = [];
    if (tax?.categories?.length) {
      const byId = Object.fromEntries(tax.categories.map(item => [item.id, item.value]));
      const otherTaxes = (byId.imports || 0) + (byId.otherCurrent || 0) + (byId.capital || 0);
      const taxSum = tax.categories.reduce((total, item) => total + item.value, 0);
      sources.push(
        { id: 'income', label: 'Impôts sur le revenu (IR, CSG, IS…)', value: byId.income || 0, source: 'Insee · Impôts' },
        { id: 'vat', label: 'TVA', value: byId.vat || 0, source: 'Insee · Impôts' },
        { id: 'products', label: 'Autres impôts sur les produits', value: byId.products || 0, source: 'Insee · Impôts' },
        { id: 'production', label: 'Impôts sur la production', value: byId.production || 0, source: 'Insee · Impôts' },
        { id: 'payroll', label: 'Impôts sur les salaires', value: byId.payroll || 0, source: 'Insee · Impôts' },
        { id: 'otherTaxes', label: 'Autres impôts', value: otherTaxes, source: 'Insee · Impôts' },
        { id: 'social', label: 'Cotisations sociales et autres', value: Math.max(0, taxAndSocial - taxSum), source: 'Calculé : 3.201 − Impôts', computed: true }
      );
    } else {
      sources.push({ id: 'taxesAll', label: 'Impôts et cotisations sociales', value: taxAndSocial, source: 'Insee · 3.201' });
    }
    sources.push(
      { id: 'production_sales', label: 'Ventes et recettes de production', value: revenue['Recettes de production'] ?? 0, source: 'Insee · 3.201' },
      { id: 'property', label: 'Revenus de la propriété', value: revenue['Revenus de la propriété'] ?? 0, source: 'Insee · 3.201' },
      { id: 'transfers', label: 'Autres transferts reçus', value: revenue['Autres transferts'] ?? 0, source: 'Insee · 3.201' }
    );
    const deficit = Math.max(0, -account.balance);
    const surplus = Math.max(0, account.balance);
    sources.push({ id: 'deficit', label: 'Déficit : emprunté', value: deficit, source: 'Insee · 3.201 (solde)' });
    const spendingIds = { 'Fonctionnement': 'operating', 'Intérêts': 'interest', 'Prestations et autres transferts': 'benefits', 'Acquisitions nettes d’actifs non financiers': 'investment' };
    const spendingLabels = { operating: 'Fonctionnement (salaires, achats…)', interest: 'Intérêts de la dette', benefits: 'Prestations sociales et transferts', investment: 'Investissement' };
    const uses = account.spendingBreakdown.map(item => ({ id: spendingIds[item.label] || item.label, label: spendingLabels[spendingIds[item.label]] || item.label, value: item.value, source: 'Insee · 3.201' }));
    uses.push({ id: 'surplus', label: 'Excédent', value: surplus, source: 'Insee · 3.201 (solde)' });
    return { year, sources, uses, revenue: account.revenue, spending: account.spending, balance: account.balance, taxAndSocial, hasTaxDetail: Boolean(tax?.categories?.length) };
  }

  /* Interpolate two flow sets with the same ids (missing ids count as 0). */
  function mix(from, to, t) {
    if (!from) return to;
    const blend = (a, b) => {
      const ids = [...new Set([...b.map(item => item.id), ...a.map(item => item.id)])];
      return ids.map(id => {
        const x = a.find(item => item.id === id), y = b.find(item => item.id === id);
        const base = y || x;
        return { ...base, value: (x?.value || 0) + ((y?.value || 0) - (x?.value || 0)) * t };
      });
    };
    return { ...to, sources: blend(from.sources, to.sources), uses: blend(from.uses, to.uses) };
  }

  function layout(flows) {
    const sources = flows.sources.filter(item => item.value > .05);
    const uses = flows.uses.filter(item => item.value > .05);
    const total = Math.max(sources.reduce((s, n) => s + n.value, 0), uses.reduce((s, n) => s + n.value, 0));
    const maxCount = Math.max(sources.length, uses.length);
    const k = (H - 40 - GAP * (maxCount - 1)) / total;
    const stack = (items, x) => {
      const height = items.reduce((s, n) => s + n.value * k, 0) + GAP * (items.length - 1);
      let y = (H - height) / 2;
      return items.map(item => { const node = { ...item, x, y, h: Math.max(1, item.value * k) }; y += node.h + GAP; return node; });
    };
    const left = stack(sources, COLX[0]);
    const right = stack(uses, COLX[2]);
    const midH = total * k;
    const mid = { id: 'apu', label: SCOPE_LABELS[scope], x: COLX[1], y: (H - midH) / 2, h: midH, value: total };
    let yIn = mid.y, yOut = mid.y;
    const links = [];
    left.forEach(node => { links.push({ from: node, to: mid, y0: node.y, y1: yIn, h: node.h, color: COLORS[node.id] || '#64748b', node }); yIn += node.h; });
    right.forEach(node => { links.push({ from: mid, to: node, y0: yOut, y1: node.y, h: node.h, color: COLORS[node.id] || '#64748b', node }); yOut += node.h; });
    return { left, right, mid, links };
  }

  function ribbon(x0, y0, x1, y1, h) {
    const c = (x0 + x1) / 2;
    return `M${x0},${y0}C${c},${y0} ${c},${y1} ${x1},${y1}L${x1},${y1 + h}C${c},${y1 + h} ${c},${y0 + h} ${x0},${y0 + h}Z`;
  }

  // Reusable SVG elements keyed by id, so tweening only updates attributes (no DOM churn per frame).
  const pool = new Map();
  function el(key, tag, parent) {
    let node = pool.get(key);
    if (!node) { node = document.createElementNS(NS, tag); pool.set(key, node); parent.appendChild(node); }
    node.dataset.live = '1';
    return node;
  }

  let gLinks, gNodes, gLabels;
  function setupSvg() {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    gLinks = document.createElementNS(NS, 'g'); gNodes = document.createElementNS(NS, 'g'); gLabels = document.createElementNS(NS, 'g');
    gLinks.setAttribute('class', 'cx-links'); gLabels.setAttribute('class', 'cx-labels');
    svg.append(gLinks, gNodes, gLabels);
  }

  function draw(flows) {
    shown = flows;
    pool.forEach(node => { node.dataset.live = ''; });
    const { left, right, mid, links } = layout(flows);
    links.forEach(link => {
      const fromX = link.from === mid ? mid.x + NODE_W : link.from.x + NODE_W;
      const toX = link.to === mid ? mid.x : link.to.x;
      const path = el(`link-${link.node.id}`, 'path', gLinks);
      path.setAttribute('d', ribbon(fromX, link.y0, toX, link.y1, link.h));
      path.setAttribute('fill', link.color);
      path.setAttribute('class', `cx-link${link.node.id === 'deficit' ? ' is-deficit' : ''}`);
      path.dataset.id = link.node.id;
    });
    [...left, mid, ...right].forEach(node => {
      const rect = el(`node-${node.id}`, 'rect', gNodes);
      rect.setAttribute('x', node.x); rect.setAttribute('y', node.y.toFixed(2));
      rect.setAttribute('width', NODE_W); rect.setAttribute('height', node.h.toFixed(2));
      rect.setAttribute('rx', 3);
      rect.setAttribute('fill', COLORS[node.id] || '#64748b');
      rect.setAttribute('class', 'cx-node');
      rect.dataset.id = node.id;
    });
    // Labels: two lines when the node is tall enough, else one line; then push apart to avoid overlaps.
    const placeColumn = (nodes, side) => {
      const items = nodes.map(node => ({ node, twoLines: node.h >= 30, y: node.y + node.h / 2 }));
      let last = -Infinity;
      items.forEach(item => {
        const half = item.twoLines ? 15 : 8;
        if (item.y - half < last + 3) item.y = last + 3 + half;
        last = item.y + half;
      });
      // If pushed past the bottom, shift the whole column up.
      const overflow = last - (H - 2);
      if (overflow > 0) items.forEach(item => { item.y -= overflow; });
      items.forEach(item => label(item.node, side, item));
    };
    const label = (node, side, place) => {
      const text = el(`label-${node.id}`, 'text', gLabels);
      const anchorX = side === 'left' ? node.x - 8 : side === 'right' ? node.x + NODE_W + 8 : node.x + NODE_W / 2;
      text.setAttribute('x', anchorX);
      text.setAttribute('text-anchor', side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle');
      const twoLines = side !== 'mid' && place.twoLines;
      const y = side === 'mid' ? node.y - 12 : twoLines ? place.y - 3 : place.y + 4;
      text.setAttribute('y', y.toFixed(1));
      text.setAttribute('class', `cx-label${node.id === 'deficit' ? ' is-deficit' : ''}${node.computed ? ' is-computed' : ''}`);
      let name = text.firstChild, value = text.lastChild;
      if (!name || name === value) { text.textContent = ''; name = document.createElementNS(NS, 'tspan'); value = document.createElementNS(NS, 'tspan'); text.append(name, value); }
      name.textContent = node.label + (node.computed ? ' *' : '');
      value.textContent = (twoLines ? '' : '  ') + display(convert(node.value, flows.year));
      value.setAttribute('class', 'cx-value');
      if (twoLines) { value.setAttribute('x', anchorX); value.setAttribute('dy', '15'); } else { value.removeAttribute('x'); value.removeAttribute('dy'); }
    };
    placeColumn(left, 'left');
    placeColumn(right, 'right');
    label(mid, 'mid', null);
    const yearText = el('label-year', 'text', gLabels);
    yearText.setAttribute('x', mid.x + NODE_W / 2);
    yearText.setAttribute('y', Math.max(18, mid.y - 34).toFixed(1));
    yearText.setAttribute('text-anchor', 'middle');
    yearText.setAttribute('class', 'cx-year');
    yearText.textContent = flows.year;
    pool.forEach((node, key) => { if (!node.dataset.live) { node.remove(); pool.delete(key); } });
  }

  function drawDebt(year) {
    if (scope !== 'apu') { drawLocalDebt(year); return; }
    const debt = data.debt.get(year);
    if (!debt) { debtBox.innerHTML = '<p class="national-note">Dette de Maastricht disponible à partir de 1978.</p>'; return; }
    const steps = [];
    if (debt.previousDebt != null) steps.push({ label: `Dette fin ${year - 1}`, value: debt.previousDebt, kind: 'stock' });
    if (debt.deficit != null) {
      steps.push({ label: 'Déficit à financer', value: debt.deficit, kind: 'up' });
      debt.adjustments.forEach(item => steps.push({ label: item.label, value: item.value, kind: item.value >= 0 ? 'up' : 'down' }));
    } else if (debt.previousDebt != null) steps.push({ label: 'Variation (détail publié depuis 2009)', value: debt.debt - debt.previousDebt, kind: 'up' });
    steps.push({ label: `Dette fin ${year}`, value: debt.debt, kind: 'stock' });
    const top = Math.max(...steps.filter(step => step.kind === 'stock').map(step => step.value));
    const base = Math.min(...steps.filter(step => step.kind === 'stock').map(step => step.value)) * .9;
    let running = debt.previousDebt ?? debt.debt;
    const scale = value => Math.max(0, (value - base) / (top * 1.04 - base));
    const rows = steps.map(step => {
      let from, to;
      if (step.kind === 'stock') { from = base; to = step.value; running = step.value; }
      else { from = running; to = running + step.value; running = to; }
      const lo = Math.min(from, to), hi = Math.max(from, to);
      const left = step.kind === 'stock' ? 0 : scale(lo) * 100, width = Math.max(.4, (scale(hi) - (step.kind === 'stock' ? 0 : scale(lo))) * 100);
      const sign = step.kind === 'stock' ? '' : step.value >= 0 ? '+' : '−';
      return `<div class="cx-debt-row ${step.kind}"><span class="cx-debt-label">${step.label}</span><span class="cx-debt-track"><span class="cx-debt-bar" style="left:${left}%;width:${width}%"></span></span><strong>${sign}${display(convert(Math.abs(step.value), year))}</strong></div>`;
    });
    const gap = debt.stockDifference != null && Math.abs(debt.stockDifference) > .11 ? `<p class="sector-warning">Les stocks publiés (3.101) et la variation publiée (3.105) diffèrent de ${fmt(debt.stockDifference, 3)} Md€.</p>` : '';
    debtBox.innerHTML = `<h3>Du déficit à la dette · ${year}</h3><div class="cx-debt">${rows.join('')}</div>${gap}`;
  }

  function drawLocalDebt(year) {
    const before = localValue('encours-de-dette', year - 1), after = localValue('encours-de-dette', year);
    const loans = localValue('emprunts-hors-gad', year) ?? 0, repay = localValue('remboursements-d-emprunts-hors-gad', year) ?? 0;
    if (after == null) { debtBox.innerHTML = ''; return; }
    if (before == null) { debtBox.innerHTML = `<h3>Dette · ${year}</h3><p class="national-note">Encours de dette fin ${year} : ${display(convert(after, year))}. L’année précédente n’est pas disponible pour reconstituer la variation.</p>`; return; }
    const computed = before + loans - repay, gap = after - computed;
    const rows = [[`Encours fin ${year - 1}`, before, 'stock'], ['Emprunts nouveaux', loans, 'up'], ['Remboursements', -repay, 'down'], ['Autres mouvements (écart)', gap, gap >= 0 ? 'up' : 'down'], [`Encours fin ${year}`, after, 'stock']];
    const top = Math.max(before, after) * 1.04, base = Math.min(before, after) * .85;
    const scale = v => Math.max(0, (v - base) / (top - base));
    let running = before;
    debtBox.innerHTML = `<h3>Dette · ${SCOPE_LABELS[scope]} · ${year}</h3><div class="cx-debt">${rows.map(([label, value, kind]) => {
      let from, to;
      if (kind === 'stock') { from = base; to = value; running = value; } else { from = running; to = running + value; running = to; }
      const lo = Math.min(from, to), hi = Math.max(from, to);
      const left = kind === 'stock' ? 0 : scale(lo) * 100, width = Math.max(.4, (scale(hi) - (kind === 'stock' ? 0 : scale(lo))) * 100);
      return `<div class="cx-debt-row ${kind}"><span class="cx-debt-label">${label}</span><span class="cx-debt-track"><span class="cx-debt-bar" style="left:${left}%;width:${width}%"></span></span><strong>${kind === 'stock' ? '' : value >= 0 ? '+' : '−'}${display(convert(Math.abs(value), year))}</strong></div>`;
    }).join('')}</div><p class="national-note">L’écart regroupe ce que les flux d’emprunt publiés n’expliquent pas : reprises de dette lors de fusions ou transferts de compétences, renégociations, changements de périmètre. Un écart important mérite d’être expliqué.</p>`;
  }

  function drawChecks(flows) {
    if (flows.local) {
      checks.innerHTML = `<h3>Reproduire les chiffres · ${SCOPE_LABELS[scope]} · ${flows.year}</h3><table class="sector-table"><thead><tr><th>Contrôle</th><th>Recalculé</th><th>Publié (OFGL)</th><th>Écart</th></tr></thead><tbody>${flows.checks.map(([label, computed, published]) => `<tr><th scope="row">${label}</th><td>${fmt(computed, 3)} Md€</td><td>${published == null ? '—' : fmt(published, 3) + ' Md€'}</td><td class="${published != null && Math.abs(computed - published) > .001 ? 'is-gap' : 'is-ok'}">${published == null ? '—' : fmt(computed - published, 3)}</td></tr>`).join('')}</tbody></table>${flows.reversed != null ? `<p class="national-note"><strong>Fiscalité reversée (net) : ${flows.reversed >= 0 ? '+' : '−'}${fmt(Math.abs(flows.reversed), 3)} Md€.</strong> L’OFGL la présente à part, hors des totaux : ce sont surtout les attributions de compensation et dotations de solidarité versées par les intercommunalités à leurs communes (positif pour les communes, négatif pour les intercommunalités). L’inclure dans les recettes compterait deux fois le même impôt.</p>` : ''}<p class="national-note">Montants consolidés au sein de chaque collectivité (budget principal et budgets annexes), non consolidés entre collectivités : les flux entre niveaux (fiscalité reversée, participations) apparaissent des deux côtés. Un écart non nul signale un poste que les agrégats publiés ne décomposent pas.</p>`;
      return;
    }
    const account = data.accounts.get(flows.year);
    const sourceSum = flows.sources.filter(item => item.id !== 'deficit').reduce((s, n) => s + n.value, 0);
    const useSum = flows.uses.filter(item => item.id !== 'surplus').reduce((s, n) => s + n.value, 0);
    const lines = [
      ['Somme des recettes affichées', sourceSum, account.revenue],
      ['Somme des dépenses affichées', useSum, account.spending],
      ['Recettes − dépenses', sourceSum - useSum, account.balance]
    ];
    const social = flows.sources.find(item => item.id === 'social');
    checks.innerHTML = `<h3>Reproduire les chiffres · ${flows.year}</h3><table class="sector-table"><thead><tr><th>Contrôle</th><th>Recalculé</th><th>Publié (Insee 3.201)</th><th>Écart</th></tr></thead><tbody>${lines.map(([label, computed, published]) => `<tr><th scope="row">${label}</th><td>${fmt(computed, 3)} Md€</td><td>${fmt(published, 3)} Md€</td><td class="${Math.abs(computed - published) > .001 ? 'is-gap' : 'is-ok'}">${fmt(computed - published, 3)}</td></tr>`).join('')}</tbody></table>${social ? `<p class="national-note">* « Cotisations sociales et autres » = impôts et cotisations sociales du tableau 3.201 (${fmt(flows.taxAndSocial)} Md€) moins la somme des catégories d’impôts du tableau Insee « Impôts » (${fmt(flows.taxAndSocial - social.value)} Md€) : ${fmt(social.value)} Md€. Ce poste est calculé, pas publié tel quel ; il contient surtout les cotisations sociales effectives et imputées.</p>` : ''}`;
  }

  function summarize(flows) {
    if (flows.local) {
      summary.innerHTML = `<div><span>Recettes totales</span><strong>${display(convert(flows.revenue, flows.year))}</strong></div><div><span>Dépenses totales</span><strong>${display(convert(flows.spending, flows.year))}</strong></div><div><span>Dont emprunts nouveaux</span><strong>${display(convert(flows.loans, flows.year))}</strong></div><div><span>Variation de trésorerie</span><strong class="${flows.balance < 0 ? 'is-deficit' : ''}">${flows.balance < 0 ? '−' : '+'}${display(convert(Math.abs(flows.balance), flows.year))}</strong></div>`;
      return;
    }
    const deficitShare = flows.spending ? 100 * Math.max(0, -flows.balance) / flows.spending : 0;
    summary.innerHTML = `<div><span>Recettes</span><strong>${display(convert(flows.revenue, flows.year))}</strong></div><div><span>Dépenses</span><strong>${display(convert(flows.spending, flows.year))}</strong></div><div><span>${flows.balance < 0 ? 'Déficit' : 'Excédent'}</span><strong class="${flows.balance < 0 ? 'is-deficit' : ''}">${display(convert(Math.abs(flows.balance), flows.year))}</strong></div><div><span>Part des dépenses financée par l’emprunt</span><strong>${fmt(deficitShare)} %</strong></div>`;
  }

  function goTo(year, animate = true) {
    const target = flowsFor(year);
    if (!target) return;
    yearLabel.textContent = year;
    yearInput.value = year;
    summarize(target); drawDebt(year); drawChecks(target); drawDrill(year);
    cancelAnimationFrame(animation);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!animate || !shown || reduced) { draw(target); return; }
    const from = shown, started = performance.now(), duration = playing ? 520 : 650;
    const step = now => {
      const t = Math.min(1, (now - started) / duration);
      const eased = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      draw({ ...mix(from, target, eased), year });
      if (t < 1) animation = requestAnimationFrame(step);
    };
    animation = requestAnimationFrame(step);
  }

  function play() {
    if (playing) { clearInterval(playing); playing = 0; playButton.classList.remove('is-playing'); playButton.setAttribute('aria-label', 'Lancer l’animation'); return; }
    let year = Number(yearInput.value);
    if (year >= Number(yearInput.max)) year = Number(yearInput.min) - 1;
    playButton.classList.add('is-playing'); playButton.setAttribute('aria-label', 'Mettre en pause');
    playing = setInterval(() => {
      year += 1;
      if (year > Number(yearInput.max)) { play(); return; }
      goTo(year);
    }, 620);
  }

  /* ---------- Drill-down: where each spending pole goes, by function (COFOG) ---------- */
  const drillRoot = document.getElementById('circuitDrill');
  const POLE_TABS = [['all', 'Toutes les dépenses'], ['operating', 'Fonctionnement'], ['benefits', 'Prestations et transferts'], ['investment', 'Investissement'], ['interest', 'Intérêts']];
  const drill = { pole: 'all', nature: null, open: new Set() };
  let functions = null, functionsLoading = null;
  const ensureFunctions = () => functionsLoading || (functionsLoading = load('./data/national-functions.json').then(json => { functions = json; }).catch(() => { functions = null; }));
  const natureCodes = pole => pole === 'all' ? Object.values(functions.poles).flatMap(item => item.items.map(row => row[0])) : functions.poles[pole].items.map(row => row[0]);
  const fnValue = (codes, fn, yi) => codes.reduce((sum, na) => sum + (functions.data[na]?.[fn]?.[yi] ?? 0), 0);
  const poleOfCircuit = { operating: 'operating', interest: 'interest', benefits: 'benefits', investment: 'investment', apu: 'all' };

  // Keyed list rendering, so bars glide to their new width instead of being rebuilt.
  function renderRows(container, rows, max) {
    const seen = new Set();
    rows.forEach(row => {
      let el = container.querySelector(`:scope > [data-key="${row.key}"]`);
      if (!el) {
        el = document.createElement(row.button ? 'button' : 'div');
        if (row.button) el.type = 'button';
        el.dataset.key = row.key;
        el.innerHTML = '<span class="dr-head"><span class="dr-label"></span><span class="dr-value"></span></span><span class="dr-track"><span class="dr-fill"></span></span>';
        container.appendChild(el);
      }
      el.className = `dr-row${row.level ? ' is-sub' : ''}${row.open ? ' is-open' : ''}${row.button ? ' is-button' : ''}`;
      if (row.button) el.setAttribute('aria-expanded', row.open ? 'true' : 'false');
      el.querySelector('.dr-label').textContent = row.label;
      el.querySelector('.dr-value').innerHTML = row.value;
      const track = el.querySelector('.dr-track');
      const segments = row.segments || [[row.amount, row.color]];
      while (track.children.length < segments.length) track.appendChild(Object.assign(document.createElement('span'), { className: 'dr-fill' }));
      [...track.children].forEach((fill, i) => {
        const [amount, color] = segments[i] || [0, ''];
        fill.style.width = `${i >= segments.length ? 0 : Math.max(segments.length > 1 ? 0 : .4, 100 * Math.max(0, amount) / (max || 1))}%`;
        fill.style.background = color || '';
      });
      container.appendChild(el); // keeps the order
      seen.add(row.key);
    });
    container.querySelectorAll(':scope > [data-key]').forEach(el => { if (!seen.has(el.dataset.key)) el.remove(); });
  }

  function drawDrill(year) {
    if (!drillRoot) return;
    if (scope !== 'apu' || !functions) { drillRoot.hidden = true; return; }
    drillRoot.hidden = false;
    const years = functions.years, first = years[0], last = years[years.length - 1];
    const y = Math.min(Math.max(year, first), last), yi = years.indexOf(y);
    if (!drillRoot.dataset.ready) {
      drillRoot.innerHTML = `<div class="dr-top"><div><p class="dr-eyebrow">Où va l’argent · par fonction</p><h3 id="drTitle"></h3><p class="dr-note" id="drNote"></p></div>
        <div class="dr-tabs" role="tablist">${POLE_TABS.map(([id, label]) => `<button type="button" role="tab" data-pole="${id}">${label}</button>`).join('')}</div></div>
        <div class="dr-natures" id="drNatures"></div><div class="dr-list" id="drList"></div><p class="dr-foot" id="drFoot"></p>`;
      drillRoot.dataset.ready = '1';
      drillRoot.addEventListener('click', event => {
        const tab = event.target.closest('[data-pole]');
        if (tab) { if (drill.pole !== tab.dataset.pole) drill.open.clear(); drill.pole = tab.dataset.pole; drill.nature = null; drawDrill(Number(yearInput.value)); return; }
        const chip = event.target.closest('[data-nature]');
        if (chip) { drill.nature = drill.nature === chip.dataset.nature ? null : chip.dataset.nature; drawDrill(Number(yearInput.value)); return; }
        const row = event.target.closest('.dr-row.is-button');
        if (row) { const key = row.dataset.key; drill.open.has(key) ? drill.open.delete(key) : drill.open.add(key); drawDrill(Number(yearInput.value)); }
      });
    }
    drillRoot.querySelectorAll('[data-pole]').forEach(button => { const on = button.dataset.pole === drill.pole; button.classList.toggle('active', on); button.setAttribute('aria-selected', on ? 'true' : 'false'); });
    const poleLabel = drill.pole === 'all' ? 'l’ensemble des dépenses publiques' : functions.poles[drill.pole].label.toLowerCase();
    const codes = drill.nature ? [drill.nature] : natureCodes(drill.pole);
    const total = fnValue(codes, 'TOTAL', yi);
    const shownTotal = display(convert(total, y));
    drillRoot.querySelector('#drTitle').textContent = `${shownTotal} : ${drill.nature ? natureLabel(drill.nature).toLowerCase() : poleLabel} en ${y}`;
    // Notes: year coverage and the gap with the circuit's published pole.
    const notes = [];
    if (year > last) notes.push(`Le détail par fonction n’est publié que jusqu’en ${last} : ${year} affiche ${last}.`);
    if (year < first) notes.push(`Le détail par fonction commence en ${first}.`);
    const circuitPole = drill.pole === 'all' ? data.accounts.get(y)?.spending : data.accounts.get(y)?.spendingBreakdown?.find(item => poleOfCircuit[{ 'Fonctionnement': 'operating', 'Intérêts': 'interest', 'Prestations et autres transferts': 'benefits', 'Acquisitions nettes d’actifs non financiers': 'investment' }[item.label]] === drill.pole)?.value;
    if (!drill.nature && circuitPole != null) notes.push(`Circuit (Insee 3.201) : ${fmt(circuitPole)} Md€ ; détail par fonction : ${fmt(total)} Md€, soit un écart de ${fmt(total - circuitPole, 1)} Md€ dû aux conventions de présentation.`);
    drillRoot.querySelector('#drNote').textContent = notes.join(' ');
    // Nature chips (what kind of spending).
    const natures = drill.pole === 'all' ? Object.entries(functions.poles).map(([id, pole]) => [pole.items.map(row => row[0]), pole.label, id]) : functions.poles[drill.pole].items.map(([na, label]) => [[na], label, na]);
    const naturesEl = drillRoot.querySelector('#drNatures');
    naturesEl.innerHTML = drill.pole === 'all'
      ? natures.map(([nas, label, id]) => `<button type="button" class="dr-chip" data-pole="${id}"><span><i class="dr-dot" style="background:${POLE_COLORS[id]}"></i>${label}</span><strong>${display(convert(fnValue(nas, 'TOTAL', yi), y))}</strong></button>`).join('')
      : natures.length > 1 ? natures.map(([nas, label, na], i) => `<button type="button" class="dr-chip${drill.nature === na ? ' active' : ''}" data-nature="${na}" aria-pressed="${drill.nature === na}"><span><i class="dr-dot" style="background:${NATURE_COLORS[i]}"></i>${label}</span><strong>${display(convert(fnValue(nas, 'TOTAL', yi), y))}</strong></button>`).join('') : '';
    // Function bars: divisions, with groups under the opened ones.
    // Each bar is split by kind of spending (pole, or nature within the pole), coloured like the cards above.
    const parts = drill.nature ? null : drill.pole === 'all' ? natures.map(([nas, , id]) => [nas, POLE_COLORS[id]]) : natures.length > 1 ? natures.map(([nas], i) => [nas, NATURE_COLORS[i]]) : null;
    const split = fn => parts ? parts.map(([nas, color]) => [fnValue(nas, fn, yi), color]) : null;
    const divisions = Object.keys(functions.functions).filter(code => /^GF\d{2}$/.test(code)).map(code => ({ code, amount: fnValue(codes, code, yi) })).sort((a, b) => b.amount - a.amount);
    const max = Math.max(...divisions.map(item => item.amount));
    const rows = [];
    divisions.forEach(({ code, amount }, index) => {
      const open = drill.open.has(code);
      rows.push({ key: code, label: functions.functions[code], amount, open, button: true, color: DRILL_COLORS[index % DRILL_COLORS.length], segments: split(code),
        value: `${display(convert(amount, y))}<small>${total ? fmt(100 * amount / total) : '0'} %</small>` });
      if (open) Object.keys(functions.functions).filter(g => g.length === 6 && g.startsWith(code)).map(g => ({ g, amount: fnValue(codes, g, yi) })).filter(item => Math.abs(item.amount) >= .005).sort((a, b) => b.amount - a.amount)
        .forEach(({ g, amount: value }) => rows.push({ key: g, level: 1, label: functions.functions[g], amount: value, color: DRILL_COLORS[index % DRILL_COLORS.length], segments: split(g),
          value: `${display(convert(value, y))}<small>${amount ? fmt(100 * value / amount) : '0'} %</small>` }));
    });
    renderRows(drillRoot.querySelector('#drList'), rows, max);
    drillRoot.querySelector('#drFoot').innerHTML = `Cliquez sur une fonction pour la détailler. Source : <a href="${functions.url}" target="_blank" rel="noopener noreferrer">${functions.source}</a>. Pour savoir qui reçoit l’argent ligne par ligne : <a href="./aides.html">aides et subventions</a>, <a href="./marches.html#achats">achats publics par type de produit</a>, <a href="./marches.html#energie">zoom énergies renouvelables</a>.`;
  }
  const natureLabel = na => Object.values(functions.poles).flatMap(pole => pole.items).find(row => row[0] === na)?.[1] || na;
  const POLE_COLORS = { operating: '#2563eb', benefits: '#4f46e5', investment: '#0ea5e9', interest: '#f59e0b' };
  const NATURE_COLORS = ['#1d4ed8', '#0891b2', '#7c3aed', '#f59e0b', '#64748b'];
  const DRILL_COLORS = ['#2563eb', '#0e7490', '#4f46e5', '#0891b2', '#3b82f6', '#22a5c0', '#6366f1', '#0ea5e9', '#1d4ed8', '#38bdf8'];

  function setupTooltip() {
    svg.addEventListener('pointermove', event => {
      const id = event.target.dataset?.id;
      if (!id || !shown) { tooltip.hidden = true; return; }
      const item = [...shown.sources, ...shown.uses].find(node => node.id === id);
      if (!item) { tooltip.hidden = true; return; }
      const total = id === 'deficit' || shown.sources.some(node => node.id === id) ? shown.spending : shown.spending;
      tooltip.innerHTML = `<strong>${item.label}</strong><span>${display(convert(item.value, shown.year))} · ${fmt(100 * item.value / total)} % des dépenses</span><span class="cx-src">${item.source}${item.computed ? ' · poste calculé' : ''}</span>`;
      tooltip.hidden = false;
      const box = root.querySelector('.cx-stage').getBoundingClientRect();
      tooltip.style.transform = `translate(${Math.min(event.clientX - box.left + 14, box.width - 260)}px, ${event.clientY - box.top + 14}px)`;
      svg.querySelectorAll('.cx-link').forEach(path => path.classList.toggle('is-dim', path.dataset.id !== id));
    });
    svg.addEventListener('click', event => {
      const id = event.target.dataset?.id;
      if (scope !== 'apu' || !(id in poleOfCircuit) || !functions) return;
      if (drill.pole !== poleOfCircuit[id]) drill.open.clear();
      drill.pole = poleOfCircuit[id]; drill.nature = null;
      drawDrill(Number(yearInput.value));
      drillRoot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    svg.addEventListener('pointerleave', () => { tooltip.hidden = true; svg.querySelectorAll('.cx-link').forEach(path => path.classList.remove('is-dim')); });
  }

  async function init() {
    const [ratios, accounts, taxes, debt, population] = await Promise.all([
      load('./data/national-ratios-insee.json'), load('./data/national-accounts-3201.json'), load('./data/national-taxes-insee.json'), load('./data/national-debt.json'), load('./data/insee-population.json').catch(() => ({ january1: [] }))
    ]);
    data = {
      ratios: new Map(ratios.years.map(row => [row.year, row])),
      accounts: new Map(accounts.years.map(row => [row.year, row])),
      taxes: new Map(taxes.years.map(row => [row.year, row])),
      debt: new Map(debt.years.map(row => [row.year, row])),
      population: new Map((population.january1 || []).map(row => [row.year, row.population]))
    };
    const years = [...data.accounts.keys()].sort((a, b) => a - b);
    yearInput.min = years[0]; yearInput.max = years[years.length - 1];
    setupSvg(); setupTooltip();
    yearInput.addEventListener('input', () => goTo(Number(yearInput.value)));
    playButton.addEventListener('click', play);
    unitSelect.addEventListener('change', () => { unit = unitSelect.value; goTo(Number(yearInput.value), false); });
    scopeSelect?.addEventListener('change', async () => {
      if (playing) play();
      scope = scopeSelect.value;
      const eyebrow = document.getElementById('circuitEyebrow');
      if (eyebrow) eyebrow.textContent = scope === 'apu' ? 'Comptes nationaux · Insee · 1960–2025' : `${SCOPE_LABELS[scope]} · comptes consolidés OFGL`;
      if (scope !== 'apu' && !localIndex) localIndex = await load('./data/local/index.json').catch(() => null);
      const range = scope === 'apu' ? years : (localIndex?.levels?.[scope]?.years || []).filter(y => localIndex.totals[scope]['depenses-totales']?.[String(y)] != null);
      if (!range.length) { summary.textContent = 'Comptes locaux indisponibles.'; return; }
      yearInput.min = range[0]; yearInput.max = range[range.length - 1];
      const year = Math.min(Math.max(Number(yearInput.value), range[0]), range[range.length - 1]);
      shown = null; pool.forEach(node => node.remove()); pool.clear();
      goTo(year, false);
    });
    goTo(years[years.length - 1], false);
    ensureFunctions().then(() => drawDrill(Number(yearInput.value)));
  }

  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    init().catch(error => { console.error(error); summary.textContent = 'Impossible de charger les comptes nationaux.'; });
  }, { rootMargin: '600px 0px' }) : null;
  if (observer) observer.observe(root); else init();
})();
