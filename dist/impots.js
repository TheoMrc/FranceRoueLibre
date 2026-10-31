/* Impôts: every tax with its yield, who pays, who receives, who collects, the cost of collection when a public report
   gives it, Insee history 1995-2025, small taxes, tax gaps. One data file: data/impots.json (scripts/taxes-data.mjs).
   Charts are plain SVG strings redrawn on resize; colours come from the --tx-* tokens so the theme switch needs no redraw. */
(() => {
  const { esc, load } = FRL;
  const $ = id => document.getElementById(id);
  const nf = (value, digits = 1) => value.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  /* Amounts are stored in millions of euros. */
  const meur = value => {
    if (value == null || !Number.isFinite(value)) return '–';
    const a = Math.abs(value);
    if (a >= 1000) return `${nf(value / 1000, a >= 100000 ? 0 : 1)} Md€`;
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
  const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  /* Fixed slot per group value (colour follows the entity, never its rank); values outside the list fold into grey. */
  const GROUPS = {
    category: { label: 'Ce qui est taxé', field: 'category', order: ['Consommation', 'Revenus', 'Bénéfices des sociétés', 'Patrimoine et transactions', 'Production et travail', 'Énergie et environnement', 'Santé, alcool, tabac, jeux', 'Taxes sectorielles et affectées'] },
    beneficiary: { label: 'Qui reçoit', field: 'beneficiary', order: ['État', 'Sécurité sociale', 'Collectivités locales', 'Opérateurs et agences', 'Partagé', 'Union européenne'] },
    collector: { label: 'Qui collecte', field: 'collector', order: ['DGFiP', 'Douane (DGDDI)', 'Urssaf', 'Autres collecteurs'] },
    payer: { label: 'Qui paie', field: 'payer', order: ['Ménages', 'Entreprises', 'Ménages et entreprises'] }
  };
  const slot = (group, value) => { const i = GROUPS[group].order.indexOf(value); return i < 0 ? 'other' : String(i + 1); };
  const color = (group, value) => `var(--tx-${slot(group, value)})`;
  const lightText = (group, value) => ['3', '4', '5', 'other'].includes(slot(group, value));

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
    const taxes = data.taxes;
    const population = data.totals.population;
    const insee = data.insee, macro = new Map(data.macro.map(m => [m.year, m]));
    const seriesOf = id => { const line = insee.lines.find(l => l.id === id); return line ? insee.years.map((year, i) => ({ x: year, value: line.values[i] })) : []; };
    // Shown in charts: lines with an amount, minus fractions of another line (they would be counted twice).
    const counted = taxes.filter(t => Number.isFinite(t.amount) && t.amount > 0 && !t.partOf);
    const totalListed = counted.reduce((s, t) => s + t.amount, 0);
    let group = 'category', selected = null;

    /* KPIs */
    const TOT = data.totals;
    $('txKpis').innerHTML = [
      ['Impôts perçus en ' + TOT.year, md(TOT.taxes), `Comptes nationaux Insee (${TOT.status}), hors cotisations sociales`],
      ['Prélèvements obligatoires', pct(TOT.levyRate), `du PIB en ${TOT.year}, cotisations sociales comprises (≈ ${md(TOT.levy)})`],
      ['Par habitant', `${nf(Math.round(TOT.taxes * 1e9 / population), 0)} €`, `d’impôts en ${TOT.year}, hors cotisations`],
      ['Prélèvements listés ici', String(taxes.length), `${counted.length} avec un produit connu ; la Cour des comptes compte à elle seule 243 petites taxes`]
    ].map(([a, b, c]) => `<div class="kpi"><span>${a}</span><strong>${b}</strong><small>${c}</small></div>`).join('');

    /* ---------- Treemap ---------- */
    const treemapEl = $('txTreemap');
    function drawTreemap(W) {
      const H = Math.round(treemapEl.clientHeight || 480);
      const g = GROUPS[group];
      const buckets = new Map();
      counted.forEach(t => { const key = g.order.includes(t[g.field]) ? t[g.field] : 'Autres'; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(t); });
      const groups = [...buckets].map(([key, items]) => ({ key, value: items.reduce((s, t) => s + t.amount, 0), items: items.sort((a, b) => b.amount - a.amount) })).sort((a, b) => b.value - a.value);
      let cells = '';
      squarify(groups, 0, 0, W, H).forEach(gr => {
        squarify(gr.items.map(t => ({ ...t, value: t.amount })), gr.x, gr.y, gr.w, gr.h).forEach(c => {
          const fits = c.w > 64 && c.h > 30, big = c.w > 64 && c.h > 48;
          const maxChars = Math.floor((c.w - 12) / 6.6), name = (c.short || c.name);
          const text = name.length > maxChars ? `${name.slice(0, Math.max(1, maxChars - 1))}…` : name;
          cells += `<g class="tx-cell${lightText(group, c[g.field]) ? ' is-light' : ''}${selected === c.id ? ' is-selected' : ''}" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.name)} : ${esc(meur(c.amount))}"><rect x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" width="${Math.max(0, c.w).toFixed(1)}" height="${Math.max(0, c.h).toFixed(1)}" rx="3" fill="${color(group, c[g.field])}"/>${fits ? `<text x="${(c.x + 7).toFixed(1)}" y="${(c.y + 18).toFixed(1)}">${esc(text)}</text>` : ''}${big ? `<text class="tx-cell__value" x="${(c.x + 7).toFixed(1)}" y="${(c.y + 34).toFixed(1)}">${meur(c.amount)}</text>` : ''}</g>`;
        });
      });
      treemapEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="Impôts et taxes, surface proportionnelle au produit">${cells}</svg>`;
      $('txLegend').innerHTML = groups.map(gr => `<span><i style="background:${gr.key === 'Autres' ? 'var(--tx-other)' : color(group, gr.key)}"></i>${esc(gr.key)} <b>${meur(gr.value)}</b></span>`).join('');
    }
    const byId = id => taxes.find(t => t.id === id);
    treemapEl.addEventListener('pointermove', event => {
      const cell = event.target.closest?.('.tx-cell'); if (!cell) { hideTip(); return; }
      const t = byId(cell.dataset.id);
      showTip(event, `<strong>${esc(t.name)}</strong><span class="tx-tip__value">${meur(t.amount)}</span> · ${pct(100 * t.amount / totalListed)} du total listé<br>${esc(t.year)} · ${esc(t.beneficiary)} · ${esc(t.collector)}`);
    });
    treemapEl.addEventListener('pointerleave', hideTip);
    treemapEl.addEventListener('click', event => { const cell = event.target.closest?.('.tx-cell'); if (!cell) return; select(cell.dataset.id); if (innerWidth <= 960) $('txDetail').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' }); });
    treemapEl.addEventListener('keydown', event => { const cell = event.target.closest?.('.tx-cell'); if (cell && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(cell.dataset.id); } });
    const redrawTreemap = responsive(treemapEl, drawTreemap);
    $('txGroup').addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      group = b.dataset.group;
      $('txGroup').querySelectorAll('button').forEach(n => n.classList.toggle('active', n === b));
      redrawTreemap();
    });
    $('txTreemapNote').textContent = `${counted.length} prélèvements dont le produit est connu, ${meur(totalListed)} au total. Les années et les sources diffèrent d’une ligne à l’autre (voir le tableau) : ce total n’est pas celui des comptes nationaux. Les fractions d’un impôt reversées à un autre bénéficiaire ne sont pas comptées deux fois.`;

    /* ---------- Detail panel ---------- */
    // Without a cost for the tax itself, the overall rate of the administration that collects it, labelled as such.
    const globalRate = t => {
      const c = (data.costs.collectors || []).find(r => !r.focus && r.name.startsWith(t.collector.split(' ')[0]));
      return c ? `<br><span class="muted">Pour l’ensemble des prélèvements qu’elle collecte, l’administration ${esc(t.collector)} dépense ${euros(c.per100)} pour 100 € (${c.year}).</span>` : '';
    };
    const checkNote = t => t.check === 'extrait' ? '<p class="note">Chiffre relevé dans un extrait du document cité : à confirmer sur le document complet.</p>' : '';
    function select(id) {
      selected = id;
      treemapEl.querySelectorAll('.tx-cell').forEach(n => n.classList.toggle('is-selected', n.dataset.id === id));
      const t = byId(id); if (!t) return;
      const per = t.amount ? t.amount * 1e6 / population : null;
      const cost = t.cost;
      $('txDetail').innerHTML = `<span class="tx-pill"><i style="background:${color('category', t.category)}"></i>${esc(t.category)}</span>
        <h3>${esc(t.name)}${t.acronym ? ` <span class="muted">(${esc(t.acronym)})</span>` : ''}</h3>
        <div class="tx-amount">${approx(t)}${meur(t.amount)}</div>
        <p class="note">${esc(t.year)} · ${esc(t.status || '')}${per ? ` · ${euros(per)} par habitant` : ''}${t.amount && !t.partOf ? ` · ${pct(100 * t.amount / totalListed)} du total listé` : ''}</p>
        ${t.insee ? `<div class="tx-spark" id="txSpark"></div><p class="note">Comptes nationaux Insee, ${insee.years[0]}–${insee.years.at(-1)}, Md€</p>` : ''}
        <dl><dt>Qui paie</dt><dd>${esc(t.payer)}</dd><dt>Qui reçoit</dt><dd>${esc(t.beneficiaryDetail || t.beneficiary)}</dd><dt>Qui collecte</dt><dd>${esc(t.collectorDetail || t.collector)}</dd>${t.created ? `<dt>Créé en</dt><dd>${esc(t.created)}</dd>` : ''}
        <dt>Coût de collecte</dt><dd>${cost ? `${cost.pct != null ? `${pct(cost.pct, 2)} du produit` : ''}${cost.meur != null ? `${cost.pct != null ? ' · ' : ''}${meur(cost.meur)}` : ''} <span class="muted">(${esc(cost.year || '')}, ${link(cost.url, cost.title || 'source')})</span>` : `<span class="muted">non publié pour cet impôt</span>${globalRate(t)}`}</dd></dl>
        ${t.partOf ? `<p class="note">Fraction d’un autre impôt de la liste : non comptée une seconde fois dans les graphiques.</p>` : ''}
        ${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}${checkNote(t)}
        <p class="note">Source : ${link(t.source?.url, t.source?.title || 'document')}${t.source?.ref ? ` · ${esc(t.source.ref)}` : ''}</p>`;
      if (t.insee) lineChart($('txSpark'), seriesOf(t.insee), { spark: true, label: `${t.name} depuis 1995` });
    }
    select(counted.slice().sort((a, b) => b.amount - a.amount)[0]?.id);

    /* ---------- Log strip: each tax by order of magnitude ---------- */
    const strip = $('txStrip');
    responsive(strip, W => {
      const cats = GROUPS.category.order.filter(c => counted.some(t => t.category === c));
      const narrow = W < 560, rowH = narrow ? 48 : 34, L = narrow ? 8 : 200, R = 14, T = 8, B = 30, H = T + B + rowH * cats.length;
      const lo = Math.floor(Math.log10(Math.min(...counted.map(t => t.amount)))), hi = Math.ceil(Math.log10(Math.max(...counted.map(t => t.amount))));
      const x = v => L + (W - L - R) * (Math.log10(v) - lo) / (hi - lo);
      let svg = '';
      for (let p = lo; p <= hi; p++) svg += `<line class="tx-grid" x1="${x(10 ** p)}" x2="${x(10 ** p)}" y1="${T}" y2="${H - B}"/><text class="tx-tick" x="${x(10 ** p)}" y="${H - 10}" text-anchor="middle">${meur(10 ** p).replace(' ', ' ')}</text>`;
      svg += `<line class="tx-ref" x1="${x(175)}" x2="${x(175)}" y1="${T}" y2="${H - B}"/>`;
      cats.forEach((c, i) => {
        const cy = T + rowH * i + rowH / 2 + (narrow ? 8 : 0);
        if (!narrow) svg += `<text class="tx-label tx-label--muted" x="${L - 12}" y="${cy + 4}" text-anchor="end">${esc(c)}</text>`;
        svg += `<line class="tx-axis" x1="${L}" x2="${W - R}" y1="${cy}" y2="${cy}" opacity=".25"/>`;
        // Spread overlapping dots vertically within the row.
        const placed = [];
        counted.filter(t => t.category === c).sort((a, b) => b.amount - a.amount).forEach(t => {
          const cx = x(t.amount); let dy = 0;
          for (const k of [0, -7, 7, -14, 14]) { if (!placed.some(p => Math.abs(p.x - cx) < 9 && p.dy === k)) { dy = k; break; } }
          placed.push({ x: cx, dy });
          svg += `<circle class="tx-dot" data-id="${esc(t.id)}" cx="${cx.toFixed(1)}" cy="${cy + dy}" r="5.5" fill="${color('category', c)}"/>`;
        });
      });
      if (narrow) svg += cats.map((c, i) => `<text class="tx-tick tx-tick--strong" x="${L}" y="${T + rowH * i + 12}">${esc(c)}</text>`).join('');
      svg += `<text class="tx-ref-label" x="${x(175) + 5}" y="${narrow ? H - B - 4 : T + 10}">175 M€</text>`;
      strip.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Produit de chaque impôt sur une échelle logarithmique">${svg}</svg>`;
    });
    strip.addEventListener('pointermove', event => {
      const dot = event.target.closest?.('.tx-dot'); if (!dot) { hideTip(); return; }
      const t = byId(dot.dataset.id);
      showTip(event, `<strong>${esc(t.name)}</strong><span class="tx-tip__value">${meur(t.amount)}</span><br>${esc(t.year)} · ${esc(t.category)}`);
    });
    strip.addEventListener('pointerleave', hideTip);
    strip.addEventListener('click', event => { const dot = event.target.closest?.('.tx-dot'); if (dot) { select(dot.dataset.id); $('ensemble').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); } });
    const small = counted.filter(t => t.amount < 175);
    $('txStripNote').textContent = `Ligne orange : 175 M€, seuil retenu par la Cour des comptes (2025) pour les « taxes à faible rendement » ; elle en compte 243. ${small.length} prélèvements de cette liste sont en dessous, pour ${meur(small.reduce((s, t) => s + t.amount, 0))} au total. Cliquez sur un point pour son détail.`;

    /* ---------- Pareto ---------- */
    const ranked = counted.slice().sort((a, b) => b.amount - a.amount);
    let run = 0; const cumulative = ranked.map(t => { run += t.amount; return { t, share: 100 * run / totalListed }; });
    const firstAt = s => cumulative.findIndex(c => c.share >= s) + 1;
    const pareto = $('txPareto');
    responsive(pareto, W => {
      const H = 260, L = 44, R = 16, T = 12, B = 30, n = cumulative.length;
      const x = i => L + (W - L - R) * (i / Math.max(1, n - 1)), y = v => T + (H - T - B) * (1 - v / 100);
      let svg = '';
      for (let v = 0; v <= 100; v += 25) svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v} %</text>`;
      [1, 10, 20, 50, 100].filter(k => k <= n).forEach(k => { svg += `<text class="tx-tick" x="${x(k - 1)}" y="${H - 8}" text-anchor="middle">${k}</text>`; });
      const d = cumulative.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c.share).toFixed(1)}`).join('');
      svg += `<path class="tx-line-area" d="${d}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z"/><path class="tx-line-path" d="${d}"/>`;
      [80, 95].forEach(s => { const k = firstAt(s); if (k > 0) { const cx = x(k - 1), cy = y(cumulative[k - 1].share); svg += `<circle class="tx-focus" cx="${cx}" cy="${cy}" r="4.5"/><text class="tx-label" x="${cx + 8}" y="${cy + 16}">${k} impôts = ${s} %</text>`; } });
      pareto.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Part cumulée des recettes selon le nombre d’impôts">${svg}<g class="tx-hover"></g><rect class="tx-hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/></svg>`;
      const hit = pareto.querySelector('.tx-hit'), hover = pareto.querySelector('.tx-hover');
      hit.addEventListener('pointermove', event => {
        const box = pareto.querySelector('svg').getBoundingClientRect(), mx = (event.clientX - box.left) * W / box.width;
        const i = Math.max(0, Math.min(n - 1, Math.round((mx - L) / (W - L - R) * (n - 1)))), c = cumulative[i];
        hover.innerHTML = `<line class="tx-cursor" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/><circle class="tx-focus" cx="${x(i)}" cy="${y(c.share)}" r="5"/>`;
        showTip(event, `<strong>${i + 1}<sup>e</sup> : ${esc(c.t.name)}</strong>${meur(c.t.amount)}<br>Les ${i + 1} premiers : <span class="tx-tip__value">${pct(c.share)}</span>`);
      });
      hit.addEventListener('pointerleave', () => { hover.innerHTML = ''; hideTip(); });
    });
    $('txParetoNote').textContent = `Impôts classés du plus gros au plus petit (axe horizontal : rang). Les ${Math.min(5, cumulative.length)} premiers (${ranked.slice(0, 5).map(t => t.short || t.name).join(', ')}) font ${pct(cumulative[Math.min(4, cumulative.length - 1)]?.share)} des recettes listées.`;

    hbars($('txTop'), ranked.slice(0, 15).map(t => ({ label: t.name, sub: `${esc(t.year)} · ${esc(t.beneficiary)}`, value: t.amount })), { format: meur });

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
    $('txPerTaxCost').innerHTML = perTax.length ? `<table class="data-table"><thead><tr><th>Impôt</th><th class="num">Coût</th><th class="num">En % du produit</th><th>Année</th><th>Remarque</th><th>Source</th></tr></thead><tbody>${perTax.map(r => `<tr><td class="tx-name">${esc(r.tax)}</td><td class="num">${meur(r.meur)}</td><td class="num">${r.pct != null ? pct(r.pct, 2) : '–'}</td><td>${esc(r.year || '')}</td><td class="muted">${esc(r.note || '')}${r.uncertain ? ' Valeur lue dans un tableau mal extrait : à confirmer.' : ''}</td><td class="tx-src">${link(r.url, r.title || 'source')}</td></tr>`).join('')}</tbody></table>` : '<p class="tx-empty">Aucun coût par impôt publié trouvé.</p>';
    $('txPerTaxCostNote').textContent = C.perTaxNote || '';

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
          svg += narrow ? `<text class="tx-tick tx-tick--strong" x="${L}" y="${cy - 12}">${esc(r.name)} (${esc(r.year)})</text>` : `<text class="tx-label" x="${L - 12}" y="${cy + 4}" text-anchor="end">${esc(r.name)} <tspan class="tx-label--muted">${esc(r.year)}</tspan></text>`;
          svg += `<line class="tx-axis" x1="${x(10 ** lo)}" x2="${cx}" y1="${cy}" y2="${cy}"/><circle class="tx-dot" data-i="${i}" cx="${cx.toFixed(1)}" cy="${cy}" r="6" fill="${r.per100 >= 5 ? 'var(--tx-8)' : 'var(--tx-1)'}"/><text class="tx-label" x="${cx + 10}" y="${cy + 4}">${nf(r.per100, r.per100 < 1 ? 2 : 1)} €</text>`;
        });
        dotsEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Coût de collecte pour 100 euros perçus, échelle logarithmique">${svg}</svg>`;
      });
      dotsEl.addEventListener('pointermove', event => {
        const dot = event.target.closest?.('.tx-dot'); if (!dot) { hideTip(); return; }
        const r = dots[Number(dot.dataset.i)];
        showTip(event, `<strong>${esc(r.name)}</strong><span class="tx-tip__value">${nf(r.per100, 2)} € pour 100 € perçus</span><br>${esc(r.year)}${r.yield ? ` · rendement ${meur(r.yield)}` : ''}`);
      });
      dotsEl.addEventListener('pointerleave', hideTip);
      $('txCostDotsNote').innerHTML = `Échelle logarithmique : chaque graduation multiplie le coût par dix. En rouge, plus de 5 € pour 100 €. Sources : ${[...new Map(dots.map(r => [r.url, r])).values()].map((r, i) => link(r.url, `[${i + 1}]`)).join(' ')}. Les coûts sont ceux du rapport cité, à sa date ; certaines taxes ont depuis été supprimées ou réformées. Aucun rapport public récent trouvé ne chiffre une taxe dont la collecte coûterait plus qu’elle ne rapporte : le cas le plus cité, la taxe sur les appareils automatiques (flippers, jeux vidéo), qui rapportait quelques centaines de milliers d’euros (${link('https://www.vie-publique.fr/files/rapport/pdf/174000418.pdf', 'IGF, 2014')}), a été supprimée en 2015 (${link('https://www.senat.fr/questions/base/2015/qSEQ150114502.html', 'Sénat')}) sans que son coût de gestion ait été publié.`;
    } else dotsEl.innerHTML = '<p class="tx-empty">Aucun coût publié.</p>';
    $('txCounts').innerHTML = (data.counts || []).map(c => `<div class="tx-count"><strong>${esc(c.value)}</strong><p>${esc(c.text)}</p>${link(c.url, c.title || 'source')}</div>`).join('');

    /* ---------- Gaps ---------- */
    const gaps = C.gaps || [];
    $('txGapKpis').innerHTML = gaps.filter(g => g.kpi).map(g => `<div class="kpi"><span>${esc(g.label)}</span><strong>${esc(g.kpi)}</strong><small>${esc(g.sub || '')}</small></div>`).join('');
    $('txGapList').innerHTML = gaps.map(g => `<article class="gap"><h3>${esc(g.label)}</h3><p>${esc(g.text)}</p><p class="note">${link(g.url, g.title || 'source')}</p></article>`).join('') || '<p class="tx-empty">Aucune estimation officielle trouvée.</p>';

    /* ---------- Full table ---------- */
    const filters = { category: $('txFilterCategory'), beneficiary: $('txFilterBeneficiary'), collector: $('txFilterCollector') };
    Object.entries(filters).forEach(([field, el]) => { [...new Set(taxes.map(t => t[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')).forEach(v => el.insertAdjacentHTML('beforeend', `<option>${esc(v)}</option>`)); el.addEventListener('change', drawTable); });
    let sortKey = 'amount', sortDir = -1, showAll = false;
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    $('txSearch').addEventListener('input', drawTable);
    const maxAmount = Math.max(...counted.map(t => t.amount));
    const COLS = [['name', 'Impôt'], ['category', 'Catégorie'], ['amount', 'Produit', 'num'], ['', ''], ['year', 'Année'], ['beneficiary', 'Bénéficiaire'], ['collector', 'Collecteur'], ['costPct', 'Coût de collecte', 'num'], ['', 'Source']];
    function drawTable() {
      const q = norm($('txSearch').value);
      let rows = taxes.filter(t => (!q || norm(`${t.name} ${t.acronym || ''} ${t.short || ''}`).includes(q)) && Object.entries(filters).every(([f, el]) => !el.value || t[f] === el.value));
      const val = (t, k) => k === 'costPct' ? (t.cost?.pct ?? -1) : k === 'amount' ? (t.amount ?? -1) : t[k];
      rows.sort((a, b) => { const va = val(a, sortKey), vb = val(b, sortKey); return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va || '').localeCompare(String(vb || ''), 'fr')) * sortDir; });
      const total = rows.length; if (!showAll) rows = rows.slice(0, 60);
      $('txTable').innerHTML = `<table class="data-table tx-table"><thead><tr>${COLS.map(([k, label, cls]) => `<th${cls ? ` class="${cls}"` : ''}${k ? ` data-sort="${k}" aria-sort="${sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}"` : ''}>${label}</th>`).join('')}</tr></thead><tbody>${rows.map(t => `<tr class="${t.partOf ? 'is-sub' : ''}"><td><button type="button" class="tx-name tx-rowlink" data-id="${esc(t.id)}">${esc(t.name)}</button>${t.acronym ? ` <span class="muted">${esc(t.acronym)}</span>` : ''}${t.note ? `<br><span class="muted">${esc(t.note.length > 110 ? `${t.note.slice(0, 108)}…` : t.note)}</span>` : ''}</td><td><span class="tx-pill"><i style="background:${color('category', t.category)}"></i>${esc(t.category)}</span></td><td class="num">${t.amount == null ? '<span class="muted">non trouvé</span>' : `${approx(t)}${meur(t.amount)}${t.check === 'extrait' ? '<sup>*</sup>' : ''}`}</td><td class="tx-bar-cell">${t.amount ? `<span class="tx-minibar" style="width:${Math.max(2, 100 * Math.sqrt(t.amount / maxAmount)).toFixed(1)}%;background:${color('category', t.category)}"></span>` : ''}</td><td class="muted">${esc(t.year)}${t.status ? `<br>${esc(t.status)}` : ''}</td><td>${esc(t.beneficiary)}</td><td>${esc(t.collector)}</td><td class="num">${t.cost?.pct != null ? pct(t.cost.pct, 2) : t.cost?.meur != null ? meur(t.cost.meur) : '<span class="muted">non publié</span>'}</td><td class="tx-src">${link(t.source?.url, t.source?.title || 'source')}</td></tr>`).join('')}</tbody></table>${total > rows.length ? `<div class="tx-more"><button type="button" id="txShowAll">Afficher les ${total} lignes</button></div>` : ''}`;
      $('txShowAll')?.addEventListener('click', () => { showAll = true; drawTable(); });
      $('txTableNote').textContent = `${total} ligne${total > 1 ? 's' : ''}. Cliquez sur un nom pour sa fiche complète. Barre : racine carrée du produit (pour que les petites taxes restent visibles). Lignes en retrait : fraction d’un autre impôt, non additionnée. * Chiffre relevé dans un extrait du document cité, à confirmer sur le document complet ; sans astérisque : lu dans le fichier Insee versionné. « ≈ », « au plus », « plus de » : estimation, plafond ou plancher, pas un montant encaissé.`;
    }
    $('txTable').addEventListener('click', event => {
      const row = event.target.closest('.tx-rowlink');
      if (row) { select(row.dataset.id); $('txDetail').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); return; }
      const th = event.target.closest('th[data-sort]'); if (!th) return;
      const k = th.dataset.sort; sortDir = sortKey === k ? -sortDir : (k === 'amount' || k === 'costPct' ? -1 : 1); sortKey = k; drawTable();
    });
    drawTable();

    $('txSources').innerHTML = (data.sources || []).map(s => link(s.url, `${s.title} ↗`)).join('');
    FRL.keepHash();
  }
})();
