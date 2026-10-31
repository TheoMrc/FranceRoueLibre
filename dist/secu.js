/* Sécurité sociale: national accounts context, branch accounts (2009-2010), health insurance spending by
   region (January-July 2012), and what the Assurance maladie series files contain.
   Charts are SVG strings redrawn on resize; colours come from the --tx-* tokens of style.css. */
(() => {
  const { esc, load } = FRL;
  const $ = id => document.getElementById(id);
  const nf = (v, d = 0) => v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
  const md = (v, d = 1) => `${nf(v, d)} Md€`;
  const mdFromM = (v, d = 1) => v == null ? '–' : md(v / 1000, d);
  const signed = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v));
  const pctS = (v, d = 1) => `${nf(v, d)} %`;
  const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
  const kpi = (label, value, sub, alert) => `<div class="kpi${alert ? ' is-alert' : ''}"><span>${esc(label)}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;

  /* Tooltip shared by every chart (same look as the taxes page). */
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

  function responsive(el, draw) {
    let width = 0;
    const run = force => { const w = Math.round(el.clientWidth); if (w && (force || w !== width)) { width = w; draw(w); } };
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => run()).observe(el);
    run();
    return () => run(true);
  }
  const niceStep = range => { const raw = range / 5, mag = 10 ** Math.floor(Math.log10(raw || 1)), n = raw / mag; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag; };
  function chips(el, items, active, onPick) {
    el.innerHTML = items.map(it => `<button type="button" data-v="${esc(it.id)}"${it.id === active ? ' class="active"' : ''}>${esc(it.label)}</button>`).join('');
    el.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      el.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      onPick(b.dataset.v);
    });
  }
  function hbars(el, rows, { format = v => nf(v), max = null } = {}) {
    const top = max ?? Math.max(...rows.map(r => Math.abs(r.value || 0)), 1e-9);
    el.innerHTML = `<ul class="tx-bars">${rows.map(r => `<li class="${r.focus ? 'is-focus' : ''}"><div class="tx-bars__line"><span>${esc(r.label)}${r.sub ? `<small>${r.sub}</small>` : ''}</span><strong>${format(r.value)}</strong></div><span class="tx-bars__track" aria-hidden="true"><span class="tx-bars__fill" style="--w:${(100 * Math.abs(r.value || 0) / top).toFixed(2)}%${r.color ? `;background:${r.color}` : ''}"></span></span></li>`).join('')}</ul>`;
    requestAnimationFrame(() => el.querySelectorAll('.tx-bars__fill').forEach(n => { n.style.width = n.style.getPropertyValue('--w'); }));
  }

  /* ---------- Multi-series line chart with a shared hover ---------- */
  function lines(el, series, { height = 280, format = v => nf(v), tick = format, label = '' } = {}) {
    return responsive(el, W => {
      const H = W < 520 ? 230 : height, L = 58, R = 14, T = 14, B = 26;
      const all = series.flatMap(s => s.points.filter(p => Number.isFinite(p.value)));
      if (!all.length) { el.innerHTML = '<p class="tx-empty">Série indisponible.</p>'; return; }
      const xs = all.map(p => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
      let lo = Math.min(0, ...all.map(p => p.value)), hi = Math.max(...all.map(p => p.value));
      const step = niceStep(hi - lo || 1); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
      const x = v => L + (W - L - R) * (v - x0) / ((x1 - x0) || 1), y = v => T + (H - T - B) * (1 - (v - lo) / ((hi - lo) || 1));
      let svg = '';
      for (let v = lo; v <= hi + step / 2; v += step) svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${tick(v)}</text>`;
      const every = [1, 2, 5, 10, 20].find(k => (W - L - R) / ((x1 - x0) / k) >= 44) || 20;
      for (let v = Math.ceil(x0 / every) * every; v <= x1; v += every) svg += `<text class="tx-tick" x="${x(v)}" y="${H - 6}" text-anchor="middle">${v}</text>`;
      series.forEach(s => {
        const pts = s.points.filter(p => Number.isFinite(p.value));
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
        svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="5 4"' : ''}/>`;
      });
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${svg}<g class="tx-hover"></g><rect class="tx-hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/></svg>`;
      const hover = el.querySelector('.tx-hover'), hit = el.querySelector('.tx-hit');
      const years = [...new Set(xs)].sort((a, b) => a - b);
      hit.addEventListener('pointermove', event => {
        const box = el.querySelector('svg').getBoundingClientRect(), mx = (event.clientX - box.left) * W / box.width;
        const yr = years.reduce((b, q) => Math.abs(x(q) - mx) < Math.abs(x(b) - mx) ? q : b, years[0]);
        const rows = series.map(s => ({ s, p: s.points.find(p => p.x === yr) })).filter(r => r.p && Number.isFinite(r.p.value));
        hover.innerHTML = `<line class="tx-cursor" x1="${x(yr)}" x2="${x(yr)}" y1="${T}" y2="${H - B}"/>${rows.map(r => `<circle cx="${x(yr)}" cy="${y(r.p.value)}" r="4.5" fill="var(--c-bg)" stroke="${r.s.color}" stroke-width="2.5"/>`).join('')}`;
        showTip(event, `<strong>${yr}</strong><table>${rows.map(r => `<tr><td><i style="background:${r.s.color}"></i>${esc(r.s.name)}</td><td>${format(r.p.value)}</td></tr>`).join('')}</table>`);
      });
      hit.addEventListener('pointerleave', () => { hover.innerHTML = ''; hideTip(); });
    });
  }

  /* ---------- Vertical columns around zero (annual balance) ---------- */
  function columns(el, points, { height = 200, format = v => nf(v), label = '' } = {}) {
    return responsive(el, W => {
      const H = W < 520 ? 180 : height, L = 58, R = 14, T = 12, B = 26;
      let lo = Math.min(0, ...points.map(p => p.value)), hi = Math.max(0, ...points.map(p => p.value));
      const step = niceStep(hi - lo || 1); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
      const n = points.length, bw = (W - L - R) / n, y = v => T + (H - T - B) * (1 - (v - lo) / ((hi - lo) || 1));
      let svg = '';
      for (let v = lo; v <= hi + step / 2; v += step) svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${nf(v)}</text>`;
      const every = [1, 2, 5, 10, 20].find(k => bw * k >= 44) || 20;
      points.forEach((p, i) => {
        const x = L + i * bw, top = y(Math.max(0, p.value)), h = Math.abs(y(p.value) - y(0));
        svg += `<rect class="sc-col" data-i="${i}" x="${(x + bw * .12).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, bw * .76).toFixed(1)}" height="${Math.max(.5, h).toFixed(1)}" fill="${p.value < 0 ? 'var(--tx-8)' : 'var(--tx-3)'}" rx="1"/>`;
        if (p.x % every === 0) svg += `<text class="tx-tick" x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${p.x}</text>`;
      });
      svg += `<line class="tx-axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${svg}<rect class="tx-hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/></svg>`;
      const hit = el.querySelector('.tx-hit');
      hit.addEventListener('pointermove', event => {
        const box = el.querySelector('svg').getBoundingClientRect(), mx = (event.clientX - box.left) * W / box.width;
        const i = Math.max(0, Math.min(n - 1, Math.floor((mx - L) / bw)));
        el.querySelectorAll('.sc-col').forEach(r => r.classList.toggle('is-dim', +r.dataset.i !== i));
        showTip(event, `<strong>${points[i].x}</strong><span class="tx-tip__value">${format(points[i].value)}</span>`);
      });
      hit.addEventListener('pointerleave', () => { el.querySelectorAll('.sc-col').forEach(r => r.classList.remove('is-dim')); hideTip(); });
    });
  }

  /* ---------- 1. Context: national accounts ---------- */
  function initContext(ctx) {
    const rows = ctx.years, last = rows.at(-1);
    const perHab = (r, k) => r.population ? r[k] * 1e9 / r.population : null;
    $('scCtxKpis').innerHTML = [
      kpi(`Dépenses ${last.year}`, md(last.spending), 'administrations de sécurité sociale'),
      kpi('Part des dépenses publiques', pctS(100 * last.shareOfApu), `en ${last.year}, toutes administrations publiques`),
      kpi(`Par habitant, ${last.year}`, `${nf(perHab(last, 'spending'))} €`, 'dépenses divisées par la population au 1er janvier'),
      kpi(`Solde ${last.year}`, signed(last.balance, v => md(v)), 'recettes moins dépenses', last.balance < 0),
    ].join('');
    let unit = 'md';
    const draw = () => {
      const cfg = {
        md: { title: 'Dépenses et recettes, en milliards d’euros courants', series: [['Dépenses', 'spending', 'var(--tx-2)'], ['Recettes', 'revenue', 'var(--tx-1)']], val: (r, k) => r[k], format: v => md(v), tick: v => nf(v) },
        hab: { title: 'Dépenses et recettes par habitant, en euros courants', series: [['Dépenses par habitant', 'spending', 'var(--tx-2)'], ['Recettes par habitant', 'revenue', 'var(--tx-1)']], val: perHab, format: v => `${nf(v)} €`, tick: v => nf(v) },
        share: { title: 'Part des administrations de sécurité sociale dans les dépenses publiques, en %', series: [['Part des dépenses publiques', 'share', 'var(--tx-7)']], val: r => 100 * r.shareOfApu, format: v => pctS(v), tick: v => `${nf(v)} %` },
      }[unit];
      $('scCtxTitle').textContent = cfg.title;
      lines($('scCtxChart'), cfg.series.map(([name, k, color]) => ({ name, color, points: rows.map(r => ({ x: r.year, value: cfg.val(r, k) })) })), { format: cfg.format, tick: cfg.tick, label: cfg.title });
      $('scCtxLegend').innerHTML = cfg.series.map(([name, , color]) => `<span><i style="background:${color}"></i>${esc(name)}</span>`).join('');
      $('scCtxNote').innerHTML = `${esc(ctx.note)} ${unit === 'hab' ? 'Population au 1er janvier (Insee), disponible depuis 1982, Mayotte comprise à partir de 2014. ' : ''}Les dépenses des administrations publiques additionnent celles des sous-secteurs sans consolider les transferts entre eux. Source : ${link(ctx.url, `Insee, comptes de la Nation, tableau ${ctx.table} (publié le ${new Date(ctx.publication).toLocaleDateString('fr-FR')})`)}${unit === 'hab' ? ` ; ${link(ctx.populationUrl, 'Insee, population au 1er janvier')}` : ''}.`;
    };
    $('scCtxUnit').addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      $('scCtxUnit').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      unit = b.dataset.unit; draw();
    });
    draw();
    columns($('scCtxBalance'), rows.map(r => ({ x: r.year, value: r.balance })), { format: v => signed(v, x => md(x)), label: 'Solde annuel des administrations de sécurité sociale' });
    const deficits = rows.filter(r => r.balance < 0).length;
    $('scCtxBalanceNote').innerHTML = `Solde en déficit ${deficits} années sur ${rows.length} entre ${rows[0].year} et ${last.year}. Plus bas : ${signed(Math.min(...rows.map(r => r.balance)), x => md(x))} en ${rows.find(r => r.balance === Math.min(...rows.map(q => q.balance))).year}. Le solde inclut les excédents des régimes complémentaires et de la Cades, qui amortit la dette sociale. Source : ${link(ctx.url, `Insee, tableau ${ctx.table}`)}.`;
  }

  /* ---------- 2 & 3. Branch accounts ---------- */
  function initAccounts(acc) {
    const by = Object.fromEntries(acc.lines.map(l => [l.id, l]));
    const branches = acc.branches.slice(0, 4), totalIdx = 4;
    const src = acc.source, xlsUrl = src.files[0].url;
    const srcLinks = `Source : ${link(src.page, 'Comptes simplifiés des régimes de base de sécurité sociale (data.gouv.fr)')}, ${link(xlsUrl, 'fichier .xls')}`;
    let scope = 'tous', yi = acc.years.length - 1, detail = false;
    const v = (id, b, s = scope) => by[id][s][yi][b];
    chips($('scScope'), acc.scopes, scope, x => { scope = x; draw(); });
    chips($('scYear'), acc.years.map((y, i) => ({ id: String(i), label: String(y) })), String(yi), x => { yi = +x; draw(); });
    $('scDetail').addEventListener('change', event => { detail = event.target.checked; drawTable(); });
    $('scCheckText').textContent = `Pour chaque branche, chaque année et chaque périmètre (${acc.checks} contrôles), la somme des grandes lignes est comparée au total publié, et le solde publié à la différence produits moins charges. Écart maximal constaté : ${nf(acc.maxCheckGap, 1)} M€, dû aux arrondis du fichier.`;

    function drawTable() {
      const cols = [...branches.map((b, i) => ({ label: b.id === 'atmp' ? 'AT-MP' : b.label, get: id => v(id, i) })),
        { label: 'Somme des branches', get: id => branches.reduce((s, _, i) => s + (v(id, i) || 0), 0), cls: 'sc-sum' },
        { label: 'Toutes branches (publié)', get: id => v(id, totalIdx), cls: 'sc-total' }];
      const shown = acc.lines.filter(l => detail || l.level <= 1);
      $('scBrTable').innerHTML = `<table class="data-table sc-acc"><thead><tr><th>Poste, en M€ ${acc.years[yi]}</th>${cols.map(c => `<th class="num ${c.cls || ''}">${esc(c.label)}</th>`).join('')}<th class="num">FSV</th></tr></thead><tbody>${shown.map(l => `<tr class="lvl${l.level}"><td>${esc(l.label)}</td>${cols.map(c => `<td class="num ${c.cls || ''}">${nf(c.get(l.id))}</td>`).join('')}<td class="num muted">${nf(by[l.id].fsv[yi])}</td></tr>`).join('')}</tbody></table>`;
      $('scBrTableNote').innerHTML = `Millions d’euros courants. ${acc.scopes.find(s => s.id === scope).label}, ${acc.years[yi]}. Les lignes en gras sont les totaux ; ${detail ? 'les sous-postes (« dont ») sont en retrait et ne s’ajoutent pas une seconde fois' : 'cochez « Afficher les sous-postes » pour le détail des prestations, de la CSG et des impôts affectés'}. La colonne « Somme des 4 branches » est recalculée ; elle diffère de la colonne publiée « toutes branches » parce que celle-ci retire les transferts entre branches et entre régimes. Le FSV (Fonds de solidarité vieillesse) finance le minimum vieillesse et des cotisations retraite ; il n’est pas une branche. ${srcLinks}.`;
    }

    function draw() {
      const y = acc.years[yi], sl = acc.scopes.find(s => s.id === scope).label;
      const ch = v('charges', totalIdx), pr = v('produits', totalIdx), so = v('solde', totalIdx);
      const sumCh = branches.reduce((s, _, i) => s + v('charges', i), 0);
      $('scBrKpis').innerHTML = [
        kpi(`Charges nettes ${y}`, mdFromM(ch), `${esc(sl)}, toutes branches consolidées`),
        kpi(`Produits nets ${y}`, mdFromM(pr), 'cotisations, CSG, impôts affectés, transferts'),
        kpi(`Solde ${y}`, signed(so, x => mdFromM(x)), 'produits moins charges', so < 0),
        kpi('Flux entre branches retirés', mdFromM(sumCh - ch), `somme des 4 branches : ${mdFromM(sumCh)} de charges`),
      ].join('');
      const max = Math.max(...acc.branches.map((_, i) => Math.max(v('charges', i), v('produits', i))));
      $('scBrBarsTitle').textContent = `Charges et produits par branche, ${y}`;
      $('scBrBars').innerHTML = acc.branches.map((b, i) => `<div class="sc-pair${i === totalIdx ? ' is-total' : ''}"><div class="sc-pair__head"><span>${esc(b.label)}</span><small>${mdFromM(v('charges', i))} / ${mdFromM(v('produits', i))}</small></div><span class="sc-pair__bar" style="--w:${(100 * v('charges', i) / max).toFixed(2)}%;--c:var(--tx-2)"></span><span class="sc-pair__bar" style="--w:${(100 * v('produits', i) / max).toFixed(2)}%;--c:var(--tx-1)"></span></div>`).join('');
      requestAnimationFrame(() => $('scBrBars').querySelectorAll('.sc-pair__bar').forEach(n => n.classList.add('is-in')));
      $('scBrBarsNote').innerHTML = `Milliards d’euros courants, ${esc(sl.toLowerCase())}, ${y}. La branche autonomie n’existait pas encore (créée en 2021) : elle n’apparaît pas dans ces comptes. ${srcLinks}.`;

      const sRows = [...acc.branches.map((b, i) => ({ label: b.label, value: v('solde', i), total: i === totalIdx })), { label: 'FSV (fonds, hors branches)', value: by.solde.fsv[yi], fsv: true }];
      const smax = Math.max(...sRows.map(r => Math.abs(r.value)));
      $('scBrSolde').innerHTML = `<ul class="sc-div">${sRows.map(r => `<li class="${r.total ? 'is-total' : ''}${r.fsv ? ' is-fsv' : ''}"><span class="sc-div__label">${esc(r.label)}</span><span class="sc-div__track"><span class="sc-div__fill ${r.value < 0 ? 'neg' : 'pos'}" style="--w:${(50 * Math.abs(r.value) / smax).toFixed(2)}%"></span></span><strong>${signed(r.value, x => mdFromM(x, 2))}</strong></li>`).join('')}</ul>`;
      requestAnimationFrame(() => $('scBrSolde').querySelectorAll('.sc-div__fill').forEach(n => n.classList.add('is-in')));
      const worst = acc.branches.slice(0, 4).map((b, i) => ({ b, s: v('solde', i) })).sort((a, b) => a.s - b.s)[0];
      $('scBrSoldeNote').innerHTML = `En ${y}, ${acc.branches.slice(0, 4).filter((_, i) => v('solde', i) < 0).length} branches sur 4 sont en déficit ; le plus important est celui de la branche ${esc(worst.b.label.toLowerCase())} (${signed(worst.s, x => mdFromM(x, 2))}). Le FSV est présenté à part : son solde n’est pas compris dans « toutes branches ». ${srcLinks}.`;
      drawTable();
      drawMix();
    }

    const IN = [
      { label: 'Cotisations effectives', ids: ['cotis'], color: 'var(--tx-1)' },
      { label: 'Cotisations fictives et prises en charge', ids: ['cotis_fictives', 'cotis_etat', 'cotis_secu'], color: 'var(--tx-7)' },
      { label: 'CSG nette', ids: ['csg_nette'], color: 'var(--tx-3)' },
      { label: 'Impôts et taxes affectés', ids: ['itaf'], color: 'var(--tx-4)' },
      { label: 'Transferts reçus', ids: ['transferts_pr'], color: 'var(--tx-5)' },
      { label: 'Autres produits', ids: ['pr_fin', 'pr_autres'], color: 'var(--tx-other)' },
    ];
    const OUT = [
      { label: 'Prestations', ids: ['prestations'], color: 'var(--tx-2)' },
      { label: 'Transferts versés', ids: ['transferts_ch'], color: 'var(--tx-5)' },
      { label: 'Gestion courante', ids: ['gestion'], color: 'var(--tx-7)' },
      { label: 'Charges financières et autres', ids: ['ch_fin', 'ch_autres'], color: 'var(--tx-other)' },
    ];
    function stack(el, legendEl, parts, totalId) {
      el.innerHTML = acc.branches.map((b, i) => {
        const total = v(totalId, i);
        const vals = parts.map(p => ({ ...p, value: p.ids.reduce((s, id) => s + (v(id, i) || 0), 0) }));
        return `<div class="sc-stack__row${i === totalIdx ? ' is-total' : ''}"><span class="sc-stack__label">${esc(b.label)}<small>${mdFromM(total)}</small></span><span class="sc-stack__bar">${vals.map(p => p.value > 0 ? `<span style="width:${(100 * p.value / total).toFixed(2)}%;background:${p.color}" data-tip="${esc(`<strong>${esc(b.label)}</strong>${esc(p.label)} : ${mdFromM(p.value, 2)}<br>${nf(100 * p.value / total, 1)} % du total`)}"></span>` : '').join('')}</span></div>`;
      }).join('');
      legendEl.innerHTML = parts.map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)}</span>`).join('');
      el.querySelectorAll('[data-tip]').forEach(n => {
        n.addEventListener('pointermove', event => showTip(event, n.dataset.tip));
        n.addEventListener('pointerleave', hideTip);
      });
    }
    function drawMix() {
      stack($('scMixIn'), $('scMixInLegend'), IN, 'produits');
      stack($('scMixOut'), $('scMixOutLegend'), OUT, 'charges');
      const i = 3, csgShare = v('csg_nette', 0) / v('produits', 0);
      $('scMixNote').innerHTML = `${acc.scopes.find(s => s.id === scope).label}, ${acc.years[yi]}. Survolez ou touchez un segment pour son montant. La CSG représente ${nf(100 * csgShare, 0)} % des produits de la branche maladie, les cotisations ${nf(100 * v('cotis', i) / v('produits', i), 0)} % de ceux de la branche vieillesse. Les « cotisations fictives » sont celles que l’État employeur inscrit pour les retraites de ses fonctionnaires ; elles n’existent qu’en tous régimes. ${srcLinks}.`;
    }
    draw();
    $('scBrSources').innerHTML = `${link(src.page, 'Jeu de données sur data.gouv.fr')}${link(xlsUrl, 'Fichier .xls téléchargé')}`;
  }

  /* ---------- 4. Regions ---------- */
  function initRegions(reg, geo) {
    const posts = reg.posts, fr = reg.france;
    const src = reg.source, xlsUrl = src.files[0].url;
    const srcLinks = `Source : ${link(src.page, 'Dépenses de santé remboursées par l’assurance maladie par région (data.gouv.fr)')}, ${link(xlsUrl, 'fichier .xls')} ; population : ${link(reg.population.url, 'OFGL')}`;
    let post = 'total', unit = 'hab';
    chips($('scRegPost'), posts.map(p => ({ id: p.id, label: p.id === 'etab' ? 'Établissements sanitaires' : p.id === 'medsoc' ? 'Médico-social' : p.label })), post, x => { post = x; draw(); });
    $('scRegUnit').addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      $('scRegUnit').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      unit = b.dataset.unit; draw();
    });
    const val = (r, u = unit) => u === 'hab' ? r.perHab[post] : u === 'amount' ? r.amounts[post] : r.growth[post];
    const fmt = (x, u = unit) => u === 'hab' ? `${nf(x)} €` : u === 'amount' ? FRL.money(x) : `${x > 0 ? '+' : x < 0 ? '−' : ''}${nf(Math.abs(x), 1)} %`;
    const postLabel = () => posts.find(p => p.id === post).label;
    const unitLabel = () => unit === 'hab' ? 'euros remboursés par habitant, janvier à juillet 2012' : unit === 'amount' ? 'montants remboursés, janvier à juillet 2012' : 'évolution par rapport à janvier-juillet 2011, en %';

    /* Map: départements coloured by their 2012 region (equirectangular projection, metropolitan France). */
    const depRegion = {};
    reg.regions.forEach(r => r.deps.forEach(d => { depRegion[d] = r; }));
    const feats = (geo?.features || []).filter(f => depRegion[f.properties.code]);
    const k = Math.cos(46.5 * Math.PI / 180);
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    const rings = f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    feats.forEach(f => rings(f).forEach(poly => poly.forEach(ring => ring.forEach(([lon, lat]) => { bx0 = Math.min(bx0, lon * k); bx1 = Math.max(bx1, lon * k); by0 = Math.min(by0, lat); by1 = Math.max(by1, lat); }))));
    let paint = () => {};
    const redrawMap = responsive($('scMap'), W => {
      if (!feats.length) { $('scMap').innerHTML = '<p class="tx-empty">Fond de carte indisponible : le classement ci-contre donne les mêmes valeurs.</p>'; return; }
      const pad = 6, s = Math.min((W - 2 * pad) / (bx1 - bx0), 1e9), H = Math.round((by1 - by0) * s + 2 * pad);
      const px = lon => pad + (lon * k - bx0) * s, py = lat => pad + (by1 - lat) * s;
      const path = f => rings(f).map(poly => poly.map(ring => `M${ring.map(([lon, lat]) => `${px(lon).toFixed(1)},${py(lat).toFixed(1)}`).join('L')}Z`).join('')).join('');
      /* Region outlines: département edges used once inside a region are its border; edges used twice are internal. */
      const edges = new Map();
      feats.forEach(f => { const rc = depRegion[f.properties.code].code; rings(f).forEach(poly => poly.forEach(ring => ring.forEach((pt, i) => {
        if (!i) return; const a = ring[i - 1].join(','), b = pt.join(','); if (a === b) return;
        const key = `${rc}|${a < b ? `${a}|${b}` : `${b}|${a}`}`, e = edges.get(key);
        if (e) e.n += 1; else edges.set(key, { n: 1, a: ring[i - 1], b: pt });
      }))); });
      const outline = [...edges.values()].filter(e => e.n === 1).map(e => `M${px(e.a[0]).toFixed(1)},${py(e.a[1]).toFixed(1)}L${px(e.b[0]).toFixed(1)},${py(e.b[1]).toFixed(1)}`).join('');
      $('scMap').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Carte des dépenses remboursées par région en 2012">${feats.map(f => `<path class="sc-dep" data-r="${depRegion[f.properties.code].code}" d="${path(f)}"/>`).join('')}<path class="sc-reg-line" d="${outline}"/></svg>`;
      $('scMap').querySelectorAll('.sc-dep').forEach(n => {
        const r = reg.regions.find(x => x.code === n.dataset.r);
        n.addEventListener('pointermove', event => {
          $('scMap').querySelectorAll(`.sc-dep[data-r="${r.code}"]`).forEach(m => m.classList.add('is-hover'));
          showTip(event, `<strong>${esc(r.name)}</strong><span class="tx-tip__value">${fmt(val(r))}</span><br>${esc(postLabel())}<br>${nf(r.population)} habitants (2012)`);
        });
        n.addEventListener('pointerleave', () => { $('scMap').querySelectorAll('.is-hover').forEach(m => m.classList.remove('is-hover')); hideTip(); });
      });
      paint();
    });

    function draw() {
      const rows = reg.regions.map(r => ({ r, value: val(r) })).sort((a, b) => b.value - a.value);
      const values = rows.map(x => x.value), lo = Math.min(...values), hi = Math.max(...values);
      const diverging = unit === 'growth' && lo < 0;
      const m = Math.max(Math.abs(lo), Math.abs(hi));
      const color = x => {
        if (diverging) return `color-mix(in srgb, ${x < 0 ? 'var(--tx-2)' : 'var(--tx-1)'} ${(12 + 80 * Math.abs(x) / m).toFixed(0)}%, var(--c-surface-2))`;
        const t = hi === lo ? 1 : (x - lo) / (hi - lo);
        return `color-mix(in srgb, var(--tx-1) ${(14 + 80 * t).toFixed(0)}%, var(--c-surface-2))`;
      };
      paint = () => $('scMap').querySelectorAll('.sc-dep').forEach(n => { const c = color(val(reg.regions.find(x => x.code === n.dataset.r))); n.style.fill = c; n.style.stroke = c; });
      paint();
      $('scMapTitle').textContent = `${postLabel()} : ${unitLabel()}`;
      $('scMapLegend').innerHTML = diverging
        ? `<span>${fmt(-m)}</span><i style="background:linear-gradient(90deg, color-mix(in srgb, var(--tx-2) 92%, var(--c-surface-2)), var(--c-surface-2), color-mix(in srgb, var(--tx-1) 92%, var(--c-surface-2)))"></i><span>${fmt(m)}</span>`
        : `<span>${fmt(lo)}</span><i style="background:linear-gradient(90deg, color-mix(in srgb, var(--tx-1) 14%, var(--c-surface-2)), color-mix(in srgb, var(--tx-1) 94%, var(--c-surface-2)))"></i><span>${fmt(hi)}</span>`;
      $('scMapNote').innerHTML = `Régions administratives de 2012, dessinées à partir de leurs départements. Survolez ou touchez une région pour sa valeur. ${srcLinks}.`;
      $('scRankTitle').textContent = `Classement, ${unit === 'hab' ? '€ par habitant' : unit === 'amount' ? 'montants' : 'évolution sur un an'}`;
      const frRow = { label: 'France métropolitaine (publié)', value: val(fr), focus: true };
      const list = [...rows.map(x => ({ label: x.r.name, value: x.value, color: unit === 'growth' && x.value < 0 ? 'var(--tx-2)' : null })), frRow].sort((a, b) => b.value - a.value);
      hbars($('scRank'), list, { format: x => fmt(x) });
      const top = rows[0], bottom = rows.at(-1);
      $('scRegKpis').innerHTML = [
        kpi('France métropolitaine', fmt(val(fr)), esc(`${postLabel()}, ${unit === 'growth' ? 'sur un an' : 'janvier à juillet 2012'}`)),
        kpi('Le plus élevé', fmt(top.value), esc(top.r.name)),
        kpi('Le plus bas', fmt(bottom.value), esc(bottom.r.name)),
        unit === 'growth' ? kpi('Écart entre extrêmes', `${nf(top.value - bottom.value, 1)} points`, 'de pourcentage') : kpi('Rapport entre extrêmes', `× ${nf(top.value / bottom.value, 2)}`, 'région la plus haute sur la plus basse'),
      ].join('');
    }

    /* Table: every region, every post, checked against the published national row. */
    const sums = fr.sumOfRegions;
    const cell = (r, p) => `<td class="num">${FRL.money(r.amounts[p])}</td>`;
    $('scRegTable').innerHTML = `<table class="data-table"><thead><tr><th>Région (2012)</th><th class="num">Population</th>${posts.map(p => `<th class="num">${esc({ ville: 'Soins de ville', etab: 'Établissements sanitaires', medsoc: 'Médico-social', total: 'Total' }[p.id])}</th>`).join('')}<th class="num">Total par habitant</th><th class="num">Évolution du total</th></tr></thead><tbody>${[...reg.regions].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(r => `<tr><td>${esc(r.name)}</td><td class="num">${nf(r.population)}</td>${posts.map(p => cell(r, p.id)).join('')}<td class="num">${nf(r.perHab.total)} €</td><td class="num">${fmt(r.growth.total, 'growth')}</td></tr>`).join('')}</tbody><tfoot><tr><td>Somme des 22 régions (recalculée)</td><td class="num">${nf(fr.population)}</td>${posts.map(p => `<td class="num">${FRL.money(sums[p.id])}</td>`).join('')}<td class="num">${nf(fr.perHab.total)} €</td><td class="num">–</td></tr><tr><td>France métropolitaine (publié)</td><td class="num">–</td>${posts.map(p => cell(fr, p.id)).join('')}<td class="num">–</td><td class="num">${fmt(fr.growth.total, 'growth')}</td></tr></tfoot></table>`;
    const gap = Math.max(...posts.map(p => Math.abs(sums[p.id] - fr.amounts[p.id])));
    $('scRegTableNote').innerHTML = `Montants remboursés du 1er janvier au 31 juillet 2012, en euros. La somme des régions recalculée égale la ligne « France métropolitaine » publiée à ${nf(gap)} € près. Les départements d’outre-mer ne figurent pas dans le fichier. Population : ${esc(reg.population.label)}. ${srcLinks}.`;
    $('scRegSources').innerHTML = `${link(src.page, 'Jeu de données sur data.gouv.fr')}${link(xlsUrl, 'Fichier .xls téléchargé')}${link(reg.population.url, 'Population des départements (OFGL)')}`;
    draw();
    return redrawMap;
  }

  /* ---------- 5. Posts and series files ---------- */
  function initPosts(reg, files) {
    const fr = reg.france, total = fr.amounts.total;
    const v = files.ville, c = files.cliniques;
    const years = v.years.map(y => y.year);
    $('scPostLead').innerHTML = `L’Assurance maladie publie chaque année, depuis ${Math.min(...years)}, les montants remboursés en soins de ville (par prestation, par spécialité du professionnel, par taux de remboursement pour les médicaments) et en cliniques privées (par caisse primaire et par type d’établissement). Ces fichiers sont derrière une page de téléchargement à jeton : les liens de data.gouv.fr renvoient une page, pas les données. Ils ne sont donc pas encore chiffrés ici. En attendant, voici les trois grands postes de 2012 et ce que contiennent ces séries.`;
    $('scPostKpis').innerHTML = [
      kpi('Soins de ville', FRL.money(fr.amounts.ville), `${nf(100 * fr.amounts.ville / total, 0)} % des remboursements, janvier à juillet 2012`),
      kpi('Établissements sanitaires', FRL.money(fr.amounts.etab), `${nf(100 * fr.amounts.etab / total, 0)} %, hôpitaux publics et cliniques privées`),
      kpi('Médico-social', FRL.money(fr.amounts.medsoc), `${nf(100 * fr.amounts.medsoc / total, 0)} %, établissements pour personnes âgées et handicapées`),
      kpi('Fichiers annuels à intégrer', nf(v.years.length + c.years.length), `${v.years.length} pour les soins de ville, ${c.years.length} pour les cliniques`),
    ].join('');
    hbars($('scPostBars'), reg.posts.filter(p => p.id !== 'total').map(p => ({ label: p.label, value: fr.amounts[p.id], sub: `${fr.growth[p.id] > 0 ? '+' : ''}${nf(fr.growth[p.id], 1)} % sur un an · ${nf(fr.perHab[p.id])} € par habitant` })), { format: x => FRL.money(x) });
    $('scPostBarsNote').innerHTML = `France métropolitaine, montants remboursés du 1er janvier au 31 juillet 2012. Le fichier ne sépare ni médicaments, ni hôpitaux publics et cliniques privées. Source : ${link(reg.source.page, 'Assurance maladie, dépenses par région (data.gouv.fr)')}.`;
    const groups = v.lists.exe_spe1 || [];
    $('scVilleWhat').innerHTML = `<ul class="sc-facts"><li><strong>${nf(v.counts.serie)}</strong> postes de la « statistique mensuelle » (consultations, visites, actes techniques, médicaments par taux de remboursement, indemnités journalières…)</li><li><strong>${nf(v.counts.prs_nat)}</strong> codes de prestation</li><li><strong>${nf(v.counts.exe_spe)}</strong> spécialités de professionnels, regroupées en <strong>${nf(groups.length)}</strong> catégories :</li></ul><p class="sc-tags">${groups.map(g => `<span class="tag">${esc(g[1])}</span>`).join('')}</p><p class="note">Périmètre indiqué par le descriptif : ${esc(v.perimeter.filter(x => !/^Champ|^Source/.test(x)).join(' ; '))}. Montants remboursés, bases de remboursement et dépassements d’honoraires, par mois de soins et de remboursement. Source : ${link(v.source.page, 'données nationales sur les dépenses de soins de ville (data.gouv.fr)')}, ${link(v.source.files[0].url, 'descriptif des variables')}.</p>`;
    const typeList = c.lists.eta_typ || [];
    $('scCliWhat').innerHTML = `<ul class="sc-facts"><li><strong>${nf(c.counts.serie)}</strong> postes : séjours (GHS) et suppléments, médicaments et dispositifs en sus, urgences, dialyse, hospitalisation à domicile, psychiatrie, soins de suite…</li><li><strong>${nf(c.counts.cpam)}</strong> caisses primaires, <strong>${nf(c.counts.region)}</strong> régions, <strong>${nf(typeList.length)}</strong> types d’établissement</li><li><strong>${nf(c.counts.psh_ddp)}</strong> disciplines médicales</li></ul><p class="sc-tags">${c.series.slice(0, 18).map(s => `<span class="tag">${esc(s[1])}</span>`).join('')}</p><p class="note">${esc(c.perimeter.filter(x => !/^Champ|^Source/.test(x)).join(' ; '))}. Source : ${link(c.source.page, 'données par CPAM sur les dépenses des établissements de santé privés (data.gouv.fr)')}, ${link(c.source.files[0].url, 'descriptif des variables')}.</p>`;
    const cy = Object.fromEntries(c.years.map(y => [y.year, y]));
    const fileList = y => y.files.length > 2 ? `${y.files.length} fichiers mensuels (${esc(y.files[0].replace(/_\d+\..*$/, ''))}_01 à _${esc(y.files.at(-1).replace(/^.*_(\d+)\..*$/, '$1'))})` : y.files.map(esc).join(', ') || '–';
    $('scFiles').innerHTML = `<table class="data-table"><thead><tr><th>Année</th><th>Soins de ville</th><th>Cliniques privées</th></tr></thead><tbody>${[...v.years].reverse().map(y => `<tr><td>${link(y.url, String(y.year))}</td><td class="muted">${fileList(y)}</td><td class="muted">${cy[y.year] ? `<a href="${esc(cy[y.year].url)}" target="_blank" rel="noopener noreferrer">${fileList(cy[y.year])}</a>` : '–'}</td></tr>`).join('')}</tbody></table>`;
    $('scFilesNote').innerHTML = `Noms des fichiers relevés sur les pages de téléchargement de l’Assurance maladie (open-data-assurance-maladie.ameli.fr), auxquelles renvoient les liens de data.gouv.fr. ${v.dataFiles + c.dataFiles === 0 ? 'Aucun de ces liens ne donne directement les données : chaque page demande un jeton de session.' : ''} Mensuels depuis 2020 pour les soins de ville (avec l’ex-régime social des indépendants), archives annuelles avant.`;
    $('scPostSources').innerHTML = `${link(v.source.page, 'Soins de ville (data.gouv.fr)')}${link(c.source.page, 'Cliniques privées (data.gouv.fr)')}${link('https://open-data-assurance-maladie.ameli.fr/', 'Open data de l’Assurance maladie')}`;
  }

  /* ---------- 6. Not published ---------- */
  const GAPS = [
    { state: 'partial', title: 'Comptes des branches depuis 2011', text: 'Le seul jeu ouvert des comptes simplifiés des régimes de base s’arrête en 2010. Les comptes suivants, dont ceux de la branche autonomie créée en 2021, figurent dans les rapports de la Commission des comptes de la Sécurité sociale et les annexes au projet de loi de financement, en PDF et tableurs dispersés, sans série ouverte et stable.', who: 'Direction de la Sécurité sociale' },
    { state: 'partial', title: 'Exécution de l’Ondam par sous-objectif', text: 'L’objectif national de dépenses d’assurance maladie est voté chaque année, mais son exécution par sous-objectif (soins de ville, hôpitaux, médico-social, FIR) n’est pas publiée en série téléchargeable.', who: 'Direction de la Sécurité sociale, Assurance maladie' },
    { state: 'none', title: 'Comptes des hôpitaux publics', text: 'Aucun jeu national ouvert des comptes financiers des quelque 1 300 établissements publics de santé (environ 100 Md€ de charges). Les indicateurs Hospidiag et ScanSanté se consultent mais ne se téléchargent pas en masse.', who: 'ATIH, DGFiP, ministère de la Santé' },
    { state: 'partial', title: 'Agences régionales de santé et FIR', text: 'Le fonds d’intervention régional (plusieurs Md€ par an) n’est publié ligne à ligne que par l’ARS Pays de la Loire (2025). Les autres ARS ne publient pas leurs subventions en données ouvertes, ni leurs budgets de fonctionnement.', who: 'Les 18 ARS, ministère de la Santé' },
    { state: 'none', title: 'Comptes de chaque caisse', text: 'Frais de gestion, effectifs et prestations versées par caisse primaire, caisse d’allocations familiales, caisse de retraite ou Urssaf : rien n’est publié caisse par caisse en données ouvertes, alors que les charges de gestion courante dépassent 13 Md€ dès 2009 pour les seuls régimes de base.', who: 'Cnam, Cnaf, Cnav, Urssaf Caisse nationale' },
    { state: 'partial', title: 'Dépenses de santé par région après 2012', text: 'Le jeu régional de l’Assurance maladie couvre janvier à juillet 2012 sur les anciennes régions. Aucune série régionale récente comparable n’est publiée sur data.gouv.fr, alors que les remboursements sont connus jusqu’au niveau de la caisse primaire.', who: 'Assurance maladie' },
    { state: 'partial', title: 'Liens directs vers les fichiers de l’Assurance maladie', text: 'Les séries de soins de ville et de cliniques privées sont publiées, mais derrière une page de téléchargement qui exige un jeton : un lien de data.gouv.fr ne suffit pas à les récupérer automatiquement. Des liens stables vers les fichiers permettraient de les intégrer et de les mettre à jour.', who: 'Assurance maladie, data.gouv.fr' },
    { state: 'none', title: 'CPTS et exercice coordonné', text: 'Les financements des communautés professionnelles territoriales de santé, prévus par l’accord conventionnel interprofessionnel, ne sont pas publiés structure par structure.', who: 'Assurance maladie' },
  ];
  function initGaps() {
    $('scGaps').innerHTML = GAPS.map(g => `<article class="gap"><span class="gap__state ${g.state}">${g.state === 'none' ? 'Aucune donnée ouverte' : 'Données partielles'}</span><h3>${esc(g.title)}</h3><p>${esc(g.text)}</p><p class="sc-who">Qui pourrait le publier : ${esc(g.who)}</p></article>`).join('');
  }

  function init([data, geo]) {
    initContext(data.context);
    initAccounts(data.accounts);
    initRegions(data.regions, geo);
    initPosts(data.regions, data.seriesFiles);
    initGaps();
    const a = data.accounts.source, r = data.regions.source, f = data.seriesFiles;
    $('scSources').innerHTML = [
      link(a.page, 'Comptes simplifiés des régimes de base (data.gouv.fr)'), link(r.page, 'Dépenses remboursées par région (data.gouv.fr)'),
      link(f.ville.source.page, 'Soins de ville (data.gouv.fr)'), link(f.cliniques.source.page, 'Cliniques privées (data.gouv.fr)'),
      link(data.context.url, `Insee, tableau ${data.context.table}`), link(data.regions.population.url, 'OFGL, population des départements'),
    ].join('');
    window.addEventListener('frl-theme', () => window.dispatchEvent(new Event('resize')));
    FRL.keepHash();
  }

  Promise.all([load('./data/secu.json'), load('./data/departments.geojson').catch(() => null)]).then(init).catch(error => {
    console.error(error);
    $('scCtxChart').innerHTML = '<p class="tx-empty">Données indisponibles. Le site doit être servi par HTTP.</p>';
  });
})();
