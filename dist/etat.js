/* Budget de l'État: PLF 2025 by mission, programme and action (AE and CP), by nature, receipts, the monthly budget situation
   (2024 onwards, with the PDF archive since 2010), RAP 2025 performance indicators, the PLF 2026 green budget, official
   development assistance 2018-2024 and the State's general accounts 2016-2025. One data file: data/etat.json
   (scripts/etat-data.py). Amounts are stored in millions of euros. Charts are SVG or HTML strings redrawn on resize;
   colours come from the --tx-* tokens of style.css. */
(() => {
  const { esc, load } = FRL;
  const $ = id => document.getElementById(id);
  const nf = (value, digits = 1) => value.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  /* M€ -> readable */
  const meur = value => {
    if (value == null || !Number.isFinite(value)) return '–';
    const a = Math.abs(value);
    if (a >= 1000) return `${nf(value / 1000, a >= 100000 ? 0 : a >= 10000 ? 1 : 2)} Md€`;
    if (a >= 10) return `${nf(value, 0)} M€`;
    if (a >= 1) return `${nf(value, 1)} M€`;
    if (a === 0) return '0 €';
    return `${nf(value * 1000, 0)} k€`;
  };
  const md = (value, digits = 1) => value == null || !Number.isFinite(value) ? '–' : `${nf(value / 1000, digits)} Md€`;
  const pct = (value, digits = 1) => value == null || !Number.isFinite(value) ? '–' : `${nf(value, digits)} %`;
  const link = (url, text) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").toLowerCase();
  const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const sum = (list, f = x => x) => list.reduce((s, x) => s + (f(x) || 0), 0);
  const kpis = list => list.map(([a, b, c, alert]) => `<div class="kpi${alert ? ' is-alert' : ''}"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${c}</small></div>`).join('');
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  /* Fixed colour per budget title (colour follows the title, never its rank). */
  const TITRE_SLOT = { 2: '1', 6: '2', 3: '3', 4: '4', 5: '7', 7: '5', 1: 'other' };
  const TITRE_ORDER = ['2', '3', '6', '4', '5', '7', '1'];
  const titreColor = t => `var(--tx-${TITRE_SLOT[t] || 'other'})`;
  const lightSlot = t => ['3', '4', '5', 'other'].includes(TITRE_SLOT[t] || 'other');

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
  /* Elements carrying data-tip show it on hover. */
  function tipsOn(el) {
    el.addEventListener('pointermove', event => { const n = event.target.closest?.('[data-tip]'); if (!n) { hideTip(); return; } showTip(event, n.dataset.tip); });
    el.addEventListener('pointerleave', hideTip);
  }

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

  /* ---------- Line chart: one or several series on categorical x positions, one y axis ---------- */
  function lines(el, series, { labels, height = 280, format = v => nf(v), tickFormat = format, aria = '', area = false, tipTitle = i => labels[i] } = {}) {
    const draw = W => {
      const all = series.flatMap(s => s.values.filter(Number.isFinite));
      if (!all.length) { el.innerHTML = '<p class="tx-empty">Série indisponible.</p>'; return; }
      const narrow = W < 560, H = height, L = narrow ? 46 : 60, R = narrow ? 12 : 64, T = 16, B = 28, n = labels.length;
      const x = i => L + (W - L - R) * (n === 1 ? .5 : i / (n - 1));
      let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
      const step = niceStep(hi - lo || 1); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step || step;
      const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
      let svg = '';
      for (let v = lo; v <= hi + step / 2; v += step) svg += `<line class="${Math.abs(v) < step / 1e6 ? 'tx-axis' : 'tx-grid'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${tickFormat(v)}</text>`;
      const every = Math.max(1, Math.ceil(n / Math.floor((W - L - R) / 46)));
      labels.forEach((lab, i) => { if (i % every === 0 || i === n - 1 && n < 16) svg += `<text class="tx-tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(lab)}</text>`; });
      const ends = [];
      series.forEach(s => {
        const pts = s.values.map((v, i) => [i, v]).filter(p => Number.isFinite(p[1]));
        if (!pts.length) return;
        const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
        if (area && series.length === 1) svg += `<path class="tx-line-area" d="${d}L${x(pts.at(-1)[0])},${y(Math.max(lo, 0))}L${x(pts[0][0])},${y(Math.max(lo, 0))}Z" style="fill:${s.color}"/>`;
        svg += `<path class="tx-line-path" d="${d}" style="stroke:${s.color}"/>`;
        if (pts.length < 3) svg += pts.map(([i, v]) => `<circle class="tx-focus" cx="${x(i)}" cy="${y(v)}" r="4" style="stroke:${s.color}"/>`).join('');
        const [li, lv] = pts.at(-1); ends.push({ s, x: x(li), y: y(lv) });
      });
      // direct labels at line ends, nudged apart (series count stays small)
      if (series.length > 1 && !narrow) {
        ends.sort((a, b) => a.y - b.y);
        for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
        ends.forEach(e => { svg += `<text class="tx-label tx-halo" x="${e.x + 7}" y="${e.y + 4}">${esc(e.s.name)}</text>`; });
      }
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}">${svg}<g class="tx-hover"></g><rect class="tx-hit" x="${L - 10}" y="0" width="${W - L - R + 20}" height="${H}"/></svg>`;
      const hover = el.querySelector('.tx-hover'), hit = el.querySelector('.tx-hit');
      hit.addEventListener('pointermove', event => {
        const box = el.querySelector('svg').getBoundingClientRect(), mx = (event.clientX - box.left) * W / box.width;
        const i = Math.max(0, Math.min(n - 1, Math.round((mx - L) / (W - L - R) * (n - 1))));
        hover.innerHTML = `<line class="tx-cursor" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/>` + series.filter(s => Number.isFinite(s.values[i])).map(s => `<circle class="tx-focus" cx="${x(i)}" cy="${y(s.values[i])}" r="4.5" style="stroke:${s.color}"/>`).join('');
        const rows = series.filter(s => Number.isFinite(s.values[i]));
        showTip(event, `<strong>${esc(tipTitle(i))}</strong>${rows.length ? `<table>${rows.map(s => `<tr><td><i style="background:${s.color}"></i>${esc(s.name)}</td><td>${format(s.values[i])}</td></tr>`).join('')}</table>` : 'non publié'}`);
      });
      hit.addEventListener('pointerleave', () => { hover.innerHTML = ''; hideTip(); });
    };
    return responsive(el, draw);
  }

  /* ---------- Horizontal bars ---------- */
  function hbars(el, rows, { format = meur, max = null, color = null } = {}) {
    if (!rows.length) { el.innerHTML = '<p class="tx-empty">Aucune donnée publiée.</p>'; return; }
    const top = max ?? Math.max(...rows.map(r => Math.abs(r.value || 0)), 1e-9);
    el.innerHTML = `<ul class="tx-bars">${rows.map(r => `<li class="${r.focus ? 'is-focus' : ''}"><div class="tx-bars__line"><span>${esc(r.label)}${r.sub ? `<small>${r.sub}</small>` : ''}</span><strong>${format(r.value)}</strong></div><span class="tx-bars__track" aria-hidden="true"><span class="tx-bars__fill" style="--w:${(100 * Math.abs(r.value || 0) / top).toFixed(2)}%${r.color || color ? `;background:${r.color || color}` : ''}"></span></span></li>`).join('')}</ul>`;
    requestAnimationFrame(() => el.querySelectorAll('.tx-bars__fill').forEach(n => { n.style.width = n.style.getPropertyValue('--w'); }));
  }

  /* ---------- 100 % stacked horizontal bars: rows [{label, sub, total, parts: [{key, value, color, label}]}] ---------- */
  function stacks(el, rows, { format = meur, totalFormat = format, legend = null, legendEl = null, onRow = null } = {}) {
    el.innerHTML = `<ul class="et-stack__rows">${rows.map((r, ri) => {
      const total = sum(r.parts, p => Math.max(0, p.value));
      return `<li${onRow ? ` class="is-link" data-row="${ri}" tabindex="0" role="button"` : ''}><div class="et-stack__label"><span>${esc(r.label)}${r.sub ? `<small>${r.sub}</small>` : ''}</span><strong>${totalFormat(r.total ?? total)}</strong></div><div class="et-stack__bar">${r.parts.filter(p => p.value > 0).map(p => `<span style="flex-grow:${(p.value / (total || 1)).toFixed(5)};background:${p.color}" data-tip="${esc(`<strong>${esc(r.label)}</strong>${esc(p.label)} : <span class="tx-tip__value">${format(p.value)}</span> · ${pct(100 * p.value / (total || 1), 0)}`)}"></span>`).join('')}</div></li>`;
    }).join('')}</ul>`;
    tipsOn(el);
    if (onRow) {
      const go = n => { const li = n.closest?.('[data-row]'); if (li) onRow(rows[+li.dataset.row]); };
      el.onclick = event => go(event.target);
      el.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(event.target); } };
    }
    if (legendEl && legend) legendEl.innerHTML = legend.map(l => `<span><i style="background:${l.color}"></i>${esc(l.label)}${l.value != null ? ` <b>${esc(l.value)}</b>` : ''}</span>`).join('');
  }

  load('./data/etat.json').then(init).catch(error => {
    console.error(error);
    $('etTreemap').innerHTML = '<p class="tx-empty">Données indisponibles. Le site doit être servi par HTTP.</p>';
  });

  function init(data) {
    const S = data.sources;
    const src = (id, text) => link(S[id]?.page || S[id]?.download, text);
    const TITRES = data.titres;

    /* ======================================================= Missions */
    const missions = data.missions;
    const rd = missions.find(m => m.type === 'BG' && m.code === 'RD');
    const bg = missions.filter(m => m.type === 'BG');
    const bgNet = bg.filter(m => m !== rd);
    const others = missions.filter(m => m.type !== 'BG');
    const totBg = sum(bg, m => m.cp), totNet = sum(bgNet, m => m.cp), aeNet = sum(bgNet, m => m.ae);
    $('etRdAmount').textContent = md(rd.cp, 0);
    const progCount = sum(missions, m => m.progs.length);
    const monthly = data.monthly;
    const mLine = label => monthly.lines.find(l => l.label === label);
    const at = date => monthly.dates.indexOf(date);
    const lastDate = monthly.dates.at(-1);
    const dec25 = at('2025-12-31');
    const solde25 = mLine('Solde budgétaire').values[dec25];
    $('etKpis').innerHTML = kpis([
      ['Budget général, PLF 2025', md(totNet, 1), `crédits de paiement, hors ${md(rd.cp, 0)} de remboursements et dégrèvements d’impôts (${md(totBg, 0)} brut)`],
      ['Missions et programmes', `${missions.length} · ${progCount}`, `dont ${bg.length} missions du budget général ; ${others.length} comptes spéciaux et budgets annexes`],
      ['Solde exécuté 2025', md(solde25, 1), `situation de décembre 2025 : ce que l’État a payé de plus qu’il n’a encaissé`, true],
      ['Indicateurs de performance', nf(data.rap.rows.length, 0), 'indicateurs et sous-indicateurs dans les rapports annuels de performance 2025']
    ]);

    let scope = 'bg', credit = 'cp', path = [];
    const scopeList = () => scope === 'bg' ? bgNet : scope === 'bgall' ? bg : others;
    const dominant = titres => Object.entries(titres || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '1';
    const nodeOf = () => {
      if (!path.length) return { level: 0, items: scopeList().map(m => ({ id: m.type + m.code, name: m.name, ae: m.ae, cp: m.cp, titre: dominant(m.titres), ref: m })) };
      const mi = path[0];
      if (path.length === 1) return { level: 1, items: mi.progs.map(p => ({ id: p.code, name: `${p.code} · ${p.name}`, ae: p.ae, cp: p.cp, titre: dominant(p.titres), ref: p })) };
      const pr = path[1];
      return { level: 2, items: pr.actions.map(a => ({ id: a.code, name: a.name, ae: a.ae, cp: a.cp, titre: dominant(pr.titres), ref: a })) };
    };
    const fitText = (w, long, short) => long.length * 6.4 < w - 12 ? long : short.length * 6.4 < w - 12 ? short : '';
    const tmEl = $('etTreemap');
    let cells = [];
    const drawTreemap = W => {
      const H = Math.round(tmEl.clientHeight || 480);
      const node = nodeOf();
      const items = node.items.filter(it => it[credit] > 0).map(it => ({ ...it, value: it[credit] })).sort((a, b) => b.value - a.value);
      const total = sum(items, it => it.value);
      cells = squarify(items, 0, 0, W, H);
      tmEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="Crédits, surface proportionnelle au montant">${cells.map((c, i) => {
        const fits = c.w > 60 && c.h > 30, big = c.w > 60 && c.h > 48;
        const maxChars = Math.floor((c.w - 12) / 6.6);
        const text = c.name.length > maxChars ? `${c.name.slice(0, Math.max(1, maxChars - 1))}…` : c.name;
        return `<g class="tx-cell${lightSlot(c.titre) ? ' is-light' : ''}" data-i="${i}" tabindex="0" role="button" aria-label="${esc(c.name)} : ${esc(meur(c.value))}"><rect x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" width="${Math.max(0, c.w).toFixed(2)}" height="${Math.max(0, c.h).toFixed(2)}" rx="${Math.min(3, c.w / 3, c.h / 3).toFixed(1)}" fill="${titreColor(c.titre)}"/>${fits ? `<text x="${(c.x + 7).toFixed(1)}" y="${(c.y + 18).toFixed(1)}">${esc(text)}</text>` : ''}${big && fitText(c.w, `${meur(c.value)} · ${pct(100 * c.value / total, 1)}`, meur(c.value)) ? `<text class="tx-cell__value" x="${(c.x + 7).toFixed(1)}" y="${(c.y + 34).toFixed(1)}">${fitText(c.w, `${meur(c.value)} · ${pct(100 * c.value / total, 1)}`, meur(c.value))}</text>` : ''}</g>`;
      }).join('')}</svg>`;
      const present = new Set(items.map(it => it.titre));
      $('etLegend').innerHTML = `<span class="muted">Couleur : nature principale des crédits de paiement</span>${TITRE_ORDER.filter(t => present.has(t)).map(t => `<span><i style="background:${titreColor(t)}"></i>${esc(TITRES[t])}</span>`).join('')}`;
      const label = credit === 'cp' ? 'crédits de paiement' : 'autorisations d’engagement';
      const where = !path.length ? (scope === 'bg' ? 'budget général hors remboursements et dégrèvements' : scope === 'bgall' ? 'budget général, remboursements et dégrèvements compris' : 'comptes spéciaux et budgets annexes (ils ne s’additionnent pas au budget général)') : path.length === 1 ? `mission « ${path[0].name} »` : `programme ${path[1].code}`;
      $('etTreemapNote').innerHTML = `${items.length} ${['missions', 'programmes', 'actions'][node.level]}, ${md(total, 1)} de ${label} au total (${esc(where)}), PLF 2025. ${node.level === 2 ? 'Les montants par action sont indicatifs. ' : ''}Source : ${src('plf25-depenses-destination', 'PLF 2025, dépenses selon destination')}.`;
      $('etCrumbs').innerHTML = `<button type="button" data-depth="0"${path.length ? '' : ' aria-current="true"'}>${esc({ bg: 'Budget général', bgall: 'Budget général complet', other: 'Comptes spéciaux et budgets annexes' }[scope])}</button>${path.map((p, i) => `<span aria-hidden="true">›</span><button type="button" data-depth="${i + 1}"${i === path.length - 1 ? ' aria-current="true"' : ''}>${esc(i === 0 ? p.name : `Programme ${p.code}`)}</button>`).join('')}`;
    };
    const redrawTreemap = responsive(tmEl, drawTreemap);
    const tipCell = c => {
      const total = sum(cells, x => x.value);
      return `<strong>${esc(c.name)}</strong><span class="tx-tip__value">${meur(c.value)}</span> · ${pct(100 * c.value / total, 1)}<br>AE ${meur(c.ae)} · CP ${meur(c.cp)}${c.ref.progs ? `<br>${c.ref.progs.length} programme${c.ref.progs.length > 1 ? 's' : ''}` : c.ref.actions ? `<br>${c.ref.actions.length} action${c.ref.actions.length > 1 ? 's' : ''}` : ''}`;
    };
    tmEl.addEventListener('pointermove', event => { const g = event.target.closest?.('.tx-cell'); if (!g) { hideTip(); return; } showTip(event, tipCell(cells[+g.dataset.i])); });
    tmEl.addEventListener('pointerleave', hideTip);
    const openCell = i => {
      const c = cells[i]; if (!c) return;
      if (c.ref.progs) { path = [c.ref]; detailMission(c.ref); }
      else if (c.ref.actions) { path = [path[0], c.ref]; detailProgramme(path[0], c.ref); }
      else { detailAction(path[0], path[1], c.ref); return; }
      redrawTreemap();
    };
    tmEl.addEventListener('click', event => { const g = event.target.closest?.('.tx-cell'); if (g) { hideTip(); openCell(+g.dataset.i); } });
    tmEl.addEventListener('keydown', event => { const g = event.target.closest?.('.tx-cell'); if (g && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openCell(+g.dataset.i); } });
    $('etCrumbs').addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      path = path.slice(0, +b.dataset.depth);
      if (path.length === 1) detailMission(path[0]); else if (!path.length) detailScope();
      redrawTreemap();
    });
    const chips = (id, attr, fn) => $(id).addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      $(id).querySelectorAll('button').forEach(n => n.classList.toggle('active', n === b));
      fn(b.dataset[attr]);
    });
    chips('etScope', 'scope', v => { scope = v; path = []; detailScope(); redrawTreemap(); });
    chips('etCredit', 'credit', v => { credit = v; redrawTreemap(); });

    const titreBars = titres => {
      const entries = TITRE_ORDER.filter(t => titres?.[t]).map(t => [t, titres[t]]);
      const total = sum(entries, e => Math.max(0, e[1]));
      return entries.length ? `<div class="et-mini">${entries.map(([t, v]) => `<div><span><i style="background:${titreColor(t)}"></i>${esc(TITRES[t])}</span><strong>${meur(v)}</strong><em style="--w:${(100 * Math.max(0, v) / (total || 1)).toFixed(1)}%;--c:${titreColor(t)}"></em></div>`).join('')}</div>` : '';
    };
    const perfLink = m => {
      const code = m.code, n = data.rap.rows.filter(r => data.rap.missions[r[0]][1] === code).length;
      return n ? `<p class="note"><button type="button" class="tx-rowlink" data-perf="${esc(code)}">Voir ses ${n} indicateurs de performance 2025</button></p>` : '';
    };
    const detail = $('etDetail');
    detail.addEventListener('click', event => {
      const b = event.target.closest('[data-perf]'); if (b) { openPerf(b.dataset.perf); return; }
      const p = event.target.closest('[data-prog]'); if (p && path[0]) { const pr = path[0].progs.find(x => x.code === p.dataset.prog); if (pr) { path = [path[0], pr]; detailProgramme(path[0], pr); redrawTreemap(); } }
    });
    function detailScope() {
      const list = scopeList(), cp = sum(list, m => m.cp), ae = sum(list, m => m.ae);
      const titres = {}; list.forEach(m => Object.entries(m.titres).forEach(([t, v]) => { titres[t] = (titres[t] || 0) + v; }));
      detail.innerHTML = `<span class="tx-pill">PLF 2025</span><h3>${esc({ bg: 'Budget général, hors remboursements et dégrèvements', bgall: 'Budget général, remboursements et dégrèvements compris', other: 'Comptes spéciaux et budgets annexes' }[scope])}</h3>
        <div class="tx-amount">${md(cp, 1)}</div><p class="note">crédits de paiement · ${md(ae, 1)} d’autorisations d’engagement · ${list.length} missions</p>
        <h4 class="et-h4">Par nature (crédits de paiement)</h4>${titreBars(titres)}
        <p class="note">${scope === 'other' ? 'Ces comptes reçoivent une partie de leurs recettes du budget général (par exemple les contributions employeur au compte « Pensions ») : ne pas les additionner au budget général.' : 'Cliquez sur une mission pour voir ses programmes.'}</p>`;
    }
    function detailMission(m) {
      const list = m.type === 'BG' && m !== rd ? bgNet : m.type === 'BG' ? bg : others, tot = sum(list, x => x.cp);
      detail.innerHTML = `<span class="tx-pill">${esc(data.budgets[m.type])}</span><h3>${esc(m.name)}</h3>
        <div class="tx-amount">${md(m.cp, 2)}</div><p class="note">crédits de paiement 2025 · ${pct(100 * m.cp / tot, 1)} du périmètre</p>
        <dl><dt>Autorisations d’engagement</dt><dd>${meur(m.ae)}</dd><dt>Écart AE − CP</dt><dd>${meur(m.ae - m.cp)}${Math.abs(m.ae - m.cp) > 0.05 * m.cp ? ' <span class="muted">(engagements pluriannuels)</span>' : ''}</dd><dt>Programmes</dt><dd>${m.progs.length}</dd><dt>Ministères</dt><dd>${esc([...new Set(m.progs.map(p => p.min))].join(', '))}</dd></dl>
        <h4 class="et-h4">Par nature</h4>${titreBars(m.titres)}
        <h4 class="et-h4">Programmes</h4><ul class="et-list">${m.progs.map(p => `<li><button type="button" class="tx-rowlink" data-prog="${esc(p.code)}">${esc(p.code)} · ${esc(p.name)}</button><span>${meur(p.cp)}</span></li>`).join('')}</ul>
        ${perfLink(m)}`;
    }
    function detailProgramme(m, p) {
      detail.innerHTML = `<span class="tx-pill">Programme ${esc(p.code)}</span><h3>${esc(p.name)}</h3>
        <div class="tx-amount">${md(p.cp, 2)}</div><p class="note">crédits de paiement 2025 · ${pct(100 * p.cp / m.cp, 1)} de la mission « ${esc(m.name)} »</p>
        <dl><dt>Autorisations d’engagement</dt><dd>${meur(p.ae)}</dd><dt>Ministère</dt><dd>${esc(p.min)}</dd><dt>Actions</dt><dd>${p.actions.length}</dd></dl>
        <h4 class="et-h4">Par nature</h4>${titreBars(p.titres)}
        <h4 class="et-h4">Actions</h4><ul class="et-list">${p.actions.map(a => `<li><span>${esc(a.name)}</span><span>${meur(a.cp)}</span></li>`).join('')}</ul>${perfLink(m)}`;
    }
    function detailAction(m, p, a) {
      detail.innerHTML = `<span class="tx-pill">Action ${esc(a.code)}</span><h3>${esc(a.name)}</h3>
        <div class="tx-amount">${md(a.cp, 2)}</div><p class="note">crédits de paiement 2025 · ${pct(100 * a.cp / (p.cp || 1), 1)} du programme ${esc(p.code)} · AE ${meur(a.ae)}</p>
        <p class="note">Le montant d’une action est une prévision : le responsable du programme peut redistribuer les crédits entre actions en cours d’année.</p>`;
    }
    detailScope();

    /* Table of missions and programmes */
    const tableEl = $('etMisTable');
    const open = new Set();
    const drawTable = () => {
      const q = norm($('etMisSearch').value.trim());
      const rows = [];
      ['BG', 'CAS', 'CCF', 'BA'].forEach(type => {
        const list = missions.filter(m => m.type === type);
        const hits = list.map(m => ({ m, progs: q ? m.progs.filter(p => norm(p.name + ' ' + p.code + ' ' + p.min).includes(q)) : m.progs, self: !q || norm(m.name).includes(q) })).filter(x => x.self || x.progs.length);
        if (!hits.length) return;
        const tot = sum(list, m => m.cp);
        rows.push(`<tr class="et-group"><td colspan="5">${esc(data.budgets[type])} · ${md(tot, 1)} de CP${type === 'BG' ? `, dont ${md(rd.cp, 1)} de remboursements et dégrèvements` : ''}</td></tr>`);
        hits.forEach(({ m, progs, self }) => {
          const expanded = open.has(m.type + m.code) || (q && !self) || (q && progs.length && progs.length < m.progs.length);
          rows.push(`<tr><td class="tx-name"><button type="button" class="tx-rowlink" data-m="${esc(m.type + m.code)}" aria-expanded="${expanded}">${expanded ? '▾' : '▸'} ${esc(m.name)}</button></td><td class="num">${m.progs.length}</td><td class="num">${meur(m.ae)}</td><td class="num">${meur(m.cp)}</td><td class="tx-bar-cell"><span class="tx-minibar" style="width:${(100 * m.cp / Math.max(...missions.map(x => x.cp))).toFixed(1)}%;background:${titreColor(dominant(m.titres))}"></span></td></tr>`);
          if (expanded) (q && !self ? progs : m.progs).forEach(p => rows.push(`<tr class="is-sub"><td>${esc(p.code)} · ${esc(p.name)} <span class="muted">(${esc(p.min)})</span></td><td class="num">${p.actions.length} act.</td><td class="num">${meur(p.ae)}</td><td class="num">${meur(p.cp)}</td><td></td></tr>`));
        });
      });
      tableEl.innerHTML = rows.length ? `<table class="data-table tx-table et-mis-table"><thead><tr><th>Mission, programme</th><th class="num">Programmes</th><th class="num">AE 2025</th><th class="num">CP 2025</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="tx-empty">Aucune mission ni aucun programme ne correspond.</p>';
    };
    tableEl.addEventListener('click', event => { const b = event.target.closest('[data-m]'); if (!b) return; open.has(b.dataset.m) ? open.delete(b.dataset.m) : open.add(b.dataset.m); drawTable(); });
    $('etMisSearch').addEventListener('input', drawTable);
    drawTable();
    $('etMisTableNote').innerHTML = `Montants du projet de loi de finances 2025, en euros courants, crédits du budget général hors fonds de concours. Cliquez sur une mission pour ses programmes. Source : ${src('plf25-depenses-destination', 'PLF 2025, dépenses selon destination (Direction du budget)')}.`;

    /* ======================================================= Nature */
    const nat = data.nature;
    const plfTitre = t => sum(nat.titres.filter(r => r.budget === 'BG' && !r.rd && r.titre === t), r => r.cp);
    const EXEC_LABEL = { 1: 'Dotation des pouvoirs publics', 2: 'Dépenses de personnel', 3: 'Dépenses de fonctionnement', 4: 'Charges de la dette', 5: 'Dépenses d’investissement', 6: 'Dépenses d’intervention', 7: 'Dépenses d’opérations financières' };
    const execTitre = t => monthly.lines.find(l => l.cat === 'Dépenses' && l.sub === 'Budget général' && norm(l.label).startsWith(norm(EXEC_LABEL[t])))?.values[dec25];
    const cmp = TITRE_ORDER.map(t => ({ t, plf: plfTitre(t), exec: execTitre(t) })).sort((a, b) => b.plf - a.plf);
    const cmpMax = Math.max(...cmp.flatMap(r => [r.plf, r.exec || 0]));
    $('etNatCompare').innerHTML = `<ul class="et-pairs">${cmp.map(r => `<li><div class="tx-bars__line"><span>${esc(TITRES[r.t])}</span><strong>${md(r.plf, 1)} · ${md(r.exec, 1)}</strong></div><span class="et-pairs__bar" style="--w:${(100 * r.plf / cmpMax).toFixed(1)}%;--c:var(--tx-1)" data-tip="${esc(`<strong>${esc(TITRES[r.t])}</strong>PLF 2025 : <span class="tx-tip__value">${md(r.plf, 2)}</span>`)}"></span><span class="et-pairs__bar" style="--w:${(100 * (r.exec || 0) / cmpMax).toFixed(1)}%;--c:var(--tx-2)" data-tip="${esc(`<strong>${esc(TITRES[r.t])}</strong>Exécuté 2025 : <span class="tx-tip__value">${md(r.exec, 2)}</span><br>Écart au PLF : ${md((r.exec || 0) - r.plf, 2)}`)}"></span></li>`).join('')}</ul>`;
    tipsOn($('etNatCompare'));
    const plfNet = sum(cmp, r => r.plf), execNet = sum(cmp, r => r.exec);
    $('etNatCompareNote').innerHTML = `Total : ${md(plfNet, 1)} prévus au PLF, ${md(execNet, 1)} payés (dépenses nettes du budget général, ${link(monthly.pdfs.find(p => /décembre/i.test(p.title) && /2025/.test(p.title))?.url, 'situation de décembre 2025')}). La loi votée en février 2025 et les lois de finances rectificatives ont modifié le projet ; les opérations financières, en particulier, ne sont pas comptées de la même façon en prévision et en exécution. Sources : ${src('plf25-depenses-nature', 'PLF 2025 par nature')}, ${src('etat-situations-mensuelles', 'situations mensuelles budgétaires')}.`;
    const cats = nat.categories.filter(c => !c.rd).sort((a, b) => b.cp - a.cp);
    hbars($('etNatCats'), cats.slice(0, 14).map(c => ({ label: c.label, sub: esc(TITRES[c.titre]), value: c.cp, color: titreColor(c.titre) })), { format: v => md(v, 1) });
    const fdc = sum(nat.titres.filter(r => r.budget === 'BG'), r => r.fdcCp);
    const rdCats = nat.categories.filter(c => c.rd).sort((a, b) => b.cp - a.cp);
    $('etNatCatsNote').innerHTML = `${cats.length} catégories ; les plus petites ne sont pas affichées. Les remboursements et dégrèvements (${md(rd.cp, 1)}, exclus ici) sont classés en transferts : ${rdCats.map(c => `${esc(c.label.toLowerCase())} ${md(c.cp, 1)}`).join(', ')}. S’y ajoutent ${md(fdc, 2)} de fonds de concours prévus (dons et participations affectés à une dépense). Source : ${src('plf25-depenses-nature', 'PLF 2025, nomenclatures destination et nature')}.`;
    const natRows = bgNet.slice().sort((a, b) => b.cp - a.cp).map(m => ({ label: m.name, total: m.cp, parts: TITRE_ORDER.map(t => ({ key: t, value: m.titres[t] || 0, color: titreColor(t), label: TITRES[t] })) }));
    stacks($('etNatStack'), natRows, { format: v => meur(v), legend: TITRE_ORDER.map(t => ({ color: titreColor(t), label: TITRES[t], value: md(plfTitre(t), 1) })), legendEl: $('etNatStackLegend') });
    $('etNatStackNote').textContent = 'Chaque barre fait 100 % des crédits de paiement de la mission, classées de la plus grosse à la plus petite (montant à droite). Survolez un segment pour son montant. La charge de la dette est presque entièrement dans « Engagements financiers de l’État » ; les salaires des enseignants font l’essentiel de « Enseignement scolaire ».';

    /* ======================================================= Receipts */
    const R = data.recettes;
    const g = key => sum(R.lines.filter(l => l.g === key), l => l.v);
    const fiscal = g('fiscal'), nonfiscal = g('nonfiscal'), psrCt = g('psr-ct'), psrUe = g('psr-ue');
    const netReceipts = fiscal - rd.cp + nonfiscal - psrCt - psrUe;
    const soldeBg = netReceipts - totNet;
    const specialDep = type => sum(missions.filter(m => m.type === type), m => m.cp);
    const specialRec = type => sum(R.special.filter(s => s.type === type), s => s.v);
    const soldeCas = specialRec('CAS') - specialDep('CAS'), soldeCcf = specialRec('CCF') - specialDep('CCF');
    const box = (label, value, sub, op = '', cls = '') => `<div class="et-flow__item ${cls}">${op ? `<b class="et-flow__op" aria-hidden="true">${op}</b>` : ''}<span>${esc(label)}</span><strong>${md(value, 1)}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
    $('etRecFlow').innerHTML = `<div class="et-flow__row">${box('Recettes fiscales brutes', fiscal, `${R.lines.filter(l => l.g === 'fiscal').length} lignes`)}${box('Remboursements et dégrèvements', -rd.cp, 'impôt rendu', '−')}${box('Recettes non fiscales', nonfiscal, 'dividendes, amendes, redevances', '+')}${box('Prélèvements pour les collectivités', -psrCt, 'dotation globale de fonctionnement…', '−')}${box('Prélèvement pour l’Union européenne', -psrUe, 'contribution au budget européen', '−')}${box('Recettes nettes', netReceipts, 'disponibles pour les missions', '=', 'is-total')}</div>
      <div class="et-flow__row">${box('Recettes nettes', netReceipts, '')}${box('Dépenses nettes du budget général', -totNet, 'hors remboursements et dégrèvements', '−')}${box('Solde du budget général', soldeBg, 'recalculé', '=', 'is-alert')}${box('Solde des comptes spéciaux', soldeCas + soldeCcf, `affectation spéciale ${md(soldeCas, 2)}, concours financiers ${md(soldeCcf, 2)}`, '+')}${box('Solde prévu, hors budgets annexes', soldeBg + soldeCas + soldeCcf, 'recalculé à partir des fichiers du PLF 2025', '=', 'is-alert')}</div>
      <p class="note">Calcul fait ici à partir des fichiers ouverts du PLF 2025, fonds de concours exclus (ils sont prévus en recettes et en dépenses pour le même montant). Les recettes des budgets annexes, votés en équilibre, ne sont pas dans ces fichiers. Le solde de l’article d’équilibre figure dans le texte du projet de loi (PDF), pas dans ces données. L’exécution 2025 s’est soldée à ${md(solde25, 1)} (section suivante). Sources : ${src('plf25-recettes', 'recettes du budget général')}, ${src('plf25-recettes-cas-ccf', 'recettes des comptes spéciaux')}, ${src('plf25-depenses-destination', 'dépenses')}.</p>`;
    const taxes = R.lines.filter(l => l.g === 'fiscal');
    hbars($('etRecTax'), taxes.slice(0, 15).map(l => ({ label: l.label, sub: `ligne ${esc(l.code)} · ${pct(100 * l.v / fiscal, 1)} des recettes fiscales brutes`, value: l.v })), { format: v => md(v, 2) });
    $('etRecTaxNote').innerHTML = `Montants bruts, avant remboursements et dégrèvements. Taxe sur la valeur ajoutée, impôt sur le revenu et impôt sur les sociétés font ${pct(100 * sum(taxes.slice(0, 3), l => l.v) / fiscal, 0)} des recettes fiscales brutes. La TVA ici est la part de l’État : une fraction est déjà affectée aux collectivités et à la Sécurité sociale. Pour le rendement de chaque impôt toutes administrations confondues, voir la <a href="impots.html">page Impôts</a>.`;
    const nf_ = R.lines.filter(l => l.g === 'nonfiscal').slice(0, 6), psr = R.lines.filter(l => l.g.startsWith('psr')).slice(0, 6);
    hbars($('etRecOther'), [...nf_.map(l => ({ label: l.label, sub: 'Recette non fiscale', value: l.v, color: 'var(--tx-3)' })), ...psr.map(l => ({ label: cap(l.label.replace(/^Prélèvement sur les recettes de l'État (au titre de la |au titre du |au profit du |au profit de la |au profit des )?/i, '')), sub: 'Prélèvement sur recettes', value: l.v, color: 'var(--tx-2)' }))].sort((a, b) => b.value - a.value), { format: v => md(v, 2) });
    $('etRecOtherNote').innerHTML = `Recettes non fiscales : ${md(nonfiscal, 1)} au total. Prélèvements sur recettes : ${md(psrCt, 1)} pour les collectivités, ${md(psrUe, 1)} pour l’Union européenne. Les prélèvements sont soustraits des recettes : ce ne sont pas des crédits votés par mission.`;
    const depOf = s => missions.find(m => m.type === s.type && norm(m.name).slice(0, 40) === norm(s.mission).slice(0, 40));
    $('etRecSpecial').innerHTML = `<table class="data-table et-wide-table"><thead><tr><th>Compte</th><th>Type</th><th class="num">Recettes 2025</th><th class="num">Dépenses 2025 (CP)</th><th class="num">Recettes 2026</th><th class="num">Recettes 2027</th></tr></thead><tbody>${R.special.map(s => { const d = depOf(s); return `<tr><td class="tx-name">${esc(s.mission)}<br><span class="muted">${s.sections.slice(0, 2).filter(x => norm(x.label) !== norm(s.mission)).map(x => esc(x.label)).join(' · ')}</span></td><td>${s.type === 'CAS' ? 'Affectation spéciale' : 'Concours financiers'}</td><td class="num">${meur(s.v)}</td><td class="num">${d ? meur(d.cp) : '–'}</td><td class="num">${meur(s.v26)}</td><td class="num">${meur(s.v27)}</td></tr>`; }).join('')}</tbody></table>`;
    $('etRecSpecialNote').innerHTML = `Les comptes de concours financiers avancent notamment aux collectivités le produit de leurs impôts locaux (taxes foncières…), remboursé au fil des encaissements. Les prévisions 2026 et 2027 sont celles du PLF 2025. Source : ${src('plf25-recettes-cas-ccf', 'PLF 2025, recettes des CAS et des CCF')}.`;

    /* ======================================================= Monthly */
    const years = [...new Set(monthly.dates.map(d => +d.slice(0, 4)))];
    const YEAR_COLOR = y => `var(--tx-${[1, 2, 3, 7, 4][years.indexOf(y)] || 'other'})`;
    const pick = $('etMonPick');
    const groups = [['Solde', l => l.cat === 'Solde budgétaire' || l.cat === 'Soldes'], ['Recettes', l => l.cat === 'Recettes'], ['Dépenses', l => l.cat === 'Dépenses']];
    pick.innerHTML = groups.map(([name, f]) => `<optgroup label="${name}">${monthly.lines.map((l, i) => [l, i]).filter(([l]) => f(l)).map(([l, i]) => `<option value="${i}">${'· '.repeat(Math.max(0, l.level - 1))}${esc(l.label)}</option>`).join('')}</optgroup>`).join('');
    pick.value = '0';
    let mode = 'cum';
    const byYear = (line, y) => {
      const vals = Array(12).fill(null);
      monthly.dates.forEach((d, i) => { if (+d.slice(0, 4) === y) vals[+d.slice(5, 7) - 1] = line.values[i]; });
      if (mode === 'month') return vals.map((v, i) => v == null ? null : i === 0 ? v : vals[i - 1] == null ? null : v - vals[i - 1]);
      return vals;
    };
    let redrawMon = () => {};
    const drawMon = () => {
      const line = monthly.lines[+pick.value];
      $('etMonChartTitle').textContent = `${line.label}${mode === 'cum' ? ', cumul depuis janvier' : ', mois par mois'}`;
      const series = years.map(y => ({ name: String(y), color: YEAR_COLOR(y), values: byYear(line, y) }));
      redrawMon = lines($('etMonChart'), series, { labels: MONTHS, height: 300, format: v => md(v, 1), tickFormat: v => nf(v / 1000, 0), aria: `${line.label} par mois, ${years.join(', ')}`, tipTitle: i => `${MONTHS_LONG[i]}${mode === 'cum' ? ' (cumul)' : ''}` });
      $('etMonLegend').innerHTML = `<span class="muted">Md€</span>${series.map(s => { const last = s.values.map((v, i) => [i, v]).filter(p => p[1] != null).at(-1); return `<span><i style="background:${s.color}"></i>${s.name}${last ? ` <b>${md(last[1], 1)}</b> <span class="muted">fin ${MONTHS[last[0]]}</span>` : ''}</span>`; }).join('')}`;
    };
    pick.addEventListener('change', drawMon);
    chips('etMonMode', 'mode', v => { mode = v; drawMon(); });
    drawMon();
    const L = label => mLine(label).values;
    const lastI = monthly.dates.length - 1, lastMonth = +lastDate.slice(5, 7), lastYear = +lastDate.slice(0, 4);
    const sameMonthPrev = at(monthly.dates.find(d => d.startsWith(`${lastYear - 1}-${lastDate.slice(5, 7)}`)));
    const dec24 = at('2024-12-31');
    $('etMonKpis').innerHTML = kpis([
      ['Solde 2024', md(L('Solde budgétaire')[dec24], 1), 'situation de décembre 2024', true],
      ['Solde 2025', md(solde25, 1), `situation de décembre 2025 ; dépenses nettes ${md(L('Total dépenses nettes du budget général')[dec25], 1)}`, true],
      [`Fin ${MONTHS_LONG[lastMonth - 1]} ${lastYear}`, md(L('Solde budgétaire')[lastI], 1), `contre ${md(L('Solde budgétaire')[sameMonthPrev], 1)} fin ${MONTHS_LONG[lastMonth - 1]} ${lastYear - 1} (cumul depuis janvier)`, true],
      ['Charge de la dette 2025', md(L('Charges de la dette de l’Etat')[dec25], 1), `payée en 2025, contre ${md(L('Charges de la dette de l’Etat')[dec24], 1)} en 2024`]
    ]);
    $('etMonNote').innerHTML = `Le solde se creuse en cours d’année et se redresse en décembre (encaissements de fin d’année, dont le solde de l’impôt sur les sociétés). Recettes nettes des remboursements et dégrèvements ; dépenses nettes du budget général. Situation d’avril 2024 arrêtée au 24 avril. Source : ${src('etat-situations-mensuelles', 'situations mensuelles budgétaires, séries longues (DGFiP)')}.`;
    const reconCols = [dec24, dec25, lastI].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
    const recon = [
      ['Recettes nettes du budget général', 'Total recettes nettes du budget général', 1],
      ['+ Fonds de concours et attributions de produits', 'Fonds de concours et attribution de produits', 1],
      ['− Dépenses nettes du budget général', 'Total dépenses nettes du budget général', -1],
      ['− Prélèvements sur recettes (collectivités, Union européenne)', 'Total prélèvements sur recettes', -1],
      ['+ Solde des comptes spéciaux', 'Solde des comptes spéciaux', 1],
      ['+ Solde des budgets annexes', 'Solde des Budgets annexes', 1]
    ];
    const recalc = i => sum(recon, ([, label, s]) => s * L(label)[i]);
    const dateLabel = i => { const d = monthly.dates[i]; return `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`; };
    $('etMonRecon').innerHTML = `<table class="data-table"><thead><tr><th>Composante (cumul depuis janvier)</th>${reconCols.map(i => `<th class="num">${dateLabel(i)}</th>`).join('')}</tr></thead><tbody>${recon.map(([name, label, s]) => `<tr><td>${esc(name)}</td>${reconCols.map(i => `<td class="num">${md(s * L(label)[i], 1)}</td>`).join('')}</tr>`).join('')}<tr class="et-total"><td>= Solde recalculé</td>${reconCols.map(i => `<td class="num">${md(recalc(i), 2)}</td>`).join('')}</tr><tr><td>Solde publié</td>${reconCols.map(i => `<td class="num">${md(L('Solde budgétaire')[i], 2)}</td>`).join('')}</tr></tbody></table>`;
    const maxGap = Math.max(...monthly.dates.map((_, i) => Math.abs(recalc(i) - L('Solde budgétaire')[i])));
    $('etMonReconNote').textContent = `Les six composantes publiées redonnent le solde publié à ${maxGap < 0.5 ? 'moins de 0,5 M€ près' : `${meur(maxGap)} près`} pour chacun des ${monthly.dates.length} mois du fichier. Les remboursements et dégrèvements (${md(L('Remboursements et dégrèvements d\'impôts d\'Etat')[dec25] + L('Remboursements et dégrèvements d\'impôts locaux')[dec25], 1)} en 2025) sont déjà déduits des recettes nettes.`;
    const pdfYears = [...new Set(monthly.pdfs.map(p => (p.title.match(/(20\d\d)/) || [])[1]).filter(Boolean))].sort().reverse();
    const pdfSel = $('etPdfYear');
    pdfSel.innerHTML = pdfYears.map(y => `<option value="${y}">${y}</option>`).join('');
    const pdfOrder = p => { const t = norm(p.title); const i = MONTHS_LONG.findIndex(mo => t.includes(norm(mo))); return i < 0 ? 99 : i; };
    const drawPdfs = () => {
      const list = monthly.pdfs.filter(p => (p.title.match(/(20\d\d)/) || [])[1] === pdfSel.value).sort((a, b) => pdfOrder(a) - pdfOrder(b) || a.date.localeCompare(b.date));
      $('etPdfList').innerHTML = list.map(p => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title.replace(/^Situation mensuelle de l.[ée]tat\s*[-–]\s*/i, ''))}</a><small>publié le ${esc(p.date.split('-').reverse().join('/'))}</small></li>`).join('');
    };
    pdfSel.addEventListener('change', drawPdfs);
    drawPdfs();
    $('etPdfNote').innerHTML = `${monthly.pdfs.length} situations mensuelles publiées depuis ${pdfYears.at(-1)}. Seules celles de ${years[0]} à ${years.at(-1)} existent aussi en données ; les précédentes ne sont lisibles qu’en PDF. Source : ${src('etat-situation-mensuelle', 'situation mensuelle de l’État (liste des publications)')}.`;

    /* ======================================================= Performance (RAP 2025) */
    const P = data.rap;
    const ST = {
      ok: { label: 'Cible atteinte', color: 'var(--tx-3)' },
      up: { label: 'Cible non atteinte, en amélioration', color: 'var(--tx-1)' },
      no: { label: 'Cible non atteinte, sans amélioration', color: 'var(--tx-2)' },
      nd: { label: 'Réalisation non renseignée', color: 'var(--tx-none)' },
      nr: { label: 'Donnée non retenue', color: 'var(--tx-other)' },
      na: { label: 'Sans classement', color: 'var(--tx-5)' }
    };
    const ST_ORDER = ['ok', 'up', 'no', 'nd', 'nr', 'na'];
    const count = list => { const c = {}; list.forEach(r => { c[r[8]] = (c[r[8]] || 0) + 1; }); return c; };
    const allC = count(P.rows), N = P.rows.length;
    $('etPerfKpis').innerHTML = kpis([
      ['Cible atteinte', pct(100 * allC.ok / N, 0), `${nf(allC.ok, 0)} indicateurs et sous-indicateurs sur ${nf(N, 0)}`],
      ['En amélioration', pct(100 * allC.up / N, 0), `${nf(allC.up, 0)} : cible manquée mais résultat meilleur qu’en 2024`],
      ['Sans amélioration', pct(100 * allC.no / N, 0), `${nf(allC.no, 0)} : cible manquée, pas de progrès`],
      ['Réalisation absente', pct(100 * ((allC.nd || 0) + (allC.nr || 0)) / N, 0), `${nf(allC.nd || 0, 0)} non renseignées, ${nf(allC.nr || 0, 0)} non retenues`, true]
    ]);
    const missionName = i => P.missions[i][2];
    const byMission = new Map();
    P.rows.forEach(r => { if (!byMission.has(r[0])) byMission.set(r[0], []); byMission.get(r[0]).push(r); });
    const perfAll = [...byMission.entries()].map(([mi, list]) => ({ mi, label: missionName(mi), sub: '', c: count(list), n: list.length }));
    const perfSmall = perfAll.filter(r => r.n < 10);
    const perfRows = perfAll.filter(r => r.n >= 10).sort((a, b) => (b.c.ok || 0) / b.n - (a.c.ok || 0) / a.n);
    stacks($('etPerfStack'), perfRows.map(r => ({ label: r.label, mi: r.mi, total: r.n, parts: ST_ORDER.map(s => ({ key: s, value: r.c[s] || 0, color: ST[s].color, label: ST[s].label })) })),
      { format: v => `${nf(v, 0)} indicateur${v > 1 ? 's' : ''}`, totalFormat: v => nf(v, 0), legend: ST_ORDER.filter(s => allC[s]).map(s => ({ color: ST[s].color, label: ST[s].label, value: nf(allC[s], 0) })), legendEl: $('etPerfLegend'), onRow: r => openPerf(P.missions[r.mi][1]) });
    $('etPerfStackNote').innerHTML = `Missions classées par part d’indicateurs dont la cible est atteinte ; nombre d’indicateurs et sous-indicateurs à droite. ${perfSmall.length} missions ou comptes de moins de 10 indicateurs ne sont pas représentés (leurs parts ne seraient pas comparables) : ${perfSmall.map(r => esc(r.label)).join(', ')}. Cliquez sur une mission pour la liste de ses indicateurs. Classement publié par l’administration dans le fichier des ${src('rap-2025-performance', 'rapports annuels de performance 2025')}.`;
    const seen = new Set();
    const gaps = P.rows.filter(r => r[8] === 'no' && r[9] != null && r[9] !== 0).sort((a, b) => Math.abs(b[9]) - Math.abs(a[9])).filter(r => { const k = [r[2], r[3], r[6], r[7]].join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
    const progName = i => i >= 0 ? `${P.progs[i][0]} · ${P.progs[i][1]}` : 'Indicateur de mission';
    $('etPerfGaps').innerHTML = `<table class="data-table et-perf-table"><thead><tr><th>Indicateur</th><th class="num">Cible 2025</th><th class="num">Réalisé</th><th class="num">Écart</th></tr></thead><tbody>${gaps.slice(0, 15).map(r => `<tr><td><strong>${esc(r[3] || r[2])}</strong>${r[3] ? `<br><span class="muted">${esc(r[2])}</span>` : ''}<br><span class="muted">${esc(missionName(r[0]))} · ${esc(progName(r[1]))}</span></td><td class="et-val" data-l="Cible 2025">${esc(r[6])}</td><td class="et-val" data-l="Réalisé">${esc(r[7])}</td><td class="et-val" data-l="Écart">${r[9] > 0 ? '+' : ''}${nf(r[9], 1)} pt</td></tr>`).join('')}</tbody></table>`;
    $('etPerfGapsNote').textContent = `Parmi les ${gaps.length} indicateurs en pourcentage classés « sans amélioration » par l’administration, les quinze plus éloignés de leur cible, en points. Un taux de consommation de crédits faible peut refléter un calendrier de projets, une cible de satisfaction peut être fixée haut : l’écart signale une question à poser, pas un dysfonctionnement établi.`;
    const missRows = [...byMission.entries()].map(([mi, list]) => ({ label: missionName(mi), value: list.filter(r => r[8] === 'nd').length, n: list.length })).filter(r => r.value).sort((a, b) => b.value - a.value);
    hbars($('etPerfMissing'), missRows.slice(0, 14).map(r => ({ label: r.label, sub: `sur ${r.n} indicateurs · ${pct(100 * r.value / r.n, 0)}`, value: r.value, color: 'var(--c-muted)' })), { format: v => nf(v, 0) });
    $('etPerfMissingNote').textContent = `Nombre d’indicateurs dont la réalisation 2025 est « non renseignée » dans le fichier (${nf(allC.nd || 0, 0)} au total, sur ${missRows.length} missions). Souvent la donnée n’est connue qu’après la publication du rapport (enquêtes annuelles, comptes d’organismes) ; elle devrait alors être publiée l’année suivante.`;
    // full table
    const mSel = $('etPerfMission'), sSel = $('etPerfStatus');
    mSel.innerHTML += [...byMission.keys()].sort((a, b) => missionName(a).localeCompare(missionName(b), 'fr')).map(mi => `<option value="${esc(P.missions[mi][1])}">${esc(missionName(mi))}</option>`).join('');
    sSel.innerHTML += ST_ORDER.filter(s => allC[s]).map(s => `<option value="${s}">${esc(ST[s].label)}</option>`).join('');
    let shown = 25;
    const drawPerf = () => {
      const q = norm($('etPerfSearch').value.trim()), mc = mSel.value, st = sSel.value;
      const list = P.rows.filter(r => (!mc || P.missions[r[0]][1] === mc) && (!st || r[8] === st) && (!q || norm(`${r[2]} ${r[3]} ${progName(r[1])} ${missionName(r[0])}`).includes(q)));
      $('etPerfTable').innerHTML = list.length ? `<table class="data-table et-perf-table"><thead><tr><th>Indicateur</th><th>Unité</th><th class="num">2024</th><th class="num">Cible 2025</th><th class="num">2025</th><th>Résultat</th></tr></thead><tbody>${list.slice(0, shown).map(r => `<tr><td><strong>${esc(r[2])}</strong>${r[3] ? `<br>${esc(r[3])}` : ''}<br><span class="muted">${esc(missionName(r[0]))} · ${esc(progName(r[1]))}</span></td><td data-l="Unité">${esc(r[4])}</td><td class="et-val" data-l="2024">${esc(r[5] || '–')}</td><td class="et-val" data-l="Cible 2025">${esc(r[6] || '–')}</td><td class="et-val" data-l="2025">${esc(r[7] || '–')}</td><td data-l="Résultat"><span class="et-status" style="--c:${ST[r[8]].color}">${esc(ST[r[8]].label)}</span></td></tr>`).join('')}</tbody></table>` : '<p class="tx-empty">Aucun indicateur ne correspond.</p>';
      $('etPerfMore').innerHTML = list.length > shown ? `<button type="button">Afficher 50 de plus (${nf(list.length - shown, 0)} restants)</button>` : '';
      $('etPerfTableNote').textContent = `${nf(list.length, 0)} indicateurs et sous-indicateurs affichés sur ${nf(N, 0)}. Valeurs telles que publiées (unités, signes, mentions « ND »).`;
    };
    $('etPerfMore').addEventListener('click', () => { shown += 50; drawPerf(); });
    [$('etPerfSearch'), mSel, sSel].forEach(n => n.addEventListener(n.tagName === 'INPUT' ? 'input' : 'change', () => { shown = 25; drawPerf(); }));
    drawPerf();
    function openPerf(code) {
      mSel.value = code; sSel.value = ''; $('etPerfSearch').value = ''; shown = 25; drawPerf();
      $('etPerfTable').closest('.panel').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    }

    /* ======================================================= Green budget */
    const G = data.green;
    const COT = { Favorable: 'var(--tx-3)', Mixte: 'var(--tx-7)', Défavorable: 'var(--tx-2)', Neutre: 'var(--tx-none)', NC: 'var(--tx-other)' };
    const COT_LABEL = { Favorable: 'Favorable', Mixte: 'Mixte', Défavorable: 'Défavorable', Neutre: 'Neutre', NC: 'Non coté' };
    const COT_ORDER = ['Favorable', 'Mixte', 'Défavorable', 'Neutre', 'NC'];
    const KINDS = ['Crédits budgétaires', 'Dépenses fiscales', 'Taxes affectées plafonnées'];
    const YLAB = { v24: 'exécution 2024', v25: 'LFI 2025 (prévision pour les dépenses fiscales)', v26: 'PLF 2026 (prévision pour les dépenses fiscales)' };
    let gy = 'v26';
    const gTot = (c, k = null) => sum(G.totals.filter(t => t.c === c && (!k || t.k === k)), t => t[gy]);
    const drawGreen = () => {
      $('etVertKpis').innerHTML = kpis(['Favorable', 'Défavorable', 'Mixte', 'NC'].map(c => [COT_LABEL[c], md(gTot(c), 1), `${YLAB[gy]}, crédits, dépenses fiscales et taxes affectées`, c === 'Défavorable']));
      stacks($('etVertStack'), KINDS.map(k => ({ label: k, parts: COT_ORDER.map(c => ({ key: c, value: gTot(c, k), color: COT[c], label: COT_LABEL[c] })) })),
        { format: v => md(v, 2), legend: COT_ORDER.map(c => ({ color: COT[c], label: COT_LABEL[c], value: md(gTot(c), 1) })), legendEl: $('etVertLegend') });
      const top = c => G.lines.filter(l => l.c === c).sort((a, b) => b[gy] - a[gy]).slice(0, 10).map(l => ({ label: l.l, sub: `${esc(l.k)} · ${esc(l.m || l.cat)}`, value: l[gy], color: COT[c] }));
      hbars($('etVertFav'), top('Favorable'), { format: v => meur(v) });
      hbars($('etVertDef'), top('Défavorable'), { format: v => meur(v) });
    };
    chips('etVertYear', 'y', v => { gy = v; drawGreen(); });
    drawGreen();
    const nc = G.flags.find(f => f.flag === 'nc')?.n || 0, eps = G.flags.find(f => f.flag === 'ε')?.n || 0;
    $('etVertStackNote').innerHTML = `Chaque barre fait 100 % du type de dépense ; survolez un segment pour son montant. « Mixte » : favorable sur un axe, défavorable sur un autre. Les dépenses « non cotées » n’ont pas reçu de cotation (par exemple la charge de la dette ou certaines dotations). Parmi les dépenses fiscales, ${nc} ne sont pas chiffrées (« nc ») et ${eps} font moins de 0,5 M€ : elles sont comptées pour zéro. Source : ${src('plf26-budget-vert', 'PLF 2026, budget vert (Direction du budget)')}.`;
    const gm = G.missions.filter(x => x.m && x.m !== '(sans mission)' && ((x.Favorable || 0) + (x.Défavorable || 0) + (x.Mixte || 0)) > 0).sort((a, b) => ((b.Favorable || 0) + (b.Défavorable || 0)) - ((a.Favorable || 0) + (a.Défavorable || 0)));
    $('etVertMissions').innerHTML = `<table class="data-table"><thead><tr><th>Mission</th>${COT_ORDER.map(c => `<th class="num"><i class="et-dot" style="background:${COT[c]}"></i>${COT_LABEL[c]}</th>`).join('')}</tr></thead><tbody>${gm.map(x => `<tr><td class="tx-name">${esc(x.m)}</td>${COT_ORDER.map(c => `<td class="num">${x[c] ? meur(x[c]) : '–'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    $('etVertNote').textContent = `PLF 2026. Missions ayant au moins une dépense cotée favorable, mixte ou défavorable, classées par montant coté (favorable plus défavorable). Les dépenses fiscales sont rattachées à la mission dont elles relèvent. Le budget vert ne couvre que l’État : ni les collectivités ni la Sécurité sociale.`;

    /* ======================================================= Development aid */
    const A = data.apd, AY = A.years.map(y => y.year), lastA = A.years.at(-1), li = AY.length - 1;
    $('etApdKpis').innerHTML = kpis([
      [`APD ${lastA.year}, équivalent-don`, md(lastA.ge, 2), `${nf(lastA.n, 0)} lignes déclarées ; ${md(A.years[0].ge, 1)} en ${AY[0]}`],
      ['Versements bruts', md(lastA.paid, 2), `${lastA.year}, montants effectivement versés ; ${md(lastA.received, 2)} de remboursements reçus`],
      ['Part bilatérale', pct(100 * lastA.bi / lastA.ge, 0), `${md(lastA.bi, 1)} versés directement aux pays ou à des projets`],
      ['Part multilatérale', pct(100 * lastA.multi / lastA.ge, 0), `${md(lastA.multi, 1)} versés à l’Union européenne, la Banque mondiale, l’ONU…`]
    ]);
    lines($('etApdLine'), [
      { name: 'Équivalent-don (mesure OCDE)', color: 'var(--tx-1)', values: A.years.map(y => y.ge) },
      { name: 'Versements bruts', color: 'var(--tx-2)', values: A.years.map(y => y.paid) },
      { name: 'Remboursements reçus', color: 'var(--tx-3)', values: A.years.map(y => y.received) }
    ], { labels: AY.map(String), height: 280, format: v => md(v, 2), tickFormat: v => nf(v / 1000, 0), aria: 'Aide publique au développement déclarée, 2018 à 2024' });
    $('etApdLegend').innerHTML = `<span class="muted">Md€</span><span><i style="background:var(--tx-1)"></i>Équivalent-don (mesure OCDE)</span><span><i style="background:var(--tx-2)"></i>Versements bruts</span><span><i style="background:var(--tx-3)"></i>Remboursements reçus</span>`;
    $('etApdLineNote').innerHTML = `Lignes déclarées comme « aide publique au développement » seulement ; les autres apports publics (${md(lastA.other_paid, 2)} versés en ${lastA.year}) ne sont pas comptés. Le total officiel publié par l’OCDE peut différer (révisions, données préliminaires). Source : ${src('aide-publique-developpement', 'aide publique au développement (DG Trésor)')}.`;
    const unspec = n => /multilat|non spécifi|régional|non ventil/i.test(n);
    const countries = A.country.filter(c => !unspec(c.name));
    const unspecV = sum(A.country.filter(c => unspec(c.name)), c => c.v[li]);
    $('etApdCountryTitle').textContent = `Premiers pays bénéficiaires en ${lastA.year}`;
    hbars($('etApdCountry'), countries.slice(0, 12).map(c => ({ label: c.name, sub: `${md(c.v[0], 2)} en ${AY[0]}`, value: c.v[li] })), { format: v => meur(v) });
    $('etApdCountryNote').textContent = `Équivalent-don. ${md(unspecV, 1)} ne sont pas rattachés à un pays (contributions multilatérales, programmes régionaux ou non ventilés), soit ${pct(100 * unspecV / lastA.ge, 0)} du total. Wallis-et-Futuna, collectivité française, figure parmi les bénéficiaires au sens de l’OCDE.`;
    $('etApdSectorTitle').textContent = `Par secteur en ${lastA.year}`;
    hbars($('etApdSector'), A.sector.slice(0, 10).map(c => ({ label: c.name, value: c.v[li], color: 'var(--tx-7)' })), { format: v => meur(v) });
    $('etApdAgencyTitle').textContent = `Par organisme déclarant en ${lastA.year}`;
    hbars($('etApdAgency'), A.agency.slice(0, 10).map(c => ({ label: c.name, value: c.v[li], color: 'var(--tx-1)' })), { format: v => meur(v) });
    $('etApdFinTitle').textContent = `Par instrument en ${lastA.year}`;
    hbars($('etApdFin'), A.finance.filter(c => Math.abs(c.v[li]) > 0.5).map(c => ({ label: c.name, value: c.v[li], color: 'var(--tx-3)' })), { format: v => meur(v) });
    $('etApdNote').textContent = 'Un prêt ne compte en équivalent-don que pour sa part de faveur ; un allègement de dette compte pour la créance abandonnée. Les ministères, l’Agence française de développement et les collectivités déclarent chacun leurs propres lignes.';

    /* ======================================================= General accounts */
    const B = data.balances, BY = B.years, bl = BY.length - 1;
    const post = cat => B.postes.filter(p => p.cat === cat);
    const total = (cat, i) => sum(post(cat), p => p.v[i]);
    const net = BY.map((_, i) => total('Actif', i) - total('Passif', i));
    const res = BY.map((_, i) => total('Produits', i) - total('Charges', i));
    $('etBilKpis').innerHTML = kpis([
      [`Actif fin ${BY[bl]}`, md(total('Actif', bl), 0), 'immobilisations, participations, créances, trésorerie'],
      [`Passif fin ${BY[bl]}`, md(total('Passif', bl), 0), `dont ${md(post('Passif').find(p => /Dettes financi/.test(p.poste))?.v[bl], 0)} de dettes financières`],
      ['Situation nette', md(net[bl], 0), `actif moins passif, fin ${BY[bl]} ; ${md(net[0], 0)} fin ${BY[0]}`, true],
      [`Résultat patrimonial ${BY[bl]}`, md(res[bl], 1), `produits moins charges de l’exercice ; ${md(res[bl - 1], 1)} en ${BY[bl - 1]}`, true]
    ]);
    $('etBilActifTitle').textContent = `Actif fin ${BY[bl]}`;
    $('etBilPassifTitle').textContent = `Passif fin ${BY[bl]}`;
    hbars($('etBilActif'), post('Actif').sort((a, b) => b.v[bl] - a.v[bl]).map(p => ({ label: p.poste, sub: `${md(p.v[0], 0)} fin ${BY[0]}`, value: p.v[bl], color: 'var(--tx-1)' })), { format: v => md(v, 1), max: total('Passif', bl) });
    hbars($('etBilPassif'), post('Passif').sort((a, b) => b.v[bl] - a.v[bl]).map(p => ({ label: p.poste, sub: `${md(p.v[0], 0)} fin ${BY[0]}`, value: p.v[bl], color: 'var(--tx-2)' })), { format: v => md(v, 1), max: total('Passif', bl) });
    lines($('etBilNet'), [{ name: 'Situation nette', color: 'var(--tx-2)', values: net }], { labels: BY.map(String), height: 240, format: v => md(v, 0), tickFormat: v => nf(v / 1000, 0), aria: 'Situation nette de l’État', area: true });
    $('etBilNetNote').innerHTML = `Md€. Situation nette recalculée en sommant les soldes des comptes de la balance par catégorie ; le compte général de l’État certifié par la Cour des comptes peut différer à la marge. Source : ${src('etat-balances', 'balances des comptes de l’État (DGFiP)')}.`;
    lines($('etBilRes'), [{ name: 'Résultat patrimonial', color: 'var(--tx-2)', values: res }], { labels: BY.map(String), height: 240, format: v => md(v, 1), tickFormat: v => nf(v / 1000, 0), aria: 'Résultat patrimonial de l’État', area: true });
    $('etBilResNote').textContent = `Md€. Le résultat patrimonial rattache charges et produits à l’année où ils naissent (et non à celle où ils sont payés) et compte des charges sans décaissement (amortissements, provisions). Il ne se compare donc pas directement au solde budgétaire. ${BY[bl]} : ${md(total('Produits', bl), 0)} de produits, ${md(total('Charges', bl), 0)} de charges.`;

    /* ======================================================= What is not published */
    const ndRows = allC.nd || 0;
    const gapsList = [
      ['none', 'L’exécution par mission et par programme, mois par mois', `La situation mensuelle ne donne que de grands agrégats (nature de dépense, grands impôts). L’exécution de chaque programme n’est connue qu’une fois l’an, dans les rapports annuels de performance et la loi relative aux résultats de la gestion. La DGFiP et la Direction du budget disposent de ces montants dans Chorus.`],
      ['partial', 'La loi votée, pas seulement le projet', 'Les fichiers détaillés utilisés ici sont ceux du projet de loi (octobre 2024). La loi de finances initiale 2025, promulguée après la censure, et les lois rectificatives modifient les montants : publier chaque version au même format, ligne à ligne, permettrait de voir ce que le Parlement a changé.'],
      ['partial', 'Les séries mensuelles avant 2024', `Les ${monthly.pdfs.length} situations mensuelles publiées depuis ${pdfYears.at(-1)} ne sont, avant ${years[0]}, disponibles qu’en PDF. Une série longue en données, déjà promise par le nom du jeu « séries longues », devrait remonter au moins à 2010.`],
      ['partial', 'Les réalisations manquantes des indicateurs', `${nf(ndRows, 0)} indicateurs ou sous-indicateurs n’ont pas de réalisation 2025 renseignée, et ${nf(allC.nr || 0, 0)} ne sont « pas retenus ». Le fichier ne dit pas pourquoi. Il ne donne pas non plus le coût de chaque programme rapporté à ses résultats.`],
      ['partial', 'Le budget vert hors État, et ses angles morts', `${md(gTot('NC'), 0)} de dépenses ne sont pas cotées (${YLAB[gy]}), ${nc} dépenses fiscales ne sont pas chiffrées. Les collectivités et la Sécurité sociale n’ont pas d’équivalent publié. La cotation est une appréciation a priori, sans mesure d’impact.`],
      ['none', 'Les bénéficiaires des dépenses d’intervention', `Les dépenses d’intervention (${md(execTitre('6'), 0)} payés en 2025 par le budget général) vont aux ménages, aux entreprises et aux collectivités, mais les fichiers budgétaires ne descendent pas sous l’action. Les bénéficiaires ne sont publiés que pour certaines aides (voir la page Aides et subventions) ; ceux des dépenses fiscales ne le sont jamais.`],
      ['partial', 'L’aide au développement récente et ses projets', `Le jeu s’arrête à ${lastA.year} et n’est mis à jour qu’une fois l’an. Pour une grande partie des lignes, la description reste sommaire et les résultats des projets ne sont pas publiés.`],
      ['partial', 'Le compte général de l’État en données', 'La balance des comptes est ouverte, mais le bilan et le compte de résultat certifiés, avec leurs retraitements, les engagements hors bilan (retraites des fonctionnaires, garanties) et les réserves de la Cour des comptes, restent dans un document PDF.']
    ];
    $('etGaps').innerHTML = gapsList.map(([state, title, text]) => `<article class="gap"><span class="gap__state ${state}">${state === 'none' ? 'Non publié' : 'Partiel'}</span><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`).join('');

    /* ======================================================= Sources */
    const SRC_TITLES = {
      'plf25-depenses-destination': 'PLF 2025, dépenses selon destination', 'plf25-depenses-nature': 'PLF 2025, dépenses selon destination et nature', 'plf25-recettes': 'PLF 2025, recettes du budget général',
      'plf25-recettes-cas-ccf': 'PLF 2025, recettes des CAS et des CCF', 'etat-situations-mensuelles': 'Situations mensuelles budgétaires, séries longues', 'etat-situation-mensuelle': 'Situation mensuelle de l’État (PDF)',
      'rap-2025-performance': 'Performance de la dépense, RAP 2025', 'plf26-budget-vert': 'PLF 2026, budget vert', 'aide-publique-developpement': 'Aide publique au développement', 'etat-balances': 'Balances des comptes de l’État'
    };
    $('etSources').innerHTML = `Sources (data.economie.gouv.fr) : ${Object.entries(SRC_TITLES).map(([id, t]) => src(id, t)).join(' ')}`;
  }
})();
