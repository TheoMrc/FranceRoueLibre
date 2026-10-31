/* Niches fiscales: every tax expenditure of the PLF 2026 (« budget vert » open file: cost 2024, 2025, 2026, tax, mission,
   2026 flags « ε » and « nc »), with the PLF 2024 tome II list for the section and stated purpose. One data file:
   data/niches.json (scripts/niches-data.py). Amounts in millions of euros. Charts are HTML/SVG redrawn on resize. */
(() => {
  const { esc, load } = FRL;
  const $ = id => document.getElementById(id);
  const nf = (value, digits = 1) => value.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  const meur = value => {
    if (value == null || !Number.isFinite(value)) return '–';
    const a = Math.abs(value);
    if (a >= 1000) return `${nf(value / 1000, a >= 100000 ? 0 : a >= 10000 ? 1 : 2)} Md€`;
    if (a >= 10) return `${nf(value, 0)} M€`;
    return `${nf(value, 1)} M€`;
  };
  const pct = (value, digits = 0) => `${nf(value, digits)} %`;
  const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${meur(Math.abs(v))}`;
  const link = (url, text) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const cut = (s, n) => s.length > n ? `${s.slice(0, n - 2).replace(/\s+\S*$/, '')}…` : s;
  const kpis = list => list.map(([a, b, c]) => `<div class="kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join('');
  const STATUS = { 'chiffré': 'Chiffrée', nc: 'Non chiffrée (nc)', 'ε': 'Moins de 0,5 M€ (ε)', vide: 'Sans montant 2026' };
  const statusPill = st => `<span class="nf-st nf-st--${st === 'ε' ? 'eps' : st === 'chiffré' ? 'ok' : st}">${esc(st === 'chiffré' ? 'chiffrée' : st === 'vide' ? 'sans montant' : st)}</span>`;

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
    const run = () => { const w = Math.round(el.clientWidth); if (w && w !== width) { width = w; draw(w); } };
    if (typeof ResizeObserver === 'function') new ResizeObserver(run).observe(el);
    run();
  }

  function hbars(el, rows, { format = meur, max = null } = {}) {
    if (!rows.length) { el.innerHTML = '<p class="tx-empty">Aucune donnée.</p>'; return; }
    const top = max ?? Math.max(...rows.map(r => r.value || 0), 1e-9);
    el.innerHTML = `<ul class="tx-bars">${rows.map(r => `<li class="${r.focus ? 'is-focus' : ''}"><div class="tx-bars__line"><span>${esc(r.label)}${r.sub ? `<small>${r.sub}</small>` : ''}</span><strong>${format(r.value)}</strong></div><span class="tx-bars__track" aria-hidden="true"><span class="tx-bars__fill" style="--w:${(100 * (r.value || 0) / top).toFixed(2)}%"></span></span></li>`).join('')}</ul>`;
    requestAnimationFrame(() => el.querySelectorAll('.tx-bars__fill').forEach(n => { n.style.width = n.style.getPropertyValue('--w'); }));
  }

  load('./data/niches.json').then(init).catch(error => {
    console.error(error);
    $('nfKpis').innerHTML = '<p class="tx-empty">Données indisponibles. Le site doit être servi par HTTP.</p>';
  });

  function init(data) {
    const M = data.measures, C = data.counts, T = data.totals, Y = data.years, S = data.sources;
    const t26 = T[2], known = M.filter(m => m.v[2] != null).sort((a, b) => b.v[2] - a.v[2]);
    const missing = M.filter(m => m.v[2] == null);
    const top10 = known.slice(0, 10).reduce((s, m) => s + m.v[2], 0);
    const srcPlf26 = link(S.plf26.page, 'PLF 2026, données du « budget vert »'), srcPlf24 = link(S.plf24.page, 'PLF 2024, tome II des voies et moyens');

    /* ---------- Headline ---------- */
    $('nfLead').textContent = `${C.measures} réductions, crédits d’impôt, exonérations et taux réduits recensés par le projet de loi de finances pour 2026. Leur coût prévu pour 2026 : ${meur(t26.total)} pour les ${t26.count} mesures chiffrées. Pour ${C.measures - t26.count} autres, aucun montant 2026 n’est donné.`;
    $('nfKpis').innerHTML = kpis([
      ['Coût prévu en 2026', meur(t26.total), `somme des ${t26.count} mesures chiffrées : un ordre de grandeur, pas un total exact`],
      ['Mesures recensées', String(C.measures), `dépenses fiscales du PLF 2026, sur ${C.lines} lignes du fichier`],
      ['Sans montant pour 2026', String(C.measures - t26.count), `${C.nc} « non chiffrées », ${C.eps} « ε » (moins de 0,5 M€), ${C.empty} sans montant ni mention`],
      ['Les dix plus coûteuses', pct(100 * top10 / t26.total), `du coût chiffré de 2026 (${meur(top10)})`]
    ]);
    hbars($('nfByTax'), data.byTax.map(g => ({ label: g.name, sub: `${g.n} mesures${g.n - g.known ? `, dont ${g.n - g.known} sans montant 2026` : ''}`, value: g.v26 })));
    const missions = data.byMission.filter(g => g.v26 > 0);
    hbars($('nfByMission'), missions.slice(0, 12).map(g => ({ label: g.name, sub: `${g.n} mesures${g.n - g.known ? `, dont ${g.n - g.known} sans montant 2026` : ''}`, value: g.v26 })));
    const rest = missions.slice(12), restZero = data.byMission.filter(g => !(g.v26 > 0));
    $('nfByMissionNote').textContent = `Mission du budget de l’État à laquelle chaque mesure est rattachée. ${rest.length ? `${rest.length} autres missions : ${meur(rest.reduce((s, g) => s + g.v26, 0))} au total. ` : ''}${restZero.length ? `${restZero.map(g => g.name).join(', ')} : aucune mesure chiffrée.` : ''}`;
    $('nfByTaxNote').innerHTML = `Coût prévu en 2026, par impôt réduit. « Impôt sur le revenu et impôt sur les sociétés » : mesures qui jouent sur les deux (crédit d’impôt recherche, par exemple). Source : ${srcPlf26}.`;

    /* ---------- The most expensive ---------- */
    const yearSub = m => Y.map((y, k) => `${y} : ${meur(m.v[k])}`).join(' · ');
    hbars($('nfTop'), known.slice(0, 20).map(m => ({ label: cut(m.l, 110), sub: `${esc(m.i)} · ${esc(m.m)}<br>${esc(yearSub(m))}`, value: m.v[2] })));
    $('nfTopNote').innerHTML = `Coût prévu en 2026 de chaque mesure, chiffrée seule. Code de la mesure et finalité dans le tableau complet. Source : ${srcPlf26}.`;

    /* ---------- Years ---------- */
    const yearsEl = $('nfYears');
    const series = [
      { label: `Toutes les mesures chiffrées l’année dite`, values: T.map(t => t.total), counts: T.map(t => t.count), cls: 'a' },
      { label: `Les ${data.constant.count} mesures chiffrées les trois années`, values: data.constant.totals, counts: [data.constant.count, data.constant.count, data.constant.count], cls: 'b' }
    ];
    responsive(yearsEl, W => {
      const H = 250, L = 46, R = 8, Tp = 22, B = 44, hi = Math.ceil(Math.max(...series.flatMap(s => s.values)) / 20000) * 20000;
      const y = v => Tp + (H - Tp - B) * (1 - v / hi), gw = (W - L - R) / Y.length, bw = Math.min(56, gw / 3);
      let svg = '';
      for (let v = 0; v <= hi; v += 20000) svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${nf(v / 1000, 0)}</text>`;
      Y.forEach((yr, k) => {
        const cx = L + gw * k + gw / 2;
        series.forEach((s, j) => {
          const x = cx - bw - 3 + j * (bw + 6), v = s.values[k];
          svg += `<rect class="nf-bar nf-bar--${s.cls}" data-k="${k}" data-j="${j}" x="${x}" y="${y(v)}" width="${bw}" height="${y(0) - y(v)}" rx="3"/><text class="tx-label" x="${x + bw / 2}" y="${y(v) - 6}" text-anchor="middle">${nf(v / 1000, 1)}</text>`;
        });
        svg += `<text class="tx-tick tx-tick--strong" x="${cx}" y="${H - 24}" text-anchor="middle">${yr}</text><text class="tx-tick" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(data.yearLabels[k].replace(/^\d+ \(|\)$/g, ''))}</text>`;
      });
      yearsEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Coût des dépenses fiscales en milliards d’euros, 2024 à 2026">${svg}</svg>`;
    });
    yearsEl.addEventListener('pointermove', event => {
      const b = event.target.closest?.('.nf-bar'); if (!b) { hideTip(); return; }
      const s = series[b.dataset.j], k = Number(b.dataset.k);
      showTip(event, `<strong>${esc(data.yearLabels[k])}</strong><span class="tx-tip__value">${meur(s.values[k])}</span><br>${esc(s.label)} (${s.counts[k]} mesures)`);
    });
    yearsEl.addEventListener('pointerleave', hideTip);
    $('nfYearsLegend').innerHTML = series.map(s => `<span><i class="nf-sw nf-sw--${s.cls}"></i>${esc(s.label)}</span>`).join('');
    $('nfYearsNote').innerHTML = `En milliards d’euros. Le premier total change aussi parce que des mesures entrent ou sortent du chiffrage d’une année à l’autre ; le second compare le même ensemble de mesures. 2024 : coût estimé de l’année écoulée ; 2025 et 2026 : prévisions, toutes publiées à l’automne 2025. Source : ${srcPlf26}.`;
    const both = M.filter(m => m.v[0] != null && m.v[2] != null).map(m => ({ m, d: m.v[2] - m.v[0] }));
    const ups = both.filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 8), downs = both.filter(x => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 8);
    const changeRows = list => list.map(x => ({ label: cut(x.m.l, 90), sub: `${esc(x.m.i)} · ${meur(x.m.v[0])} en 2024, ${meur(x.m.v[2])} prévus en 2026`, value: Math.abs(x.d) }));
    const maxChange = Math.max(...[...ups, ...downs].map(x => Math.abs(x.d)));
    hbars($('nfUp'), changeRows(ups), { format: v => signed(v), max: maxChange });
    hbars($('nfDown'), changeRows(downs), { format: v => signed(-v), max: maxChange });

    // PLF 2024 list -> PLF 2026 file
    $('nfListKpis').innerHTML = kpis([
      ['Liste du PLF 2024', String(C.plf24), `mesures du tome II des voies et moyens (${C.plf24Rows} lignes, dont ${C.plf24NoCode} sans code)`],
      ['Toujours présentes en 2026', String(C.inBoth), 'même code de mesure dans les deux fichiers'],
      ['Nouvelles depuis', String(C.new), 'codes du PLF 2026 absents de la liste 2024'],
      ['Disparues depuis', String(C.gone), 'codes de la liste 2024 absents du PLF 2026']
    ]);
    $('nfGone').innerHTML = `<summary>Voir les ${C.gone} mesures de la liste 2024 absentes du fichier 2026</summary><ul class="nf-list">${data.gone.map(g => `<li><span class="muted">${esc(g.c)}</span> ${esc(g.l)} <span class="muted">· ${esc(g.i)}</span></li>`).join('')}</ul>`;
    const fresh = M.filter(m => !m.in24);
    $('nfNew').innerHTML = `<summary>Voir les ${fresh.length} mesures du fichier 2026 absentes de la liste 2024</summary><ul class="nf-list">${fresh.map(m => `<li><span class="muted">${esc(m.c)}</span> ${esc(m.l)} <span class="muted">· ${esc(m.i)} · ${m.v[2] != null ? `${meur(m.v[2])} en 2026` : esc(STATUS[m.st])}</span></li>`).join('')}</ul>`;
    $('nfListNote').innerHTML = `Une mesure peut disparaître parce qu’elle a pris fin, ou changer de code ou de libellé : le fichier ne le dit pas. Sources : ${srcPlf24} et ${srcPlf26}.`;

    /* ---------- Blind spot: measures without a 2026 amount ---------- */
    const never = M.filter(m => m.v.every(v => v == null));
    $('nfBlindKpis').innerHTML = kpis([
      ['« nc » : non chiffrées', String(C.nc), 'l’administration publie la mesure mais pas son coût'],
      ['« ε » : moins de 0,5 M€', String(C.eps), 'coût jugé négligeable, sans montant précis'],
      ['Sans montant ni mention', String(C.empty), 'pas de montant 2026 et aucune explication dans le fichier'],
      ['Jamais chiffrées de 2024 à 2026', String(never.length), `sur ${C.measures} mesures : ${pct(100 * never.length / C.measures)} des niches n’ont aucun coût publié`]
    ]);
    const byTaxBlind = data.byTax.map(g => ({ label: g.name, sub: `${g.nc} nc · ${g.eps} ε · ${g.empty} sans montant, sur ${g.n} mesures`, value: g.nc + g.eps + g.empty })).filter(r => r.value).sort((a, b) => b.value - a.value);
    hbars($('nfBlindTax'), byTaxBlind, { format: v => `${v} mesures` });
    let blindMode = 'all';
    const drawBlind = () => {
      const rows = missing.filter(m => blindMode === 'all' || m.st === blindMode).sort((a, b) => a.i.localeCompare(b.i, 'fr') || a.c.localeCompare(b.c));
      $('nfBlindTable').innerHTML = `<table class="data-table tx-table nf-table"><thead><tr><th>Mesure</th><th class="nf-hide-sm">Impôt</th><th class="nf-hide-sm">Mission</th><th>2026</th><th class="num">Dernier montant publié</th></tr></thead><tbody>${rows.map(m => {
        const lastK = [1, 0].find(k => m.v[k] != null);
        return `<tr><td class="tx-namecell"><span class="tx-name">${esc(m.l)}</span><br><span class="muted">${esc(m.c)}${m.fin ? ` · ${esc(m.fin)}` : ''}</span><span class="nf-sm-only muted">${esc(m.i)} · ${esc(m.m)}</span></td><td class="nf-hide-sm">${esc(m.i)}</td><td class="nf-hide-sm">${esc(m.m)}</td><td>${statusPill(m.st)}</td><td class="num">${lastK == null ? '<span class="muted">aucun</span>' : `${meur(m.v[lastK])} <span class="muted">(${Y[lastK]})</span>`}</td></tr>`;
      }).join('')}</tbody></table>`;
      $('nfBlindCount').textContent = `${rows.length} mesure${rows.length > 1 ? 's' : ''}`;
    };
    $('nfBlindMode').addEventListener('click', event => {
      const b = event.target.closest('button[data-mode]'); if (!b) return;
      blindMode = b.dataset.mode;
      $('nfBlindMode').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      drawBlind();
    });
    drawBlind();

    /* ---------- Full table ---------- */
    const fill = (el, values) => values.forEach(v => el.insertAdjacentHTML('beforeend', `<option>${esc(v)}</option>`));
    fill($('nfFilterTax'), data.byTax.map(g => g.name));
    fill($('nfFilterMission'), [...data.byMission].map(g => g.name).sort((a, b) => a.localeCompare(b, 'fr')));
    Object.entries(STATUS).forEach(([k, v]) => $('nfFilterStatus').insertAdjacentHTML('beforeend', `<option value="${esc(k)}">${esc(v)}</option>`));
    const maxV = known[0].v[2];
    let sortKey = 'v2', sortDir = -1, showAll = false;
    const COLS = [['l', 'Mesure'], ['i', 'Impôt', 'nf-hide-sm'], ['m', 'Mission', 'nf-hide-sm'], ['v0', '2024', 'num'], ['v1', '2025', 'num'], ['v2', '2026', 'num'], ['', ''], ['d', '2026 / 2024', 'num'], ['g', 'Budget vert']];
    const val = (m, k) => k === 'd' ? (m.v[0] && m.v[2] != null ? m.v[2] / m.v[0] - 1 : null) : k[0] === 'v' ? m.v[Number(k[1])] : k === 'g' ? m.g[0][0] : m[k] || null;
    const green = m => m.g.map(([k, s]) => `${k}${m.g.length > 1 ? ` ${nf(100 * s, 0)} %` : ''}`).join(' / ');
    function drawTable() {
      const q = norm($('nfSearch').value), tx = $('nfFilterTax').value, mi = $('nfFilterMission').value, st = $('nfFilterStatus').value;
      let rows = M.filter(m => (!q || norm(`${m.l} ${m.c} ${m.fin || ''} ${m.p || ''}`).includes(q)) && (!tx || m.i === tx) && (!mi || m.m === mi) && (!st || m.st === st));
      rows.sort((a, b) => { const va = val(a, sortKey), vb = val(b, sortKey); if (va == null || vb == null) return (va == null) - (vb == null); return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr')) * sortDir; });
      const total = rows.length, sum = rows.reduce((s, m) => s + (m.v[2] || 0), 0), unk = rows.filter(m => m.v[2] == null).length;
      if (!showAll) rows = rows.slice(0, 25);
      const cell = (m, k) => m.v[k] != null ? `<td class="num">${meur(m.v[k])}</td>` : `<td class="num muted">${k === 2 ? statusPill(m.st) : '–'}</td>`;
      $('nfTable').innerHTML = `<table class="data-table tx-table nf-table"><thead><tr>${COLS.map(([k, label, cls]) => `<th${cls ? ` class="${cls}"` : ''}${k ? ` data-sort="${k}" aria-sort="${sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}"` : ''}>${label}</th>`).join('')}</tr></thead><tbody>${rows.map(m => {
        const d = val(m, 'd');
        return `<tr><td class="tx-namecell"><span class="tx-name">${esc(m.l)}</span><br><span class="muted">${esc(m.c)}${m.fin ? ` · ${esc(m.fin)}` : ''}${m.in24 ? '' : ' · absente de la liste 2024'}</span><span class="nf-sm-only muted">${esc(m.i)} · ${esc(m.m)}</span></td><td class="nf-hide-sm">${esc(m.i)}</td><td class="nf-mission nf-hide-sm" title="Programme ${esc(m.p)}">${esc(m.m)}</td>${cell(m, 0)}${cell(m, 1)}${cell(m, 2)}<td class="tx-bar-cell">${m.v[2] ? `<span class="tx-minibar" style="width:${Math.max(2, 100 * Math.sqrt(m.v[2] / maxV)).toFixed(1)}%"></span>` : ''}</td><td class="num${d == null ? ' muted' : ''}">${d == null ? '–' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${nf(Math.abs(100 * d), 0)} %`}</td><td class="muted">${esc(green(m))}</td></tr>`;
      }).join('')}</tbody></table>${total > rows.length ? `<div class="tx-more"><button type="button" id="nfShowAll">Afficher les ${total} mesures</button></div>` : ''}`;
      $('nfShowAll')?.addEventListener('click', () => { showAll = true; drawTable(); });
      $('nfTableNote').innerHTML = `${total} mesure${total > 1 ? 's' : ''}, ${meur(sum)} de coût chiffré en 2026${unk ? ` (${unk} sans montant 2026)` : ''}. Montants : 2024, coût estimé de l’année écoulée ; 2025 et 2026, prévisions. Barre : racine carrée du coût 2026, pour que les petites mesures restent visibles. « Budget vert » : cotation environnementale donnée par l’administration (favorable, neutre, défavorable, mixte, non cotée), avec la part de la mesure quand elle est partagée. Finalité : libellé du PLF 2024. Sources : ${srcPlf26} ; ${srcPlf24}.`;
    }
    ['input', 'change'].forEach(ev => ['nfSearch', 'nfFilterTax', 'nfFilterMission', 'nfFilterStatus'].forEach(id => $(id).addEventListener(ev, () => { showAll = false; drawTable(); })));
    $('nfTable').addEventListener('click', event => {
      const th = event.target.closest('th[data-sort]'); if (!th) return;
      const k = th.dataset.sort; sortDir = sortKey === k ? -sortDir : (k[0] === 'v' || k === 'd' ? -1 : 1); sortKey = k; drawTable();
    });
    drawTable();

    /* ---------- What is not published ---------- */
    $('nfEmptyCols').textContent = String(C.plf24CostCells);
    const ncList = M.filter(m => m.st === 'nc'), ncNever = ncList.filter(m => m.v[0] == null && m.v[1] == null).length;
    $('nfNcNever').textContent = ncNever === ncList.length ? `Aucune des ${ncList.length} mesures « nc » de 2026 n’a de montant publié pour 2024 ou 2025 non plus.` : `${ncNever} des ${ncList.length} mesures « nc » de 2026 n’ont aucun montant publié pour 2024 ou 2025 non plus.`;
    $('nfSources').innerHTML = [[S.plf26.page, S.plf26.title], [S.plf26.url, 'Fichier CSV du budget vert 2026'], [S.plf24.page, S.plf24.title], [S.plf24.url, 'Fichier CSV du tome II 2024']].map(([u, t]) => link(u, `${t} ↗`)).join('');
    FRL.keepHash();
  }
})();
