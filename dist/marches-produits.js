/* Marchés publics : achats par type de produit (CPV) et zoom énergies renouvelables. */
(() => {
  const { money, count, esc, load, sirenLink, bars, lazy, resolveNames } = FRL;
  const $ = id => document.getElementById(id);
  const buyerLink = siren => `<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/${esc(siren)}" target="_blank" rel="noopener noreferrer" data-siren-name="${esc(siren)}">${esc(siren)}</a>`;
  const supplierLink = id => id ? `<a href="https://annuaire-entreprises.data.gouv.fr/etablissement/${esc(id)}" target="_blank" rel="noopener noreferrer">${esc(id)}</a>` : '–';

  /* Selectable ranking: rows of buttons with a bar; keeps the DOM so bars glide between years. */
  function selectList(container, rows, { selected = null, limit = 40, onSelect }) {
    const top = rows.slice(0, limit);
    const max = Math.max(...top.map(row => Math.abs(row.value || 0)), 1);
    let list = container.querySelector('ol.pr-list');
    if (!list) {
      container.innerHTML = '<ol class="ranking pr-list"></ol>';
      list = container.querySelector('ol.pr-list');
      list.addEventListener('click', event => { const button = event.target.closest('[data-code]'); if (button) onSelect(button.dataset.code); });
    }
    const seen = new Set();
    top.forEach(row => {
      let li = list.querySelector(`:scope > li[data-key="${row.code}"]`);
      if (!li) {
        li = document.createElement('li'); li.dataset.key = row.code;
        li.innerHTML = '<button type="button" class="pr-row"><div class="ranking__line"><span class="ranking__label"><span class="pr-label"></span><small></small></span><strong></strong></div><span class="ranking__track"><span class="ranking__fill"></span></span></button>';
      }
      const button = li.querySelector('button');
      button.dataset.code = row.code;
      button.classList.toggle('is-selected', row.code === selected);
      button.setAttribute('aria-pressed', row.code === selected ? 'true' : 'false');
      li.querySelector('.pr-label').textContent = row.label;
      li.querySelector('small').textContent = row.sub || '';
      li.querySelector('strong').textContent = money(row.value);
      li.querySelector('.ranking__fill').style.setProperty('--w', `${(100 * Math.abs(row.value || 0) / max).toFixed(2)}%`);
      list.appendChild(li); seen.add(row.code);
    });
    list.querySelectorAll(':scope > li').forEach(li => { if (!seen.has(li.dataset.key)) li.remove(); });
    if (!top.length) container.innerHTML = '<p class="note">Aucun achat dans cette sélection.</p>';
    grow(container);
  }
  const grow = container => requestAnimationFrame(() => requestAnimationFrame(() => container.querySelectorAll('.ranking__fill').forEach(node => node.classList.add('is-in'))));

  /* ---------- Achats par type de produit ---------- */
  let cpv = null, cpvTop = null, state = { year: null, mode: 'amount', division: null, group: null, query: '', all: false };
  const label = code => (code.length === 2 ? cpv.divisions[code] : cpv.groups[code]) || `Code CPV ${code}`;

  function aggregate() {
    const rows = cpv.perYear[String(state.year)] || [];
    const key = state.mode === 'amount' ? 2 : 4, nKey = state.mode === 'amount' ? 1 : 3;
    const groups = rows.map(row => ({ code: row[0], value: row[key], n: row[nKey] })).filter(row => row.n > 0);
    const divisions = new Map();
    groups.forEach(row => { const d = divisions.get(row.code.slice(0, 2)) || { code: row.code.slice(0, 2), value: 0, n: 0 }; d.value += row.value; d.n += row.n; divisions.set(d.code, d); });
    return { groups, divisions: [...divisions.values()] };
  }

  function renderProducts() {
    $('prYears').querySelectorAll('button').forEach(b => b.classList.toggle('active', Number(b.dataset.year) === state.year));
    $('prMode').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
    const { groups, divisions } = aggregate();
    const word = state.mode === 'amount' ? 'marchés' : 'accords-cadres';
    const query = state.query.toLowerCase();
    const matches = text => !query || (text || '').toLowerCase().includes(query);
    const divRows = divisions.map(d => ({ ...d, label: label(d.code), sub: `${count(d.n)} ${word}` }))
      .filter(d => !query || matches(d.label) || groups.some(g => g.code.startsWith(d.code) && matches(label(g.code)))).sort((a, b) => b.value - a.value);
    if (!state.division || !divRows.some(d => d.code === state.division)) state.division = divRows[0]?.code || null;
    $('prDivTitle').textContent = `Familles de produits · ${state.year}`;
    selectList($('prDivisions'), divRows, { selected: state.division, limit: state.all || query ? 60 : 15, onSelect: code => { state.division = code; state.group = null; renderProducts(); renderTop(); } });
    let more = $('prDivisions').querySelector('.more-btn');
    if (divRows.length > 15 && !query) {
      if (!more) { more = Object.assign(document.createElement('button'), { type: 'button', className: 'more-btn' }); more.addEventListener('click', () => { state.all = !state.all; renderProducts(); }); }
      more.textContent = state.all ? 'Afficher les 15 premières familles' : `Afficher les ${divRows.length} familles`;
      $('prDivisions').appendChild(more);
    } else more?.remove();
    const groupRows = groups.filter(g => g.code.startsWith(state.division || '--')).map(g => ({ ...g, label: label(g.code), sub: `${count(g.n)} ${word}` }))
      .filter(g => !query || matches(g.label) || matches(label(state.division))).sort((a, b) => b.value - a.value);
    $('prGroupTitle').textContent = state.division ? label(state.division) : 'Sous-familles';
    selectList($('prGroups'), groupRows, { selected: state.group, limit: 40, onSelect: code => { state.group = code; renderTop(); renderProducts(); } });
    const total = divisions.reduce((s, d) => s + d.value, 0);
    $('prNote').textContent = `${state.year} : ${money(total)} ${state.mode === 'amount' ? 'de marchés notifiés (hors accords-cadres)' : 'de plafonds d’accords-cadres (montants maximums, pas des dépenses)'}${state.year === cpv.years[cpv.years.length - 1] ? ', année en cours' : ''}. Libellés : ${cpv.source}.`;
  }

  async function renderTop() {
    if (!state.group) { $('prTopPanel').hidden = true; return; }
    $('prTopPanel').hidden = false;
    $('prTopTitle').textContent = `Plus gros marchés · ${label(state.group)}`;
    if (!cpvTop) { $('prTop').innerHTML = '<p class="note">Chargement…</p>'; cpvTop = await load('./data/marches/cpv-top.json').catch(() => ({ groups: {}, cpvLabels: {} })); }
    const rows = [...(cpvTop.groups[state.group] || [])].sort((a, b) => b[3] - a[3]);
    $('prTop').innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Année</th><th>Acheteur</th><th>Objet</th><th>Produit</th><th>Titulaire</th><th class="num">Offres</th><th class="num">Montant</th></tr></thead><tbody>${rows.map(([year, buyer, supplier, amount, object, code, bids]) =>
      `<tr><td>${year}</td><td>${buyerLink(buyer)}</td><td class="muted">${esc(object || '')}</td><td class="muted">${esc(cpvTop.cpvLabels[code] || code || '')}</td><td>${supplierLink(supplier)}</td><td class="num">${bids ?? '–'}</td><td class="num">${money(amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="note">Aucun marché hors accord-cadre dans cette sous-famille.</p>';
    resolveNames($('prTop'));
  }

  async function initProducts() {
    try { cpv = await load('./data/marches/cpv.json'); } catch (error) { $('prDivisions').innerHTML = '<p class="note">Données indisponibles.</p>'; return; }
    const years = cpv.years.filter(y => y >= 2019);
    state.year = years.includes(2025) ? 2025 : years[years.length - 1];
    $('prYears').innerHTML = years.map(y => `<button type="button" data-year="${y}">${y}${y === cpv.years[cpv.years.length - 1] ? ' (en cours)' : ''}</button>`).join('');
    $('prYears').addEventListener('click', event => { const b = event.target.closest('[data-year]'); if (b) { state.year = Number(b.dataset.year); renderProducts(); } });
    $('prMode').addEventListener('click', event => { const b = event.target.closest('[data-mode]'); if (b) { state.mode = b.dataset.mode; renderProducts(); } });
    let timer = 0;
    $('prSearch').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.query = $('prSearch').value.trim(); state.division = null; renderProducts(); }, 150); });
    renderProducts();
  }

  /* ---------- Zoom énergies renouvelables ---------- */
  let energy = null, tech = 'solaire';
  const PRODUCTION = ['solaire', 'eolien', 'chaleur', 'biogaz', 'hydro'];

  function renderEnergyTech() {
    $('enTech').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tech === tech));
    const series = (energy.decp[tech] || []).filter(row => row[0] >= 2019);
    const last = Math.max(...series.map(row => row[0]));
    bars($('enBars'), series.map(row => ({ label: row[0] === last ? `${row[0]}*` : row[0], value: row[2] || 0 })), { height: 200 });
    const name = energy.technologies.find(([key]) => key === tech)?.[1] || tech;
    $('enDecpNote').textContent = `${name} : montants des marchés notifiés (hors accords-cadres). * année en cours. ${energy.note}`;
    $('enTopTitle').textContent = `Plus gros marchés · ${name}`;
    const rows = energy.top[tech] || [];
    $('enTop').innerHTML = `<table class="data-table"><thead><tr><th>Année</th><th>Acheteur</th><th>Objet</th><th>Titulaire</th><th class="num">Offres</th><th class="num">Montant</th></tr></thead><tbody>${rows.map(([year, buyer, supplier, amount, object, bids]) =>
      `<tr><td>${year}</td><td>${buyerLink(buyer)}</td><td class="muted">${esc(object || '')}</td><td>${supplierLink(supplier)}</td><td class="num">${bids ?? '–'}</td><td class="num">${money(amount)}</td></tr>`).join('') || '<tr><td colspan="6">Aucun marché</td></tr>'}</tbody></table>`;
    resolveNames($('enTop'));
  }

  async function initEnergy() {
    try { energy = await load('./data/marches/energie.json'); } catch (error) { $('enKpis').innerHTML = '<p class="note">Données indisponibles.</p>'; return; }
    const bv = energy.budgetVert;
    const RENEWABLE = /solaire|[ée]olien|biom[ée]thane|biogaz|biomasse|hydraul|g[ée]otherm|renouvel|hydrog[èe]ne/i;
    const support = (bv?.renewables || []).filter(row => (row[4] || 0) > 0 || (row[3] || 0) > 0).map(row => [...row, RENEWABLE.test(row[0])]);
    const renewableOnly = support.filter(row => row[5]);
    const sum = i => renewableOnly.reduce((s, row) => s + (row[2 + i] || 0), 0);
    const decpYear = 2025;
    const decpProd = PRODUCTION.reduce((s, key) => s + ((energy.decp[key] || []).find(row => row[0] === decpYear)?.[2] || 0), 0);
    const fvEnergy = (energy.fondsVert?.energyMeasures || []).reduce((s, row) => s + row[2], 0);
    $('enKpis').innerHTML = [
      ['Soutien de l’État aux renouvelables', money(sum(2)), `PLF 2026 · ${money(sum(0))} exécutés en 2024 · programme 345`],
      [`Achats publics d’installations (${decpYear})`, money(decpProd), 'solaire, éolien, chaleur, biogaz, hydro'],
      ['Fonds vert · mesures énergie', money(fvEnergy), 'engagements 2023–2025'],
      ['Budget « favorable » à l’environnement', money((bv?.byRating || []).filter(row => row[1] === 'Favorable').reduce((s, row) => s + (row[5] || 0), 0)), 'PLF 2026, toutes natures de dépense']
    ].map(([title, value, sub]) => `<div class="kpi"><span>${title}</span><strong>${value}</strong><small>${sub}</small></div>`).join('');
    // Programme 345: each support line, 2026 bar with 2024 → 2025 → 2026.
    const max = Math.max(...support.map(row => row[4] || 0), 1);
    $('enSupport').innerHTML = `<ol class="ranking">${support.map(([name, rating, y24, y25, y26, renewable]) => `<li${renewable ? '' : ' class="is-muted"'}><div class="ranking__line"><span class="ranking__label">${esc(name)}<small>2024 : ${money(y24)} · 2025 : ${money(y25)}${renewable ? '' : ' · hors renouvelables'}${rating && rating !== 'Favorable' ? ` · ${esc(rating.toLowerCase())}` : ''}</small></span><strong>${money(y26)}</strong></div><span class="ranking__track"><span class="ranking__fill" style="--w:${(100 * (y26 || 0) / max).toFixed(2)}%"></span></span></li>`).join('')}</ol>`;
    grow($('enSupport'));
    $('enSupportNote').textContent = 'Montants 2026 (projet de loi de finances). Lignes grisées : autres dépenses du programme (cogénération au gaz, zones non interconnectées, consommateurs), exclues du total renouvelables. Ce soutien compense l’écart entre le tarif garanti aux producteurs et le prix de marché de l’électricité : il baisse quand les prix de marché montent (2022–2024) et remonte quand ils baissent. Source : budget vert, PLF 2026.';
    $('enTech').innerHTML = energy.technologies.map(([key, name]) => `<button type="button" data-tech="${key}">${esc(name.split(' (')[0])}</button>`).join('');
    $('enTech').addEventListener('click', event => { const b = event.target.closest('[data-tech]'); if (b) { tech = b.dataset.tech; renderEnergyTech(); } });
    renderEnergyTech();
    // Budget vert by rating (2026), all expenditure types together.
    const ratings = {};
    (bv?.byRating || []).forEach(([type, rating, n, y24, y25, y26]) => { const r = ratings[rating] || (ratings[rating] = { value: 0, n: 0 }); r.value += y26 || 0; r.n += n; });
    const order = ['Favorable', 'Mixte', 'Défavorable', 'Neutre', 'NC'];
    const ratingLabel = { Favorable: 'Favorable à l’environnement', Mixte: 'Mixte', 'Défavorable': 'Défavorable à l’environnement', Neutre: 'Neutre', NC: 'Non coté' };
    const rmax = Math.max(...Object.values(ratings).map(r => r.value), 1);
    $('enRating').innerHTML = `<ol class="ranking">${order.filter(k => ratings[k]).map(k => `<li><div class="ranking__line"><span class="ranking__label">${ratingLabel[k]}<small>${count(ratings[k].n)} lignes</small></span><strong>${money(ratings[k].value)}</strong></div><span class="ranking__track"><span class="ranking__fill${k === 'Défavorable' ? ' is-alert' : ''}" style="--w:${(100 * ratings[k].value / rmax).toFixed(2)}%"></span></span></li>`).join('')}</ol>`;
    grow($('enRating'));
    $('enRatingNote').textContent = 'Crédits budgétaires, dépenses fiscales et taxes affectées cotés par l’administration selon six axes environnementaux. « Défavorable » regroupe surtout des niches fiscales sur les carburants et le gaz.';
    const fv = energy.fondsVert?.energyMeasures || [];
    const fmax = Math.max(...fv.map(row => row[2]), 1);
    $('enFondsVert').innerHTML = `<ol class="ranking">${fv.map(([name, n, amount]) => `<li><div class="ranking__line"><span class="ranking__label">${esc(name)}<small>${count(n)} projets</small></span><strong>${money(amount)}</strong></div><span class="ranking__track"><span class="ranking__fill" style="--w:${(100 * amount / fmax).toFixed(2)}%"></span></span></li>`).join('')}</ol>`;
    grow($('enFondsVert'));
  }

  lazy($('achats'), initProducts);
  lazy($('energie'), initEnergy);
})();
