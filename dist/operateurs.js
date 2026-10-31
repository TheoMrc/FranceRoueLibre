/* Opérateurs de l'État: the 431 operators listed in the PLF 2026 « jaune » (name, network, legal status, mission and lead
   programme), the PLF 2025 subsidies (SCSP) of their programmes, and the earmarked taxes of the PLF 2024 list.
   One data file: data/operateurs.json (scripts/operateurs-data.py). Charts are SVG strings redrawn on resize, coloured
   with the --tx-* tokens of style.css; the full table at the bottom is the text view of every chart. */
(() => {
  const { esc, load } = FRL;
  const $ = id => document.getElementById(id);
  const nf = (value, digits = 1) => value.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  /* Amounts are stored in euros. */
  const eur = value => {
    if (value == null || !Number.isFinite(value)) return '–';
    const a = Math.abs(value);
    if (a >= 1e9) return `${nf(value / 1e9, a >= 1e11 ? 0 : 2)} Md€`;
    if (a >= 1e7) return `${nf(value / 1e6, 0)} M€`;
    if (a >= 1e6) return `${nf(value / 1e6, 1)} M€`;
    if (a >= 1e3) return `${nf(value / 1e3, 0)} k€`;
    return `${nf(value, 0)} €`;
  };
  const pct = (value, digits = 1) => value == null || !Number.isFinite(value) ? '–' : `${nf(value, digits)} %`;
  const link = (url, text) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const plural = (n, one, many = `${one}s`) => `${nf(n, 0)} ${n > 1 ? many : one}`;

  /* Legal status: fixed colour slot per status (colour follows the status, never its rank). */
  const STATUT_ORDER = ['EPA', 'EPSCP', 'EPIC', 'GIP', 'EPST'];
  const statutSlot = s => { const i = STATUT_ORDER.indexOf(s); return i < 0 ? 'other' : String(i + 1); };
  const statutColor = s => `var(--tx-${statutSlot(s)})`;
  const lightText = slot => ['3', '4', '5', 'other', 'none'].includes(slot);

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

  /* Squarified treemap. */
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

  /* Horizontal bars. rows: [{label, sub, value, display}] */
  function hbars(el, rows, { format = eur, max = null } = {}) {
    if (!rows.length) { el.innerHTML = '<p class="tx-empty">Aucune donnée publiée.</p>'; return; }
    const top = max ?? Math.max(...rows.map(r => r.value || 0), 1e-9);
    el.innerHTML = `<ul class="tx-bars">${rows.map(r => `<li class="${r.focus ? 'is-focus' : ''}"><div class="tx-bars__line"><span>${r.html || esc(r.label)}${r.sub ? `<small>${r.sub}</small>` : ''}</span><strong>${r.display ?? format(r.value)}</strong></div><span class="tx-bars__track" aria-hidden="true"><span class="tx-bars__fill" style="--w:${(100 * (r.value || 0) / top).toFixed(2)}%${r.color ? `;background:${r.color}` : ''}"></span></span></li>`).join('')}</ul>`;
    requestAnimationFrame(() => el.querySelectorAll('.tx-bars__fill').forEach(n => { n.style.width = n.style.getPropertyValue('--w'); }));
  }

  load('./data/operateurs.json').then(init).catch(error => {
    console.error(error);
    $('opTreemap').innerHTML = '<p class="tx-empty">Données indisponibles. Le site doit être servi par HTTP.</p>';
  });

  function init(data) {
    const OPS = data.operators, T = data.totals, S = data.sources, STATUTS = data.statuts;
    const byId = new Map(OPS.map(o => [o.id, o]));
    const PROGS = data.programmes, progByCode = new Map(PROGS.map(p => [p.code, p]));
    const catCount = OPS.reduce((m, o) => (o.category ? m.set(o.category, (m.get(o.category) || 0) + 1) : m), new Map());
    const srcLink = (key, text) => link(S[key].url, text || S[key].title);
    const short = o => o.acronym || o.name;
    const kept = o => o.taxes?.y2024?.kept ?? null;
    const missions = [...new Set(OPS.map(o => o.mission))];
    const missionCount = m => OPS.filter(o => o.mission === m).length;
    missions.sort((a, b) => missionCount(b) - missionCount(a) || a.localeCompare(b, 'fr'));

    /* ---------- Headline ---------- */
    const p150 = progByCode.get('150');
    $('opKpis').innerHTML = [
      ['Opérateurs de l’État en 2026', nf(T.operators, 0), `lignes de la liste annexée au PLF 2026 ; le document en annonce ${T.published}, contre ${T.publishedPrevious} en 2025`],
      ['Comptés en réseau', nf(T.inCategories, 0), `dans ${T.categories} catégories (universités, ARS, parcs nationaux…) ; ${T.standalone} opérateurs isolés`],
      ['Recherche et enseignement supérieur', pct(100 * missionCount('Recherche et enseignement supérieur') / T.operators, 0), `des opérateurs (${missionCount('Recherche et enseignement supérieur')}), sur ${T.missions} missions du budget`],
      ['Subventions pour charges de service public', eur(T.scspCp), `crédits de paiement du PLF 2025, tous programmes ; données par programme, pas par opérateur`],
      ['Taxes affectées aux opérateurs', eur(T.taxesOperators2024.kept), `conservées en 2024 (prévision) après ${eur(T.taxesOperators2024.returned)} reversés au budget général`]
    ].map(([a, b, c]) => `<div class="kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join('');

    /* ---------- Fiche: one operator ---------- */
    const taxRows = items => `<ul class="op-taxlist">${items.map(i => `<li><span>${esc(i.tax)}</span><strong>${i.y2024.yield == null ? '<span class="muted">non chiffré</span>' : eur(i.y2024.yield)}</strong>${i.y2024.returned ? `<small>dont ${eur(i.y2024.returned)} reversés au budget général (plafond ${eur(i.y2024.ceiling)})</small>` : ''}</li>`).join('')}</ul>`;
    function ficheHtml(o, headingId = '') {
      const p = progByCode.get(o.programme);
      const siblings = o.category ? catCount.get(o.category) : 0;
      const catTax = o.category ? data.categoryTaxes[o.category] : null;
      const tx = o.taxes;
      const search = `https://annuaire-entreprises.data.gouv.fr/rechercher?terme=${encodeURIComponent(o.full || o.name)}`;
      return `<span class="tx-pill"><i style="background:${statutColor(o.statut)}"></i>${esc(o.statut)}</span>${o.category ? ` <span class="tx-pill">Réseau : ${esc(o.category)}</span>` : ''}
        <h3${headingId ? ` id="${headingId}"` : ''}>${esc(o.acronym ? o.full : o.name)}${o.acronym ? ` <span class="muted">(${esc(o.acronym)})</span>` : ''}</h3>
        <dl>
          <dt>Statut</dt><dd>${esc(STATUTS[o.statut] || o.statut)}</dd>
          ${o.category ? `<dt>Réseau</dt><dd>${esc(o.category)}, ${plural(siblings, 'établissement')} dans la liste</dd>` : ''}
          <dt>Mission</dt><dd>${esc(o.mission)}</dd>
          <dt>Programme chef de file</dt><dd>${esc(o.programme)} – ${esc(o.programmeLabel)}</dd>
          <dt>Ministère</dt><dd>${o.ministere ? `${esc(o.ministere)} <span class="muted">(porteur du programme au PLF 2025)</span>` : '<span class="muted">programme absent du PLF 2025</span>'}</dd>
          <dt>SCSP du programme</dt><dd>${p?.scspCp != null ? `${eur(p.scspCp)} <span class="muted">en 2025 (PLF), pour l’ensemble du programme, qui pilote ${plural(p.operators, 'opérateur')} ; la part de celui-ci n’est pas publiée en données ouvertes</span>` : '<span class="muted">non disponible</span>'}</dd>
          <dt>Taxes affectées</dt><dd>${tx ? `${eur(tx.y2024.kept)} conservés en 2024 (prévision)${tx.y2024.returned ? `, après ${eur(tx.y2024.returned)} reversés au budget général` : ''}${tx.y2022.kept != null ? ` · ${eur(tx.y2022.kept)} en 2022 (exécution)` : ''}${taxRows(tx.items)}` : catTax ? `<span class="muted">affectées au réseau entier, sans répartition publiée :</span> ${eur(catTax.y2024.kept)} pour l’ensemble des ${esc(o.category.toLowerCase())} en 2024${taxRows(catTax.items)}` : '<span class="muted">aucune dans la liste du PLF 2024</span>'}</dd>
          <dt>Emplois (ETPT)</dt><dd><span class="muted">non publiés en données ouvertes</span></dd>
        </dl>
        <p class="note">Liste : ${srcLink('list', 'jaune Opérateurs, PLF 2026')} · SCSP : ${srcLink('scsp', 'PLF 2025 par nature')} · Taxes : ${srcLink('taxes', 'taxes affectées, PLF 2024')} · ${link(search, 'Chercher l’organisme dans l’Annuaire des entreprises')}</p>`;
    }
    function programmeHtml(p, headingId = '') {
      const ops = OPS.filter(o => o.programme === p.code);
      return `<span class="tx-pill">Programme ${esc(p.code)}</span>
        <h3${headingId ? ` id="${headingId}"` : ''}>${esc(p.label)}</h3>
        <div class="tx-amount">${p.scspCp != null ? eur(p.scspCp) : '–'}</div>
        <p class="note">Subventions pour charges de service public, crédits de paiement du PLF 2025 · mission ${esc(p.mission || p.missionPlf25 || '')}${p.ministere ? ` · ${esc(p.ministere)}` : ''}${p.cp ? ` · ${pct(100 * p.scspCp / p.cp, 0)} des crédits du programme (${eur(p.cp)})` : ''}</p>
        ${ops.length ? `<p class="note">Chef de file de ${plural(ops.length, 'opérateur')} :</p><ul class="op-oplist">${ops.slice(0, 40).map(o => `<li><button type="button" class="tx-rowlink" data-op="${o.id}">${esc(o.name)}</button></li>`).join('')}${ops.length > 40 ? `<li class="muted">et ${ops.length - 40} autres, voir le tableau</li>` : ''}</ul>` : '<p class="note">Ce programme ne pilote aucun opérateur : ses subventions vont à des opérateurs rattachés à d’autres programmes, ou à d’autres organismes.</p>'}
        <p class="note">Source : ${srcLink('scsp')}</p>`;
    }

    const detail = $('opDetail');
    let selected = null, mapMode = 'count';
    function select(id) {
      const o = byId.get(id); if (!o) return;
      selected = id;
      detail.innerHTML = ficheHtml(o);
      $('opTreemap').querySelectorAll('.tx-cell').forEach(n => n.classList.toggle('is-selected', Number(n.dataset.id) === id));
    }
    const dialog = $('opDialog');
    function openFiche(id) {
      const o = byId.get(id); if (!o) return;
      $('opDialogBody').innerHTML = ficheHtml(o, 'opDialogTitle');
      if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
      else { select(id); detail.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); }
    }
    function openProgramme(code) {
      const p = progByCode.get(code); if (!p) return;
      $('opDialogBody').innerHTML = programmeHtml(p, 'opDialogTitle');
      if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    }
    dialog.addEventListener('click', event => {
      if (event.target === dialog) { dialog.close(); return; }
      const b = event.target.closest('[data-op]'); if (b) openFiche(Number(b.dataset.op));
    });
    detail.addEventListener('click', event => { const b = event.target.closest('[data-op]'); if (b) select(Number(b.dataset.op)); });

    /* ---------- Treemap: missions, then one cell per operator or per programme ---------- */
    const scspMissions = [...new Set(PROGS.filter(p => p.scspCp > 0).map(p => p.mission))]
      .map(m => ({ m, v: PROGS.filter(p => p.mission === m && p.scspCp > 0 && p.operators).reduce((s, p) => s + p.scspCp, 0) })).sort((a, b) => b.v - a.v);
    const scspSlot = m => { const i = scspMissions.slice(0, 4).findIndex(x => x.m === m); return i < 0 ? '7' : String(i + 1); };
    const treemapEl = $('opTreemap');
    const drawTreemap = W => {
      const H = Math.round(treemapEl.clientHeight || 480);
      let groups;
      if (mapMode === 'count') {
        groups = missions.map(m => ({ key: m, items: OPS.filter(o => o.mission === m).sort((a, b) => STATUT_ORDER.indexOf(a.statut) - STATUT_ORDER.indexOf(b.statut) || (a.category || '').localeCompare(b.category || '', 'fr') || a.name.localeCompare(b.name, 'fr')).map(o => ({ ...o, value: 1 })) }));
      } else {
        const ms = [...new Set(PROGS.filter(p => p.scspCp > 0).map(p => p.mission))];
        groups = ms.map(m => ({ key: m, items: PROGS.filter(p => p.scspCp > 0 && p.mission === m).sort((a, b) => b.scspCp - a.scspCp).map(p => ({ ...p, value: p.scspCp })) }));
      }
      groups = groups.map(g => ({ ...g, value: g.items.reduce((s, it) => s + it.value, 0) })).sort((a, b) => b.value - a.value);
      let cells = '', labels = '';
      squarify(groups, 0, 0, W, H).forEach(gr => {
        squarify(gr.items, gr.x, gr.y, gr.w, gr.h).forEach(c => {
          if (mapMode === 'count') {
            const slot = statutSlot(c.statut);
            cells += `<g class="tx-cell${lightText(slot) ? ' is-light' : ''}${selected === c.id ? ' is-selected' : ''}" data-id="${c.id}"><rect x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" width="${Math.max(0, c.w).toFixed(2)}" height="${Math.max(0, c.h).toFixed(2)}" rx="${Math.min(2, c.w / 3, c.h / 3).toFixed(1)}" fill="${statutColor(c.statut)}"/></g>`;
          } else {
            const fits = c.w > 70 && c.h > 30, big = c.w > 70 && c.h > 48, maxChars = Math.floor((c.w - 12) / 6.6);
            const name = `${c.code} · ${c.label}`, text = name.length > maxChars ? `${name.slice(0, Math.max(1, maxChars - 1))}…` : name;
            const slot = c.operators ? scspSlot(c.mission) : 'other';
            cells += `<g class="tx-cell${lightText(slot) ? ' is-light' : ''}" data-prog="${esc(c.code)}" tabindex="0" role="button" aria-label="Programme ${esc(c.code)} ${esc(c.label)} : ${esc(eur(c.scspCp))}"><rect x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" width="${Math.max(0, c.w).toFixed(2)}" height="${Math.max(0, c.h).toFixed(2)}" rx="${Math.min(3, c.w / 3, c.h / 3).toFixed(1)}" fill="var(--tx-${slot})"/>${fits ? `<text x="${(c.x + 7).toFixed(1)}" y="${(c.y + 18).toFixed(1)}">${esc(text)}</text>` : ''}${big ? `<text class="tx-cell__value" x="${(c.x + 7).toFixed(1)}" y="${(c.y + 34).toFixed(1)}">${eur(c.scspCp)}</text>` : ''}</g>`;
          }
        });
        labels += `<rect class="op-group" x="${gr.x.toFixed(2)}" y="${gr.y.toFixed(2)}" width="${gr.w.toFixed(2)}" height="${gr.h.toFixed(2)}"/>`;
        if (mapMode === 'count' && gr.w > 80 && gr.h > 34) {
          const maxChars = Math.floor((gr.w - 14) / 6.8), t = gr.key.length > maxChars ? `${gr.key.slice(0, Math.max(1, maxChars - 1))}…` : gr.key;
          labels += `<text class="op-group__label" x="${(gr.x + 7).toFixed(1)}" y="${(gr.y + 17).toFixed(1)}">${esc(t)}</text><text class="op-group__label op-group__n" x="${(gr.x + 7).toFixed(1)}" y="${(gr.y + 32).toFixed(1)}">${gr.items.length}</text>`;
        }
      });
      treemapEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="${mapMode === 'count' ? 'Opérateurs de l’État regroupés par mission, une case par opérateur' : 'Subventions pour charges de service public par programme, PLF 2025'}">${cells}<g class="op-groups" aria-hidden="true">${labels}</g></svg>`;
      if (mapMode === 'count') {
        const present = [...STATUT_ORDER, 'other'].map(s => ({ s, n: s === 'other' ? OPS.filter(o => !STATUT_ORDER.includes(o.statut)).length : OPS.filter(o => o.statut === s).length }));
        $('opLegend').innerHTML = present.map(({ s, n }) => `<span><i style="background:var(--tx-${s === 'other' ? 'other' : statutSlot(s)})"></i>${s === 'other' ? 'Autres statuts' : esc(s)} <b>${n}</b></span>`).join('');
        $('opTreemapNote').textContent = `Chaque case est un opérateur de la liste du PLF 2026, sa couleur est son statut juridique ; les blocs sont les missions du budget de l’État auxquelles se rattache leur programme chef de file. La surface ne dit rien de la taille des opérateurs : un parc national pèse une case, comme le CNRS. France Travail figure encore sous son ancien nom, « Pôle emploi ». Cliquez sur une case pour sa fiche.`;
      } else {
        const noOp = PROGS.filter(p => p.scspCp > 0 && !p.operators);
        const rest = scspMissions.slice(4).reduce((s, x) => s + x.v, 0);
        $('opLegend').innerHTML = scspMissions.slice(0, 4).map((x, i) => `<span><i style="background:var(--tx-${i + 1})"></i>${esc(x.m)} <b>${eur(x.v)}</b></span>`).join('') + `<span><i style="background:var(--tx-7)"></i>Autres missions <b>${eur(rest)}</b></span><span><i style="background:var(--tx-other)"></i>Programme qui ne pilote aucun opérateur <b>${eur(noOp.reduce((s, p) => s + p.scspCp, 0))}</b></span>`;
        $('opTreemapNote').textContent = `Chaque rectangle est un programme du budget de l’État, sa couleur sa mission, sa surface le montant des subventions pour charges de service public inscrites au PLF 2025 (${eur(T.scspCp)} au total, crédits de paiement). Ces montants ne peuvent pas être répartis entre les opérateurs avec les données ouvertes. Cliquez sur un programme pour la liste des opérateurs qu’il pilote.`;
      }
    };
    const redrawMap = responsive(treemapEl, drawTreemap);
    treemapEl.addEventListener('pointermove', event => {
      const cell = event.target.closest?.('.tx-cell'); if (!cell) { hideTip(); return; }
      if (cell.dataset.prog) { const p = progByCode.get(cell.dataset.prog); showTip(event, `<strong>${esc(p.code)} · ${esc(p.label)}</strong><span class="tx-tip__value">${eur(p.scspCp)}</span> de SCSP (PLF 2025)<br>${esc(p.mission || '')}<br>${p.operators ? `chef de file de ${plural(p.operators, 'opérateur')}` : 'ne pilote aucun opérateur'}`); return; }
      const o = byId.get(Number(cell.dataset.id));
      showTip(event, `<strong>${esc(o.name)}</strong>${esc(o.statut)}${o.category ? ` · ${esc(o.category)}` : ''}<br>${esc(o.mission)}<br>Programme ${esc(o.programme)}${kept(o) ? `<br>Taxes affectées 2024 : <span class="tx-tip__value">${eur(kept(o))}</span>` : ''}`);
    });
    treemapEl.addEventListener('pointerleave', hideTip);
    treemapEl.addEventListener('click', event => {
      const cell = event.target.closest?.('.tx-cell'); if (!cell) return;
      if (cell.dataset.prog) { hideTip(); openProgramme(cell.dataset.prog); return; }
      select(Number(cell.dataset.id));
      if (innerWidth <= 960) detail.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
    });
    treemapEl.addEventListener('keydown', event => { const cell = event.target.closest?.('.tx-cell'); if (cell?.dataset.prog && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openProgramme(cell.dataset.prog); } });
    $('opMapMode').addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b || b.dataset.mode === mapMode) return;
      mapMode = b.dataset.mode;
      $('opMapMode').querySelectorAll('button').forEach(n => n.classList.toggle('active', n === b));
      redrawMap();
    });
    $('opMapLead').textContent = `Les ${T.operators} opérateurs de la liste annexée au projet de loi de finances 2026, dans les ${T.missions} missions du budget qui les pilotent. Deuxième vue : les subventions que versent les programmes de ces missions.`;
    select(OPS.find(o => /^(France Travail|Pôle emploi)/.test(o.name))?.id ?? OPS[0].id);

    /* ---------- Missions and ministries ---------- */
    let tutBy = 'mission', tutAll = false;
    const drawTut = () => {
      const keyOf = tutBy === 'mission' ? (o => o.mission) : (o => o.ministere || 'Programme absent du PLF 2025');
      const keys = [...new Set(OPS.map(keyOf))];
      const rows = keys.map(k => {
        const ops = OPS.filter(o => keyOf(o) === k), codes = [...new Set(ops.map(o => o.programme))];
        const ps = codes.map(c => progByCode.get(c)), known = ps.filter(p => p?.scspCp != null);
        return { k, n: ops.length, codes, scsp: known.length ? known.reduce((s, p) => s + p.scspCp, 0) : null, missing: ps.length - known.length };
      });
      rows.sort((a, b) => b.n - a.n || a.k.localeCompare(b.k, 'fr'));
      const cap = list => tutAll ? list : list.slice(0, 12);
      hbars($('opTutCount'), cap(rows).map(r => ({ label: r.k, sub: `${plural(r.codes.length, 'programme')} chef${r.codes.length > 1 ? 's' : ''} de file`, value: r.n })), { format: v => nf(v, 0) });
      const bySc = rows.filter(r => r.scsp != null || r.missing).sort((a, b) => (b.scsp ?? -1) - (a.scsp ?? -1));
      hbars($('opTutScsp'), cap(bySc).map(r => ({ label: r.k, sub: `${plural(r.n, 'opérateur')}${r.missing ? ` · ${r.missing} programme absent du PLF 2025` : ''}`, value: r.scsp || 0, display: r.scsp == null ? 'non disponible' : eur(r.scsp) })));
      ['opTutCount', 'opTutScsp'].forEach(id => { const n = id === 'opTutCount' ? rows.length : bySc.length; if (!tutAll && n > 12) $(id).insertAdjacentHTML('beforeend', `<div class="tx-more"><button type="button" data-tut-all>Afficher les ${n} lignes</button></div>`); });
      $('opTutCountTitle').textContent = tutBy === 'mission' ? 'Nombre d’opérateurs par mission' : 'Nombre d’opérateurs par ministère';
      $('opTutCountNote').textContent = tutBy === 'mission'
        ? `${T.missions} missions et ${T.programmes} programmes chefs de file. La mission est celle de la liste du PLF 2026.`
        : 'Ministère qui porte le programme chef de file dans le PLF 2025, dernière nomenclature par ministère disponible dans les données téléchargées. La tutelle réelle peut être partagée entre plusieurs ministères ; la liste ne l’indique pas.';
      $('opTutScspNote').innerHTML = `Somme, pour chaque regroupement, des SCSP inscrites sur les programmes chefs de file de ses opérateurs. Un programme peut aussi financer des opérateurs pilotés ailleurs : ce n’est pas le financement de ces opérateurs, c’est ce que portent leurs programmes. ${eur(T.scspCp - T.scspChefCp)} de SCSP sont inscrits sur des programmes qui ne pilotent aucun opérateur. Sources : ${srcLink('list', 'liste PLF 2026')}, ${srcLink('scsp', 'crédits PLF 2025 par nature')}.`;
    };
    drawTut();
    $('tutelles').addEventListener('click', event => { if (event.target.closest('[data-tut-all]')) { tutAll = true; drawTut(); } });
    $('opTutBy').addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b || b.dataset.by === tutBy) return;
      tutBy = b.dataset.by; $('opTutBy').querySelectorAll('button').forEach(n => n.classList.toggle('active', n === b)); drawTut();
    });

    /* ---------- Status and networks ---------- */
    const statuts = [...new Set(OPS.map(o => o.statut))].map(s => ({ s, n: OPS.filter(o => o.statut === s).length })).sort((a, b) => b.n - a.n);
    hbars($('opStatuts'), statuts.map(({ s, n }) => ({ label: s, sub: esc(STATUTS[s] || ''), value: n, color: statutColor(s) })), { format: v => nf(v, 0) });
    $('opStatutsNote').innerHTML = `Statut indiqué dans la liste pour chaque ligne. Les établissements publics administratifs (EPA) sont les plus nombreux ; les universités et grandes écoles sont des EPSCP. Source : ${srcLink('list')}.`;
    const cats = [...catCount.entries()].sort((a, b) => b[1] - a[1]);
    hbars($('opCats'), cats.map(([c, n]) => {
      const st = [...new Set(OPS.filter(o => o.category === c).map(o => o.statut))].join(', ');
      return { label: c, sub: esc(st), value: n };
    }), { format: v => nf(v, 0) });
    const unnamed = OPS.filter(o => o.unnamed);
    $('opCatsNote').textContent = `${T.inCategories} des ${T.operators} lignes appartiennent à une catégorie : le jaune les compte une par une, chacune avec son statut. ${unnamed.length ? `Une ligne « ${unnamed[0].category} » n’a pas de nom d’établissement dans le fichier ; elle est gardée telle quelle.` : ''}`;

    /* ---------- Subsidies by programme ---------- */
    const withScsp = PROGS.filter(p => p.scspCp > 0).sort((a, b) => b.scspCp - a.scspCp);
    const absent = PROGS.filter(p => !p.inPlf25);
    const top5 = withScsp.slice(0, 5).reduce((s, p) => s + p.scspCp, 0);
    $('opFinKpis').innerHTML = [
      ['SCSP inscrites au PLF 2025', eur(T.scspCp), `crédits de paiement, ${withScsp.length} programmes ; autorisations d’engagement identiques`],
      ['Programme 150, universités', eur(p150?.scspCp), `${pct(100 * (p150?.scspCp || 0) / T.scspCp, 0)} du total, pour ${p150?.operators} opérateurs chefs de file`],
      ['Les cinq premiers programmes', pct(100 * top5 / T.scspCp, 0), 'des subventions pour charges de service public'],
      ['Programmes chefs de file absents du PLF 2025', String(absent.length), absent.map(p => `${p.code} (${plural(p.operators, 'opérateur')})`).join(', ') || 'aucun']
    ].map(([a, b, c]) => `<div class="kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join('');
    hbars($('opProgTop'), withScsp.slice(0, 15).map(p => ({ html: `<button type="button" class="tx-rowlink" data-prog="${esc(p.code)}">${esc(p.code)} · ${esc(p.label)}</button>`, sub: `${esc(p.mission || '')} · ${p.operators ? `chef de file de ${plural(p.operators, 'opérateur')}` : 'ne pilote aucun opérateur'}`, value: p.scspCp, color: p.operators ? null : 'var(--tx-other)' })));
    $('opProgTop').addEventListener('click', event => { const b = event.target.closest('[data-prog]'); if (b) openProgramme(b.dataset.prog); });
    $('opProgTopNote').innerHTML = `Catégorie 32 (subventions pour charges de service public) des crédits par nature du PLF 2025. Les autres versements de l’État aux opérateurs (transferts, dotations en fonds propres) sont mêlés dans les données à ceux destinés à d’autres bénéficiaires ; ils ne sont pas comptés ici. Source : ${srcLink('scsp')}.`;

    /* Scatter: SCSP (log) against number of operators piloted (log). */
    const scatterEl = $('opProgScatter');
    const pts = PROGS.filter(p => p.scspCp > 0 && p.operators > 0);
    responsive(scatterEl, W => {
      const H = 300, L = 58, R = 14, Tp = 12, B = 34;
      const x0 = 0, x1 = Math.log10(200), y0 = 5, y1 = Math.ceil(Math.log10(Math.max(...pts.map(p => p.scspCp))));
      const x = n => L + (W - L - R) * (Math.log10(n) - x0) / (x1 - x0), y = v => Tp + (H - Tp - B) * (1 - (Math.log10(v) - y0) / (y1 - y0));
      let svg = '';
      for (let k = y0; k <= y1; k++) svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(10 ** k)}" y2="${y(10 ** k)}"/><text class="tx-tick" x="${L - 8}" y="${y(10 ** k) + 4}" text-anchor="end">${eur(10 ** k).replace(/^1 000 M€$/, '1 Md€')}</text>`;
      [1, 2, 5, 10, 20, 50, 100, 200].forEach(n => { svg += `<line class="tx-grid" x1="${x(n)}" x2="${x(n)}" y1="${Tp}" y2="${H - B}" opacity=".5"/><text class="tx-tick" x="${x(n)}" y="${H - B + 16}" text-anchor="middle">${n}</text>`; });
      svg += `<text class="tx-tick" x="${(L + W - R) / 2}" y="${H - 2}" text-anchor="middle">Nombre d’opérateurs pilotés (échelle logarithmique)</text>`;
      svg += pts.map(p => `<circle class="tx-dot" data-prog="${esc(p.code)}" cx="${x(p.operators).toFixed(1)}" cy="${y(p.scspCp).toFixed(1)}" r="5.5" fill="var(--tx-1)"/>`).join('');
      const lab = pts.filter(p => p.scspCp > 1.4e9 || p.operators >= 18);
      svg += lab.map(p => `<text class="tx-label tx-halo" x="${(x(p.operators) + (x(p.operators) > W - 90 ? -9 : 9)).toFixed(1)}" y="${(y(p.scspCp) + 4).toFixed(1)}" text-anchor="${x(p.operators) > W - 90 ? 'end' : 'start'}">${esc(p.code)}</text>`).join('');
      scatterEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Subvention de chaque programme selon le nombre d’opérateurs qu’il pilote">${svg}</svg>`;
    });
    scatterEl.addEventListener('pointermove', event => { const d = event.target.closest?.('.tx-dot'); if (!d) { hideTip(); return; } const p = progByCode.get(d.dataset.prog); showTip(event, `<strong>${esc(p.code)} · ${esc(p.label)}</strong><span class="tx-tip__value">${eur(p.scspCp)}</span><br>chef de file de ${plural(p.operators, 'opérateur')}`); });
    scatterEl.addEventListener('pointerleave', hideTip);
    scatterEl.addEventListener('click', event => { const d = event.target.closest?.('.tx-dot'); if (d) { hideTip(); openProgramme(d.dataset.prog); } });
    const fewBig = pts.filter(p => p.operators <= 3).sort((a, b) => b.scspCp - a.scspCp).slice(0, 4)
      .map(p => `${p.code}, ${eur(p.scspCp)} (${OPS.filter(o => o.programme === p.code).map(short).join(', ')})`);
    const many = pts.slice().sort((a, b) => b.operators - a.operators)[0];
    $('opProgScatterNote').textContent = `${pts.length} programmes qui pilotent au moins un opérateur et versent des SCSP. À droite, le programme ${many.code} pilote ${many.operators} opérateurs ; en haut à gauche, les programmes qui versent le plus en ne pilotant qu’un à trois opérateurs : ${fewBig.join(' ; ')}. Diviser la subvention par le nombre d’opérateurs donnerait une moyenne sans signification : elle n’est pas calculée.`;

    /* ---------- Earmarked taxes ---------- */
    const benef = [
      ...OPS.filter(o => o.taxes).map(o => ({ label: short(o), full: o.name, t: o.taxes, id: o.id })),
      ...Object.entries(data.categoryTaxes).map(([c, t]) => ({ label: c, full: `${c} (réseau, ${catCount.get(c)} établissements)`, t })),
      ...data.unmatchedTaxes.map(u => ({ label: u.beneficiary.split(' - ')[0], full: `${u.beneficiary} (absent de la liste 2026)`, t: u, absent: true }))
    ].filter(b => b.t.y2024.yield).sort((a, b) => b.t.y2024.yield - a.t.y2024.yield);
    const maxY = Math.max(...benef.map(b => b.t.y2024.yield));
    $('opTaxBars').innerHTML = `<ul class="tx-bars op-stack">${benef.map(b => {
      const y = b.t.y2024, k = y.kept ?? y.yield, r = y.returned || 0;
      return `<li><div class="tx-bars__line"><span>${b.id ? `<button type="button" class="tx-rowlink" data-op="${b.id}">${esc(b.full)}</button>` : esc(b.full)}<small>${plural(b.t.count, 'taxe')}${b.t.y2022.kept != null ? ` · ${eur(b.t.y2022.kept)} conservés en 2022` : ''}</small></span><strong>${eur(k)}${r ? ` <span class="muted">+ ${eur(r)} reversés</span>` : ''}</strong></div><span class="tx-bars__track op-stack__track" aria-hidden="true"><span class="op-stack__kept" style="width:${(100 * k / maxY).toFixed(3)}%"></span><span class="op-stack__returned" style="width:${(100 * r / maxY).toFixed(3)}%"></span></span></li>`;
    }).join('')}</ul>`;
    $('opTaxBars').addEventListener('click', event => { const b = event.target.closest('[data-op]'); if (b) openFiche(Number(b.dataset.op)); });
    const fc = OPS.find(o => o.name === 'France Compétences');
    $('opTaxKpis').innerHTML = [
      ['Prévues pour 2024', eur(T.taxesOperators2024.yield), `${T.taxesOperatorsLines} taxes affectées à ${T.taxesOperatorsBeneficiaries} opérateurs ou réseaux, avant plafonnement`],
      ['Reversées au budget général', eur(T.taxesOperators2024.returned), 'part qui dépasse les plafonds votés en loi de finances'],
      ['Conservées par les opérateurs', eur(T.taxesOperators2024.kept), `prévision 2024 ; ${eur(T.taxesOperators2022.kept)} en 2022 (exécution)`],
      ['France Compétences', pct(100 * (kept(fc) || 0) / T.taxesOperators2024.kept, 0), `des taxes conservées (${eur(kept(fc))}, contribution des employeurs à la formation et à l’apprentissage)`]
    ].map(([a, b, c]) => `<div class="kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join('');
    const unm = data.unmatchedTaxes.map(u => u.beneficiary).join(', ');
    $('opTaxNote').innerHTML = `Bénéficiaires classés « Opérateurs État » dans la liste des taxes affectées du PLF 2024 (Voies et moyens, tome 1) : rendement prévu pour 2024, moins le montant reversé au budget général au-delà du plafond. Rattachés à la liste 2026 par leur sigle ou leur nom exact. ${unm ? `${esc(unm)} ne figure plus dans la liste des opérateurs 2026 ; il reste affiché, à part.` : ''} Les taxes des agences de l’eau sont publiées pour les six agences ensemble. Sur ${eur(T.taxesAll2024)} de taxes affectées à tous bénéficiaires en 2024 (Sécurité sociale, collectivités…), ces opérateurs en reçoivent ${pct(100 * T.taxesOperators2024.yield / T.taxesAll2024, 0)}. La page ${link('impots.html', 'Impôts et taxes')} détaille chaque prélèvement. Source : ${srcLink('taxes')}.`;

    /* ---------- Full table ---------- */
    const filters = { mission: $('opFilterMission'), ministere: $('opFilterMinistere'), statut: $('opFilterStatut'), category: $('opFilterCategory') };
    missions.forEach(m => filters.mission.insertAdjacentHTML('beforeend', `<option>${esc(m)}</option>`));
    [...new Set(OPS.map(o => o.ministere).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')).forEach(m => filters.ministere.insertAdjacentHTML('beforeend', `<option>${esc(m)}</option>`));
    statuts.forEach(({ s }) => filters.statut.insertAdjacentHTML('beforeend', `<option value="${esc(s)}">${esc(s)} · ${esc(STATUTS[s] || s)}</option>`));
    cats.forEach(([c]) => filters.category.insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`));
    let sortKey = 'name', sortDir = 1, showAll = false;
    const COLS = [['name', 'Opérateur'], ['statut', 'Statut'], ['category', 'Réseau'], ['programme', 'Programme chef de file et mission'], ['ministere', 'Ministère (PLF 2025)'], ['taxes', 'Taxes affectées 2024', 'num']];
    const val = (o, k) => k === 'taxes' ? kept(o) : k === 'programme' ? Number(o.programme) : o[k] || null;
    function drawTable() {
      const q = norm($('opSearch').value), tx = $('opFilterTax').value;
      let rows = OPS.filter(o => (!q || norm(`${o.name} ${o.category || ''} ${o.programme} ${o.programmeLabel}`).includes(q))
        && (!filters.mission.value || o.mission === filters.mission.value)
        && (!filters.ministere.value || o.ministere === filters.ministere.value)
        && (!filters.statut.value || o.statut === filters.statut.value)
        && (!filters.category.value || (filters.category.value === '-' ? !o.category : o.category === filters.category.value))
        && (!tx || o.taxes));
      rows.sort((a, b) => { const va = val(a, sortKey), vb = val(b, sortKey); if (va == null || vb == null) return (va == null) - (vb == null) || a.name.localeCompare(b.name, 'fr'); return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr')) * sortDir || a.name.localeCompare(b.name, 'fr'); });
      const total = rows.length;
      if (!showAll) rows = rows.slice(0, 50);
      $('opTable').innerHTML = `<table class="data-table tx-table op-table"><thead><tr>${COLS.map(([k, label, cls]) => `<th${cls ? ` class="${cls}"` : ''} data-sort="${k}" aria-sort="${sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(o => `<tr><td class="tx-namecell"><button type="button" class="tx-name tx-rowlink" data-op="${o.id}">${esc(o.name)}</button></td><td><span class="tx-pill" title="${esc(STATUTS[o.statut] || '')}"><i style="background:${statutColor(o.statut)}"></i>${esc(o.statut)}</span></td><td>${o.category ? esc(o.category) : '<span class="muted">isolé</span>'}</td><td class="op-progcell"><span class="op-prog">${esc(o.programme)}</span> ${esc(o.programmeLabel)}<br><span class="muted">${esc(o.mission)}</span></td><td>${o.ministere ? esc(o.ministere) : '<span class="muted">absent du PLF 2025</span>'}</td><td class="num">${o.taxes ? eur(kept(o)) : '<span class="muted">–</span>'}</td></tr>`).join('')}</tbody></table>${total > rows.length ? `<div class="tx-more"><button type="button" id="opShowAll">Afficher les ${total} lignes</button></div>` : ''}`;
      $('opShowAll')?.addEventListener('click', () => { showAll = true; drawTable(); });
      $('opTableNote').innerHTML = `${plural(total, 'opérateur')}${total < T.operators ? ` sur ${T.operators}` : ''}. Taxes affectées : montant conservé en 2024 (prévision du PLF 2024), après reversement au budget général ; un tiret signifie qu’aucune taxe n’est affectée à cet opérateur dans la liste, ou qu’elle l’est à son réseau entier (agences de l’eau). Les subventions et les emplois de chaque opérateur ne sont pas dans les données ouvertes : voir ${link('#non-publie', 'ce qui n’est pas publié')}.`;
    }
    ['input', 'change'].forEach(ev => ['opSearch', 'opFilterMission', 'opFilterMinistere', 'opFilterStatut', 'opFilterCategory', 'opFilterTax'].forEach(id => $(id).addEventListener(ev, () => { showAll = false; drawTable(); })));
    $('opTable').addEventListener('click', event => {
      const row = event.target.closest('[data-op]');
      if (row) { openFiche(Number(row.dataset.op)); return; }
      const th = event.target.closest('th[data-sort]'); if (!th) return;
      const k = th.dataset.sort; sortDir = sortKey === k ? -sortDir : (k === 'taxes' ? -1 : 1); sortKey = k; drawTable();
    });
    drawTable();

    /* ---------- Method ---------- */
    const method = [
      ['Trois documents, trois années', `La liste des opérateurs est celle du PLF 2026 ; les subventions viennent du PLF 2025, dernier détail par nature téléchargé ; les taxes affectées, de la liste du PLF 2024. Les années ne sont jamais mélangées dans un même total.`],
      ['Le décompte officiel est retrouvé', `Le fichier compte ${T.operators} lignes ; le jaune annonce ${T.published} opérateurs en 2026, contre ${T.publishedPrevious} en 2025 (${link(S.count.url, 'Acteurs publics, citant le jaune')}). Chaque établissement d’un réseau (une université, une ARS) compte pour un.`],
      ['Subvention d’un programme, pas d’un opérateur', 'Les crédits ouverts sont publiés par programme, action et nature. Un programme qui pilote 159 opérateurs n’a qu’une ligne « subventions pour charges de service public ». Aucune part n’est attribuée à un opérateur par règle de trois.'],
      ['Programme chef de file', 'Un opérateur peut recevoir des crédits de plusieurs programmes ; la liste ne donne que son programme principal. Les sommes par mission ou par ministère additionnent donc des programmes, pas des opérateurs.'],
      ['Ministère de tutelle', `La liste ne nomme pas le ministère. Celui affiché est le ministère qui porte le programme chef de file dans le PLF 2025. ${absent.length} programmes de 2026 n’existent pas dans le PLF 2025 (${absent.map(p => p.code).join(', ')}) : leur ministère reste vide.`],
      ['Taxes affectées rattachées par le nom', 'Une taxe n’est attachée à un opérateur que si le bénéficiaire porte exactement son sigle ou son nom. Montants de 2024 : prévision, rendement moins reversement au budget général au-delà du plafond.']
    ];
    $('opMethod').innerHTML = method.map(([h, p]) => `<article class="gap"><h3>${esc(h)}</h3><p>${p}</p></article>`).join('');
    $('opSources').innerHTML = ['list', 'scsp', 'taxes'].map(k => link(S[k].page || S[k].url, `${S[k].title} ↗`)).join('') + link(S.count.url, `${S.count.title} ↗`);

    /* ---------- What is not published ---------- */
    const GAPS = [
      { state: 'none', title: 'Le financement de l’État, opérateur par opérateur', today: `Les données ouvertes donnent les subventions par programme (${eur(T.scspCp)} au PLF 2025), jamais par opérateur. Les projets annuels de performance de chaque programme les détaillent, en PDF.`, ask: 'Un fichier par année : opérateur, programme, subvention pour charges de service public, transferts, dotations en fonds propres, en prévision et en exécution.', who: 'Direction du budget, avec le jaune « Opérateurs de l’État » et les rapports annuels de performance.' },
      { state: 'none', title: 'Les emplois des opérateurs', today: 'Les emplois sous plafond (votés en loi de finances) et hors plafond (financés par les ressources propres) figurent dans les documents budgétaires PDF ; aucun fichier ouvert téléchargé par le site ne les contient.', ask: 'Pour chaque opérateur : ETPT sous plafond et hors plafond, prévus et réalisés, sur plusieurs années.', who: 'Direction du budget ; chaque ministère de tutelle pour ses opérateurs.' },
      { state: 'none', title: 'Un identifiant pour chaque opérateur', today: 'La liste ne donne ni SIREN ni SIRET. Impossible de relier un opérateur, sans erreur, à ses marchés publics, aux aides qu’il verse ou à ses comptes.', ask: 'Ajouter le SIREN de chaque ligne de la liste.', who: 'Direction du budget, qui publie la liste sur data.gouv.fr.' },
      { state: 'partial', title: 'Les comptes des opérateurs', today: 'Chaque opérateur arrête un compte financier annuel (bilan, résultat, trésorerie, fonds de roulement). Certains le mettent en ligne sur leur site, sans format commun.', ask: 'Un recueil ouvert des comptes financiers de tous les opérateurs, au même format, chaque année.', who: 'DGFiP (comptables publics des opérateurs) et Direction du budget.' },
      { state: 'none', title: 'Les rémunérations', today: 'Ni la masse salariale par opérateur, ni la rémunération de leurs dirigeants ne sont dans les données ouvertes utilisées ici.', ask: 'Masse salariale, effectifs et rémunérations les plus élevées de chaque opérateur.', who: 'Chaque opérateur, sous le contrôle de son ministère de tutelle.' },
      { state: 'partial', title: 'Les achats des opérateurs', today: 'Les opérateurs sont des acheteurs publics : leurs marchés doivent apparaître dans les données essentielles de la commande publique (page Marchés publics), mais sans SIREN dans la liste on ne peut pas isoler ceux des opérateurs.', ask: 'Le SIREN dans la liste, et la publication complète des marchés de chaque opérateur.', who: 'Chaque opérateur acheteur ; Direction des affaires juridiques pour les données essentielles.' },
      { state: 'partial', title: 'Les taxes affectées récentes', today: 'La liste ouverte utilisée ici est celle du PLF 2024 (prévision 2024, exécution 2022). Les montants exécutés plus récents, par opérateur, ne sont pas dans les fichiers téléchargés.', ask: 'Chaque année, la liste des taxes affectées en fichier ouvert, avec l’exécution et le plafond, et le SIREN du bénéficiaire.', who: 'Direction du budget et Direction de la législation fiscale (Voies et moyens, tome 1).' },
      { state: 'none', title: 'Les ressources propres', today: 'Recettes commerciales, mécénat, fonds européens, contrats de recherche : la part du budget de chaque opérateur qui ne vient pas de l’État n’est pas publiée en données ouvertes.', ask: 'Le budget de chaque opérateur par origine des ressources, prévu et exécuté.', who: 'Chaque opérateur ; Direction du budget pour la synthèse du jaune.' }
    ];
    $('opGaps').innerHTML = GAPS.map((a, i) => `<article class="gap tx-ask"><span class="gap__state ${a.state}">${a.state === 'none' ? 'Non publié' : 'Partiel'}</span><h3><span class="tx-ask__n">${i + 1}</span>${esc(a.title)}</h3><dl><dt>Aujourd’hui</dt><dd>${esc(a.today)}</dd><dt>Ce qu’il faudrait publier</dt><dd>${esc(a.ask)}</dd><dt>Par qui</dt><dd>${esc(a.who)}</dd></dl></article>`).join('');

    FRL.keepHash();
  }
})();
