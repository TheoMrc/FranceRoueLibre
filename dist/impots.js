/* Impôts: every tax and levy in one list (large taxes from the national accounts and budget documents, the Cour des comptes
   inventory of taxes under 175 M€), with its yield, who pays, who receives, who collects, the cost of collection when a public
   report gives it; Insee history 1995-2025; tax gaps. One data file: data/impots.json (scripts/taxes-data.mjs).
   One colour scheme drives every global chart. Charts are SVG strings redrawn on resize; colours come from the --tx-* tokens. */
(() => {
  const { esc, load } = FRL;
  const $ = id => document.getElementById(id);
  const nf = (value, digits = 1) => value.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  /* Amounts are stored in millions of euros. */
  const meur = value => {
    if (value == null || !Number.isFinite(value)) return '–';
    const a = Math.abs(value);
    if (a >= 1000) return `${nf(value / 1000, a >= 100000 ? 0 : a >= 10000 ? 1 : 2)} Md€`;
    if (a >= 10) return `${nf(value, 0)} M€`;
    if (a >= 1) return `${nf(value, 1)} M€`;
    return `${nf(value * 1000, 0)} k€`;
  };
  const md = value => value == null || !Number.isFinite(value) ? '–' : `${nf(value, value >= 100 ? 0 : 1)} Md€`;
  const pct = (value, digits = 1) => value == null || !Number.isFinite(value) ? '–' : `${nf(value, digits)} %`;
  /* Ceilings, floors and estimates are not amounts actually collected: say so next to the number. */
  const approx = t => ({ plafond: 'au plus ', plancher: 'plus de ', estimation: '≈ ' })[t.status] || '';
  const euros = value => `${nf(value, value < 10 ? 2 : 0)} €`;
  const link = (url, text) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
  /* A cost published for a tax that no longer exists, or only in part: say so next to the figure. */
  const ended = e => e ? ` <span class="tx-ended${e.full === false ? ' is-partial' : ''}">${e.url ? link(e.url, e.text) : esc(e.text)}</span>` : '';
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  /* One colour scheme at a time for every global chart. Fixed slot per value (colour follows the entity, never its rank);
     values outside the list fold into grey. « Avis de la Cour » only exists for taxes of the Cour des comptes inventory. */
  const SCEN_LABELS = ['Petite taxe non citée par la Cour', 'Scénario 1 : revoir dès le budget 2026', 'Scénario 2 : réexaminer d’ici 2027', 'Scénario 3 : rationaliser', 'Plus de 175 M€ (hors inventaire)'];
  const GROUPS = {
    base: { label: 'Ce qui est taxé', value: t => t.base, order: ['Consommation', 'Revenus des ménages', 'Production', 'Salaires', 'Patrimoine', 'Bénéfices des sociétés'] },
    beneficiary: { label: 'Qui reçoit', value: t => t.beneficiary, order: ['État', 'Sécurité sociale', 'Collectivités locales', 'Opérateurs et agences', 'Partagé', 'Union européenne'] },
    collector: { label: 'Qui collecte', value: t => t.collector, order: ['DGFiP', 'Douane (DGDDI)', 'Urssaf', 'Autres collecteurs'] },
    payer: { label: 'Qui paie', value: t => t.payer, order: ['Ménages', 'Entreprises', 'Ménages et entreprises'] },
    scenario: { label: 'Avis de la Cour des comptes', value: t => SCEN_LABELS[t.scenario == null ? 4 : t.scenario], order: [SCEN_LABELS[1], SCEN_LABELS[2], SCEN_LABELS[3], SCEN_LABELS[0], SCEN_LABELS[4]] }
  };
  const slot = (group, value) => {
    const i = GROUPS[group].order.indexOf(value);
    if (group === 'scenario') return ['1', '2', '3', 'other', 'none'][i] || 'other';
    return i < 0 ? 'other' : String(i + 1);
  };
  const color = (group, value) => `var(--tx-${slot(group, value)})`;
  const lightText = (group, value) => ['3', '4', '5', 'other', 'none'].includes(slot(group, value));

  /* Tooltip shared by every chart. */
  const tip = document.createElement('div');
  tip.className = 'tx-tip'; tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  function showTip(event, html) {
    tip.innerHTML = html; tip.classList.add('is-on');
    const r = tip.getBoundingClientRect(), pad = 14;
    let x = event.clientX + pad, y = event.clientY + pad;
    if (x + r.width > innerWidth - 8) x = event.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = event.clientY - r.height - pad;
    tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
  }
  const hideTip = () => tip.classList.remove('is-on');
  window.addEventListener('scroll', hideTip, { passive: true });

  /* Redraw a chart when its container changes width. */
  function responsive(el, draw) {
    let width = 0;
    const run = () => { const w = Math.round(el.clientWidth); if (w && w !== width) { width = w; draw(w); } };
    if (typeof ResizeObserver === 'function') new ResizeObserver(run).observe(el);
    run();
    return () => { width = 0; run(); };
  }
  const niceStep = range => { const raw = range / 5, mag = 10 ** Math.floor(Math.log10(raw || 1)), n = raw / mag; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag; };

  /* ---------- Squarified treemap ---------- */
  function squarify(items, x, y, w, h) {
    const total = items.reduce((s, it) => s + it.value, 0), out = [];
    if (!total || w <= 0 || h <= 0) return out;
    const scale = w * h / total;
    let rest = items.map(it => ({ it, area: it.value * scale })), box = { x, y, w, h };
    const worst = (row, side) => { const s = row.reduce((a, r) => a + r.area, 0), mx = Math.max(...row.map(r => r.area)), mn = Math.min(...row.map(r => r.area)); return Math.max(side * side * mx / (s * s), s * s / (side * side * mn)); };
    while (rest.length) {
      const side = Math.min(box.w, box.h);
      let row = [rest[0]], i = 1;
      while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
      rest = rest.slice(i);
      const s = row.reduce((a, r) => a + r.area, 0);
      if (box.w >= box.h) { const cw = s / box.h; let cy = box.y; row.forEach(r => { const ch = r.area / cw; out.push({ ...r.it, x: box.x, y: cy, w: cw, h: ch }); cy += ch; }); box = { x: box.x + cw, y: box.y, w: box.w - cw, h: box.h }; }
      else { const ch = s / box.w; let cx = box.x; row.forEach(r => { const cw2 = r.area / ch; out.push({ ...r.it, x: cx, y: box.y, w: cw2, h: ch }); cx += cw2; }); box = { x: box.x, y: box.y + ch, w: box.w, h: box.h - ch }; }
    }
    return out;
  }

  /* ---------- Small line chart (one series, crosshair + tooltip) ---------- */
  function lineChart(el, points, { height = 240, format = v => nf(v), tickFormat = format, label = '', zero = true, refs = [], spark = false } = {}) {
    const draw = W => {
      const pts = points.filter(p => Number.isFinite(p.value));
      if (!pts.length) { el.innerHTML = '<p class="tx-empty">Série indisponible.</p>'; return; }
      const H = spark ? 64 : height, L = spark ? 2 : 52, R = spark ? 2 : 16, T = spark ? 6 : 16, B = spark ? 6 : 26;
      const xs = pts.map(p => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
      const x = v => L + (W - L - R) * (x1 === x0 ? .5 : (v - x0) / (x1 - x0));
      let lo = zero ? 0 : Math.min(...pts.map(p => p.value), ...refs.map(r => r.value)), hi = Math.max(...pts.map(p => p.value), ...refs.map(r => r.value));
      if (!zero) lo -= (hi - lo) * .1 || 1;
      const step = niceStep(hi - lo || hi || 1); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step || step;
      const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
      let svg = '';
      if (!spark) {
        for (let v = lo; v <= hi + step / 2; v += step) svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${tickFormat(v)}</text>`;
        const span = x1 - x0, every = [1, 2, 5, 10].find(k => (W - L - R) / (span / k) >= 46) || 10;
        for (let v = Math.ceil(x0 / every) * every; v <= x1; v += every) svg += `<text class="tx-tick" x="${x(v)}" y="${H - 6}" text-anchor="middle">${v}</text>`;
        refs.forEach(r => { svg += `<line class="tx-ref" x1="${L}" x2="${W - R}" y1="${y(r.value)}" y2="${y(r.value)}"/><text class="tx-ref-label" x="${W - R}" y="${y(r.value) - 5}" text-anchor="end">${esc(r.label)}</text>`; });
      }
      svg += `<path class="tx-line-area" d="${d}L${x(pts.at(-1).x)},${y(lo)}L${x(pts[0].x)},${y(lo)}Z"/><path class="tx-line-path" d="${d}"/>`;
      if (pts.length < 3 || spark) svg += pts.slice(spark ? -1 : 0).map(p => `<circle class="tx-focus" cx="${x(p.x)}" cy="${y(p.value)}" r="${spark ? 3.5 : 4.5}"/>`).join('');
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${svg}<g class="tx-hover"></g><rect class="tx-hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/></svg>`;
      if (spark) return;
      const hover = el.querySelector('.tx-hover'), hit = el.querySelector('.tx-hit');
      hit.addEventListener('pointermove', event => {
        const box = el.querySelector('svg').getBoundingClientRect(), mx = (event.clientX - box.left) * W / box.width;
        const p = pts.reduce((best, q) => Math.abs(x(q.x) - mx) < Math.abs(x(best.x) - mx) ? q : best, pts[0]);
        hover.innerHTML = `<line class="tx-cursor" x1="${x(p.x)}" x2="${x(p.x)}" y1="${T}" y2="${H - B}"/><circle class="tx-focus" cx="${x(p.x)}" cy="${y(p.value)}" r="5"/>`;
        showTip(event, `<strong>${esc(p.x)}${p.note ? ` · ${esc(p.note)}` : ''}</strong><span class="tx-tip__value">${format(p.value)}</span>${p.sub ? `<br>${p.sub}` : ''}`);
      });
      hit.addEventListener('pointerleave', () => { hover.innerHTML = ''; hideTip(); });
    };
    return responsive(el, draw);
  }

  /* ---------- Horizontal bars ---------- */
  function hbars(el, rows, { format = v => nf(v), max = null } = {}) {
    if (!rows.length) { el.innerHTML = '<p class="tx-empty">Aucune donnée publiée trouvée.</p>'; return; }
    const top = max ?? Math.max(...rows.map(r => r.value || 0), 1e-9);
    el.innerHTML = `<ul class="tx-bars">${rows.map(r => `<li class="${r.focus ? 'is-focus' : ''}"><div class="tx-bars__line"><span>${esc(r.label)}${r.sub ? `<small>${r.sub}</small>` : ''}</span><strong>${format(r.value)}</strong></div><span class="tx-bars__track" aria-hidden="true"><span class="tx-bars__fill" style="--w:${(100 * (r.value || 0) / top).toFixed(2)}%"></span></span></li>`).join('')}</ul>`;
    requestAnimationFrame(() => el.querySelectorAll('.tx-bars__fill').forEach(n => { n.style.width = n.style.getPropertyValue('--w'); }));
  }


  load('./data/impots.json').then(init).catch(error => {
    console.error(error);
    $('txTreemap').innerHTML = '<p class="tx-empty">Données indisponibles. Le site doit être servi par HTTP.</p>';
  });

  function init(data) {
    const ALL = data.all;
    const TOT = data.totals, population = TOT.population;
    const insee = data.insee, macro = new Map(data.macro.map(m => [m.year, m]));
    const seriesOf = id => { const line = insee.lines.find(l => l.id === id); return line ? insee.years.map((year, i) => ({ x: year, value: line.values[i] })) : []; };
    const active = ALL.filter(t => t.inForce);
    // Amounts in charts: taxes in force with a known amount, minus fractions of another line (they would be counted twice).
    const counted = active.filter(t => Number.isFinite(t.amount) && t.amount > 0 && !t.partOf);
    const unknown = active.filter(t => t.amount == null);
    const totalListed = counted.reduce((s, t) => s + t.amount, 0);
    const ranked = counted.slice().sort((a, b) => b.amount - a.amount);
    const median = ranked[Math.floor(ranked.length / 2)].amount;
    const byId = new Map(ALL.map(t => [t.id, t]));
    let group = 'base', selected = null;
    const gval = t => GROUPS[group].value(t);
    const groupsPresent = list => { const seen = new Set(list.map(gval)); return [...GROUPS[group].order.filter(v => seen.has(v)), ...[...seen].filter(v => !GROUPS[group].order.includes(v))]; };

    /* ---------- Headline ---------- */
    $('txKpis').innerHTML = [
      ['Impôts perçus en ' + TOT.year, md(TOT.taxes), `Comptes nationaux Insee (${TOT.status}), hors cotisations sociales`],
      ['Prélèvements obligatoires', pct(TOT.levyRate), `du PIB en ${TOT.year}, cotisations sociales comprises (≈ ${md(TOT.levy)})`],
      ['Prélèvements recensés ici', String(active.length), `en vigueur, dont ${unknown.length} au produit inconnu de l’État lui-même`],
      ['La moitié rapporte moins de', meur(median), `par an ; les cinq plus gros font ${pct(100 * ranked.slice(0, 5).reduce((s, t) => s + t.amount, 0) / totalListed, 0)} du total`]
    ].map(([a, b, c]) => `<div class="kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join('');
    $('txLead').textContent = `Les ${active.length} impôts, taxes et prélèvements recensés, de la TVA (${meur(ranked[0].amount)}) aux plus petites taxes (${meur(ranked.at(-1).amount)} pour la plus petite connue), sur les mêmes graphiques : ce qu’ils rapportent, qui les paie, qui les reçoit, qui les collecte, et ce que coûte leur collecte.`;
    $('txOneLead').textContent = `Les ${counted.length} prélèvements dont le produit est connu, sur une échelle logarithmique où chaque graduation multiplie le montant par dix. ${unknown.length} autres n’ont pas de produit connu : ils sont comptés à part.`;

    /* ---------- Colour scheme shared by the global charts ---------- */
    const redraws = [];
    document.querySelectorAll('.tx-color').forEach(box => box.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b || b.dataset.color === group) return;
      group = b.dataset.color;
      document.querySelectorAll('.tx-color button').forEach(n => n.classList.toggle('active', n.dataset.color === group));
      redraws.forEach(fn => fn());
    }));
    const legendHtml = (list, withAmount = true) => groupsPresent(list).map(v => {
      const items = list.filter(t => gval(t) === v), sum = items.reduce((s, t) => s + (t.amount || 0), 0);
      return `<span><i style="background:${color(group, v)}"></i>${esc(v)} <b>${withAmount ? meur(sum) : items.length}</b></span>`;
    }).join('');
    const tipFor = t => `<strong>${esc(t.name)}</strong><span class="tx-tip__value">${t.amount == null ? 'produit inconnu' : `${approx(t)}${meur(t.amount)}`}</span>${t.amount != null && !t.partOf && t.inForce ? ` · ${pct(100 * t.amount / totalListed, t.amount / totalListed < .001 ? 3 : 1)} du total` : ''}<br>${esc(t.year)} · ${esc(t.beneficiary)} · ${esc(t.collector)}${t.partOf ? '<br>Fraction d’une autre ligne, non additionnée' : ''}`;

    /* ---------- Treemap ---------- */
    const treemapEl = $('txTreemap');
    const drawTreemap = W => {
      const H = Math.round(treemapEl.clientHeight || 480);
      const groups = groupsPresent(counted).map(key => ({ key, items: counted.filter(t => gval(t) === key).sort((a, b) => b.amount - a.amount) }))
        .map(g => ({ ...g, value: g.items.reduce((s, t) => s + t.amount, 0) })).sort((a, b) => b.value - a.value);
      let cells = '';
      squarify(groups, 0, 0, W, H).forEach(gr => {
        squarify(gr.items.map(t => ({ ...t, value: t.amount })), gr.x, gr.y, gr.w, gr.h).forEach(c => {
          const fits = c.w > 64 && c.h > 30, big = c.w > 64 && c.h > 48;
          const maxChars = Math.floor((c.w - 12) / 6.6), name = c.short || c.name;
          const text = name.length > maxChars ? `${name.slice(0, Math.max(1, maxChars - 1))}…` : name;
          cells += `<g class="tx-cell${lightText(group, gval(c)) ? ' is-light' : ''}${selected === c.id ? ' is-selected' : ''}" data-id="${esc(c.id)}"${fits ? ' tabindex="0" role="button"' : ''} aria-label="${esc(c.name)} : ${esc(meur(c.amount))}"><rect x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" width="${Math.max(0, c.w).toFixed(2)}" height="${Math.max(0, c.h).toFixed(2)}" rx="${Math.min(3, c.w / 3, c.h / 3).toFixed(1)}" fill="${color(group, gval(c))}"/>${fits ? `<text x="${(c.x + 7).toFixed(1)}" y="${(c.y + 18).toFixed(1)}">${esc(text)}</text>` : ''}${big ? `<text class="tx-cell__value" x="${(c.x + 7).toFixed(1)}" y="${(c.y + 34).toFixed(1)}">${meur(c.amount)}</text>` : ''}</g>`;
        });
      });
      treemapEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="Impôts et taxes, surface proportionnelle au produit">${cells}</svg>`;
      $('txLegend').innerHTML = legendHtml(counted);
    };
    redraws.push(responsive(treemapEl, drawTreemap));
    treemapEl.addEventListener('pointermove', event => { const cell = event.target.closest?.('.tx-cell'); if (!cell) { hideTip(); return; } showTip(event, tipFor(byId.get(cell.dataset.id))); });
    treemapEl.addEventListener('pointerleave', hideTip);
    treemapEl.addEventListener('click', event => { const cell = event.target.closest?.('.tx-cell'); if (!cell) return; select(cell.dataset.id); if (innerWidth <= 960) $('txDetail').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' }); });
    treemapEl.addEventListener('keydown', event => { const cell = event.target.closest?.('.tx-cell'); if (cell && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(cell.dataset.id); } });
    const tiny = counted.filter(t => t.amount < totalListed * 2e-5).length;
    $('txTreemapNote').textContent = `${counted.length} prélèvements au produit connu, ${meur(totalListed)} au total. ${tiny} d’entre eux sont trop petits pour être visibles à cette échelle (moins de ${meur(totalListed * 2e-5)}) ; ${unknown.length} autres, au produit inconnu, n’y figurent pas. Les années et les sources diffèrent d’une ligne à l’autre : ce total n’est pas celui des comptes nationaux. Les fractions d’un impôt (par exemple la TVA reversée aux collectivités) ne sont pas comptées deux fois.`;

    /* ---------- Detail panel ---------- */
    // Without a cost for the tax itself, the overall rate of the administration that collects it, labelled as such.
    const globalRate = t => {
      const c = (data.costs.collectors || []).find(r => !r.focus && r.name.startsWith(t.collector.split(' ')[0]));
      return c ? `<br><span class="muted">Pour l’ensemble de ce qu’elle collecte, l’administration ${esc(t.collector)} dépense ${euros(c.per100)} pour 100 € (${c.year}).</span>` : '';
    };
    function select(id) {
      const t = byId.get(id); if (!t) return;
      selected = id;
      treemapEl.querySelectorAll('.tx-cell').forEach(n => n.classList.toggle('is-selected', n.dataset.id === id));
      const per = t.amount ? t.amount * 1e6 / population : null, cost = t.cost;
      $('txDetail').innerHTML = `<span class="tx-pill"><i style="background:${color('base', t.base)}"></i>${esc(t.base)}</span>${t.scenario ? ` <span class="tx-scen s${t.scenario}" title="${esc(SCEN_LABELS[t.scenario])}">Cour : scénario ${t.scenario}</span>` : ''}
        <h3>${esc(t.name)}${t.acronym ? ` <span class="muted">(${esc(t.acronym)})</span>` : ''}</h3>
        <div class="tx-amount">${t.amount == null ? 'Produit inconnu' : `${approx(t)}${meur(t.amount)}`}</div>
        <p class="note">${esc(t.year)} · ${esc(t.status || '')}${per ? ` · ${euros(per)} par habitant` : ''}${t.amount && !t.partOf && t.inForce ? ` · ${pct(100 * t.amount / totalListed, t.amount / totalListed < .001 ? 3 : 1)} du total recensé` : ''}${t.y2019 != null ? ` · ${meur(t.y2019)} en 2019` : ''}</p>
        ${t.insee ? `<div class="tx-spark" id="txSpark"></div><p class="note">Comptes nationaux Insee, ${insee.years[0]}–${insee.years.at(-1)}, Md€</p>` : ''}
        <dl><dt>Ce qui est taxé</dt><dd>${esc(t.base)}</dd><dt>Qui paie</dt><dd>${esc(t.payer)}</dd><dt>Qui reçoit</dt><dd>${esc(t.beneficiaryDetail || t.beneficiary)}</dd><dt>Qui collecte</dt><dd>${esc(t.collectorDetail || t.collector)}</dd>${t.objective ? `<dt>Objectif</dt><dd>${esc(t.objective)} <span class="muted">(Cour des comptes)</span></dd>` : ''}${t.created ? `<dt>Créé en</dt><dd>${esc(t.created)}</dd>` : ''}${t.state && t.state !== 'en vigueur' ? `<dt>État</dt><dd>${esc(t.state)} entre 2019 et 2024</dd>` : ''}
        <dt>Coût de collecte</dt><dd>${cost ? `${cost.range ? `${esc(cost.range)} du produit` : cost.pct != null ? `${pct(cost.pct, 2)} du produit` : ''}${cost.meur != null ? ` · ${meur(cost.meur)}` : ''} <span class="muted">(${esc(cost.year || '')}, ${link(cost.url, cost.title || 'source')})</span>` : `<span class="muted">non publié pour cette taxe</span>${globalRate(t)}`}</dd></dl>
        ${t.scenario ? `<p class="note">Avis de la Cour des comptes : ${esc(data.lowYield.scenarioLabels[t.scenario])}.</p>` : ''}
        ${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}${t.check === 'extrait' ? '<p class="note">Chiffre relevé dans un extrait du document cité : à confirmer sur le document complet.</p>' : ''}
        <p class="note">Source : ${link(t.source?.url, t.source?.title || 'document')}${t.source?.ref ? ` · ${esc(t.source.ref)}` : ''}</p>`;
      if (t.insee) lineChart($('txSpark'), seriesOf(t.insee), { spark: true, label: `${t.name} depuis 1995` });
    }
    select(ranked[0].id);
    const openDetail = id => { select(id); $('txDetail').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); };

    /* ---------- Log strip: every tax, one row per value of the colour scheme ---------- */
    const strip = $('txStrip');
    const drawStrip = W => {
      const rows = groupsPresent(active);
      const narrow = W < 640, rowH = narrow ? 62 : 40, L = narrow ? 8 : 230, R = narrow ? 8 : 104, T = 8, B = 30, H = T + B + rowH * rows.length;
      const lo = -2, hi = 6, x = v => L + (W - L - R) * (Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo);
      let svg = '', labels = '';
      for (let p = lo; p <= hi; p++) {
        svg += `<line class="tx-grid" x1="${x(10 ** p)}" x2="${x(10 ** p)}" y1="${T}" y2="${H - B}"/>`;
        if (!narrow || p % 2 === 0) svg += `<text class="tx-tick" x="${x(10 ** p)}" y="${H - 10}" text-anchor="middle">${meur(10 ** p).replace(' ', ' ')}</text>`;
      }
      svg += `<line class="tx-ref" x1="${x(175)}" x2="${x(175)}" y1="${T}" y2="${H - B}"/><text class="tx-ref-label" x="${x(175) + 5}" y="${H - B - 5}">175 M€</text>`;
      rows.forEach((v, i) => {
        const top = T + rowH * i, cy = top + rowH / 2 + (narrow ? 10 : 0);
        const items = counted.filter(t => gval(t) === v).sort((a, b) => b.amount - a.amount), missing = unknown.filter(t => gval(t) === v).length;
        labels += narrow ? `<text class="tx-tick tx-tick--strong tx-halo" x="${L}" y="${top + 13}">${esc(v)}${missing ? ` · ${missing} au produit inconnu` : ''}</text>`
          : `<text class="tx-label" x="${L - 14}" y="${cy + 4}" text-anchor="end">${esc(v)}</text>${missing ? `<text class="tx-tick" x="${W - R + 10}" y="${cy + 4}">+ ${missing} inconnu${missing > 1 ? 's' : ''}</text>` : ''}`;
        svg += `<line class="tx-axis" x1="${L}" x2="${W - R}" y1="${cy}" y2="${cy}" opacity=".25"/>`;
        const placed = [];
        items.forEach(t => {
          const cx = x(t.amount); let dy = 0;
          for (const k of [0, -6, 6, -12, 12]) { if (!placed.some(p => Math.abs(p.x - cx) < 8 && p.dy === k)) { dy = k; break; } }
          placed.push({ x: cx, dy });
          svg += `<circle class="tx-dot" data-id="${esc(t.id)}" cx="${cx.toFixed(1)}" cy="${cy + dy}" r="4.5" fill="${color(group, v)}"/>`;
        });
      });
      strip.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Produit de chaque impôt sur une échelle logarithmique">${svg}${labels}</svg>`;
    };
    redraws.push(responsive(strip, drawStrip));
    strip.addEventListener('pointermove', event => { const dot = event.target.closest?.('.tx-dot'); if (!dot) { hideTip(); return; } showTip(event, tipFor(byId.get(dot.dataset.id))); });
    strip.addEventListener('pointerleave', hideTip);
    strip.addEventListener('click', event => { const dot = event.target.closest?.('.tx-dot'); if (dot) { select(dot.dataset.id); $('ensemble').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); } });
    const small = counted.filter(t => t.amount < 175);
    $('txStripNote').textContent = `Ligne orange : 175 M€, seuil de la Cour des comptes pour les « taxes à faible rendement ». ${small.length} prélèvements au produit connu sont en dessous, pour ${meur(small.reduce((s, t) => s + t.amount, 0))} au total, soit ${pct(100 * small.reduce((s, t) => s + t.amount, 0) / totalListed, 2)} des recettes recensées. Les points se décalent verticalement quand ils se chevauchent. Cliquez sur un point pour sa fiche.`;

    /* ---------- Pareto ---------- */
    let run = 0; const cumulative = ranked.map(t => { run += t.amount; return { t, share: 100 * run / totalListed }; });
    const firstAt = s => cumulative.findIndex(c => c.share >= s) + 1;
    const pareto = $('txPareto');
    responsive(pareto, W => {
      const H = 260, L = 44, R = 16, T = 12, B = 30, n = cumulative.length;
      const x = i => L + (W - L - R) * (i / Math.max(1, n - 1)), y = v => T + (H - T - B) * (1 - v / 100);
      let svg = '';
      for (let v = 0; v <= 100; v += 25) svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v} %</text>`;
      [1, 50, 100, 150].filter(k => k <= n && x(n - 1) - x(k - 1) > 30).concat(n).forEach(k => { svg += `<text class="tx-tick" x="${x(k - 1)}" y="${H - 8}" text-anchor="middle">${k}</text>`; });
      const d = cumulative.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c.share).toFixed(1)}`).join('');
      svg += `<path class="tx-line-area" d="${d}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z"/><path class="tx-line-path" d="${d}"/>`;
      [80, 99].forEach((s, j) => { const k = firstAt(s); if (k > 0) { const cx = x(k - 1), cy = y(cumulative[k - 1].share); svg += `<circle class="tx-focus" cx="${cx}" cy="${cy}" r="4.5"/><text class="tx-label" x="${cx + 8}" y="${cy + (j ? 18 : 16)}">${k} impôts = ${s} %</text>`; } });
      pareto.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Part cumulée des recettes selon le nombre d’impôts">${svg}<g class="tx-hover"></g><rect class="tx-hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/></svg>`;
      const hit = pareto.querySelector('.tx-hit'), hover = pareto.querySelector('.tx-hover');
      hit.addEventListener('pointermove', event => {
        const box = pareto.querySelector('svg').getBoundingClientRect(), mx = (event.clientX - box.left) * W / box.width;
        const i = Math.max(0, Math.min(n - 1, Math.round((mx - L) / (W - L - R) * (n - 1)))), c = cumulative[i];
        hover.innerHTML = `<line class="tx-cursor" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/><circle class="tx-focus" cx="${x(i)}" cy="${y(c.share)}" r="5"/>`;
        showTip(event, `<strong>${i + 1}<sup>e</sup> : ${esc(c.t.name)}</strong>${meur(c.t.amount)}<br>Les ${i + 1} premiers : <span class="tx-tip__value">${pct(c.share, c.share > 99 ? 2 : 1)}</span>`);
      });
      hit.addEventListener('pointerleave', () => { hover.innerHTML = ''; hideTip(); });
    });
    const k99 = firstAt(99);
    $('txParetoNote').textContent = `Prélèvements classés du plus gros au plus petit (axe horizontal : rang). Les cinq premiers (${ranked.slice(0, 5).map(t => t.short || t.name).join(', ')}) font ${pct(cumulative[4].share)} des recettes recensées ; les ${counted.length - k99} derniers, moins de 1 %.`;

    /* ---------- Share of taxes vs share of money, per value of the colour scheme ---------- */
    const shareEl = $('txShare');
    const drawShare = () => {
      const rows = groupsPresent(active).map(v => {
        const n = active.filter(t => gval(t) === v).length, sum = counted.filter(t => gval(t) === v).reduce((s, t) => s + t.amount, 0);
        return { v, n, sum, pn: 100 * n / active.length, ps: 100 * sum / totalListed };
      });
      shareEl.innerHTML = `<div class="tx-share__legend"><span><i class="is-count"></i>Part du nombre de prélèvements</span><span><i></i>Part de l’argent</span></div><ul class="tx-share">${rows.map(r => `<li><div class="tx-bars__line"><span>${esc(r.v)}</span><strong>${r.n} · ${meur(r.sum)}</strong></div>
        <span class="tx-share__bar is-count" style="--c:${color(group, r.v)};--w:${r.pn.toFixed(2)}%"><b>${pct(r.pn, 0)}</b></span><span class="tx-share__bar" style="--c:${color(group, r.v)};--w:${r.ps.toFixed(2)}%"><b>${pct(r.ps, r.ps < 1 ? 1 : 0)}</b></span></li>`).join('')}</ul>`;
    };
    drawShare(); redraws.push(drawShare);
    $('txShareNote').textContent = 'Barre claire : part des prélèvements en vigueur (produit connu ou non) ; barre foncée : part de l’argent recensé. L’écart entre les deux montre où se concentrent les petites taxes.';

    /* ---------- Waffle: one cell per tax in force, grouped by collector ---------- */
    const waffleEl = $('txWaffle');
    const drawWaffle = () => {
      const by = group === 'collector' ? 'base' : 'collector';
      const blocks = GROUPS[by].order.filter(v => active.some(t => GROUPS[by].value(t) === v));
      const order = GROUPS[group].order;
      waffleEl.innerHTML = blocks.map(b => {
        const items = active.filter(t => GROUPS[by].value(t) === b).sort((p, q) => (order.indexOf(gval(p)) + 99) % 99 - (order.indexOf(gval(q)) + 99) % 99 || (q.amount ?? -1) - (p.amount ?? -1));
        const sum = items.reduce((s, t) => s + (t.partOf ? 0 : t.amount || 0), 0), miss = items.filter(t => t.amount == null).length;
        return `<div class="tx-waffle__group"><h4>${esc(b)} <span>· ${items.length} prélèvements · ${meur(sum)}${miss ? ` · ${miss} au produit inconnu` : ''}</span></h4><div class="tx-waffle__cells">${items.map(t => `<button type="button" data-id="${esc(t.id)}" class="${t.amount == null ? 'is-unknown' : ''}" style="--cell:${color(group, gval(t))}" aria-label="${esc(t.name)} : ${t.amount == null ? 'produit inconnu' : meur(t.amount)}"></button>`).join('')}</div></div>`;
      }).join('') + `<div class="tx-legend">${legendHtml(active, false)}<span><i class="is-hollow"></i>Case vide : produit inconnu <b>${unknown.length}</b></span></div>`;
    };
    drawWaffle(); redraws.push(drawWaffle);
    waffleEl.addEventListener('pointermove', event => { const b = event.target.closest?.('[data-id]'); if (!b) { hideTip(); return; } showTip(event, tipFor(byId.get(b.dataset.id))); });
    waffleEl.addEventListener('pointerleave', hideTip);
    waffleEl.addEventListener('click', event => { const b = event.target.closest?.('[data-id]'); if (b) openDetail(b.dataset.id); });
    const LY = data.lowYield;
    $('txWaffleNote').innerHTML = `Groupées par administration qui collecte (ou par ce qui est taxé quand la couleur montre le collecteur). Couleur « Avis de la Cour » : la Cour des comptes propose de revoir 44 taxes dès le budget 2026, d’en réexaminer 30 d’ici 2027 et d’en rationaliser 99 autres (${link(`${LY.report}#page=12`, 'rapport, p. 11-12')}) ; son annexe n’en nomme qu’une partie, seules les taxes nommées sont colorées. Cliquez sur une case pour sa fiche.`;

    hbars($('txTop'), ranked.slice(0, 15).map(t => ({ label: t.short || t.name, sub: `${esc(t.year)} · ${esc(t.beneficiary)}`, value: t.amount })), { format: meur });
    hbars($('txBottom'), ranked.slice(-15).reverse().map(t => ({ label: t.name, sub: `${esc(t.year)} · ${esc(t.beneficiaryDetail || t.beneficiary)}`, value: t.amount })), { format: meur });

    /* ---------- Insee history: stacked categories ---------- */
    const cats = insee.lines.filter(l => !l.parent);
    // Insee categories take the categorical slots in stacking order (the validated adjacent order); VAT keeps slot 1 as in the treemap.
    const catColor = id => `var(--tx-${cats.findIndex(c => c.id === id) + 1})`;
    let unit = 'md';
    const conv = (value, year) => {
      if (value == null) return null;
      const m = macro.get(year);
      if (unit === 'pib') return m?.gdp ? 100 * value / m.gdp : null;
      if (unit === 'hab') return m?.population ? value * 1e9 / m.population : null;
      return value;
    };
    const unitFmt = v => unit === 'pib' ? `${nf(v, 2)} % du PIB` : unit === 'hab' ? `${nf(Math.round(v), 0)} €/hab.` : `${nf(v, 1)} Md€`;
    const unitTick = v => unit === 'pib' ? `${nf(v, 0)} %` : unit === 'hab' ? `${nf(v / 1000, 0)} k€` : nf(v, 0);
    const stackEl = $('txStack');
    const drawStack = W => {
      const H = 330, L = 52, R = 14, T = 26, B = 28, years = insee.years, n = years.length;
      const x = i => L + (W - L - R) * i / (n - 1);
      const layers = cats.map(c => ({ c, values: c.values.map((v, i) => conv(v, years[i]) ?? 0) }));
      const tops = years.map((_, i) => layers.reduce((s, l) => s + l.values[i], 0));
      const hi0 = Math.max(...tops), step = niceStep(hi0), hi = Math.ceil(hi0 / step) * step;
      const y = v => T + (H - T - B) * (1 - v / hi);
      let svg = '', base = years.map(() => 0);
      for (let v = 0; v <= hi + step / 2; v += step) svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${unitTick(v)}</text>`;
      svg += `<text class="tx-tick" x="${L - 8}" y="${T - 14}" text-anchor="end">${unit === 'md' ? 'Md€' : unit === 'pib' ? '% du PIB' : '€/hab.'}</text>`;
      layers.forEach(l => {
        const top = base.map((b, i) => b + l.values[i]);
        const d = top.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('') + base.map((v, i) => [i, v]).reverse().map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('') + 'Z';
        svg += `<path class="tx-stack-layer" d="${d}" fill="${catColor(l.c.id)}"/>`;
        base = top;
      });
      const every = [1, 2, 5, 10].find(k => (W - L - R) / (n / k) >= 44) || 10;
      years.forEach((yr, i) => { if (yr % every === 0) svg += `<text class="tx-tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${yr}</text>`; });
      stackEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Impôts par catégorie de ${years[0]} à ${years.at(-1)}">${svg}<g class="tx-hover"></g><rect class="tx-hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/></svg>`;
      const hit = stackEl.querySelector('.tx-hit'), hover = stackEl.querySelector('.tx-hover');
      hit.addEventListener('pointermove', event => {
        const box = stackEl.querySelector('svg').getBoundingClientRect(), mx = (event.clientX - box.left) * W / box.width;
        const i = Math.max(0, Math.min(n - 1, Math.round((mx - L) / (W - L - R) * (n - 1))));
        hover.innerHTML = `<line class="tx-cursor" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/>`;
        const status = insee.status[String(years[i])];
        showTip(event, `<strong>${years[i]}${status ? ` (${status})` : ''} · ${unitFmt(tops[i])}</strong><table>${layers.slice().reverse().map(l => `<tr><td><i style="background:${catColor(l.c.id)}"></i>${esc(l.c.label)}</td><td>${unitFmt(l.values[i])}</td></tr>`).join('')}</table>`);
      });
      hit.addEventListener('pointerleave', () => { hover.innerHTML = ''; hideTip(); });
      const last = n - 1;
      $('txStackLegend').innerHTML = cats.slice().reverse().map(c => `<span><i style="background:${catColor(c.id)}"></i>${esc(c.label)} <b>${unitFmt(conv(c.values[last], years[last]))}</b></span>`).join('');
      const first = tops[0], end = tops[last];
      $('txStackNote').textContent = `De ${years[0]} à ${years[last]}, les impôts passent de ${unitFmt(first)} à ${unitFmt(end)}${unit === 'md' ? ' en euros courants (inflation non corrigée)' : ''}. Légende : valeurs ${years[last]} (provisoires). Les cotisations sociales, environ ${md(TOT.contributions)} en ${TOT.year}, ne sont pas des impôts au sens de la comptabilité nationale et n’apparaissent pas ici. Source : Insee, comptes nationaux, base 2020.`;
    };
    const redrawStack = responsive(stackEl, drawStack);

    /* One tax in time */
    const pick = $('txSeriesPick');
    pick.innerHTML = cats.map(c => `<optgroup label="${esc(c.label)}"><option value="${c.id}">${esc(c.label)} (total)</option>${insee.lines.filter(l => l.parent === c.id).map(l => `<option value="${l.id}">${esc(l.label)}</option>`).join('')}</optgroup>`).join('');
    pick.value = 'csg';
    let redrawSeries = () => {};
    const drawSeries = () => {
      const line = insee.lines.find(l => l.id === pick.value);
      const pts = insee.years.map((yr, i) => ({ x: yr, value: conv(line.values[i], yr), note: insee.status[String(yr)] })).filter(p => p.value != null);
      $('txSeriesTitle').textContent = line.label;
      redrawSeries = lineChart($('txSeries'), pts, { format: unitFmt, tickFormat: unitTick, label: `${line.label} de ${insee.years[0]} à ${insee.years.at(-1)}` });
      const a = pts[0], b = pts.at(-1);
      $('txSeriesNote').textContent = a && b ? `${a.x} : ${unitFmt(a.value)} ; ${b.x} : ${unitFmt(b.value)}.${line.parent ? ' Ligne « dont » du tableau Insee : déjà comprise dans sa catégorie.' : ''} Libellé Insee : « ${line.sourceLabel} ».` : '';
    };
    pick.addEventListener('change', drawSeries);
    drawSeries();
    $('txHistUnit').addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      unit = b.dataset.unit;
      $('txHistUnit').querySelectorAll('button').forEach(n => n.classList.toggle('active', n === b));
      redrawStack(); drawSeries();
    });

    /* ---------- Cost of collection ---------- */
    const C = data.costs;
    const dg = (C.dgfip || []).filter(r => Number.isFinite(r.gross)).sort((a, b) => a.year - b.year);
    const lastDg = dg.at(-1);
    const collectors = (C.collectors || []).filter(r => Number.isFinite(r.per100));
    $('txCostKpis').innerHTML = [
      ...collectors.filter(c => !c.focus).map(c => [`${c.name} : pour 100 € collectés`, euros(c.per100), `${c.year} · ${c.scope}`]),
      C.compliance && [C.compliance.label, C.compliance.value, C.compliance.sub]
    ].filter(Boolean).map(([a, b, c]) => `<div class="kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join('');
    hbars($('txCollectors'), collectors.map(c => ({ label: c.name, sub: `${esc(c.scope)} · ${c.year} · ${link(c.url, c.title || 'source')}`, value: c.per100, focus: c.focus })), { format: v => `${nf(v, 2)} €` });
    $('txCollectorsNote').textContent = C.collectorsNote || '';
    if (dg.length) {
      lineChart($('txDgfip'), dg.map(r => ({ x: r.year, value: r.gross, note: r.uncertain ? 'année ou méthode à confirmer' : '', sub: `${r.net != null ? `Rapporté aux recettes nettes : ${pct(r.net, 2)}<br>` : ''}${esc(r.title || '')}` })), { height: 220, format: v => `${nf(v, 2)} %`, tickFormat: v => `${nf(v, 1)} %`, label: 'Taux d’intervention de la DGFiP sur l’impôt' });
      $('txDgfipNote').innerHTML = `${esc(C.dgfipNote || '')} Sources : ${[...new Map(dg.map(r => [r.url, r])).values()].map(r => link(r.url, String(r.year))).join(', ')}.`;
    } else $('txDgfip').innerHTML = '<p class="tx-empty">Série indisponible.</p>';
    const fees = C.localFees || [];
    hbars($('txFees'), fees.map(f => ({ label: f.tax, sub: `${esc(f.detail || '')} · ${link(f.url, f.law || 'source')}`, value: f.rate })), { format: v => `${nf(v, 1)} % de l’impôt`, max: 10 });
    $('txFeesNote').innerHTML = `${esc(C.localFeesNote || '')}${C.localFeesTotal ? ` ${esc(C.localFeesTotal.text)} ${link(C.localFeesTotal.url, 'Rapport de la Cour des comptes (2017)')}` : ''}`;
    const perTax = C.perTax || [];
    $('txPerTaxCost').innerHTML = perTax.length ? `<table class="data-table"><thead><tr><th>Impôt</th><th class="num">Coût</th><th class="num">En % du produit</th><th>Année</th><th>Remarque</th><th>Source</th></tr></thead><tbody>${perTax.map(r => `<tr><td class="tx-name">${esc(r.tax)}${ended(r.ended)}</td><td class="num">${meur(r.meur)}</td><td class="num">${r.range ? esc(r.range) : r.pct != null ? pct(r.pct, 2) : '–'}</td><td>${esc(r.year || '')}</td><td class="muted">${esc(r.note || '')}${r.uncertain ? ' Valeur lue dans un tableau mal extrait : à confirmer.' : ''}</td><td class="tx-src">${link(r.url, r.title || 'source')}</td></tr>`).join('')}</tbody></table>` : '<p class="tx-empty">Aucun coût par impôt publié trouvé.</p>';
    $('txPerTaxCostNote').textContent = C.perTaxNote || '';
    const law = C.lawFees || [];
    hbars($('txLawFees'), law.map(f => ({ label: f.tax, sub: `${f.detail ? `${esc(f.detail)} · ` : ''}${link(f.url, f.law || 'source')}`, value: f.rate })), { format: v => `${nf(v, 2)} % du produit`, max: 10 });
    $('txLawFeesNote').textContent = C.lawFeesNote || '';
    const BT = C.byTax;
    if (BT) {
      const hi = Math.max(...BT.rows.flatMap(r => r[1]).filter(v => v != null));
      $('txByTax').innerHTML = `<table class="data-table tx-bytax"><thead><tr><th>Impôt</th>${BT.years.map(y => `<th class="num">${y}</th>`).join('')}</tr></thead><tbody>${BT.rows.map(([name, vals]) => `<tr${name === 'Ensemble' ? ' class="is-total"' : ''}><td>${esc(name)}${ended(BT.ended?.[name])}</td>${vals.map(v => v == null ? '<td class="num muted">–</td>' : `<td class="num" style="--h:${(v / hi).toFixed(3)}">${pct(v, 2)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      $('txByTaxNote').innerHTML = `${esc(BT.note)} Sources : ${link(BT.url, BT.source)} ; ${link(BT.noteUrl, 'réponse ministérielle (2006)')}.`;
    }

    /* ---------- Small taxes: cost per 100 € on a log axis ---------- */
    const dots = (C.costDots || []).filter(r => r.per100 > 0).sort((a, b) => b.per100 - a.per100);
    const dotsEl = $('txCostDots');
    if (dots.length) {
      responsive(dotsEl, W => {
        const narrow = W < 620, rowH = narrow ? 44 : 30, L = narrow ? 8 : 330, R = 70, T = 6, B = 30, H = T + B + rowH * dots.length;
        const lo = -2, hi = 2, x = v => L + (W - L - R) * (Math.log10(v) - lo) / (hi - lo);
        let svg = '';
        for (let p = lo; p <= hi; p++) svg += `<line class="tx-grid" x1="${x(10 ** p)}" x2="${x(10 ** p)}" y1="${T}" y2="${H - B}"/><text class="tx-tick" x="${x(10 ** p)}" y="${H - 10}" text-anchor="middle">${nf(10 ** p, 2)} €</text>`;
        dots.forEach((r, i) => {
          const cy = T + rowH * i + rowH / 2 + (narrow ? 8 : 0), cx = x(r.per100);
          const lab = `${r.name} (${r.year}${r.ended?.full ? ', supprimée' : ''})`, maxc = Math.floor((W - 16) / 6.2);
          svg += narrow ? `<text class="tx-tick tx-tick--strong" x="${L}" y="${cy - 12}">${esc(lab.length > maxc ? `${lab.slice(0, maxc - 1)}…` : lab)}</text>` : `<text class="tx-label" x="${L - 12}" y="${cy + 4}" text-anchor="end">${esc(r.name)} <tspan class="tx-label--muted">${esc(r.year)}${r.ended?.full ? ' · supprimée' : ''}</tspan></text>`;
          svg += `<line class="tx-axis" x1="${x(10 ** lo)}" x2="${cx}" y1="${cy}" y2="${cy}"/><circle class="tx-dot${r.ended?.full ? ' is-ended' : ''}" data-i="${i}" cx="${cx.toFixed(1)}" cy="${cy}" r="6" fill="${r.per100 >= 5 ? 'var(--tx-8)' : 'var(--tx-1)'}"${r.ended?.full ? ` style="stroke:${r.per100 >= 5 ? 'var(--tx-8)' : 'var(--tx-1)'}"` : ''}/><text class="tx-label" x="${cx + 10}" y="${cy + 4}">${r.range ? esc(r.range) : `${nf(r.per100, r.per100 < 1 ? 2 : 1)} €`}</text>`;
        });
        dotsEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Coût de collecte pour 100 euros perçus, échelle logarithmique">${svg}</svg>`;
      });
      dotsEl.addEventListener('pointermove', event => {
        const dot = event.target.closest?.('.tx-dot'); if (!dot) { hideTip(); return; }
        const r = dots[Number(dot.dataset.i)];
        showTip(event, `<strong>${esc(r.name)}</strong><span class="tx-tip__value">${r.range ? esc(r.range) : `${nf(r.per100, 2)} €`} pour 100 € perçus</span><br>${esc(r.year)}${r.yield ? ` · rendement ${meur(r.yield)}` : ''}${r.ended ? `<br>${esc(r.ended.text)}` : ''}`);
      });
      dotsEl.addEventListener('pointerleave', hideTip);
      $('txCostDotsNote').innerHTML = `Échelle logarithmique : chaque graduation multiplie le coût par dix. En rouge, plus de 5 € pour 100 €. Cercle vide : taxe supprimée depuis. Sources : ${[...new Map(dots.map(r => [r.url, r])).values()].map((r, i) => link(r.url, `[${i + 1}]`)).join(' ')}. Les coûts sont ceux du rapport cité, à sa date ; certaines taxes ont depuis été supprimées ou réformées.${C.noLossQuote ? ` Le cas le plus cité, la taxe sur les appareils automatiques (flippers, jeux vidéo), qui rapportait quelques centaines de milliers d’euros (${link('https://www.vie-publique.fr/files/rapport/pdf/174000418.pdf', 'IGF, 2014')}), a été supprimée en 2015 (${link('https://www.senat.fr/questions/base/2015/qSEQ150114502.html', 'Sénat')}) sans que son coût de gestion ait été publié.` : ''}`;
    } else dotsEl.innerHTML = '<p class="tx-empty">Aucun coût publié.</p>';
    $('txCounts').innerHTML = (data.counts || []).map(c => `<div class="tx-count"><strong>${esc(c.value)}</strong><p>${esc(c.text)}</p>${link(c.url, c.title || 'source')}</div>`).join('');

    if (C.noLossQuote) $('txQuote').innerHTML = `« ${esc(C.noLossQuote.text)} »${link(C.noLossQuote.url, C.noLossQuote.title)}`;

    /* ---------- Gaps ---------- */
    const gaps = C.gaps || [];
    $('txGapKpis').innerHTML = gaps.filter(g => g.kpi).map(g => `<div class="kpi"><span>${esc(g.label)}</span><strong>${esc(g.kpi)}</strong><small>${esc(g.sub || '')}</small></div>`).join('');
    $('txGapList').innerHTML = gaps.map(g => `<article class="gap"><h3>${esc(g.label)}</h3><p>${esc(g.text)}</p><p class="note">${link(g.url, g.title || 'source')}</p></article>`).join('') || '<p class="tx-empty">Aucune estimation officielle trouvée.</p>';


    /* ---------- What the government should publish: computed counts, then one card per missing publication ---------- */
    const P = C.publish || {};
    const withCost = active.filter(t => t.cost && !t.partOf);
    const oldCost = withCost.filter(t => parseInt(String(t.cost.year).slice(-4), 10) < 2020);
    $('txAskKpis').innerHTML = [
      ['Prélèvements en vigueur avec un coût de collecte publié', `${withCost.length} sur ${active.length}`, oldCost.length ? `dont ${oldCost.length} avec un chiffre antérieur à 2020` : 'chiffres récents'],
      ['Prélèvements en vigueur au produit inconnu', String(unknown.length), 'ni l’État ni la Cour des comptes ne publient ce qu’ils rapportent'],
      ...(P.facts || []).map(f => [f.label, f.value, f.sub])
    ].map(([a, b, c]) => `<div class="kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c || '')}</small></div>`).join('');
    const STATE = { none: 'Rien de publié', partial: 'Publié en partie', past: 'Publié autrefois, plus maintenant' };
    $('txAskList').innerHTML = (P.items || []).map((a, i) => `<article class="gap tx-ask"><span class="gap__state ${a.state === 'none' ? 'none' : 'partial'}">${esc(STATE[a.state] || a.state)}</span><h3><span class="tx-ask__n">${i + 1}</span>${esc(a.title)}</h3><dl><dt>Aujourd’hui</dt><dd>${esc(a.today)}</dd><dt>Ce qu’il faudrait publier</dt><dd>${esc(a.ask)}</dd><dt>Par qui</dt><dd>${esc(a.who)}</dd></dl>${a.found ? `<p class="tx-ask__found">${esc(a.found)}</p>` : ''}${a.proof ? `<blockquote class="tx-ask__proof">${a.proof.text ? `« ${esc(a.proof.text)} »` : ''}${link(a.proof.url, a.proof.title)}</blockquote>` : ''}</article>`).join('');
    $('txAskNote').innerHTML = `${esc(P.note || '')}${(P.searched || []).length ? ` Documents cherchés sans succès ou introuvables en ligne : ${P.searched.map(d => d.url ? link(d.url, d.title) : esc(d.title)).join(' ; ')}.` : ''}`;

    /* ---------- Taxes affected to bodies other than the State budget, and their ceilings (PLF 2024) ---------- */
    const A = data.affected;
    if (A) {
      const [y22, , y24] = A.years;
      $('txAffKpis').innerHTML = [
        ['Taxes affectées, ligne par bénéficiaire', String(A.rows.length), `${A.taxes} taxes, ${A.beneficiaries} bénéficiaires (Sécurité sociale, collectivités, agences, chambres…)`],
        ['Produit prévu en 2024', meur(y24.yield), `somme des ${y24.rows} lignes chiffrées du fichier, CSG et fractions de TVA comprises ; ${meur(y22.yield)} en 2022`],
        ['Lignes plafonnées en 2024', String(y24.capped), `pour un plafond total de ${meur(y24.cap)} et un produit prévu de ${meur(y24.cappedYield)}`],
        ['Repris par l’État au-delà du plafond', meur(y24.back), `prévu en 2024 sur ${y24.over} lignes ; ${meur(y22.back)} en 2022 (exécution, ${y22.over} lignes)`]
      ].map(([a, b, c]) => `<div class="kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join('');
      hbars($('txAffSectors'), A.sectors.map(s => ({ label: s.name, sub: `${s.rows} lignes${s.capped ? `, dont ${s.capped} plafonnées` : ', aucune plafonnée'}${s.back ? ` · ${meur(s.back)} repris par l’État` : ''}`, value: s.yield })), { format: meur });
      const over = A.rows.filter(r => r.back[2] > 0).sort((a, b) => b.back[2] - a.back[2]);
      hbars($('txAffBack'), over.slice(0, 12).map(r => ({ label: r.tax.length > 70 ? `${r.tax.slice(0, 68).replace(/\s+\S*$/, '')}…` : r.tax, sub: `${esc(r.beneficiary)} · produit ${meur(r.y[2])}, plafond ${meur(r.cap[2])}`, value: r.back[2] })), { format: meur });
      $('txAffBackNote').textContent = `${over.length} lignes dépassent leur plafond en 2024 (prévision) ; les douze plus grosses reprises sont affichées. Montants prévus par le projet de loi de finances pour 2024.`;
      [...new Set(A.rows.map(r => r.sector))].sort((a, b) => a.localeCompare(b, 'fr')).forEach(v => $('txAffSector').insertAdjacentHTML('beforeend', `<option>${esc(v)}</option>`));
      let affKey = 'y2', affDir = -1, affAll = false;
      const AFF_COLS = [['tax', 'Taxe'], ['beneficiary', 'Bénéficiaire'], ['y0', 'Produit 2022', 'num'], ['y2', 'Produit 2024', 'num'], ['cap2', 'Plafond 2024', 'num'], ['back2', 'Repris par l’État 2024', 'num'], ['since', 'Plafonnée depuis']];
      const affVal = (r, k) => k === 'tax' || k === 'beneficiary' || k === 'since' ? r[k] || null : r[{ y: 'y', cap: 'cap', back: 'back' }[k.replace(/\d$/, '')]][Number(k.slice(-1))];
      const drawAff = () => {
        const q = norm($('txAffSearch').value), sec = $('txAffSector').value, mode = $('txAffMode').value;
        let rows = A.rows.filter(r => (!q || norm(`${r.tax} ${r.beneficiary} ${r.mission || ''}`).includes(q)) && (!sec || r.sector === sec)
          && (mode === '' || (mode === 'capped' ? r.cap[2] != null : r.back[2] > 0)));
        rows.sort((a, b) => { const va = affVal(a, affKey), vb = affVal(b, affKey); if (va == null || vb == null) return (va == null) - (vb == null); return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr')) * affDir; });
        const total = rows.length;
        if (!affAll) rows = rows.slice(0, 15);
        const cell = v => v == null ? '<td class="num muted">–</td>' : `<td class="num">${meur(v)}</td>`;
        $('txAffTable').innerHTML = `<table class="data-table tx-table tx-aff"><thead><tr>${AFF_COLS.map(([k, label, cls]) => `<th${cls ? ` class="${cls}"` : ''} data-sort="${k}" aria-sort="${affKey === k ? (affDir > 0 ? 'ascending' : 'descending') : 'none'}">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><td class="tx-namecell"><span class="tx-name">${esc(r.tax)}</span></td><td>${esc(r.beneficiary)}<br><span class="muted">${esc(r.sector)}</span></td>${cell(r.y[0])}${cell(r.y[2])}${r.cap[2] == null ? '<td class="num muted">sans plafond</td>' : cell(r.cap[2])}${r.cap[2] == null ? '<td class="num muted">–</td>' : `<td class="num${r.back[2] > 0 ? ' tx-aff-back' : ''}">${meur(r.back[2])}</td>`}<td class="muted">${esc(r.since || '')}</td></tr>`).join('')}</tbody></table>${total > rows.length ? `<div class="tx-more"><button type="button" id="txAffAll">Afficher les ${total} lignes</button></div>` : ''}`;
        $('txAffAll')?.addEventListener('click', () => { affAll = true; drawAff(); });
      };
      ['input', 'change'].forEach(ev => ['txAffSearch', 'txAffSector', 'txAffMode'].forEach(id => $(id).addEventListener(ev, () => { affAll = false; drawAff(); })));
      $('txAffTable').addEventListener('click', event => {
        const th = event.target.closest('th[data-sort]'); if (!th) return;
        const k = th.dataset.sort; affDir = affKey === k ? -affDir : (/\d$/.test(k) ? -1 : 1); affKey = k; drawAff();
      });
      drawAff();
      $('txAffNote').innerHTML = `Source : ${link(A.page || A.url, A.title)} (fichier publié le ${esc(A.modified.split('-').reverse().join('/'))}). Produit 2022 : exécution ; 2023 et 2024 : prévisions du projet de loi de finances pour 2024. « Repris par l’État » : reversement au budget général, que le fichier donne et qui vaut toujours le produit moins le plafond quand le produit le dépasse. Le total additionne les lignes du fichier ; une même taxe partagée entre plusieurs bénéficiaires y figure une fois par bénéficiaire, sans double compte. Ce document date de l’automne 2023 : les plafonds ont changé depuis, et la liste des PLF suivants n’est pas publiée dans ce format.`;
    }

    /* ---------- Full table: every tax, curated list and Cour des comptes inventory ---------- */
    const filters = { base: $('txFilterBase'), beneficiary: $('txFilterBeneficiary'), collector: $('txFilterCollector') };
    Object.entries(filters).forEach(([field, el]) => {
      const vals = [...new Set(ALL.map(t => t[field]).filter(Boolean))];
      const order = GROUPS[field].order;
      vals.sort((a, b) => ((order.indexOf(a) + 99) % 99) - ((order.indexOf(b) + 99) % 99) || a.localeCompare(b, 'fr')).forEach(v => el.insertAdjacentHTML('beforeend', `<option>${esc(v)}</option>`));
    });
    [1, 2, 3, 0].forEach(k => $('txFilterScenario').insertAdjacentHTML('beforeend', `<option value="${k}">${esc(SCEN_LABELS[k])}</option>`));
    $('txFilterScenario').insertAdjacentHTML('beforeend', `<option value="none">${esc(SCEN_LABELS[4])}</option>`);
    let sortKey = 'amount', sortDir = -1, showAll = false;
    const maxAmount = Math.max(...counted.map(t => t.amount));
    const COLS = [['name', 'Impôt ou taxe'], ['base', 'Ce qui est taxé'], ['amount', 'Produit', 'num'], ['', ''], ['year', 'Année'], ['beneficiary', 'Qui reçoit'], ['collector', 'Qui collecte'], ['costPct', 'Coût de collecte', 'num'], ['scenario', 'Cour'], ['', 'Source']];
    function drawTable() {
      const q = norm($('txSearch').value), sc = $('txFilterScenario').value, st = $('txFilterState').value;
      let rows = ALL.filter(t => (!q || norm(`${t.name} ${t.acronym || ''} ${t.short || ''} ${t.beneficiaryDetail || ''} ${t.collectorDetail || ''}`).includes(q))
        && Object.entries(filters).every(([f, el]) => !el.value || t[f] === el.value)
        && (sc === '' || (sc === 'none' ? t.scenario == null : String(t.scenario) === sc))
        && (!st || (st === 'active') === t.inForce));
      // Unknown values always sort last, whatever the direction.
      const val = (t, k) => k === 'costPct' ? (t.cost?.pct ?? null) : k === 'amount' ? (t.amount ?? null) : k === 'scenario' ? (t.scenario || null) : t[k] || null;
      rows.sort((a, b) => { const va = val(a, sortKey), vb = val(b, sortKey); if (va == null || vb == null) return (va == null) - (vb == null); return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr')) * sortDir; });
      const total = rows.length, sum = rows.reduce((s, t) => s + (t.inForce && !t.partOf ? t.amount || 0 : 0), 0);
      if (!showAll) rows = rows.slice(0, 60);
      $('txTable').innerHTML = `<table class="data-table tx-table"><thead><tr>${COLS.map(([k, label, cls]) => `<th${cls ? ` class="${cls}"` : ''}${k ? ` data-sort="${k}" aria-sort="${sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}"` : ''}>${label}</th>`).join('')}</tr></thead><tbody>${rows.map(t => `<tr class="${t.partOf ? 'is-sub' : ''}${t.inForce ? '' : ' is-removed'}"><td class="tx-namecell"><button type="button" class="tx-name tx-rowlink" data-id="${esc(t.id)}">${esc(t.name)}</button>${t.acronym ? ` <span class="muted">${esc(t.acronym)}</span>` : ''}${t.note ? `<br><span class="muted">${esc(t.note.length > 90 ? `${t.note.slice(0, 88).replace(/\s+\S*$/, '')}…` : t.note)}</span>` : ''}</td><td><span class="tx-pill"><i style="background:${color('base', t.base)}"></i>${esc(t.base)}</span></td><td class="num">${t.amount == null ? '<span class="muted">inconnu</span>' : `${approx(t)}${meur(t.amount)}${t.check === 'extrait' ? '<sup>*</sup>' : ''}`}</td><td class="tx-bar-cell">${t.amount ? `<span class="tx-minibar" style="width:${Math.max(2, 100 * Math.sqrt(t.amount / maxAmount)).toFixed(1)}%;background:${color('base', t.base)}"></span>` : ''}</td><td class="muted">${esc(t.year)}${t.inForce ? '' : `<br>${esc(t.state)}`}</td><td>${esc(t.beneficiary)}${t.beneficiaryDetail && t.beneficiaryDetail !== t.beneficiary && t.origin === 'cour' ? `<br><span class="muted">${esc(t.beneficiaryDetail.length > 60 ? `${t.beneficiaryDetail.slice(0, 58)}…` : t.beneficiaryDetail)}</span>` : ''}</td><td>${esc(t.collector)}</td><td class="num">${t.cost?.range ? esc(t.cost.range) : t.cost?.pct != null ? pct(t.cost.pct, 2) : t.cost?.meur != null ? meur(t.cost.meur) : '<span class="muted">non publié</span>'}</td><td>${t.scenario ? `<span class="tx-scen s${t.scenario}" title="${esc(SCEN_LABELS[t.scenario])}">${t.scenario}</span>` : ''}</td><td class="tx-src">${link(t.source?.url, t.origin === 'cour' ? 'Cour des comptes' : (t.source?.title || 'source').split(/,| – | \(/)[0])}</td></tr>`).join('')}</tbody></table>${total > rows.length ? `<div class="tx-more"><button type="button" id="txShowAll">Afficher les ${total} lignes</button></div>` : ''}`;
      $('txShowAll')?.addEventListener('click', () => { showAll = true; drawTable(); });
      $('txTableNote').textContent = `${total} ligne${total > 1 ? 's' : ''}${sum ? `, ${meur(sum)} de produit connu (fractions non additionnées)` : ''}. Barre : racine carrée du produit, pour que les petites taxes restent visibles. Lignes en retrait : fraction d’un autre impôt, non additionnée. * Chiffre relevé dans un extrait du document cité, à confirmer ; sans astérisque, lu dans un fichier versionné avec le site (Insee, Cour des comptes, budget de l’État, OFGL). « ≈ », « au plus », « plus de » : estimation, plafond ou plancher. Cour : scénario de la Cour des comptes (1 = revoir dès le budget 2026, 2 = réexaminer d’ici 2027, 3 = rationaliser).`;
    }
    ['input', 'change'].forEach(ev => ['txSearch', 'txFilterBase', 'txFilterBeneficiary', 'txFilterCollector', 'txFilterScenario', 'txFilterState'].forEach(id => $(id).addEventListener(ev, () => { showAll = false; drawTable(); })));
    $('txTable').addEventListener('click', event => {
      const row = event.target.closest('.tx-rowlink');
      if (row) { openDetail(row.dataset.id); return; }
      const th = event.target.closest('th[data-sort]'); if (!th) return;
      const k = th.dataset.sort; sortDir = sortKey === k ? -sortDir : (k === 'amount' || k === 'costPct' ? -1 : 1); sortKey = k; drawTable();
    });
    drawTable();

    $('txSources').innerHTML = [...(data.sources || []), { title: 'Cour des comptes, inventaire des taxes à faible rendement', url: data.lowYield.url }].map(s => link(s.url, `${s.title} ↗`)).join('');
    FRL.keepHash();
  }
})();
