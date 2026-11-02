/* Emplois publics et élus (emplois.html): remuneration of public employees (Insee 1960-2025), headcounts by versant
   (DGAFP), remuneration by function (Eurostat COFOG), State personnel credits by mission (PLF 2025), local authorities'
   personnel costs by level and by département (OFGL), legal number of elected officials and indemnity ceilings,
   and a « my commune » search. Data: data/emplois.json, built by scripts/emplois-data.py.
   Charts are SVG / HTML strings redrawn on resize; colours come from the --tx-* and --ramp-* tokens of style.css. */
(() => {
  const { esc, load } = FRL;
  const $ = id => document.getElementById(id);
  const nf = (v, d = 0) => v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
  const md = (v, d = 1) => `${nf(v, d)} Md€`;
  const eur = v => `${nf(v)} €`;
  const pctS = (v, d = 1) => `${nf(v, d)} %`;
  const signedPct = (v, d = 1) => v == null || !Number.isFinite(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), d)} %`;
  const money = v => FRL.money(v);
  const link = (url, text) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
  const kpi = (label, value, sub) => `<div class="kpi"><span>${esc(label)}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();
  const COLORS = ['var(--tx-1)', 'var(--tx-3)', 'var(--tx-2)', 'var(--tx-7)', 'var(--tx-4)', 'var(--tx-8)', 'var(--tx-5)', 'var(--tx-other)'];
  /* Sequential scale for the map: one hue, from the surface (low) to full strength (high), in both themes. */
  const RAMP = [10, 26, 42, 58, 76, 96].map(k => `color-mix(in srgb, var(--tx-1) ${k}%, var(--c-surface-2))`);

  /* ---------- Tooltip shared by every chart ---------- */
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
  const bindTips = root => root.querySelectorAll('[data-tip]').forEach(n => {
    n.addEventListener('pointermove', event => showTip(event, n.dataset.tip));
    n.addEventListener('pointerleave', hideTip);
  });

  function responsive(el, draw) {
    let width = 0;
    const run = force => { const w = Math.round(el.clientWidth); if (w && (force || w !== width)) { width = w; draw(w); } };
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => run()).observe(el);
    run();
    return () => run(true);
  }
  const niceStep = range => { const raw = range / 5, mag = 10 ** Math.floor(Math.log10(raw || 1)), n = raw / mag; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag; };
  function unitChips(el, onPick) {
    el.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      el.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      onPick(b.dataset.unit);
    });
  }

  /* Horizontal bars. rows: [{label, value, sub, color, focus, tip, id}] ; with onPick the rows are buttons. */
  function rows(el, list, { format = v => nf(v), max = null, onPick = null, active = null, after = null } = {}) {
    const top = max ?? Math.max(...list.filter(r => !r.noBar).map(r => Math.abs(r.value || 0)), 1e-9);
    const line = r => `<span class="em-line"><span>${r.prefix || ''}${esc(r.label)}${r.sub ? `<small>${r.sub}</small>` : ''}</span><strong>${format(r.value, r)}</strong></span>${r.noBar ? '' : `<span class="em-track"><span class="em-fill" style="--w:${Math.min(100, 100 * Math.abs(r.value || 0) / top).toFixed(2)}%;--c:${r.color || 'var(--tx-1)'}"></span></span>`}`;
    el.innerHTML = `<ul class="em-rows">${list.map((r, i) => `<li class="${r.focus ? 'is-focus' : ''}${active != null && r.id === active ? ' is-active' : ''}"${r.tip ? ` data-tip="${esc(r.tip)}"` : ''}>${onPick ? `<button type="button" data-i="${i}">${line(r)}</button>` : `<div class="em-row">${line(r)}</div>`}${after ? after(r) : ''}</li>`).join('')}</ul>`;
    requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.em-fill').forEach(n => n.classList.add('is-in'))));
    if (onPick) el.querySelectorAll('.em-rows > li > button').forEach(b => b.addEventListener('click', () => onPick(list[+b.dataset.i], b)));
    bindTips(el);
  }

  /* Multi-series line chart with a shared hover. */
  function lines(el, series, { height = 290, format = v => nf(v), tick = format, label = '', zero = true } = {}) {
    return responsive(el, W => {
      const H = W < 520 ? 240 : height, L = W < 520 ? 46 : 58, R = 12, T = 14, B = 26;
      const all = series.flatMap(s => s.points.filter(p => Number.isFinite(p.value)));
      if (!all.length) { el.innerHTML = '<p class="tx-empty">Série indisponible.</p>'; return; }
      const xs = all.map(p => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
      let lo = zero ? Math.min(0, ...all.map(p => p.value)) : Math.min(...all.map(p => p.value)), hi = Math.max(...all.map(p => p.value));
      const step = niceStep(hi - lo || 1); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
      const x = v => L + (W - L - R) * (v - x0) / ((x1 - x0) || 1), y = v => T + (H - T - B) * (1 - (v - lo) / ((hi - lo) || 1));
      let svg = '';
      for (let v = lo; v <= hi + step / 2; v += step) svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${tick(v)}</text>`;
      const every = [1, 2, 5, 10, 20].find(k => (W - L - R) / ((x1 - x0) / k) >= 44) || 20;
      for (let v = Math.ceil(x0 / every) * every; v <= x1; v += every) svg += `<text class="tx-tick" x="${x(v)}" y="${H - 6}" text-anchor="middle">${v}</text>`;
      series.forEach(s => {
        const pts = s.points.filter(p => Number.isFinite(p.value));
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
        if (s.area) svg += `<path d="${d}L${x(pts.at(-1).x).toFixed(1)},${y(lo)}L${x(pts[0].x).toFixed(1)},${y(lo)}Z" fill="${s.color}" opacity=".1"/>`;
        svg += `<path class="em-path" d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="5 4"' : ''}/>`;
        const last = pts.at(-1);
        svg += `<circle cx="${x(last.x)}" cy="${y(last.value)}" r="3.5" fill="${s.color}"/>`;
      });
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${svg}<g class="tx-hover"></g><rect class="tx-hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/></svg>`;
      const hover = el.querySelector('.tx-hover'), hit = el.querySelector('.tx-hit');
      const years = [...new Set(xs)].sort((a, b) => a - b);
      hit.addEventListener('pointermove', event => {
        const box = el.querySelector('svg').getBoundingClientRect(), mx = (event.clientX - box.left) * W / box.width;
        const yr = years.reduce((b, q) => Math.abs(x(q) - mx) < Math.abs(x(b) - mx) ? q : b, years[0]);
        const found = series.map(s => ({ s, p: s.points.find(p => p.x === yr) })).filter(r => r.p && Number.isFinite(r.p.value));
        hover.innerHTML = `<line class="tx-cursor" x1="${x(yr)}" x2="${x(yr)}" y1="${T}" y2="${H - B}" stroke="var(--c-muted)" stroke-dasharray="3 3"/>${found.map(r => `<circle cx="${x(yr)}" cy="${y(r.p.value)}" r="4.5" fill="var(--c-bg)" stroke="${r.s.color}" stroke-width="2.5"/>`).join('')}`;
        showTip(event, `<strong>${yr}</strong><table>${found.map(r => `<tr><td><i style="background:${r.s.color}"></i>${esc(r.s.name)}</td><td>${format(r.p.value)}</td></tr>`).join('')}</table>`);
      });
      hit.addEventListener('pointerleave', () => { hover.innerHTML = ''; hideTip(); });
    });
  }

  /* Stacked columns: years × parts, hover shows the breakdown. parts: [{name, color, values: [..]}] */
  function stacked(el, years, parts, { format = v => nf(v), tick = format, label = '' } = {}) {
    return responsive(el, W => {
      const H = W < 520 ? 230 : 270, L = W < 520 ? 42 : 52, R = 8, T = 12, B = 24;
      const totals = years.map((_, i) => parts.reduce((s, p) => s + (p.values[i] || 0), 0));
      let hi = Math.max(...totals); const step = niceStep(hi); hi = Math.ceil(hi / step) * step;
      const n = years.length, bw = (W - L - R) / n, y = v => T + (H - T - B) * (1 - v / hi);
      let svg = '';
      for (let v = 0; v <= hi + step / 2; v += step) svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${tick(v)}</text>`;
      years.forEach((yr, i) => {
        let acc = 0; const x = L + i * bw + bw * .14, w = Math.max(2, bw * .72);
        svg += `<g class="em-col" data-i="${i}">`;
        parts.forEach(p => {
          const v = p.values[i] || 0; if (!v) return;
          const y1 = y(acc), y2 = y(acc + v); acc += v;
          svg += `<rect x="${x.toFixed(1)}" y="${(y2 + .5).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(.5, y1 - y2 - 1).toFixed(1)}" fill="${p.color}" rx="1.5"/>`;
        });
        svg += '</g>';
        const short = bw < 40 ? `’${String(yr).slice(2)}` : yr;
        svg += `<text class="tx-tick" x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${short}</text>`;
      });
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${svg}<rect class="tx-hit em-col-hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/></svg>`;
      const hit = el.querySelector('.tx-hit');
      hit.addEventListener('pointermove', event => {
        const box = el.querySelector('svg').getBoundingClientRect(), mx = (event.clientX - box.left) * W / box.width;
        const i = Math.max(0, Math.min(n - 1, Math.floor((mx - L) / bw)));
        el.querySelectorAll('.em-col').forEach(g => g.classList.toggle('is-dim', +g.dataset.i !== i));
        showTip(event, `<strong>${years[i]}</strong><span class="tx-tip__value">${format(totals[i])}</span><table>${[...parts].reverse().map(p => `<tr><td><i style="background:${p.color}"></i>${esc(p.name)}</td><td>${format(p.values[i])}</td></tr>`).join('')}</table>`);
      });
      hit.addEventListener('pointerleave', () => { el.querySelectorAll('.em-col').forEach(g => g.classList.remove('is-dim')); hideTip(); });
    });
  }

  /* Small sparkline (no axis), used in detail panels. */
  function spark(el, points, { color = 'var(--tx-1)', format = v => nf(v) } = {}) {
    return responsive(el, W => {
      const H = 64, P = 4, vals = points.map(p => p.value).filter(Number.isFinite);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const x = i => P + (W - 2 * P) * i / Math.max(1, points.length - 1), y = v => P + (H - 2 * P) * (1 - (v - lo) / ((hi - lo) || 1));
      const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H + 16}" width="${W}" height="${H + 16}" aria-hidden="true"><path d="${d}L${x(points.length - 1)},${H}L${x(0)},${H}Z" fill="${color}" opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2"/><text class="tx-tick" x="${P}" y="${H + 13}">${points[0].x} : ${format(points[0].value)}</text><text class="tx-tick" x="${W - P}" y="${H + 13}" text-anchor="end">${points.at(-1).x} : ${format(points.at(-1).value)}</text></svg>`;
    });
  }

  /* ---------- Legal seats and indemnity ceilings (same rules as scripts/emplois-data.py) ---------- */
  const stepOf = (table, pop) => table.reduce((v, [threshold, x]) => pop >= threshold ? x : v, table[0][1]);
  let REF = null;
  const seatsOf = (code, pop) => !pop ? 0 : REF.municipalSeats.special[code] || stepOf(REF.municipalSeats.strata, pop);
  function capOf(pop, seats) {
    const deputies = Math.floor(seats * REF.municipalSeats.maxDeputyShare), ind = REF.indemnities;
    return { deputies, mayor: 12 * ind.indexMonthly * stepOf(ind.mayor, pop) / 100, deputy: 12 * ind.indexMonthly * stepOf(ind.deputy, pop) / 100,
      total: 12 * ind.indexMonthly / 100 * (stepOf(ind.mayor, pop) + deputies * stepOf(ind.deputy, pop)) };
  }

  /* ---------- 1. National series ---------- */
  function initNational(D) {
    const nat = D.national, rows = nat.years, last = rows.at(-1), W = D.workforce, wf = { total: W.total[W.year] / 1000, year: W.year };
    const CPI = { base: D.results.cpi.base, v: D.results.cpi.values };
    const habOf = r => r.population ? r.d1 * 1e9 / r.population : null;
    const agentsPer1000 = 1000 * wf.total * 1000 / (rows.find(r => r.year === wf.year + 1) || last).population;
    const peak = rows.filter(r => r.gdp).reduce((b, r) => r.d1 / r.gdp > b.d1 / b.gdp ? r : b);
    $('emKpis').innerHTML = [
      kpi(`Rémunération des agents publics, ${last.year}`, md(last.d1), `${pctS(100 * last.d1 / last.spending)} des dépenses publiques`),
      kpi('Part de la richesse nationale', pctS(100 * last.d1 / last.gdp), `du PIB en ${last.year} ; plus haut : ${pctS(100 * peak.d1 / peak.gdp)} en ${peak.year}`),
      kpi('Par habitant', eur(habOf(last)), `en ${last.year}, soit ${eur(habOf(last) / 12)} par mois`),
      kpi('Agents publics', `${nf(wf.total / 1000, 2)} M`, `fin ${wf.year}, soit ${nf(agentsPer1000)} pour 1 000 habitants`),
    ].join('');
    let unit = 'md';
    const cfg = {
      md: { title: 'Rémunération des agents publics, en milliards d’euros courants', val: (r, k) => r[k], format: v => md(v), tick: v => nf(v) },
      gdp: { title: 'Rémunération des agents publics, en % du PIB', val: (r, k) => r.gdp ? 100 * r[k] / r.gdp : null, format: v => pctS(v), tick: v => `${nf(v)} %` },
      share: { title: 'Rémunération des agents publics, en % des dépenses publiques', val: (r, k) => 100 * r[k] / r.spending, format: v => pctS(v), tick: v => `${nf(v)} %` },
      hab: { title: 'Rémunération des agents publics par habitant, en euros courants', val: (r, k) => r.population ? r[k] * 1e9 / r.population : null, format: v => eur(v), tick: v => nf(v) },
      real: { title: `Rémunération des agents publics, en milliards d’euros de ${CPI.base} (inflation déduite)`, val: (r, k) => CPI.v[r.year] ? r[k] * 100 / CPI.v[r.year] : null, format: v => md(v), tick: v => nf(v) },
      realHab: { title: `Rémunération des agents publics par habitant, en euros de ${CPI.base}`, val: (r, k) => r.population && CPI.v[r.year] ? r[k] * 1e9 / r.population * 100 / CPI.v[r.year] : null, format: v => eur(v), tick: v => nf(v) },
    };
    const draw = () => {
      const c = cfg[unit];
      const series = [
        { name: 'Rémunération des salariés publics', color: 'var(--tx-1)', area: true, points: rows.map(r => ({ x: r.year, value: c.val(r, 'd1') })) },
        { name: 'hors retraites des fonctionnaires de l’État (cotisations imputées)', color: 'var(--tx-2)', dash: true, points: rows.map(r => ({ x: r.year, value: r.imputed == null ? null : c.val({ ...r, net: r.d1 - r.imputed }, 'net') })) },
      ];
      $('emNatTitle').textContent = c.title;
      lines($('emNatChart'), series, { format: c.format, tick: c.tick, label: c.title });
      $('emNatLegend').innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
      const y2000 = rows.find(r => r.year === 2000);
      $('emNatNote').innerHTML = `Ensemble des administrations publiques (État, organismes d’administration centrale, collectivités, hôpitaux publics, sécurité sociale). Les cotisations imputées (${md(last.imputed)} en ${last.year}) représentent les retraites que l’État verse directement à ses anciens fonctionnaires, enregistrées comme une charge de l’employeur. ${unit === 'md' ? `Euros courants, sans correction de l’inflation : de ${md(y2000.d1)} en 2000 à ${md(last.d1)} en ${last.year}. ` : ''}${unit === 'hab' ? 'Population au 1er janvier (Insee), disponible depuis 1982. ' : ''}${unit === 'gdp' ? 'PIB déduit du ratio des dépenses publiques en % du PIB publié par l’Insee. ' : ''}${/^real/.test(unit) ? `Euros de ${CPI.base} : montants divisés par l’indice des prix à la consommation de l’Insee (séries base 2025, 2015 et 1980 raccordées). ` : ''}Source : ${link(nat.url, 'Insee, comptes de la Nation, tableau 3.201')}${/^real/.test(unit) ? `, ${link(D.results.cpi.url, 'Insee, indice des prix')}` : ''}.`;
    };
    unitChips($('emNatUnit'), u => { unit = u; draw(); });
    draw();
  }

  /* ---------- 2. Workforce (DGAFP) ---------- */
  function initWorkforce(D) {
    const W = D.workforce, nat = D.national.years, y = W.year, yk = String(y);
    const vColors = { fpe: 'var(--tx-1)', fpt: 'var(--tx-3)', fph: 'var(--tx-5)' };
    const vLabels = { fpe: 'Fonction publique de l’État', fpt: 'Fonction publique territoriale', fph: 'Fonction publique hospitalière' };
    const vWhat = { fpe: 'Ministères (enseignants, militaires, policiers, agents des finances…), universités et établissements publics nationaux', fpt: 'Communes, intercommunalités, départements, régions et leurs établissements (CCAS, SDIS, syndicats…)', fph: 'Hôpitaux publics, Ehpad publics, établissements médico-sociaux publics' };
    const pop = (nat.find(r => r.year === y + 1) || nat.at(-1)).population;
    const total = W.total[yk], first = Math.min(...Object.keys(W.total).map(Number));
    const salary = (v, who = 'Ensemble') => W.salaries.find(s => s.versant === v && s.population === who);
    const rate = W.rates.FP.at(-1)[1];
    $('emWfLead').innerHTML = `Au 31 décembre ${y}, ${nf(total)} personnes occupaient un emploi principal dans la fonction publique (hors contrats aidés), soit ${nf(1000 * total / pop)} pour 1 000 habitants : ${signedPct(100 * (total / W.total[String(first)] - 1))} depuis ${first}, quand la population a augmenté de ${signedPct(100 * (pop / (nat.find(r => r.year === first + 1) || nat[0]).population - 1))}. Fonctionnaires, contractuels et militaires sont comptés ensemble ; avec les contrats aidés : ${nf(W.withAided)}.`;
    $('emWfKpis').innerHTML = [
      kpi(`Agents publics, fin ${y}`, `${nf(total / 1e6, 2)} M`, `${nf(1000 * total / pop)} pour 1 000 habitants`),
      kpi('Taux d’administration', nf(rate, 1), `emplois en équivalent temps plein pour 1 000 habitants, agents civils (${nf(W.rates.FP[0][1], 1)} en ${W.rates.FP[0][0]})`),
      kpi('Salaire net moyen', eur(salary('Ensemble FP').net), `par mois, en équivalent temps plein, ${y} (brut : ${eur(salary('Ensemble FP').gross)})`),
      kpi(`Depuis ${first}`, signedPct(100 * (total / W.total[String(first)] - 1)), `${nf(total - W.total[String(first)])} agents de plus`),
    ].join('');
    const vs = ['fpe', 'fpt', 'fph'];
    $('emWfBar').innerHTML = vs.map(v => `<span style="flex:${W.versants[v][yk]};background:${vColors[v]}" data-tip="${esc(`<strong>${vLabels[v]}</strong><span class="tx-tip__value">${nf(W.versants[v][yk])} agents</span><br>${pctS(100 * W.versants[v][yk] / total)} des agents publics`)}">${pctS(100 * W.versants[v][yk] / total, 0)}</span>`).join('');
    const salV = { fpe: 'FPE', fpt: 'FPT', fph: 'FPH (ensemble)' };
    $('emWfCards').innerHTML = vs.map(v => { const n = W.versants[v][yk], f = W.versants[v][String(first)], sa = salary(salV[v]); return `<article class="em-card"><h4><i style="background:${vColors[v]}"></i>${vLabels[v]}</h4><strong>${nf(n / 1e6, 2)} million${n >= 2e6 ? 's' : ''}</strong><small>${nf(1000 * n / pop, 1)} pour 1 000 habitants · ${signedPct(100 * (n / f - 1))} depuis ${first}</small><small>Salaire net moyen : ${eur(sa.net)} par mois (${sa.realChange >= 0 ? '+' : ''}${nf(sa.realChange, 1)} % en un an, inflation déduite)</small><p>${vWhat[v]}</p></article>`; }).join('');
    bindTips($('emWfBar'));
    const inter = W.employers.find(e => e.label === 'Organismes intercommunaux');
    $('emWfNote').innerHTML = `Effectifs physiques au 31 décembre : un agent à temps partiel compte pour un. Mayotte n’est pas couverte. Les ${nf(inter.value * 1000)} agents des organismes intercommunaux (intercommunalités et syndicats) représentent ${pctS(100 * inter.value * 1000 / W.versants.fpt[yk], 0)} de la territoriale. Source : ${link(W.url, W.source)}.`;
    const years = Object.keys(W.total).map(Number);
    lines($('emWfLines'), vs.map(v => ({ name: vLabels[v], color: vColors[v], points: years.map(yy => ({ x: yy, value: W.versants[v][String(yy)] })) })), { format: v => nf(v), tick: v => `${nf(v / 1e6, 1)} M`, label: 'Agents publics par versant depuis 2011', height: 250 });
    $('emWfLinesLegend').innerHTML = vs.map(v => `<span><i style="background:${vColors[v]}"></i>${vLabels[v]}</span>`).join('');
    $('emWfLinesNote').innerHTML = `Agents au 31 décembre, hors contrats aidés. La série change de méthode en ${W.breaks.join(', ')} (nouvelles sources de paie, déclaration sociale nominative) : pour ces années, la DGAFP publie deux valeurs, et la plus récente est retenue ici. Avant 2020, valeurs arrondies à la centaine. Source : ${link(W.url, 'DGAFP')}.`;

    // ministries
    let mUnit = 'n';
    const drawMin = () => {
      const list = W.ministries.map(m => { const s0 = m.series[0], v0 = s0[1] * 1000, n = m.total * 1000; return { label: m.label, value: mUnit === 'n' ? n : 100 * (n / v0 - 1), sub: mUnit === 'n' ? `${nf(m.ministry * 1000)} dans les services, ${nf(m.bodies * 1000)} dans les établissements publics` : `${nf(v0)} en ${s0[0]}, ${nf(n)} en ${y}`, color: mUnit === 'evo' && n < v0 ? 'var(--tx-2)' : 'var(--tx-1)' }; }).sort((a, b) => b.value - a.value);
      rows($('emMin'), list, { format: v => mUnit === 'n' ? nf(v) : signedPct(v, 0), max: mUnit === 'evo' ? Math.max(...list.map(r => Math.abs(r.value))) : null });
      $('emMinTitle').textContent = mUnit === 'n' ? `Fonction publique de l’État, par ministère, fin ${y}` : `Évolution des effectifs par ministère, 1998–${y}`;
    };
    unitChips($('emMinUnit'), u => { mUnit = u; drawMin(); });
    drawMin();
    $('emMinNote').innerHTML = `Agents des ministères et de leurs établissements publics nationaux (universités, agences…), militaires compris. Les périmètres ministériels changent d’un gouvernement à l’autre : une évolution longue mélange réorganisations (transferts aux collectivités, aux opérateurs, fusions de directions) et créations ou suppressions de postes. Source : ${link(W.url, 'DGAFP, rapport annuel 2026')}.`;
    // FPT employers
    const pickE = l => W.employers.find(e => e.label === l);
    const fptRows = [['Communes', 'Communes'], ['Établissements communaux (CCAS, CDE)', 'Centres communaux d’action sociale, caisses des écoles'], ['EPCI à fiscalité propre', 'Intercommunalités à fiscalité propre'], ['Autres structures intercommunales (Sivom, Sivu, syndicats mixtes)', 'Syndicats intercommunaux'], ['Départements', 'Départements'], ['SDIS', 'Services d’incendie et de secours'], ['Régions', 'Régions'], ['Autres établissements départementaux', 'Autres établissements départementaux'], ['Autres EPA locaux (CCM, régies)', 'Autres établissements locaux']]
      .map(([l, label], i) => { const e = pickE(l); const s0 = e.series[0]; return e && { label, value: e.value * 1000, sub: `${signedPct(100 * (e.value / s0[1] - 1), 0)} depuis ${s0[0]}`, color: COLORS[i % COLORS.length] }; }).filter(Boolean);
    rows($('emFpt'), fptRows, { format: v => nf(v) });
    const sizes = W.employers.filter(e => /^Communes (de|du)/.test(e.label));
    $('emFptNote').innerHTML = `Agents au 31 décembre ${y}. Les communes emploient ${pctS(100 * pickE('Communes').value * 1000 / W.versants.fpt[yk], 0)} des agents territoriaux. Dans les communes de 100 000 habitants et plus : ${nf(pickE('Communes de 100 000 habitants et plus').value * 1000)} agents ; dans celles de moins de 1 000 habitants : ${nf(pickE('Communes de moins de 1 000 habitants').value * 1000)}. Source : ${link(W.url, 'DGAFP')}.`;
    // ceilings voted vs used
    const tot = W.ceilings.Total, cy = Object.keys(tot).map(Number);
    lines($('emCeil'), [{ name: 'Plafond d’emplois voté (loi de finances initiale)', color: 'var(--tx-7)', points: cy.map(yy => ({ x: yy, value: tot[yy] })) }], { format: v => `${nf(v)} ETPT`, tick: v => `${nf(v / 1e6, 2)} M`, label: 'Plafond d’emplois de l’État', height: 200, zero: false });
    $('emCeilLegend').innerHTML = '<span><i style="background:var(--tx-7)"></i>Plafond d’emplois voté, budget de l’État et budgets annexes</span>';
    const used = W.used2025.filter(u => !/^Total/.test(u.label)).sort((a, b) => a.gap - b.gap).slice(0, 6);
    const usedTotal = W.used2025.find(u => /^Total/.test(u.label));
    $('emUsed').innerHTML = `<h4 style="margin:1rem 0 .5rem;font-size:.9rem">En 2025, emplois réellement occupés sous le plafond voté</h4><div id="emUsedRows"></div>`;
    rows($('emUsedRows'), used.map(u => ({ label: u.label, value: -u.gap, sub: `${nf(u.used)} emplois occupés`, color: 'var(--tx-2)' })), { format: v => `−${nf(v)}` });
    $('emCeilNote').innerHTML = `Plafond en équivalents temps plein travaillé (ETPT) voté chaque année en loi de finances, nomenclature des ministères de 2026. En 2025, le budget général a consommé ${nf(usedTotal.used)} ETPT, ${nf(-usedTotal.gap)} de moins que son plafond rectifié : le plafond autorise des recrutements, il ne les impose pas, et l’écart mesure surtout les postes non pourvus. Source : ${link(W.url, 'DGAFP, rapport annuel 2026')} (lois de finances, rapports annuels de performances).`;
    // salary and cost per agent
    const n = nat.find(r => r.year === y);
    const loc = D.local.levels.reduce((s, l) => { const i = l.years.indexOf(y); return s + (i >= 0 ? l.personnel[i] : 0); }, 0);
    const per = [
      ...[['Ensemble FP', 'Toutes fonctions publiques'], ['FPE', 'État'], ['FPT', 'Territoriale'], ['FPH (hôpitaux publics)', 'Hôpitaux publics'], ['FPH (établissements médico-sociaux)', 'Établissements médico-sociaux']].map(([v, l]) => ({ label: `Salaire net moyen, ${l}`, value: 12 * salary(v).net, sub: `${eur(salary(v).net)} par mois · brut ${eur(salary(v).gross)}`, color: 'var(--tx-3)' })),
      { label: 'Coût complet moyen pour l’employeur, toutes administrations', value: n.d1 * 1e9 / total, sub: `${md(n.d1)} de rémunérations ${y} (cotisations et retraites de l’État comprises) pour ${nf(total / 1e6, 2)} M d’agents` },
      { label: 'Coût complet moyen, collectivités', value: loc / W.versants.fpt[yk], sub: `${md(loc / 1e9)} de frais de personnel ${y} pour ${nf(W.versants.fpt[yk] / 1e6, 2)} M d’agents territoriaux` },
    ];
    rows($('emPerAgent'), per, { format: v => `${nf(v / 1000, 1)} k€ / an` });
    $('emPerAgentNote').innerHTML = `Salaires nets moyens en équivalent temps plein ${y}, hors militaires (DGAFP). Le coût complet rapporte les rémunérations publiques (Insee, OFGL) aux agents au 31 décembre : cotisations patronales, retraites de l’État et temps partiels compris, c’est un ordre de grandeur, pas un salaire. Sources : ${link(W.url, 'DGAFP')}, ${link(D.national.url, 'Insee 3.201')}, ${link(D.local.url, 'OFGL')}.`;
    $('emWfSources').innerHTML = [link(W.url, 'DGAFP, rapport annuel 2026 (données)'), link('https://www.insee.fr/fr/statistiques/2493501', 'Insee, effectifs par versant et ministère')].join('');
  }

  /* ---------- 2b. Europe ---------- */
  const COUNTRY = { AT: 'Autriche', BE: 'Belgique', BG: 'Bulgarie', CY: 'Chypre', CZ: 'Tchéquie', DE: 'Allemagne', DK: 'Danemark', EE: 'Estonie', EL: 'Grèce', ES: 'Espagne', FI: 'Finlande', FR: 'France', HR: 'Croatie', HU: 'Hongrie', IE: 'Irlande', IT: 'Italie', LT: 'Lituanie', LU: 'Luxembourg', LV: 'Lettonie', MT: 'Malte', NL: 'Pays-Bas', PL: 'Pologne', PT: 'Portugal', RO: 'Roumanie', SE: 'Suède', SI: 'Slovénie', SK: 'Slovaquie', IS: 'Islande', NO: 'Norvège', CH: 'Suisse', EU27_2020: 'Union européenne (27)', EA20: 'Zone euro (20)',
    AUS: 'Australie', AUT: 'Autriche', BEL: 'Belgique', CAN: 'Canada', CHE: 'Suisse', CHL: 'Chili', COL: 'Colombie', CRI: 'Costa Rica', CZE: 'Tchéquie', DEU: 'Allemagne', DNK: 'Danemark', ESP: 'Espagne', EST: 'Estonie', FIN: 'Finlande', FRA: 'France', GBR: 'Royaume-Uni', GRC: 'Grèce', HUN: 'Hongrie', IRL: 'Irlande', ISL: 'Islande', ISR: 'Israël', ITA: 'Italie', JPN: 'Japon', KOR: 'Corée du Sud', LTU: 'Lituanie', LUX: 'Luxembourg', LVA: 'Lettonie', MEX: 'Mexique', NLD: 'Pays-Bas', NOR: 'Norvège', NZL: 'Nouvelle-Zélande', POL: 'Pologne', PRT: 'Portugal', SVK: 'Slovaquie', SVN: 'Slovénie', SWE: 'Suède', TUR: 'Turquie', USA: 'États-Unis', HRV: 'Croatie' };
  function initEurope(D) {
    const E = D.results.europe, O = D.results.oecd;
    const fr = E.countries.find(c => c.geo === 'FR'), eu = E.countries.find(c => c.geo === 'EU27_2020'), de = E.countries.find(c => c.geo === 'DE');
    const nat = E.countries.filter(c => !/^(EU|EA)/.test(c.geo)), rank = nat.findIndex(c => c.geo === 'FR') + 1;
    const gdp = D.national.years.find(r => r.year === E.year)?.gdp;
    $('emEuLead').innerHTML = `En ${E.year}, la France consacre ${pctS(fr.gdp)} de son PIB à rémunérer ses agents publics, contre ${pctS(eu.gdp)} en moyenne dans l’Union et ${pctS(de.gdp)} en Allemagne : ${rank}e sur ${nat.length} pays européens. ${gdp ? `L’écart avec la moyenne européenne représente ${md((fr.gdp - eu.gdp) / 100 * gdp, 0)} par an.` : ''} Les pays nordiques, qui assurent beaucoup de services en régie publique, sont plus haut ; l’Allemagne, où cliniques, écoles confessionnelles et caisses sont souvent privées ou associatives, plus bas : la comparaison dépend aussi de ce que chaque pays confie au secteur public.`;
    rows($('emEuBars'), E.countries.map(c => ({ label: COUNTRY[c.geo] || c.label, value: c.gdp, focus: c.geo === 'FR' || /^(EU|EA)/.test(c.geo), color: c.geo === 'FR' ? 'var(--tx-2)' : /^(EU|EA)/.test(c.geo) ? 'var(--tx-other)' : 'var(--tx-1)', sub: c.spending ? `${pctS(c.spending, 0)} des dépenses publiques` : '' })), { format: v => pctS(v) });
    $('emEuBarsTitle').textContent = `Rémunération des agents publics, en % du PIB, ${E.year}`;
    $('emEuBarsNote').innerHTML = `Rémunération des salariés des administrations publiques (salaires et cotisations, D.1). Source : ${link(E.url, E.source)}.`;
    const fo = O.countries.find(c => c.iso3 === 'FRA');
    rows($('emOecd'), O.countries.map(c => ({ label: COUNTRY[c.iso3] || c.label, value: c.value, focus: c.iso3 === 'FRA', color: c.iso3 === 'FRA' ? 'var(--tx-2)' : 'var(--tx-1)', sub: c.year !== fo.year ? `donnée ${c.year}` : '' })), { format: v => pctS(v) });
    $('emOecdTitle').textContent = `Emploi des administrations publiques, en % de l’emploi total`;
    $('emOecdNote').innerHTML = `Dernière année disponible (${fo.year} pour la France : ${pctS(fo.value)}, contre ${pctS(O.france[0][1])} en ${O.france[0][0]}). Pays de l’OCDE seulement : Bulgarie, Croatie, Chypre, Malte et Roumanie manquent. Source : ${link(O.url, O.source)}.`;
    const series = [['France', E.france, 'var(--tx-2)'], ['Union européenne (27)', E.eu27, 'var(--tx-other)'], ['Allemagne', E.germany, 'var(--tx-1)']];
    lines($('emEuLines'), series.map(([name, s, color]) => ({ name, color, points: s.map(([y, v]) => ({ x: y, value: v })) })), { format: v => pctS(v), tick: v => `${nf(v)} %`, label: 'Rémunération des agents publics en % du PIB', height: 240, zero: false });
    $('emEuLegend').innerHTML = series.map(([n, , c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('');
    $('emEuLinesNote').innerHTML = `Source : ${link(E.url, 'Eurostat, gov_10a_main')}.`;
    $('emEuSources').innerHTML = [link(E.url, 'Eurostat, comptes des administrations publiques'), link(O.url, 'OCDE, Government at a Glance')].join('');
  }

  /* ---------- 2c. Cost and results ---------- */
  function initPistes(D) {
    const R = D.results, CPI = R.cpi.values, base = R.cpi.base, nat = D.national.years, F = D.functions;
    const real = (v, y) => CPI[y] ? v * 100 / CPI[y] : null;
    const at = (arr, y) => arr.find(p => p[0] === y);
    const last = nat.at(-1), y80 = nat.find(r => r.year === 1980), y82 = nat.find(r => r.year === 1982), y00 = nat.find(r => r.year === 2000), GV = R.gdpVolume.values;
    const fy = F.years, fi = y => fy.indexOf(y), fn = code => F.items.find(i => i.code === code);
    const W = D.workforce, bercy = W.ministries.find(m => /économiques et financiers/.test(m.label));
    const b0 = bercy.series[0], b1 = bercy.series.at(-1);
    const debt = R.debt.series, d0 = at(debt, b0[0]) || debt[0], d1 = debt.at(-1);
    const trade = R.trade.series.filter(t => t.goodsGdp != null);
    const t0 = trade.find(t => t.year === b0[0]) || trade[0], t1 = trade.at(-1);
    const deficitSince = (() => { let y = t1.year; for (let i = trade.length - 1; i >= 0 && trade[i].goodsGdp < 0; i--) y = trade[i].year; return y; })();
    const gfp = D.state.missions.find(m => m.code === 'GA'), eco = D.state.missions.find(m => m.code === 'DB');
    const H = R.hospitals.series.public, h0 = H[0], h1 = H.at(-1);
    const growth = (a, b) => signedPct(100 * (b / a - 1), 0);
    const pisa = R.pisa.series, p0 = pisa[0], p1 = pisa.at(-1);
    const edu = fn('GF09'), health = fn('GF07');
    const k = (label, value, sub) => kpi(label, value, sub);
    const cards = [
      { id: 'inflation', tag: 'Inflation', title: 'Corrigé de l’inflation, la masse salariale publique a quand même fortement augmenté',
        facts: [k(`Rémunérations publiques ${last.year}`, md(last.d1), `en euros de ${base}`), k(`Depuis 1980, inflation déduite`, growth(real(y80.d1, 1980), real(last.d1, last.year)), `${md(real(y80.d1, 1980), 0)} en euros de ${base} en 1980`), k('Par habitant, inflation déduite', growth(real(y82.d1, 1982) / y82.population, real(last.d1, last.year) / last.population), `depuis 1982 ; population : ${growth(y82.population, last.population)}`), k('Depuis 2000, inflation déduite', growth(real(y00.d1, 2000), real(last.d1, last.year)), `richesse produite (PIB en volume) : ${growth(GV[2000], GV[last.year])}`)],
        charts: [{ id: 'piReal', title: `Rémunérations publiques, Md€ de ${base}`, series: [{ name: `Md€ de ${base}`, color: 'var(--tx-1)', area: true, points: nat.filter(r => CPI[r.year]).map(r => ({ x: r.year, value: real(r.d1, r.year) })) }], format: v => md(v, 0), zero: true }],
        q: `<strong>À demander :</strong> la hausse vient-elle de plus d’agents, de meilleurs salaires, ou du coût des retraites de l’État (cotisations imputées) ? Le nombre d’agents (+${nf(100 * (W.total[W.year] / W.total[String(Math.min(...Object.keys(W.total).map(Number)))] - 1), 0)} % depuis 2011) et le salaire net moyen (${eur(W.salaries.find(s => s.versant === 'Ensemble FP' && s.population === 'Ensemble').net)} par mois en ${W.year}) sont publiés ; le service rendu en face ne l’est pas.` },
      { id: 'bercy', tag: 'Bercy', title: `Bercy : ${nf(b1[1] * 1000)} agents, la dette et le commerce extérieur`,
        facts: [k(`Agents des ministères économiques et financiers, ${b1[0]}`, nf(b1[1] * 1000), `${nf(b0[1] * 1000)} en ${b0[0]} (${growth(b0[1], b1[1])}), établissements publics compris`), k(`Dépenses de personnel ${D.state.year}`, md((gfp.t2 + (eco?.t2 || 0)) / 1000), `missions « ${gfp.name} » et « Économie »`), k('Dette publique', `${nf(d1[1], 1)} % du PIB`, `${nf(d0[1], 1)} % en ${d0[0]}`), k('Solde des échanges de biens', `${nf(t1.goodsGdp, 1)} % du PIB`, `${t1.year} ; ${nf(t0.goodsGdp, 1)} % en ${t0.year}`)],
        charts: [
          { id: 'piBercy', title: 'Agents des ministères économiques et financiers', series: [{ name: 'Agents', color: 'var(--tx-1)', points: bercy.series.map(([y, v]) => ({ x: y, value: v * 1000 })) }], format: v => nf(v), tick: v => `${nf(v / 1000)} k`, zero: true },
          { id: 'piDebt', title: 'Dette publique, % du PIB', series: [{ name: 'Dette publique', color: 'var(--tx-2)', points: debt.filter(([y]) => y >= b0[0]).map(([y, v]) => ({ x: y, value: v })) }], format: v => pctS(v), tick: v => `${nf(v)} %`, zero: true },
          { id: 'piTrade', title: 'Solde des échanges de biens, % du PIB', series: [{ name: 'Solde des biens', color: 'var(--tx-8)', points: trade.filter(t => t.year >= b0[0]).map(t => ({ x: t.year, value: t.goodsGdp })) }], format: v => pctS(v), tick: v => `${nf(v)} %`, zero: false },
        ],
        q: `<strong>À demander :</strong> Bercy compte ${nf(b0[1] * 1000 - b1[1] * 1000)} agents de moins qu’en ${b0[0]}, pendant que l’impôt se dématérialisait (les à-coups de 2008 à 2011 tiennent aux changements de périmètre du ministère). Dans le même temps, la dette est passée de ${nf(d0[1], 0)} % à ${nf(d1[1], 0)} % du PIB et les échanges de biens sont déficitaires chaque année depuis ${deficitSince}. Les indicateurs de performance publiés pour ces missions mesurent des délais de traitement et des taux de recouvrement, jamais la trajectoire de la dette ni la compétitivité.<ul><li>Qui répond de la dette ? Les lois de finances sont préparées par le gouvernement (ministres de l’Économie et du Budget, administrations de Bercy) et votées par le Parlement.</li><li>Quel indicateur relie le coût des administrations économiques à un résultat pour le public : recettes, dette, emplois, commerce extérieur ?</li></ul>` },
      { id: 'sante', tag: 'Santé', title: 'Hôpital public : plus de médecins et de soignants, un tiers de cadres de santé en moins… et plus d’administratifs',
        facts: [k(`Rémunérations de la fonction santé, ${fy.at(-1)}`, md(health.d1.at(-1)), `${growth(real(health.d1[0], fy[0]), real(health.d1.at(-1), fy.at(-1)))} depuis ${fy[0]}, inflation déduite`), k(`Administratifs des hôpitaux publics, ${h1.year}`, nf(h1.admin), `ETP ; ${growth(h0.admin, h1.admin)} depuis ${h0.year} (${pctS(100 * h0.admin / h0.total)} puis ${pctS(100 * h1.admin / h1.total)} des emplois)`), k('Cadres de santé', nf(h1.careManagers), `ETP ; ${growth(h0.careManagers, h1.careManagers)} depuis ${h0.year}`), k('Médecins salariés, infirmiers', `${growth(h0.doctors, h1.doctors)} · ${growth(h0.nurses, h1.nurses)}`, `depuis ${h0.year} (ETP) ; aides-soignants ${growth(h0.aides, h1.aides)}`)],
        charts: [{ id: 'piHosp', title: `Hôpitaux publics, emplois en ETP (indice 100 en ${h0.year})`, series: [['Administratifs', 'admin', 'var(--tx-2)'], ['Médecins salariés', 'doctors', 'var(--tx-1)'], ['Infirmiers', 'nurses', 'var(--tx-3)'], ['Aides-soignants', 'aides', 'var(--tx-5)'], ['Cadres de santé', 'careManagers', 'var(--tx-7)']].map(([name, key, color]) => ({ name, color, points: H.map(h => ({ x: h.year, value: 100 * h[key] / h0[key] })) })), format: v => nf(v, 0), tick: v => nf(v), zero: false, legend: true }],
        q: `<strong>À demander :</strong> en 2000, l’Organisation mondiale de la santé classait le système de santé français au premier rang mondial (${link('https://www.who.int/publications/i/item/924156198X', 'Rapport sur la santé dans le monde 2000')}). Dans les hôpitaux publics, la part des administratifs a peu bougé (${pctS(100 * h0.admin / h0.total)} des ETP en ${h0.year}, ${pctS(100 * h1.admin / h1.total)} en ${h1.year}, secrétaires médicales comprises) : le poids de la gestion se mesure-t-il ailleurs (temps des soignants passé à coder et à remplir, agences régionales de santé, tarification à l’activité) ?<ul><li>Le vieillissement de la population était annoncé dès les années 1990 : qui a fixé, année après année, le nombre de médecins et d’infirmiers formés ?</li><li>Pourquoi le nombre de cadres de santé a-t-il baissé de ${nf(Math.abs(100 * (h1.careManagers / h0.careManagers - 1)), 0)} % quand celui des administratifs augmentait ?</li></ul>` },
      { id: 'ecole', tag: 'École', title: 'Enseignement : premier poste de rémunérations publiques, des résultats PISA en baisse',
        facts: [k(`Rémunérations de l’enseignement, ${fy.at(-1)}`, md(edu.d1.at(-1)), `${growth(real(edu.d1[0], fy[0]), real(edu.d1.at(-1), fy.at(-1)))} depuis ${fy[0]}, inflation déduite`), k('PISA mathématiques', `${nf(p1.math)} points`, `${p1.year} ; ${nf(p0.math)} en ${p0.year}`), k('PISA compréhension de l’écrit', `${nf(p1.reading)} points`, `${p1.year} ; ${nf(p0.reading)} en ${p0.year}`)],
        charts: [
          { id: 'piEdu', title: `Rémunérations de l’enseignement, Md€ de ${base}`, series: [{ name: 'Enseignement', color: 'var(--tx-1)', area: true, points: fy.map((y, i) => ({ x: y, value: real(edu.d1[i], y) })).filter(p => p.value) }], format: v => md(v, 0), zero: true },
          { id: 'piPisa', title: 'Scores PISA de la France', series: [['Mathématiques', 'math', 'var(--tx-1)'], ['Compréhension de l’écrit', 'reading', 'var(--tx-2)'], ['Sciences', 'science', 'var(--tx-3)']].map(([name, key, color]) => ({ name, color, points: pisa.map(p => ({ x: p.year, value: p[key] })) })), format: v => nf(v), tick: v => nf(v), zero: false, legend: true },
        ],
        q: `<strong>À demander :</strong> inflation déduite, la dépense de rémunération de l’enseignement augmente pendant que les scores moyens baissent de ${p0.year} à ${p1.year} (l’enquête 2022 n’est pas encore dans cette source ouverte). Combien d’agents de l’Éducation nationale enseignent devant une classe, combien travaillent en administration ? Ces chiffres ne sont pas publiés en données ouvertes, établissement par établissement.` },
    ];
    $('emPistes').innerHTML = cards.map(c => `<article class="em-piste" id="piste-${c.id}"><span class="em-piste__tag">${esc(c.tag)}</span><h3>${esc(c.title)}</h3><div class="em-piste__facts">${c.facts.join('')}</div><div class="em-piste__charts">${c.charts.map(ch => `<div><h4>${esc(ch.title)}</h4><div id="${ch.id}" class="em-chart"></div>${ch.legend ? `<div class="tx-legend">${ch.series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}</div>`).join('')}</div><div class="em-piste__q">${c.q}</div></article>`).join('');
    cards.forEach(c => c.charts.forEach(ch => lines($(ch.id), ch.series, { format: ch.format, tick: ch.tick || ch.format, label: ch.title, height: 200, zero: ch.zero })));
    $('emPistes').insertAdjacentHTML('beforeend', `<p class="note">Sources : ${link(D.national.url, 'Insee 3.201')}, ${link(R.cpi.url, 'Insee, prix à la consommation')}, ${link(F.url, 'Eurostat, dépenses par fonction')}, ${link(D.workforce.url, 'DGAFP')}, ${link(D.state.url, 'PLF 2025')}, ${link(R.debt.url, 'Insee, dette publique')}, ${link(R.trade.url, R.trade.source)}, ${link(R.hospitals.url, R.hospitals.source)}, ${link(R.pisa.url, R.pisa.source)}. Les montants en euros de ${base} sont divisés par l’indice des prix à la consommation.</p>`);
  }

  /* ---------- 3. By function ---------- */
  function initFunctions(D) {
    const F = D.functions, yi = F.years.length - 1, year = F.years[yi];
    const popOf = y => (D.national.years.find(r => r.year === y) || {}).population;
    const pop = popOf(year);
    const items = F.items.filter(it => it.d1 && it.d1[yi] > 0);
    let unit = 'md', active = 'GF09';
    const val = (it, i = yi, u = unit) => u === 'md' ? it.d1[i] : u === 'hab' ? it.d1[i] * 1e9 / popOf(F.years[i]) : 100 * it.d1[i] / it.te[i];
    const fmt = (v, u = unit) => u === 'md' ? md(v) : u === 'hab' ? eur(v) : pctS(v, 0);
    function detail() {
      const it = items.find(x => x.code === active) || items[0];
      const share = it.d1[yi] / F.total.d1[yi], i0 = F.years.findIndex((_, k) => it.d1[k]);
      const subs = it.subs.filter(s => s.d1 && s.d1[yi] > 0).sort((a, b) => b.d1[yi] - a.d1[yi]);
      $('emFnDetail').innerHTML = `<span class="eyebrow">${year}</span><h3>${esc(it.label)}</h3><div class="em-big">${md(it.d1[yi])}</div><dl><dt>Part de toutes les rémunérations publiques</dt><dd>${pctS(100 * share)}</dd><dt>Par habitant</dt><dd>${eur(it.d1[yi] * 1e9 / pop)}</dd><dt>Part des salaires dans la dépense de la fonction</dt><dd>${pctS(100 * it.d1[yi] / it.te[yi])} de ${md(it.te[yi])}</dd><dt>Depuis ${F.years[i0]}</dt><dd>${signedPct(100 * (it.d1[yi] / it.d1[i0] - 1), 0)} en euros courants (toutes fonctions : ${signedPct(100 * (F.total.d1[yi] / F.total.d1[i0] - 1), 0)})</dd></dl><h4>Rémunérations, ${F.years[i0]}–${year}</h4><div class="em-spark" id="emFnSpark"></div>${subs.length > 1 ? `<h4>Par sous-fonction</h4><div id="emFnSubs"></div>` : ''}`;
      spark($('emFnSpark'), F.years.map((y, k) => ({ x: y, value: it.d1[k] })).filter(p => Number.isFinite(p.value)), { format: v => md(v, 0) });
      if (subs.length > 1) rows($('emFnSubs'), subs.map(s => ({ label: s.label, value: s.d1[yi], sub: s.te[yi] ? `${pctS(100 * s.d1[yi] / s.te[yi], 0)} de la dépense de la sous-fonction` : '' })), { format: v => md(v) });
    }
    function draw() {
      const list = items.map(it => ({ id: it.code, label: it.label, value: val(it), sub: unit === 'share' ? `${md(it.d1[yi])} sur ${md(it.te[yi])} de dépenses` : `${pctS(100 * it.d1[yi] / F.total.d1[yi])} des rémunérations publiques` })).sort((a, b) => b.value - a.value);
      if (unit !== 'share') list.push({ id: 'TOTAL', label: 'Toutes fonctions', value: unit === 'md' ? F.total.d1[yi] : F.total.d1[yi] * 1e9 / pop, focus: true, noBar: true });
      else list.push({ id: 'TOTAL', label: 'Toutes fonctions', value: 100 * F.total.d1[yi] / F.total.te[yi], focus: true, noBar: true });
      rows($('emFnBars'), list, { format: v => fmt(v), active, onPick: r => { if (r.id === 'TOTAL') return; active = r.id; draw(); detail(); if (innerWidth < 960) $('emFnDetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
      $('emFnBarsTitle').textContent = { md: `Rémunérations par fonction, ${year}, en Md€`, hab: `Rémunérations par fonction, ${year}, en € par habitant`, share: `Part des salaires dans la dépense de chaque fonction, ${year}` }[unit];
    }
    unitChips($('emFnUnit'), u => { unit = u; draw(); });
    draw(); detail();
    const edu = items.find(x => x.code === 'GF09'), health = items.find(x => x.code === 'GF07');
    $('emFnNote').innerHTML = `Enseignement et santé (hôpitaux publics) réunissent ${pctS(100 * (edu.d1[yi] + health.d1[yi]) / F.total.d1[yi], 0)} des rémunérations publiques. La protection sociale verse surtout des prestations : ses salaires (agents des caisses, de l’action sociale) pèsent peu dans sa dépense. Écart maximal entre la somme des fonctions et le total publié : ${nf(F.maxGap, 2)} Md€. Source : ${link(F.url, 'Eurostat, tableau gov_10a_exp')} (données transmises par l’Insee).`;
    $('emFnSources').innerHTML = link(F.url, 'Eurostat, dépenses des administrations par fonction');
  }

  /* ---------- 4. State, titre 2 ---------- */
  function initState(D) {
    const S = D.state, list = S.missions, total = list.reduce((s, m) => s + m.t2, 0);
    const pop = (D.national.years.find(r => r.year === S.year) || D.national.years.at(-1)).population;
    const powers = S.powers.reduce((s, p) => s + p.cp, 0);
    const top = list[0];
    $('emStKpis').innerHTML = [
      kpi(`Dépenses de personnel des ministères, ${S.year}`, md(total / 1000), `${eur(total * 1e6 / pop)} par habitant`),
      kpi(esc(top.name), md(top.t2 / 1000), `${pctS(100 * top.t2 / total, 0)} du titre 2, enseignants des écoles, collèges et lycées`),
      kpi('Pensions des retraités de l’État', md(S.pensions.cp / 1000), 'compte d’affectation spéciale « Pensions », financé en grande partie par les ministères'),
      kpi('Pouvoirs publics', `${nf(powers)} M€`, 'Assemblée, Sénat, Présidence, Conseil constitutionnel : dotations, hors titre 2'),
    ].join('');
    let unit = 'md'; const open = new Set();
    function draw() {
      const data = list.map(m => ({ id: m.code, label: m.name, value: unit === 'md' ? m.t2 : 100 * m.t2 / m.cp, sub: unit === 'md' ? `${pctS(100 * m.t2 / m.cp, 0)} des crédits de la mission (${md(m.cp / 1000)})${m.type === 'BA' ? ' · budget annexe' : ''}` : `${md(m.t2 / 1000, 2)} sur ${md(m.cp / 1000)}`, m }))
        .sort((a, b) => b.value - a.value);
      rows($('emStBars'), data, {
        format: v => unit === 'md' ? (v >= 1000 ? md(v / 1000) : `${nf(v)} M€`) : pctS(v, 0),
        onPick: (r, b) => { open.has(r.id) ? open.delete(r.id) : open.add(r.id); draw(); },
        after: r => open.has(r.id) && r.m.progs.length ? `<ul class="em-sub">${r.m.progs.map(p => `<li><span class="em-line"><span>${esc(p.code)} · ${esc(p.name)}${p.min ? `<small>${esc(p.min)}</small>` : ''}</span><strong>${unit === 'md' ? (p.t2 >= 1000 ? md(p.t2 / 1000, 2) : `${nf(p.t2)} M€`) : pctS(100 * p.t2 / p.cp, 0)}</strong></span><span class="em-track"><span class="em-fill is-in" style="--w:${(100 * (unit === 'md' ? p.t2 / r.m.t2 : p.t2 / p.cp)).toFixed(1)}%;--c:var(--tx-3)"></span></span></li>`).join('')}</ul>` : '',
      });
      $('emStBars').querySelectorAll('.em-rows > li').forEach((li, i) => { li.classList.toggle('is-open', open.has(data[i].id)); li.querySelector('.em-line > span')?.insertAdjacentHTML('afterbegin', '<span class="em-chev" aria-hidden="true">›</span>'); li.querySelector('button')?.setAttribute('aria-expanded', open.has(data[i].id)); });
      $('emStTitle2').textContent = unit === 'md' ? `Titre 2 par mission, crédits de paiement ${S.year}` : `Part du personnel dans les crédits de chaque mission, ${S.year}`;
    }
    unitChips($('emStUnit'), u => { unit = u; draw(); });
    draw();
    const sec = list.find(m => m.code === 'SB'), def = list.find(m => m.code === 'DA');
    $('emStNote').innerHTML = `Millions d’euros, crédits de paiement du projet de loi de finances ${S.year}. Touchez une mission pour ses programmes. Le titre 2 comprend la contribution des ministères au compte des pensions (retraites de leurs agents) ; les pensions versées par ce compte (${md(S.pensions.cp / 1000)}) ne sont donc pas ajoutées ici. ${sec ? `Police et gendarmerie : ${md(sec.t2 / 1000)}` : ''}${def ? `, armées : ${md(def.t2 / 1000)} (le reste des crédits de la défense finance l’équipement)` : ''}. Source : ${link(S.url, S.source)}.`;
    $('emStSources').innerHTML = [link(S.url, 'PLF 2025 sur data.economie.gouv.fr'), '<a href="etat.html">Toutes les missions sur la page Budget de l’État</a>'].join('');
  }

  /* ---------- 5. Local authorities ---------- */
  function initLocal(D) {
    const L = D.local, years = L.levels.find(l => l.id === 'communes').years;
    const levels = L.levels.map((l, i) => ({ ...l, color: COLORS[i] }));
    const at = (l, y) => { const i = l.years.indexOf(y); return i >= 0 ? l.personnel[i] : null; };
    const op = (l, y) => { const i = l.years.indexOf(y); return i >= 0 ? l.operating[i] : null; };
    const y1 = years.at(-1), y0 = years[0];
    const tot = y => levels.reduce((s, l) => s + (at(l, y) || 0), 0);
    const pop = y => L.population[String(y)];
    const totOp = y => levels.reduce((s, l) => s + (op(l, y) || 0), 0);
    $('emLocKpis').innerHTML = [
      kpi(`Frais de personnel locaux, ${y1}`, md(tot(y1) / 1e9), `${eur(tot(y1) / pop(y1))} par habitant`),
      kpi(`Depuis ${y0}`, signedPct(100 * (tot(y1) / tot(y0) - 1)), `en euros courants ; par habitant : ${signedPct(100 * (tot(y1) / pop(y1) / (tot(y0) / pop(y0)) - 1))}`),
      kpi('Bloc communal', pctS(100 * (at(levels[0], y1) + at(levels[1], y1)) / tot(y1), 0), 'communes et intercommunalités, part du total'),
      kpi('Part des dépenses de fonctionnement', pctS(100 * tot(y1) / totOp(y1), 0), `de tous les échelons réunis, en ${y1}`),
    ].join('');
    let unit = 'md';
    function draw() {
      const k = y => unit === 'md' ? 1e9 : pop(y);
      stacked($('emLocStack'), years, levels.map(l => ({ name: l.label, color: l.color, values: years.map(y => (at(l, y) || 0) / k(y)) })),
        { format: v => unit === 'md' ? md(v, 2) : eur(v), tick: v => nf(v), label: 'Frais de personnel des collectivités par échelon' });
      $('emLocStackTitle').textContent = unit === 'md' ? 'Frais de personnel par échelon, en Md€' : 'Frais de personnel par échelon, en € par habitant';
    }
    $('emLocLegend').innerHTML = levels.map(l => `<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join('');
    unitChips($('emLocUnit'), u => { unit = u; draw(); });
    draw();
    $('emLocStackNote').innerHTML = `Euros courants, comptes ${y0}–${y1}. Touchez une année pour le détail. ${esc(L.note)} Les intercommunalités sont celles de ${y1}. Source : ${link(L.url, L.source)}.`;
    rows($('emLocShare'), levels.map(l => ({ label: l.label, value: 100 * at(l, y1) / op(l, y1), sub: `${md(at(l, y1) / 1e9, 2)} sur ${md(op(l, y1) / 1e9)} de dépenses de fonctionnement`, color: l.color })).sort((a, b) => b.value - a.value), { format: v => pctS(v, 0) });
    $('emLocShareNote').innerHTML = `${y1}. Les communes et les services d’incendie sont des employeurs de main-d’œuvre (écoles, voirie, état civil, pompiers) ; les départements versent surtout des allocations (RSA, autonomie, handicap) et les régions des subventions et des transports, d’où une part plus faible du personnel.`;

    // Communes by size
    const T = D.territory, strata = T.strata.filter(s => s.communes);
    const max = Math.max(...strata.map(s => s.q3)) * 1.05;
    const pos = v => `${(100 * v / max).toFixed(2)}%`;
    const ticks = [0, 250, 500, 750, 1000].filter(v => v <= max);
    $('emStrata').innerHTML = strata.map(s => `<div class="em-range__row" data-tip="${esc(`<strong>Communes de ${esc(s.label)} habitants</strong><table><tr><td>Communes</td><td>${nf(s.communes)}</td></tr><tr><td>Population</td><td>${nf(s.population)}</td></tr><tr><td>Frais de personnel</td><td>${money(s.personnel)}</td></tr><tr><td>Moyenne pondérée</td><td>${eur(s.personnelPerHab)} / hab.</td></tr><tr><td>Médiane</td><td>${eur(s.median)} / hab.</td></tr><tr><td>Moitié des communes entre</td><td>${nf(s.q1)} et ${nf(s.q3)} €</td></tr><tr><td>Part du fonctionnement</td><td>${pctS(100 * s.operatingShare, 0)}</td></tr></table>`)}"><span>${esc(s.label)}<small>${nf(s.communes)} communes</small></span><span class="em-range__track"><span class="em-range__iqr" style="left:${pos(s.q1)};width:${pos(s.q3 - s.q1)}"></span><span class="em-range__mean" style="left:${pos(s.personnelPerHab)}"></span><span class="em-range__med" style="left:${pos(s.median)}"></span></span><strong>${eur(s.median)}</strong></div>`).join('')
      + `<div class="em-range__axis"><span></span><div>${ticks.map(v => `<span>${nf(v)} €</span>`).join('')}</div><span></span></div>`;
    // the axis labels are spread evenly, so place them on the same scale as the bars
    const axis = $('emStrata').querySelector('.em-range__axis div'); axis.style.position = 'relative'; axis.style.height = '1rem';
    axis.querySelectorAll('span').forEach((n, i) => { n.style.position = 'absolute'; n.style.left = pos(ticks[i]); n.style.transform = i ? 'translateX(-50%)' : 'none'; });
    bindTips($('emStrata'));
    $('emStrataTitle').textContent = `Communes : frais de personnel par habitant selon la taille, ${T.year}`;
    $('emStrataLegend').innerHTML = '<span><i class="em-key em-key--med"></i>Médiane (valeur affichée)</span><span><i class="em-key em-key--iqr"></i>Moitié des communes (du 1er au 3e quartile)</span><span><i class="em-key em-key--mean"></i>Moyenne pondérée par la population</span>';
    const big = strata.find(s => s.min === 50000), small = strata.find(s => s.min === 200);
    $('emStrataNote').innerHTML = `Plus une commune est peuplée, plus ses frais de personnel par habitant sont élevés : ${eur(small.median)} pour la commune médiane de 200 à 499 habitants, ${eur(big.median)} de 50 000 à 99 999. Les villes assurent des services pour les habitants des communes voisines (équipements, culture, sport) et emploient en régie ce que les petites communes confient à leur intercommunalité. Comparez une commune à celles de sa taille, jamais à la moyenne nationale. Paris, qui est aussi un département, est comptée dans « 100 000 et plus ». Source : ${link(L.url, 'OFGL')}.`;
    $('emLocSources').innerHTML = [link(L.url, 'OFGL, comptes des collectivités'), '<a href="index.html#explorer">Chaque commune sur la carte (frais de personnel)</a>'].join('');
  }

  /* ---------- 6. Map by département ---------- */
  function initMap(D, geo) {
    const T = D.territory, deps = T.departments, by = Object.fromEntries(deps.map(d => [d.code, d]));
    const per = (d, k) => d.population ? d[k] / d.population : null;
    const WD = D.workforce.departments, wv = (d, k) => WD[d.code]?.[k] ?? null;
    const IND = [
      { id: 'admin', label: 'Agents publics', unit: 'ETP pour 1 000 habitants', val: d => wv(d, 'taux_admin_total_etp_1000hab'), fmt: v => nf(v, 1), desc: `Taux d’administration ${D.workforce.year} : emplois publics civils en équivalent temps plein, État, collectivités et hôpitaux, pour 1 000 habitants (DGAFP ; Mayotte non couverte)` },
      { id: 'adminFpe', label: 'Agents de l’État', unit: 'ETP pour 1 000 habitants', val: d => wv(d, 'taux_admin_fpe_etp_1000hab'), fmt: v => nf(v, 1), desc: 'Agents civils de l’État (enseignants, préfectures, finances publiques, police…) en ETP pour 1 000 habitants, militaires exclus' },
      { id: 'adminFpt', label: 'Agents territoriaux', unit: 'ETP pour 1 000 habitants', val: d => wv(d, 'taux_admin_fpt_etp_1000hab'), fmt: v => nf(v, 1), desc: 'Agents des communes, intercommunalités, départements, régions et de leurs établissements, en ETP pour 1 000 habitants' },
      { id: 'adminFph', label: 'Agents hospitaliers', unit: 'ETP pour 1 000 habitants', val: d => wv(d, 'taux_admin_fph_etp_1000hab'), fmt: v => nf(v, 1), desc: 'Agents des hôpitaux publics et établissements médico-sociaux publics, en ETP pour 1 000 habitants' },
      { id: 'adminEvo', label: 'Agents publics, évolution 2011–2024', unit: 'points pour 1 000 habitants', val: d => WD[d.code] && D.workforce.rateFirst[d.code] != null ? WD[d.code].taux_admin_total_etp_1000hab - D.workforce.rateFirst[d.code] : null, fmt: v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), 1)}`, desc: `Évolution du taux d’administration (ETP pour 1 000 habitants) entre 2011 et ${D.workforce.year}, ruptures de méthode comprises` },
      { id: 'perHab', label: 'Frais de personnel locaux', unit: '€ par habitant', val: d => per(d, 'personnelTotal'), fmt: v => eur(v), desc: `Frais de personnel ${T.year} des communes, intercommunalités, du département et de sa part de la région, par habitant` },
      { id: 'block', label: 'Bloc communal', unit: '€ par habitant', val: d => (d.personnel.communes + d.personnel.gfp) / d.population, fmt: v => eur(v), desc: `Frais de personnel ${T.year} des communes et intercommunalités, par habitant` },
      { id: 'growth', label: `Évolution ${T.year0}–${T.year}`, unit: '% par habitant', val: d => 100 * ((d.personnelTotal / d.population) / (d.personnel0 / d.population0) - 1), fmt: v => signedPct(v), desc: `Évolution des frais de personnel locaux par habitant entre ${T.year0} et ${T.year}, en euros courants` },
      { id: 'seats', label: 'Élus municipaux', unit: 'pour 1 000 habitants', val: d => 1000 * d.elected.municipaux / d.population, fmt: v => nf(v, 1), desc: 'Conseillers municipaux en fonction (répertoire national des élus) pour 1 000 habitants' },
      { id: 'allElected', label: 'Tous les élus locaux', unit: 'pour 1 000 habitants', val: d => 1000 * (d.elected.municipaux + d.elected.departementaux + d.elected.regionaux) / d.population, fmt: v => nf(v, 1), desc: 'Conseillers municipaux, départementaux et part des conseillers régionaux en fonction, pour 1 000 habitants' },
      { id: 'cap', label: 'Plafond indemnités maires et adjoints', unit: '€ par habitant', val: d => d.cap / d.population, fmt: v => eur(v), desc: 'Plafond légal annuel des indemnités des maires et adjoints, par habitant' },
      { id: 'small', label: 'Petites communes', unit: '% de communes de moins de 500 hab.', val: d => 100 * d.smallCommunes / d.communes, fmt: v => pctS(v, 0), desc: 'Part des communes de moins de 500 habitants' },
    ];
    let ind = IND[0], selected = null, showAll = false;
    const chipsEl = $('emMapInd');
    const GROUP = { admin: 'Agents', adminFpe: 'Agents', adminFpt: 'Agents', adminFph: 'Agents', adminEvo: 'Agents', perHab: 'Coût local', block: 'Coût local', growth: 'Coût local', seats: 'Élus', allElected: 'Élus', cap: 'Élus', small: 'Élus' };
    const SHORT = { admin: 'Tous', adminFpe: 'État', adminFpt: 'Territoriaux', adminFph: 'Hospitaliers', adminEvo: 'Évolution 2011–2024', perHab: 'Frais de personnel', block: 'Bloc communal', growth: `Évolution ${T.year0}–${T.year}`, seats: 'Municipaux', allElected: 'Tous les élus locaux', cap: 'Plafond indemnités', small: 'Petites communes' };
    chipsEl.innerHTML = [...new Set(IND.map(x => GROUP[x.id]))].map(g => `<div class="em-chipgroup"><span class="em-chipgroup__label">${esc(g)}</span><div class="chip-select em-chips-scroll" data-scroll-x>${IND.filter(x => GROUP[x.id] === g).map(x => `<button type="button" data-v="${x.id}"${x === IND[0] ? ' class="active"' : ''}>${esc(SHORT[x.id] || x.label)}</button>`).join('')}</div></div>`).join('');
    chipsEl.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      chipsEl.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      ind = IND.find(x => x.id === b.dataset.v); paint();
    });

    // geometry
    const rings = f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const feats = (geo?.features || []).filter(f => by[f.properties.code]);
    const metro = feats.filter(f => !/^97/.test(f.properties.code)), dom = ['971', '972', '973', '974', '976'].map(c => feats.find(f => f.properties.code === c)).filter(Boolean);
    function project(list, W, pad = 4, maxH = Infinity) {
      const lat0 = list.length > 20 ? 46.5 : (() => { let s = 0, n = 0; list.forEach(f => rings(f).forEach(p => p[0].forEach(([, la]) => { s += la; n++; }))); return s / n; })();
      const k = Math.cos(lat0 * Math.PI / 180);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      list.forEach(f => rings(f).forEach(poly => poly.forEach(ring => ring.forEach(([lon, lat]) => { x0 = Math.min(x0, lon * k); x1 = Math.max(x1, lon * k); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat); }))));
      const s = Math.min((W - 2 * pad) / (x1 - x0), (maxH - 2 * pad) / (y1 - y0)), H = Math.round((y1 - y0) * s + 2 * pad);
      const dx = Math.max(0, (W - 2 * pad - (x1 - x0) * s) / 2);
      const px = lon => pad + dx + (lon * k - x0) * s, py = lat => pad + (y1 - lat) * s;
      const path = f => rings(f).map(poly => poly.map(ring => `M${ring.map(([lon, lat]) => `${px(lon).toFixed(1)},${py(lat).toFixed(1)}`).join('L')}Z`).join('')).join('');
      return { H, path };
    }
    const depTip = d => {
      const v = ind.val(d);
      return `<strong>${esc(d.name)} (${esc(d.code)})</strong><span class="tx-tip__value">${ind.fmt(v)}</span> ${esc(ind.unit)}<table><tr><td>Population</td><td>${nf(d.population)}</td></tr><tr><td>Frais de personnel locaux</td><td>${money(d.personnelTotal)}</td></tr><tr><td>Communes</td><td>${nf(d.communes)}</td></tr><tr><td>Conseillers municipaux</td><td>${nf(d.elected.municipaux)}</td></tr><tr><td>Conseillers départementaux</td><td>${nf(d.elected.departementaux)}</td></tr></table>`;
    };
    function bindMap(root) {
      root.querySelectorAll('.em-dep').forEach(n => {
        const d = by[n.dataset.c];
        n.addEventListener('pointermove', event => showTip(event, depTip(d)));
        n.addEventListener('pointerleave', hideTip);
        n.addEventListener('click', () => select(d.code));
      });
    }
    function classes(values) {
      const v = values.filter(Number.isFinite).sort((a, b) => a - b);
      return [1, 2, 3, 4, 5].map(k => v[Math.floor(k * v.length / 6)]);
    }
    let breaks = [];
    const colorOf = v => Number.isFinite(v) ? RAMP[breaks.filter(b => v >= b).length] : 'var(--tx-none)';
    function paint() {
      const values = deps.map(d => ind.val(d));
      breaks = classes(values);
      document.querySelectorAll('#emMap .em-dep, #emDom .em-dep').forEach(n => { const d = by[n.dataset.c]; n.style.fill = colorOf(ind.val(d)); n.classList.toggle('is-selected', n.dataset.c === selected); });
      const lo = Math.min(...values.filter(Number.isFinite)), hi = Math.max(...values.filter(Number.isFinite));
      const edges = [lo, ...breaks, hi];
      $('emMapLegend').innerHTML = RAMP.map((c, i) => `<span><i style="background:${c}"></i>${i === 0 ? `&lt; ${ind.fmt(edges[1])}` : i === 5 ? `≥ ${ind.fmt(edges[5])}` : ind.fmt(edges[i])}</span>`).join('');
      $('emMapHead').textContent = `${ind.label}, ${ind.unit}`;
      $('emMapNote').innerHTML = `${esc(ind.desc)}. Six classes de 16 ou 17 départements chacune ; touchez un département pour son détail. ${/^admin/.test(ind.id) ? 'Paris accueille les administrations centrales des ministères, les chefs-lieux de région les services régionaux de l’État et les CHU : leurs agents servent bien au-delà du département. ' : ind.id === 'seats' || ind.id === 'small' || ind.id === 'allElected' ? 'Plus un département compte de petites communes, plus il a d’élus par habitant. ' : 'Outre-mer et Corse : collectivités uniques et traitements indexés, à comparer entre eux. '}Sources : ${/^admin/.test(ind.id) ? link(D.workforce.url, 'DGAFP, rapport annuel 2026') : ind.id === 'seats' || ind.id === 'allElected' ? link(D.territory.rne.url, 'Répertoire national des élus') : ind.id === 'cap' ? link(REF.indemnities.url, 'CGCT') : link(D.local.url, 'OFGL')}.`;
      rank();
      table();
    }
    function rank() {
      const list = deps.map(d => ({ d, v: ind.val(d) })).filter(x => Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
      const shown = showAll ? list : [...list.slice(0, 8), ...list.slice(-4)];
      const sel = selected && by[selected];
      $('emRankTitle').textContent = showAll ? `Les ${list.length} départements` : 'Les plus hauts et les plus bas';
      const pick = sel ? `<div class="em-pick"><h4>${esc(sel.name)} (${esc(sel.code)})</h4><div class="em-big">${ind.fmt(ind.val(sel))} <small style="font-size:.8rem;font-weight:500;color:var(--c-muted)">${esc(ind.unit)}</small></div><small style="color:var(--c-muted)">${list.findIndex(x => x.d === sel) + 1}e sur ${list.length}</small><dl><dt>Population</dt><dd>${nf(sel.population)}</dd>${WD[sel.code] ? `<dt>Agents publics civils (${D.workforce.year})</dt><dd>${nf(WD[sel.code].total_civils)}</dd><dt>dont État, territoriale, hospitalière</dt><dd>${nf(WD[sel.code].fpe_civils)} · ${nf(WD[sel.code].fpt)} · ${nf(WD[sel.code].fph)}</dd><dt>ETP pour 1 000 habitants</dt><dd>${nf(WD[sel.code].taux_admin_total_etp_1000hab, 1)}</dd>` : ''}<dt>Personnel des communes</dt><dd>${money(sel.personnel.communes)}</dd><dt>des intercommunalités</dt><dd>${money(sel.personnel.gfp)}</dd><dt>du département</dt><dd>${sel.personnel.departement ? money(sel.personnel.departement) : sel.code === '75' ? 'avec la commune' : 'collectivité unique'}</dd><dt>part de la région</dt><dd>${money(sel.personnel.region)}</dd><dt>Total par habitant</dt><dd>${eur(sel.personnelTotal / sel.population)}</dd><dt>Conseillers municipaux</dt><dd>${nf(sel.elected.municipaux)} · ${nf(1000 * sel.elected.municipaux / sel.population, 1)} ‰</dd><dt>dont adjoints</dt><dd>${nf(sel.elected.adjoints)}</dd><dt>Conseillers départementaux</dt><dd>${nf(sel.elected.departementaux)}</dd><dt>Députés, sénateurs</dt><dd>${nf(sel.elected.deputes)}, ${nf(sel.elected.senateurs)}</dd><dt>Plafond indemnités maires et adjoints</dt><dd>${money(sel.cap)} / an</dd></dl></div>` : '';
      const max = Math.max(...list.map(x => Math.abs(x.v)));
      $('emRank').innerHTML = pick + '<div id="emRankRows"></div>';
      rows($('emRankRows'), shown.map((x, i) => ({ id: x.d.code, label: `${list.indexOf(x) + 1}. ${x.d.name}`, value: x.v, focus: x.d.code === selected, color: colorOf(x.v) === RAMP[0] ? RAMP[1] : colorOf(x.v) })), { format: v => ind.fmt(v), max, onPick: r => select(r.id) });
      if (!showAll) $('emRankRows').querySelector('.em-rows')?.children[7]?.insertAdjacentHTML('afterend', '<li aria-hidden="true" style="text-align:center;color:var(--c-muted)">…</li>');
      $('emRankMore').textContent = showAll ? 'Réduire le classement' : `Voir les ${list.length} départements`;
    }
    $('emRankMore').addEventListener('click', () => { showAll = !showAll; rank(); });
    function select(code) {
      selected = selected === code ? null : code;
      paint();
      if (selected && innerWidth < 960) $('emRank').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // sortable table
    const S_ = f => deps.reduce((s, d) => s + f(d), 0), P_ = () => S_(d => d.population);
    const cols = [
      { k: 'name', label: 'Département', val: d => d.name, fmt: (v, d) => `${esc(d.code)} · ${esc(v)}`, text: true },
      { k: 'pop', label: 'Population', val: d => d.population, fmt: v => nf(v), foot: P_ },
      { k: 'ag', label: 'Agents publics civils', val: d => wv(d, 'total_civils') ?? NaN, fmt: v => nf(v), foot: () => S_(d => wv(d, 'total_civils') || 0) },
      { k: 'agr', label: 'ETP / 1 000 hab.', val: d => wv(d, 'taux_admin_total_etp_1000hab') ?? NaN, fmt: v => nf(v, 1) },
      { k: 'fp', label: 'Frais de personnel locaux', val: d => d.personnelTotal, fmt: v => money(v), foot: () => S_(d => d.personnelTotal) },
      { k: 'fph', label: '€ / hab.', val: d => d.personnelTotal / d.population, fmt: v => nf(v), foot: () => S_(d => d.personnelTotal) / P_() },
      { k: 'blk', label: 'dont bloc communal, € / hab.', val: d => (d.personnel.communes + d.personnel.gfp) / d.population, fmt: v => nf(v), foot: () => S_(d => d.personnel.communes + d.personnel.gfp) / P_() },
      { k: 'gr', label: `Évol. / hab. ${T.year0}–${T.year}`, val: d => 100 * ((d.personnelTotal / d.population) / (d.personnel0 / d.population0) - 1), fmt: v => signedPct(v), foot: () => 100 * ((S_(d => d.personnelTotal) / P_()) / (S_(d => d.personnel0) / S_(d => d.population0)) - 1) },
      { k: 'com', label: 'Communes', val: d => d.communes, fmt: v => nf(v), foot: () => S_(d => d.communes) },
      { k: 'seats', label: 'Conseillers municipaux', val: d => d.elected.municipaux, fmt: v => nf(v), foot: () => S_(d => d.elected.municipaux) },
      { k: 'sph', label: 'pour 1 000 hab.', val: d => 1000 * d.elected.municipaux / d.population, fmt: v => nf(v, 1), foot: () => 1000 * S_(d => d.elected.municipaux) / P_() },
      { k: 'cd', label: 'Conseillers dép.', val: d => d.elected.departementaux, fmt: v => nf(v), foot: () => S_(d => d.elected.departementaux) },
      { k: 'leg', label: 'Sièges légaux mun.', val: d => d.seats, fmt: v => nf(v), foot: () => S_(d => d.seats) },
      { k: 'cap', label: 'Plafond indemnités, € / hab.', val: d => d.cap / d.population, fmt: v => nf(v, 1), foot: () => S_(d => d.cap) / P_() },
    ];
    let sortK = 'agr', asc = false;
    function table() {
      const c = cols.find(x => x.k === sortK);
      const list = [...deps].sort((a, b) => { if (c.text) return a.name.localeCompare(b.name, 'fr') * (asc ? 1 : -1); const va = c.val(a), vb = c.val(b); if (!Number.isFinite(va)) return 1; if (!Number.isFinite(vb)) return -1; return (va - vb) * (asc ? 1 : -1); });
      $('emDepTable').innerHTML = `<table class="data-table em-sort"><thead><tr>${cols.map(x => `<th class="${x.text ? '' : 'num'}" data-k="${x.k}"${x.k === sortK ? ` aria-sort="${asc ? 'ascending' : 'descending'}"` : ''} scope="col" tabindex="0">${esc(x.label)}</th>`).join('')}</tr></thead><tbody>${list.map(d => `<tr class="${d.code === selected ? 'is-selected' : ''}">${cols.map(x => `<td class="${x.text ? '' : 'num'}">${x.fmt(x.val(d), d)}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr>${cols.map(x => `<td class="${x.text ? '' : 'num'}">${x.text ? `France (${nf(deps.length)} départements)` : x.foot ? x.fmt(x.foot()) : ''}</td>`).join('')}</tr></tfoot></table>`;
      $('emDepTable').querySelectorAll('th').forEach(th => {
        const go = () => { if (sortK === th.dataset.k) asc = !asc; else { sortK = th.dataset.k; asc = cols.find(x => x.k === sortK).text; } table(); };
        th.addEventListener('click', go); th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
    }
    $('emDepTableNote').innerHTML = `Agents publics civils au 31 décembre ${D.workforce.year} localisés dans le département (DGAFP : hors militaires et emplois non localisés, hors Mayotte) ; taux d’administration en équivalent temps plein pour 1 000 habitants. Frais de personnel ${T.year} des communes, intercommunalités (réparties selon la population de leurs communes membres), du département et de la région (répartie selon la population de ses départements), sans les syndicats, services d’incendie, CCAS et autres établissements, dont les comptes ne sont publiés ici qu’en total national. La Corse, la Martinique et la Guyane ont une collectivité unique, comptée dans la colonne « région ». Population : comptes OFGL ${T.year}. Sources : ${link(D.local.url, 'OFGL')}, ${link(REF.municipalSeats.url, 'CGCT, art. L. 2121-2')}, ${link(REF.indemnities.url, 'CGCT, art. L. 2123-23 et L. 2123-24')}.`;
    $('emMapSources').innerHTML = [link(D.workforce.url, 'DGAFP, agents par département'), link(D.territory.rne.url, 'Répertoire national des élus'), link(D.local.url, 'OFGL, comptes des collectivités'), link(REF.municipalSeats.url, 'Code général des collectivités territoriales'), '<a href="index.html#explorer">La carte de chaque commune</a>'].join('');
    const redraw = responsive($('emMap'), W => {
      if (!metro.length) { $('emMap').innerHTML = '<p class="tx-empty">Fond de carte indisponible : le classement donne les mêmes valeurs.</p>'; return; }
      const { H, path } = project(metro, W);
      $('emMap').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Carte des départements">${metro.map(f => `<path class="em-dep" data-c="${f.properties.code}" d="${path(f)}"/>`).join('')}</svg>`;
      const w = Math.max(48, Math.floor(($('emDom').clientWidth || W) / 5) - 8);
      $('emDom').innerHTML = dom.map(f => { const p = project([f], w, 3, Math.min(72, W / 7)); return `<figure><svg viewBox="0 0 ${w} ${p.H}" width="${w}" height="${p.H}" role="img" aria-label="${esc(by[f.properties.code].name)}"><path class="em-dep" data-c="${f.properties.code}" d="${p.path(f)}"/></svg><figcaption>${esc(by[f.properties.code].name)}</figcaption></figure>`; }).join('');
      bindMap($('emMap')); bindMap($('emDom'));
      paint();
    });

    return redraw;
  }

  /* ---------- 7. Elected officials ---------- */
  function initElected(D) {
    const T = D.territory, t = T.totals, M = D.mandates, ind = REF.indemnities, R = T.rne;
    const pop = t.population, by = Object.fromEntries(M.map(m => [m.id, m]));
    const cm = by.municipaux, fn = cm.functions || {};
    // distinct mandates: communautaires and arrondissement councillors are municipal councillors already; maires too
    const distinct = M.filter(m => !['maires', 'communautaires', 'arrondissements', 'consulaires', 'afe'].includes(m.id));
    const all = distinct.reduce((s, m) => s + m.count, 0);
    $('emElLead').innerHTML = `Le Répertoire national des élus, tenu par le ministère de l’Intérieur, recense ${nf(all)} mandats en France au ${new Date(R.date).toLocaleDateString('fr-FR')} : ${pctS(100 * cm.count / all, 1)} sont municipaux. Seuls le maire, les adjoints et certains conseillers délégués peuvent être indemnisés au niveau communal, dans la limite d’un plafond fixé par la loi ; conseillers départementaux, régionaux et parlementaires le sont tous.`;
    $('emElKpis').innerHTML = [
      kpi('Conseillers municipaux en fonction', nf(cm.count), `${nf(1000 * cm.count / pop, 1)} pour 1 000 habitants ; ${nf(cm.legal)} sièges prévus par la loi`),
      kpi('Maires et adjoints', nf((fn.maire || 0) + (fn.adjoint || 0)), `${nf(fn.maire)} maires, ${nf(fn.adjoint)} adjoints (au plus ${nf(t.deputiesMax)} permis), ${nf(fn.delegue)} maires délégués`),
      kpi('Agents publics parmi les élus', pctS(100 * cm.csp.public / cm.count, 0), `des conseillers municipaux ; ${pctS(100 * by.deputes.csp.public / by.deputes.count, 0)} des députés, ${pctS(100 * by.europeens.csp.public / by.europeens.count, 0)} des eurodéputés`),
      kpi('Communes de moins de 1 000 habitants', pctS(100 * t.communesUnder1000 / t.communes, 0), `des communes, ${pctS(100 * t.electedUnder1000 / t.elected, 0)} des conseillers municipaux, ${pctS(100 * t.popUnder1000 / pop, 0)} de la population`),
    ].join('');
    rows($('emMandates'), M.filter(m => !['consulaires', 'afe'].includes(m.id)).map((m, i) => ({ label: m.label, value: m.count, color: COLORS[i % COLORS.length],
      sub: `${nf(1e5 * m.count / pop, 1)} pour 100 000 habitants${m.legal ? ` · ${nf(m.legal)} sièges prévus par la loi${m.legal !== m.count ? ` (${m.count > m.legal ? '+' : '−'}${nf(Math.abs(m.count - m.legal))})` : ''}` : ''}` })), { format: v => nf(v) });
    $('emMandatesNote').innerHTML = `Mandats en cours inscrits au répertoire (mise à jour du ${new Date(R.date).toLocaleDateString('fr-FR')}). Un élu peut cumuler plusieurs mandats : les conseillers communautaires et d’arrondissement sont aussi conseillers municipaux, et un conseiller municipal peut être conseiller départemental. L’écart avec les sièges prévus par la loi vient des sièges vacants, des listes incomplètes (permises depuis 2026 dans les communes de moins de 1 000 habitants) et des communes nouvelles, qui gardent un temps un conseil plus large. Sources : ${link(R.url, R.source)} ; sièges légaux : ${link(REF.municipalSeats.url, 'CGCT, art. L. 2121-2')}, ${link(by.regionaux.url || REF.municipalSeats.url, 'Code électoral')}.`;
    // profile: professions, sex, age
    const groups = R.cspGroups, gColor = { public: 'var(--tx-1)', cadres: 'var(--tx-7)', independants: 'var(--tx-4)', agriculteurs: 'var(--tx-6)', intermediaires: 'var(--tx-3)', employes: 'var(--tx-5)', ouvriers: 'var(--tx-2)', retraites: 'var(--tx-other)', autres: 'var(--tx-none)' };
    const prof = ['municipaux', 'maires', 'departementaux', 'regionaux', 'deputes', 'senateurs', 'europeens'].map(id => by[id]).filter(Boolean);
    $('emProfile').innerHTML = prof.map(m => `<div class="em-stack__row"><span class="em-stack__label">${esc(m.label.replace(/ \(.*\)$/, ''))}<small>${pctS(100 * m.women, 0)} de femmes · âge médian ${m.medianAge} ans</small></span><span class="em-stack__bar">${groups.map(([g, l]) => m.csp[g] ? `<span style="width:${(100 * m.csp[g] / m.count).toFixed(2)}%;background:${gColor[g]}" data-tip="${esc(`<strong>${esc(m.label)}</strong>${esc(l)} : ${nf(m.csp[g])}<br>${pctS(100 * m.csp[g] / m.count)} des élus`)}"></span>` : '').join('')}</span></div>`).join('');
    $('emProfileLegend').innerHTML = groups.map(([g, l]) => `<span><i style="background:${gColor[g]}"></i>${esc(l)}</span>`).join('');
    bindTips($('emProfile'));
    $('emProfileNote').innerHTML = `Profession déclarée par chaque élu (catégorie socio-professionnelle de l’Insee). « Agents publics en activité » : cadres de la fonction publique, professeurs et professions scientifiques, professeurs des écoles, professions intermédiaires de la fonction publique, employés de la fonction publique, policiers et militaires ; les enseignants du privé sous contrat y sont aussi. Un fonctionnaire élu peut être détaché ou mis en disponibilité pendant son mandat et retrouver son poste ensuite. Source : ${link(R.url, R.source)}.`;
    const strata = T.strata.filter(s => s.communes);
    rows($('emSeatsStrata'), strata.map(s => ({ label: `${s.label} hab.`, value: 1000 * s.elected / s.population, sub: `${nf(s.elected)} conseillers en fonction (${nf(s.seats)} sièges légaux) dans ${nf(s.communes)} communes` })), { format: v => nf(v, 1) });
    $('emSeatsStrataNote').innerHTML = `Conseillers municipaux en fonction (répertoire national des élus), rattachés aux communes de ${T.year}. La loi fixe 7 conseillers sous 100 habitants, 11 de 100 à 499, 15 de 500 à 1 499… jusqu’à 69 à partir de 300 000 habitants (163 à Paris, 111 à Marseille, 73 à Lyon). ${nf(t.communesBelowLegal)} communes ont moins d’élus que de sièges prévus. Les ${nf(t.noCouncil.length)} communes sans habitant de la Meuse (villages détruits en 1916) n’ont pas de conseil municipal. Sources : ${link(R.url, 'RNE')}, ${link(REF.municipalSeats.url, 'CGCT')}.`;
    rows($('emCapStrata'), strata.map(s => ({ label: `${s.label} hab.`, value: s.capTotal / s.population, sub: `${money(s.capTotal)} par an au plus pour ${nf(s.communes)} maires et ${nf(s.deputies)} adjoints en fonction`, color: 'var(--tx-4)' })), { format: v => `${nf(v, 1)} €` });
    $('emCapNote').innerHTML = `Plafond légal annuel brut : indemnité maximale du maire et du nombre maximal d’adjoints (30 % du conseil), barème en vigueur en 2026. Maire d’une commune de moins de 500 habitants : ${eur(ind.indexMonthly * stepOf(ind.mayor, 0) / 100)} brut par mois au plus ; de 100 000 habitants et plus : ${eur(ind.indexMonthly * stepOf(ind.mayor, 100000) / 100)}. ${esc(ind.note)} Source : ${link(ind.url, ind.source)}.`;
    $('emMethodCap').innerHTML = `Le plafond des indemnités est un maximum légal : chaque conseil fixe les indemnités, souvent en dessous pour les adjoints, parfois au-dessus par des majorations. Les montants réellement versés viennent des comptes des collectivités (comptes 653) ; le plafond sert de point de comparaison. Indice de référence : ${esc(ind.indexLabel)}, ${eur(ind.indexMonthly)} brut par mois. ${esc(ind.indexNote)}`;
    const S = D.state, statePop = (D.national.years.find(r => r.year === S.year) || D.national.years.at(-1)).population;
    rows($('emPowers'), S.powers.map(p => ({ label: p.name, value: p.cp, sub: `${nf(p.cp * 1e6 / statePop, 2)} € par habitant` })).sort((a, b) => b.value - a.value), { format: v => `${nf(v, 1)} M€` });
    $('emPowersNote').innerHTML = `Dotations ${S.year} de la mission « Pouvoirs publics » : indemnités des parlementaires, leurs collaborateurs, les fonctionnaires des assemblées et le fonctionnement des institutions, dont les assemblées votent elles-mêmes le budget. Rapportée aux ${nf(by.deputes.count)} députés, la dotation de l’Assemblée nationale fait ${nf(S.powers.find(p => p.code === '511').cp / by.deputes.count, 2)} M€ par député et par an ; celle du Sénat ${nf(S.powers.find(p => p.code === '521').cp / by.senateurs.count, 2)} M€ par sénateur. Source : ${link(S.url, 'PLF 2025')}.`;
    rows($('emRegSeats'), T.regions.map(r => ({ label: r.name, value: 1e5 * r.seats / r.population, sub: `${nf(r.seats)} élus en fonction pour ${nf(r.population)} habitants` })).sort((a, b) => b.value - a.value), { format: v => nf(v, 1), max: null });
    $('emRegSeatsNote').innerHTML = `Conseillers régionaux et membres des assemblées de Corse, de Guyane et de Martinique en fonction (répertoire national des élus). Le nombre de sièges dépend peu de la population : petites régions et outre-mer ont beaucoup plus d’élus par habitant. Population : comptes OFGL ${T.year}. Source : ${link(R.url, R.source)}.`;
    $('emElSources').innerHTML = [link(R.url, 'Répertoire national des élus (data.gouv.fr)'), link(REF.municipalSeats.url, 'CGCT'), link(S.url, 'PLF 2025, Pouvoirs publics')].join('');
  }

  /* ---------- 8. My commune ---------- */
  function initCommune(D) {
    const input = $('emComInput'), list = $('emComList'), card = $('emComCard');
    let meta = null, rowsC = null, index = null, loading = null, hits = [], cursor = -1;
    const T = D.territory;
    const deps = Object.fromEntries(T.departments.map(d => [d.code, d]));
    const ensure = () => loading || (loading = Promise.all([load('./data/web/communes-meta.json'), load('./data/emplois-communes.json')]).then(([m, c]) => {
      meta = m; rowsC = c;
      index = m.rows.map((r, i) => ({ i, code: r[0], name: r[1], dep: r[2], key: norm(r[1]), pop: c.rows[i][0] || 0 }));
    }));
    input.addEventListener('focus', () => ensure(), { once: true });
    function suggest() {
      const q = norm(input.value);
      if (!index || q.length < 2) { list.hidden = true; return; }
      const exact = /^\d[\dab]\d{3}$/i.test(q) ? index.filter(x => x.code.toLowerCase() === q) : [];
      const starts = index.filter(x => x.key.startsWith(q)), inside = index.filter(x => !x.key.startsWith(q) && x.key.includes(q));
      hits = [...exact, ...starts.sort((a, b) => b.pop - a.pop), ...inside.sort((a, b) => b.pop - a.pop)].slice(0, 8);
      cursor = -1;
      list.innerHTML = hits.length ? hits.map((h, k) => `<li role="option" id="emOpt${k}" data-k="${k}">${esc(h.name)} <small>${esc(meta.departments[h.dep]?.[0] || h.dep)} · ${nf(h.pop)} hab.</small></li>`).join('') : '<li aria-disabled="true">Aucune commune trouvée</li>';
      list.hidden = false;
    }
    input.addEventListener('input', () => ensure().then(suggest));
    input.addEventListener('keydown', e => {
      if (list.hidden || !hits.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; list.querySelectorAll('li').forEach((li, k) => li.setAttribute('aria-selected', k === cursor)); input.setAttribute('aria-activedescendant', `emOpt${cursor}`); }
      if (e.key === 'Enter') { e.preventDefault(); show(hits[Math.max(0, cursor)]); }
      if (e.key === 'Escape') list.hidden = true;
    });
    list.addEventListener('pointerdown', e => { const li = e.target.closest('li[data-k]'); if (li) { e.preventDefault(); show(hits[+li.dataset.k]); } });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));

    function show(h) {
      if (!h) return;
      list.hidden = true; input.value = h.name; input.blur();
      const [pop, fpK, fp0K, pop0, fnK, cmR, adjR] = rowsC.rows[h.i];
      const fp = fpK == null ? null : fpK * 1000, fp0 = fp0K == null ? null : fp0K * 1000, fn = fnK == null ? null : fnK * 1000;
      const st = T.strata.find(s => pop >= s.min && pop < s.max);
      // percentile within communes of the same size
      const peers = rowsC.rows.filter(r => r[0] >= st.min && r[0] < st.max && r[0] > 0 && r[1] != null).map(r => r[1] * 1000 / r[0]).sort((a, b) => a - b);
      const ph = fp != null && pop ? fp / pop : null;
      const rank = ph == null ? null : peers.filter(v => v < ph).length / peers.length;
      const seats = seatsOf(h.code, pop), cap = capOf(pop, seats);
      const dep = deps[h.dep];
      const lo = peers[Math.floor(peers.length * .05)], hi = peers[Math.floor(peers.length * .95)];
      const g = v => `${Math.max(0, Math.min(100, 100 * (v - lo) / (hi - lo))).toFixed(1)}%`;
      card.innerHTML = `<div class="em-com-head"><h3>${esc(h.name)}</h3><span>${esc(dep?.name || h.dep)} · code ${esc(h.code)} · ${nf(pop)} habitants (${rowsC.year})</span></div>
        <div class="em-com-grid">
          ${kpi(`Frais de personnel ${rowsC.year}`, fp == null ? 'non publié' : money(fp), ph == null ? '' : `${eur(ph)} par habitant`)}
          ${kpi('Communes de même taille', st ? eur(st.median) : '–', st ? `médiane par habitant, ${esc(st.label)} hab. (${nf(st.communes)} communes)` : '')}
          ${kpi('Part du fonctionnement', fp != null && fn ? pctS(100 * fp / fn, 0) : '–', st ? `communes de même taille : ${pctS(100 * st.operatingShare, 0)} en moyenne` : '')}
          ${kpi(`Évolution par habitant depuis ${rowsC.year0}`, fp != null && fp0 && pop0 ? signedPct(100 * (ph / (fp0 / pop0) - 1)) : '–', fp0 ? `${money(fp0)} en ${rowsC.year0}, euros courants` : '')}
          ${kpi('Conseil municipal', seats ? `${nf(cmR)} élus` : 'aucun', seats ? `en fonction, dont ${nf(adjR)} adjoints ; ${nf(1000 * cmR / pop, 1)} pour 1 000 habitants ; la loi prévoit ${nf(seats)} sièges et ${nf(cap.deputies)} adjoints au plus` : 'commune sans habitant, administrée par une commission')}
          ${seats ? kpi('Plafond des indemnités du maire et des adjoints', `${money(cap.mayor + adjR * cap.deputy)} / an`, `avec les ${nf(adjR)} adjoints en fonction (${money(cap.total)} avec le maximum d’adjoints) ; maire : ${eur(cap.mayor / 12)} brut par mois au plus`) : ''}
        </div>
        ${ph != null && peers.length > 20 ? `<p class="note" style="margin-top:0">Frais de personnel par habitant comparés aux ${nf(peers.length)} communes de ${esc(st.label)} habitants : ${esc(h.name)} se situe au-dessus de ${nf(100 * rank, 0)} % d’entre elles.</p><div class="em-gauge" role="img" aria-label="Position parmi les communes de même taille"><b style="left:${g(ph)}" data-label="${esc(h.name)} · ${eur(ph)}"></b><b style="left:${g(st.median)};background:var(--c-muted)" data-label=""></b></div><div class="em-gauge-scale"><span>${eur(lo)}</span><span>médiane ${eur(st.median)}</span><span>${eur(hi)}</span></div><p class="note" style="margin-top:.3rem">Échelle : des 5 % de communes les plus bas aux 5 % les plus hauts de la même taille.</p>` : ''}
        <p class="note">${h.code === '75056' ? 'Paris est à la fois une commune et un département : ses frais de personnel comprennent ceux de l’action sociale départementale. ' : ''}Une commune qui gère elle-même cantine, crèche, piscine ou centre social a plus d’agents qu’une commune qui les confie à son intercommunalité ou à une association : un écart n’est pas, à lui seul, un signe de mauvaise gestion. Élus : répertoire national des élus ; le plafond d’indemnités n’est pas le montant versé. Sources : ${link(D.local.url, 'OFGL')}, ${link(T.rne.url, 'RNE')}, ${link(REF.municipalSeats.url, 'CGCT')}. <a href="index.html#explorer">Voir la commune sur la carte</a>.</p>`;
    }
  }

  /* ---------- 9. Not published ---------- */
  const GAPS = [
    { state: 'partial', title: 'Effectifs par collectivité', text: 'La DGAFP publie les effectifs par versant, par type d’employeur et par département, mais pas le nombre d’agents de chaque commune, intercommunalité ou département employeur. Les « rapports sociaux uniques » que chaque collectivité établit chaque année ne sont pas ouverts.', who: 'Collectivités, DGCL, CNFPT, centres de gestion' },
    { state: 'partial', title: 'Indemnités versées à chaque élu', text: 'Depuis 2020, chaque commune doit présenter avant le vote du budget l’état des indemnités de chacun de ses élus. Cet état n’est ni publié en données ouvertes ni centralisé : les comptes ne donnent que le total par collectivité.', who: 'Communes, intercommunalités, départements, régions, DGCL' },
    { state: 'partial', title: 'Effectifs de l’État par programme', text: 'Les plafonds d’emplois (ETPT) votés par ministère et par opérateur figurent dans les documents budgétaires en PDF et tableurs annexes, mais pas dans une série ouverte et stable qui permettrait de suivre emplois votés et emplois réalisés, programme par programme.', who: 'Direction du budget' },
    { state: 'none', title: 'Service rendu par administration', text: 'Les rapports annuels de performances mesurent des délais, des taux et des volumes d’activité, rarement un résultat pour le public (santé, niveau scolaire, sécurité) rapporté au coût de l’administration qui en a la charge, et jamais en série ouverte comparable d’une année et d’un territoire à l’autre.', who: 'Direction du budget, ministères, Cour des comptes' },
    { state: 'none', title: 'Temps de travail et absences', text: 'La durée effective du travail dans chaque collectivité (1 607 heures légales) et les taux d’absence ne sont connus que par des enquêtes et des rapports des chambres régionales des comptes, collectivité par collectivité, sans base ouverte.', who: 'Collectivités, chambres régionales des comptes, DGAFP' },
    { state: 'none', title: 'Collaborateurs et cabinets', text: 'Le nombre et le coût des collaborateurs de cabinet des exécutifs locaux, et des collaborateurs des parlementaires, ne sont pas publiés en données ouvertes, ni de façon homogène.', who: 'Collectivités, Assemblée nationale, Sénat' },
  ];
  function initGaps() {
    $('emGaps').innerHTML = GAPS.map(g => `<article class="gap"><span class="gap__state ${g.state}">${g.state === 'none' ? 'Aucune donnée ouverte' : 'Données partielles'}</span><h3>${esc(g.title)}</h3><p>${esc(g.text)}</p><p class="em-who">Qui pourrait le publier : ${esc(g.who)}</p></article>`).join('');
  }

  function init([D, geo]) {
    REF = D.reference;
    initNational(D);
    initWorkforce(D);
    initEurope(D);
    initPistes(D);
    initFunctions(D);
    initState(D);
    initLocal(D);
    initMap(D, geo);
    initElected(D);
    initCommune(D);
    initGaps();
    $('emSources').innerHTML = [
      link(D.national.url, 'Insee, comptes de la Nation'), link(D.functions.url, 'Eurostat, dépenses par fonction'), link(D.state.url, 'PLF 2025'),
      link(D.local.url, 'OFGL, comptes des collectivités'), link(D.workforce.url, 'DGAFP, rapport annuel 2026'), link(D.territory.rne.url, 'Répertoire national des élus'), link(REF.municipalSeats.url, 'Légifrance, CGCT'),
    ].join('');
    window.addEventListener('frl-theme', () => window.dispatchEvent(new Event('resize')));
    FRL.keepHash();
  }

  Promise.all([load('./data/emplois.json'), load('./data/departments.geojson').catch(() => null)]).then(init).catch(error => {
    console.error(error);
    $('emNatChart').innerHTML = '<p class="tx-empty">Données indisponibles. Le site doit être servi par HTTP.</p>';
  });
})();
