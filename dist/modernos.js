/* /modernos : la démo en direct pour Le Monde Moderne (6 scènes). Les boutons « 1 clic » lisent data/modernos.json,
   chargé une fois et gardé en mémoire (et dans le navigateur pour un rechargement sans réseau) : réponse immédiate,
   sans serveur ni modèle. Les champs libres interrogent en direct la Loupe, la recherche et les fichiers du site.
   Chiffres : scripts/modernos-data.py, à partir des fichiers publiés du site. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = (v, d = 0) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const eur = v => {
    const a = Math.abs(v);
    if (a >= 1e9) return `${nf(v / 1e9, a >= 1e10 ? 0 : 1)} Md€`;
    if (a >= 1e6) return `${nf(v / 1e6, a >= 1e8 ? 0 : 1)} M€`;
    if (a >= 1e4) return `${nf(v / 1e3, 0)} k€`;
    return `${nf(v)} €`;
  };
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-'’]/g, ' ').replace(/\bst\b/g, 'saint').replace(/\s+/g, ' ').trim();
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(`frl-mm:${k}`)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(`frl-mm:${k}`, JSON.stringify(v)); } catch (e) { /* quota, private mode */ } }
  };
  async function getJSON(url, ms = 4000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  const LOUPE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 20.5 7.3v9.4L12 21.5 3.5 16.7V7.3z" fill="none" stroke="url(#g7)" stroke-width="1.8" stroke-linejoin="round"/><circle cx="11" cy="11" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m13.7 13.7 2.8 2.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

  let D = null;          // data/modernos.json
  let C = null;          // data/modernos-communes.json (every commune), loaded after the page
  const scenes = $$('.mm-scene');
  let current = 0;

  /* ================================================================ navigation */
  const narrow = () => matchMedia('(max-width: 900px)').matches;
  const steps = el => $$('[data-step]', el).sort((a, b) => a.dataset.step - b.dataset.step);
  function setSteps(el, n) { steps(el).forEach((s, i) => { const show = narrow() || i < n; s.classList.toggle('is-hidden', !show); if (show) reveal(s); }); el.dataset.shown = n; }
  function go(i, fromEnd = false) {
    i = Math.max(0, Math.min(scenes.length - 1, i));
    scenes.forEach((s, k) => { s.classList.toggle('is-active', k === i); s.classList.toggle('is-before', k < i); });
    current = i;
    const sc = scenes[i];
    setSteps(sc, fromEnd ? steps(sc).length : 0);
    reveal(sc);
    sc.scrollTop = 0;
    $('#mmTitle').textContent = `${i + 1}/${scenes.length} · ${sc.dataset.title}`;
    $$('#mmDots button').forEach((b, k) => b.setAttribute('aria-current', k === i));
    history.replaceState(null, '', `#${i + 1}`);
  }
  function next() {
    const sc = scenes[current], n = Number(sc.dataset.shown || 0), all = steps(sc);
    if (!narrow() && n < all.length) { setSteps(sc, n + 1); if (all[n].classList.contains('mm-flip')) all[n].classList.add('is-flipped'); all[n].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    if (current < scenes.length - 1) go(current + 1);
  }
  function prev() {
    const sc = scenes[current], n = Number(sc.dataset.shown || 0);
    if (!narrow() && n > 0) { const s = steps(sc)[n - 1]; s.classList.remove('is-flipped'); setSteps(sc, n - 1); return; }
    if (current > 0) go(current - 1, true);
  }
  function initNav() {
    $('#mmDots').innerHTML = scenes.map((s, i) => `<button type="button" aria-label="Scène ${i + 1} : ${esc(s.dataset.title)}"></button>`).join('');
    $$('#mmDots button').forEach((b, i) => b.addEventListener('click', () => go(i, true)));
    $('#mmNext').addEventListener('click', next);
    $('#mmPrev').addEventListener('click', prev);
    document.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select, [contenteditable], .ai-panel, .xp')) { if (e.key === 'Escape') e.target.blur(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next(); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev(); }
      else if (/^[1-5]$/.test(e.key)) go(Number(e.key) - 1, true);
      else if (e.key === 'f' || e.key === 'F') toggleFull();
      else if (e.key === 't' || e.key === 'T') document.getElementById('themeToggle')?.click();
    });
    let lock = 0;
    window.addEventListener('wheel', e => {
      if (narrow() || e.target.closest('.ai-panel')) return;
      const sc = scenes[current];
      const atTop = sc.scrollTop <= 0, atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
      if (Math.abs(e.deltaY) < 30 || Date.now() < lock) return;
      if (e.deltaY > 0 && atEnd) { lock = Date.now() + 900; next(); }
      else if (e.deltaY < 0 && atTop) { lock = Date.now() + 900; prev(); }
    }, { passive: true });
    $$('.mm-flip').forEach(f => f.addEventListener('click', () => f.classList.toggle('is-flipped')));
    $('#mmFull').addEventListener('click', toggleFull);
    const start = Number((location.hash.match(/^#(\d)$/) || [])[1] || 1) - 1;
    go(start);
    window.addEventListener('hashchange', () => { const n = Number((location.hash.match(/^#(\d)$/) || [])[1]); if (n && n - 1 !== current) go(n - 1, true); });
    window.addEventListener('resize', () => setSteps(scenes[current], Number(scenes[current].dataset.shown || 0)));
  }
  function toggleFull() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); }

  /* ================================================================ chiffres animés */
  function countUp(el) {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    const to = Number(el.dataset.to), dec = Number(el.dataset.dec || 0), t0 = performance.now(), dur = 1400;
    const tick = t => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = nf(to * e, dec);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function reveal(root) {
    $$('.mm-count', root).forEach(el => { if (!el.closest('.is-hidden') && el.dataset.to) countUp(el); });
    if (root.classList?.contains('mm-count') && root.dataset.to) countUp(root);
  }
  const path = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  function fill() {
    $$('[data-k]').forEach(el => {
      const v = path(D, el.dataset.k);
      if (v == null) return;
      if (el.classList.contains('mm-count')) { el.dataset.to = v; delete el.dataset.done; el.textContent = '0'; return; }
      el.textContent = el.dataset.fmt === 'md' ? `${nf(v, v % 1 ? 1 : 0)} Md€` : el.dataset.fmt === 'int' ? nf(v) : v;
    });
    const u = D.usage || {};
    if (u.views) {
      $('#mmViews').dataset.to = u.views; delete $('#mmViews').dataset.done;
      $('#mmViewsStat').hidden = false;
      $('#mmViewsLabel').textContent = `Pages vues du ${day(u.days[0])} au ${day(u.days[1])}`;
    }
    if (u.lemaire_asked) $('#mmLeMaireCount').textContent = `Question n°1 des visiteurs · posée ${u.lemaire_asked} fois`;
    $('#mmVaulxQ').textContent = VAULX;
  }
  const XSVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg>';
  const person = (img, name, role, x) => `<figure class="mm-person"><img src="img/modernos/${img}" alt="${esc(name)}" width="400" height="400">
    <figcaption><b>${esc(name)}</b><span>${esc(role)}</span><a class="btn btn--ghost" href="https://x.com/${x}" target="_blank" rel="noopener noreferrer">${XSVG}@${x}</a></figcaption></figure>`;
  const VAULX = 'Coûts en argent public de la cantine du collège de Vaulx-en-Velin';
  const STONKS = '<img class="mm-stonks mm-stonks--sm" src="img/modernos/stonks.gif" alt="Stonks" width="64" height="48">';
  const day = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

  /* ================================================================ scène 3 : la Loupe */
  function md(text) {
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    return String(text).split(/\n{2,}/).map(block => {
      const lines = block.split('\n');
      if (lines.every(l => /^\s*[-•]\s/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-•]\s/, ''))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }
  function loupeCard(question, body, extra = '') {
    return `<div class="mm-card"><div class="mm-card__head">${LOUPE_ICON}<span class="mm-loupe-tag">La Loupe</span><span>« ${esc(question)} »</span><span class="mm-fast">réponse enregistrée, données du site</span>${extra}</div>${body}</div>`;
  }
  /* the figures in big, for the screen; the answer with its sources comes from the real Loupe (saved answer of
     server/assistant/faq.json, served without a model), or the same text here when the Loupe cannot be reached */
  function answer(kind) {
    const box = $('#mmAnswer'), L = D.loupe[kind], d = L.data || {};
    $$('.mm-shot').forEach(b => b.classList.toggle('is-on', b.dataset.loupe === kind));
    let punch = '';
    if (kind === 'lemaire') {
      const [d0, d1] = d.debt || [0, 0], [p0, p1] = d.pctGdp || [0, 0];
      punch = `<div class="mm-split"><div><div class="mm-big"><span class="mm-big__v">+<span class="mm-count" data-to="${Math.round(d1 - d0)}">0</span> Md€</span><span class="mm-big__l">de dette publique entre mai 2017 et septembre 2024</span></div>
        <div class="mm-big"><span class="mm-big__v">${nf(p0, 1)} % → ${nf(p1, 1)} %</span><span class="mm-big__l">du PIB</span></div>
        <div class="mm-big"><span class="mm-big__v">${nf(d0)} Md€ → ${nf(d1)} Md€</span><span class="mm-big__l"><b class="mm-up">+${nf(100 * (d1 / d0 - 1), 0)} %</b> de dette</span></div>
      </div>${person('lemaire.jpg', 'Bruno Le Maire', 'ministre de l’Économie de mai 2017 à septembre 2024', 'BrunoLeMaire')}</div>`;
    } else if (kind === 'cantine') {
      const per = d.amount / d.population;
      punch = `<div class="mm-split"><div>
          <div class="mm-big"><span class="mm-big__v"><span class="mm-count" data-to="${d.amount}">0</span> €</span><span class="mm-big__l">de subvention aux restaurants du Sénat en ${d.year}</span></div>
          <div class="mm-big"><span class="mm-big__v">${nf(per * 100, 1)} centime</span><span class="mm-big__l">par Français et par an</span></div>
        </div>${person('larcher.jpg', 'Gérard Larcher', 'président du Sénat', 'gerard_larcher')}</div>`;
    } else {
      const c = D.loupe.cantine.data, ratio = d.meur * 1e6 / c.amount;
      punch = `<div class="mm-split"><div>
          <div class="mm-big"><span class="mm-big__v"><span class="mm-count" data-to="${Math.round(d.meur)}">0</span> M€</span><span class="mm-big__l">mission « Audiovisuel public », PLF 2025</span></div>
          <div class="mm-big"><span class="mm-big__v">${nf(d.meur * 1e6 / d.population, 2)} €</span><span class="mm-big__l">par Français et par an</span></div>
        </div><div>
          <canvas class="mm-dots-grid" id="mmDotsGrid" width="800" height="440" aria-label="${nf(ratio, 0)} points"></canvas>
          <p class="mm-cap">Chaque point = une cantine du Sénat (${nf(c.amount)} €). L’audiovisuel public en vaut <b>${nf(ratio, 0)}</b>. Le point rouge, c’est la cantine.</p>
        </div></div>`;
    }
    const live = !!window.FRLLoupe?.ask;
    box.innerHTML = `<div class="mm-card mm-punch">${punch}</div>${live ? '' : loupeCard(L.question, `<div class="mm-md">${md(L.reply)}</div>`, '<span class="mm-off">Loupe hors ligne : même réponse, servie par la page</span>')}`;
    if (kind === 'audiovisuel') drawDots($('#mmDotsGrid'), Math.round(ratio(d)));
    reveal(box);
    if (live) window.FRLLoupe.ask(L.question);
  }
  const ratio = d => d.meur * 1e6 / D.loupe.cantine.data.amount;
  function drawDots(cv, n) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    const cols = Math.ceil(Math.sqrt(n * W / H)), rows = Math.ceil(n / cols), s = Math.min(W / cols, H / rows);
    const css = getComputedStyle(document.documentElement);
    const c1 = css.getPropertyValue('--g1').trim(), c2 = css.getPropertyValue('--g2').trim(), red = css.getPropertyValue('--red').trim();
    let i = 0;
    const per = Math.ceil(n / 40);
    ctx.clearRect(0, 0, W, H);
    const frame = () => {
      for (let k = 0; k < per && i < n; k++, i++) {
        const x = (i % cols) * s + s / 2, y = Math.floor(i / cols) * s + s / 2;
        ctx.fillStyle = i === 0 ? red : (i % 2 ? c1 : c2);
        ctx.beginPath(); ctx.arc(x, y, i === 0 ? s * .9 : s * .36, 0, 7); ctx.fill();
      }
      if (i < n) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  function askLoupe(q) {
    if (window.FRLLoupe?.ask) { window.FRLLoupe.ask(q); return true; }
    $('#mmAnswer').innerHTML = `<div class="mm-card"><p>La Loupe n’est pas joignable depuis cette page pour l’instant (serveur de l’assistant arrêté ou hors ligne).</p><div class="mm-actions"><a class="mm-btn" href="index.html" target="_blank" rel="noopener">Ouvrir le site</a></div></div>`;
    return false;
  }
  function initLoupe() {
    $$('.mm-shot').forEach(b => b.addEventListener('click', () => answer(b.dataset.loupe)));
    $('#mmAskLoupe').addEventListener('submit', e => { e.preventDefault(); const q = e.target.q.value.trim(); if (q) askLoupe(q); });
  }

  /* ================================================================ scène 4 : la ville */
  const COL = { insee: 0, nom: 1, dep: 2, pop: 3, pers: 4, dette: 5, etat: 6, dep_hab: 7, assos: 8, assos23: 9, nproj: 10, aproj: 11, gfp: 12, ranks: 13 };
  const CITY_LABEL = { '59350': 'au-dessus de sa strate', '93014': 'ultra-subventionnée', '34172': 'dans nos Signaux' };
  function bandOf(pop) { const b = D.bands; let i = 0; while (i + 1 < b.length && pop >= b[i + 1]) i++; return i; }
  function bandLabel(i) { const b = D.bands; return i + 1 < b.length ? `communes de ${nf(b[i])} à ${nf(b[i + 1] - 1)} habitants` : `villes de plus de ${nf(b[i])} habitants`; }
  function layersFor(row) {
    if (D.cityLayers[row[0]]) return D.cityLayers[row[0]];
    if (!C) return null;
    const dep = C.departements[row[COL.dep]];
    return { groupement: C.groupements[row[COL.gfp]] || null, departement: dep || null, region: dep ? C.regions[dep[2]] : null };
  }
  function renderCity(row) {
    const box = $('#mmCity');
    const b = bandOf(row[COL.pop]), med = D.medians[String(b)], n = D.counts[String(b)];
    const four = (D.fourLayers || {})[String(b)];
    const L = layersFor(row) || {};
    const parts = [[row[COL.nom], row[COL.dep_hab], 'mm-l1', 'Commune'], [L.groupement?.[0], L.groupement?.[1], 'mm-l2', 'Intercommunalité'],
      [L.departement?.[0], L.departement?.[1], 'mm-l3', 'Département'], [L.region?.[0], L.region?.[1], 'mm-l4', 'Région']].filter(p => p[1]);
    const total = parts.reduce((s, p) => s + p[1], 0);
    const pct = (v, m) => (v != null && m ? Math.round(100 * (v / m - 1)) : null);
    const signed = p => `<b class="${p > 0 ? 'mm-up' : 'mm-down'}">${p > 0 ? '+' : ''}${p} %</b>`;
    const etatPct = pct(row[COL.etat], med.etat), depPct = pct(row[COL.dep_hab], med.dep), dettePct = pct(row[COL.dette], med.dette);
    const video = row[COL.insee] === '34172' ? xPlayer('img/modernos/montpellier-seuil.mp4', 'Montpellier, juste sous le seuil : 8 ans de marchés publics de la Ville et de la Métropole') : '';
    const tilesHtml = `<div class="mm-tiles">
          <div class="mm-tile mm-tile--wide"><div class="mm-tile__v">${nf(row[COL.dep_hab] ?? 0)} €</div><div class="mm-tile__l">dépensés par la commune elle-même par habitant${depPct != null ? `, ${signed(depPct)} vs la médiane (${nf(med.dep)} €)` : ''}</div></div>
          <div class="mm-tile mm-tile--wide mm-tile--debt"><div class="mm-tile__v">${nf(row[COL.dette] ?? 0)} €</div><div class="mm-tile__l">de dette par habitant${dettePct != null ? `, ${signed(dettePct)} vs la médiane (${nf(med.dette)} €)` : ''}</div></div>
          <div class="mm-tile mm-tile--wide"><div class="mm-tile__v">${nf(row[COL.etat] ?? 0)} €${etatPct > 100 ? STONKS : ''}</div><div class="mm-tile__l">de dotations de l’État par habitant${etatPct != null ? `, ${signed(etatPct)} vs la médiane` : ''}</div></div>
          <div class="mm-tile"><div class="mm-tile__v">${nf(row[COL.assos])}</div><div class="mm-tile__l">associations du coin aidées par l’État${row[COL.assos23] ? `, dont <b>${eur(row[COL.assos23])}</b> en 2023` : ''}</div></div>
          <div class="mm-tile"><div class="mm-tile__v">${nf(row[COL.nproj])}</div><div class="mm-tile__l">projets aidés par l’État 2018-2025${row[COL.aproj] ? ` : <b>${eur(row[COL.aproj])}</b>` : ''}</div></div>
        </div>`;
    box.innerHTML = `<div class="mm-card${video ? ' mm-city--video' : ''}"><div class="mm-city__grid"><div>
        <p class="mm-city__name">${esc(row[COL.nom])}</p>
        <p class="mm-muted">${nf(row[COL.pop])} habitants · ${esc(L.departement?.[0] || row[COL.dep])} · comptes ${C?.year || 2025} · comparée aux ${nf(n)} ${esc(bandLabel(b))}</p>
        <div class="mm-layers"><p>Le mille-feuille : ce que dépense <b>chaque couche</b>, par habitant et par an</p>
          <div class="mm-layers__bar">${parts.map(p => `<span class="${p[2]}" style="flex:${p[1]}" title="${esc(p[3])} : ${nf(p[1])} €">${nf(p[1])} €</span>`).join('')}</div>
          <div class="mm-layers__legend">${parts.map(p => `<span><i class="${p[2]}"></i>${esc(p[3])} : <b>${esc(p[0])}</b></span>`).join('')}</div>
          <div class="mm-total"><div><span class="mm-layers__total"><span class="mm-count" data-to="${total}">0</span> €</span><span>par habitant et par an, hors État et Sécu</span></div>
            ${four ? `<div class="mm-total__cmp"><b>${nf(four.median)} €</b><span>médiane des communes de même taille (moyenne ${nf(four.mean)} €)</span></div>` : ''}</div>
        </div>
      ${video ? tilesHtml : ''}</div><div>
        ${video || tilesHtml}
        <div class="mm-actions">
          <a class="mm-btn" href="index.html?commune=${row[COL.insee]}#explorer" target="_blank" rel="noopener">Voir la carte ↗</a>
          <button type="button" class="mm-btn mm-btn--ghost" id="mmPersBtn">Frais de personnel ?</button>
        </div>
      </div></div><div id="mmPers"></div></div>`;
    if (video) wirePlayer(box.querySelector('.xp'));
    $('#mmPersBtn').addEventListener('click', () => {
      const ranks = row[COL.ranks] || [];
      const rows = [['Frais de personnel', row[COL.pers], med.pers, ranks[0]], ['Dette', row[COL.dette], med.dette, ranks[1]], ['Dotations de l’État', row[COL.etat], med.etat, ranks[2]]];
      $('#mmPers').innerHTML = `<div class="mm-gauge"><div class="mm-card__head"><span class="mm-loupe-tag">Comparée aux ${nf(n)} ${esc(bandLabel(b))}</span><span>médiane, comptes OFGL ${C?.year || 2025}</span><span class="mm-fast">instantané</span></div>
        ${rows.filter(r => r[1] != null && r[2]).map(([l, v, m, rk]) => {
          const pct = Math.round(100 * (v / m - 1)), scale = Math.max(2 * m, v * 1.05);
          return `<div class="mm-gauge__row"><span><b>${l}</b><br><small>${nf(v)} €/hab · médiane ${nf(m)} €</small></span>
            <div class="mm-gauge__track"><span class="mm-gauge__fill ${v > m ? 'is-over' : ''}" style="width:${(100 * v / scale).toFixed(1)}%"></span><span class="mm-gauge__med" style="left:${(100 * m / scale).toFixed(1)}%"></span></div>
            <span class="mm-gauge__pct ${pct > 0 ? 'mm-up' : 'mm-down'}">${pct > 0 ? '+' : ''}${pct} %${rk ? `<br><small class="mm-muted">${rk}${rk === 1 ? 're' : 'e'} sur ${nf(n)}</small>` : ''}</span></div>`;
        }).join('')}
        <p class="mm-note">Comparaison à la médiane des communes de même taille, comme la Loupe. Une commune qui gère elle-même cantine, piscine ou crèche dépense plus qu’une commune qui les confie à son intercommunalité.</p>
        <div class="mm-actions"><button type="button" class="mm-btn mm-btn--ghost" id="mmPersLive">${LOUPE_ICON.replace('<svg', '<svg width="18" height="18" style="margin-right:6px"')}Demander à la Loupe</button></div></div>`;
      $('#mmPersLive').addEventListener('click', () => askLoupe(`Est-ce que ${row[COL.nom]} dépense beaucoup en frais de personnel ?`));
      reveal($('#mmPers'));
    });
    reveal(box);
    $$('#mmCityChips .mm-chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.insee === row[COL.insee]));
  }
  function findCity(q) {
    const rows = C?.rows || Object.values(D.cityRows);
    const n = norm(q);
    if (/^\d[\dab]{4}$/i.test(q.trim())) return rows.find(r => r[0].toLowerCase() === q.trim().toLowerCase());
    const exact = rows.filter(r => norm(r[1]) === n);
    const pool = exact.length ? exact : rows.filter(r => norm(r[1]).startsWith(n));
    return pool.sort((a, b) => b[COL.pop] - a[COL.pop])[0];
  }
  function initCity() {
    $('#mmCityChips').innerHTML = D.cities.map(c => { const r = D.cityRows[c]; return `<button type="button" class="mm-chip" data-insee="${c}">${esc(r[1])}<small>${CITY_LABEL[c] || ''}</small></button>`; }).join('');
    $$('#mmCityChips .mm-chip').forEach(b => b.addEventListener('click', () => renderCity(D.cityRows[b.dataset.insee])));
    const input = $('#mmCityInput'), list = $('#mmCityList');
    input.addEventListener('input', () => {
      if (!C) return;
      const n = norm(input.value);
      if (n.length < 2) { list.innerHTML = ''; return; }
      const hits = C.rows.filter(r => norm(r[1]).startsWith(n)).sort((a, b) => b[COL.pop] - a[COL.pop]).slice(0, 8);
      list.innerHTML = hits.map(r => `<option value="${esc(r[1])}">${esc(r[1])} (${r[2]}) · ${nf(r[3])} hab.</option>`).join('');
    });
    $('#mmCityForm').addEventListener('submit', e => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      const row = findCity(q);
      if (row) renderCity(row);
      else $('#mmCity').innerHTML = `<div class="mm-card"><p>${C ? `Aucune commune trouvée pour « ${esc(q)} ».` : 'La liste des communes charge encore, deux secondes…'}</p><div class="mm-actions"><button type="button" class="mm-btn mm-btn--ghost" id="mmCityLoupe">Demander à la Loupe</button></div></div>`;
      $('#mmCityLoupe')?.addEventListener('click', () => askLoupe(q));
    });
  }

  /* ================================================================ scène 5 : SIREN, fraude, signaux */
  const SIREN_NOTE = {
    '316344233': 'Ce n’est pas un chèque que l’UNCA garde : c’est l’aide juridictionnelle qui transite par elle vers les CARPA des barreaux, pour payer les avocats des justiciables modestes. Jusqu’en 2020, la même dépense était versée barreau par barreau ; en 2021 et 2023, elle passe en bloc par l’UNCA.',
    '775672272': 'Associations : annexes publiées pour 2010 à 2021 et 2023 ; celle de 2022 n’a pas de liste exploitable.',
    '341062404': 'De 1 500 € en 2014 à 105 M€ en 2023, en hausse à chaque année publiée, surtout pour l’hébergement d’urgence et l’asile.'
  };
  function xray(s, live = false) {
    const max = Math.max(...s.years.map(y => y[1]), 1);
    const pmax = Math.max(...s.programmes.map(p => p[1]), 1);
    const top = s.top[0];
    $('#mmXray').innerHTML = `<div class="mm-card"><div class="mm-card__head"><span class="mm-loupe-tag">${esc(s.siren ? `SIREN ${s.siren}` : 'Recherche')}</span><span class="mm-fast">${live ? 'en direct' : 'instantané'}</span></div>
      <div class="mm-xray__grid"><div>
        <p class="mm-city__name">${esc(s.name)}</p>
        <div class="mm-big"><span class="mm-big__v">${eur(s.total)}</span><span class="mm-big__l">d’argent public versé, sur ${nf(s.lines)} ligne${s.lines > 1 ? 's' : ''}${s.n_programmes ? ` et <b>${nf(s.n_programmes)} programme${s.n_programmes > 1 ? 's' : ''}</b> de l’État` : ''}</span></div>
        <div class="mm-bars">${s.years.map(([y, v]) => `<div title="${y} : ${eur(v)}"><small>${v >= max * .08 ? eur(v) : ''}</small><span style="height:${Math.max(2, 100 * v / max).toFixed(1)}%"></span>${y}</div>`).join('')}</div>
      </div><div>
        <p><b>Qui paie</b></p>
        ${s.programmes.slice(0, 4).map(([l, v]) => `<div class="mm-prog"><div class="mm-prog__l"><span>${esc(l)}</span><b>${eur(v)}</b></div><div class="mm-prog__t"><span style="width:${(100 * v / pmax).toFixed(1)}%"></span></div></div>`).join('')}
        ${top ? `<div class="mm-line">Plus grosse ligne : <b>${eur(top.amount)}</b> en ${top.year}, « ${esc(top.title)} »</div>` : ''}
        ${SIREN_NOTE[s.siren] ? `<p class="mm-warn">${esc(SIREN_NOTE[s.siren])}</p>` : ''}
        <div class="mm-actions"><a class="mm-btn mm-btn--ghost" href="recherche.html?q=${encodeURIComponent(s.query || s.siren)}" target="_blank" rel="noopener">Ouvrir dans la recherche ↗</a></div>
      </div></div></div>`;
    $$('#mmSirenChips .mm-chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.siren === s.siren));
  }
  function fromApi(q, r) {
    const spend = r.stats.filter(x => !x.fw && x.src !== 6);
    const years = {};
    spend.forEach(x => { years[x.year] = (years[x.year] || 0) + x.amount; });
    const progs = r.extra.filter(e => e.src === 1);
    const digits = q.replace(/\s/g, '');
    return {
      siren: /^\d{9}$/.test(digits) ? digits : null, query: q,
      name: (r.who.find(w => w.siren === digits) || r.who[0] || {}).label || q,
      lines: spend.reduce((s, x) => s + x.n, 0), total: spend.reduce((s, x) => s + x.amount, 0),
      years: Object.entries(years).sort((a, b) => a[0] - b[0]).map(([y, v]) => [Number(y), v]),
      programmes: (progs.length ? progs : r.extra).map(e => [e.label, e.value]), n_programmes: progs.length,
      top: r.top.filter(t => !t.fw && t.src !== 6).sort((a, b) => b.amount - a.amount).slice(0, 1)
    };
  }
  async function liveSearch(q) {
    const key = `search:${norm(q)}`;
    const box = $('#mmXray');
    const cached = store.get(key);
    if (cached) { xray(cached, true); return; }
    box.innerHTML = `<div class="mm-card"><p>Recherche en cours sur ${nf(D.macro.searchLines / 1e6, 1)} millions de lignes…</p></div>`;
    try {
      const r = await getJSON(`api/search?q=${encodeURIComponent(q)}`, 6000);
      if (!r.lines) { box.innerHTML = `<div class="mm-card"><p>Aucune ligne publiée pour « ${esc(q)} ».</p><div class="mm-actions"><button type="button" class="mm-btn mm-btn--ghost" id="mmXLoupe">Demander à la Loupe</button></div></div>`; $('#mmXLoupe').addEventListener('click', () => askLoupe(q)); return; }
      const s = fromApi(q, r);
      store.set(key, s);
      xray(s, true);
    } catch (e) {
      box.innerHTML = `<div class="mm-card"><p>La recherche en direct ne répond pas assez vite (réseau ou serveur). Les boutons du haut, eux, marchent sans réseau.</p><div class="mm-actions"><a class="mm-btn" href="recherche.html?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">Ouvrir la recherche du site ↗</a></div></div>`;
    }
  }
  function initSiren() {
    const short = { '316344233': 'Union nationale des CARPA', '775672272': 'Croix-Rouge française', '341062404': 'Groupe SOS Solidarités' };
    $('#mmSirenChips').innerHTML = Object.entries(D.sirens).map(([k, s]) => `<button type="button" class="mm-chip" data-siren="${k}">${esc(short[k] || s.name)}<small>${k}</small></button>`).join('');
    $$('#mmSirenChips .mm-chip').forEach(b => b.addEventListener('click', () => xray({ ...D.sirens[b.dataset.siren], siren: b.dataset.siren })));
    $('#mmSirenForm').addEventListener('submit', e => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      const digits = q.replace(/\s/g, '');
      if (D.sirens[digits]) xray({ ...D.sirens[digits], siren: digits });
      else if (q) liveSearch(q);
    });
    $$('.mm-tabs button').forEach(t => t.addEventListener('click', () => tab(t.dataset.tab)));
  }
  function tab(name) {
    $$('.mm-tabs button').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
    $$('.mm-tab').forEach(p => { p.hidden = p.dataset.panel !== name; });
    reveal($(`.mm-tab[data-panel="${name}"]`));
  }
  function initFraude() {
    const f = D.macro.fraude, N = D.niches, niches = D.macro.niches.find(n => n.year === 2026) || D.macro.niches.at(-1);
    const scale = 140;
    const bar = (label, v) => `<div class="mm-hbar"><div class="mm-hbar__l"><span>${label}</span><b>${nf(v, 1)} Md€</b></div><div class="mm-hbar__t"><span style="left:0;width:${(100 * v / scale).toFixed(1)}%;background:var(--grad)"></span></div></div>`;
    $('#mmFraude').innerHTML = `<div class="mm-card"><div class="mm-fraude__grid"><div>
        <p class="mm-label">Niches fiscales, budget 2026</p>
        <div class="mm-big"><span class="mm-big__v"><span class="mm-count" data-to="${N.measures}">0</span> niches</span><span class="mm-big__l">${nf(N.costed2026)} chiffrées, pour <b>${nf(N.total2026_meur / 1000, 1)} Md€</b></span></div>
        <div class="mm-big"><span class="mm-big__v mm-up"><span class="mm-count" data-to="${N.uncosted}">0</span> sans prix</span><span class="mm-big__l">${nf(N.nc)} « non chiffré », ${nf(N.eps)} « moins de 0,5 M€ », ${nf(N.empty)} cases vides. ${nf(N.neverCosted)} n’ont eu aucun montant précis en 2024, 2025 et 2026.</span></div>
        <p class="mm-note">Source : PLF 2026, données ouvertes du « budget vert » (data.economie.gouv.fr) et PLF 2024. Elles comptent pour 0 € dans le total voté.</p>
        <div class="mm-actions"><a class="mm-btn mm-btn--ghost" href="niches.html" target="_blank" rel="noopener">Niches fiscales ↗</a></div>
      </div><div class="mm-hbars">
        <p class="mm-label">Fraude fiscale : ce qui est mesuré</p>
        <div class="mm-hbar mm-hbar--range"><div class="mm-hbar__l"><span>Fourchette de la Cour des comptes</span><b>${nf(f.de_md)} à ${nf(f.a_md)} Md€</b></div><div class="mm-hbar__t"><span style="left:${(100 * f.de_md / scale).toFixed(1)}%;width:${(100 * (f.a_md - f.de_md) / scale).toFixed(1)}%"></span></div></div>
        ${bar(`Contrôle fiscal : montants notifiés ${f.controle_year}`, f.controle_md)}
        ${bar(`TVA due mais non perçue ${f.tva_gap_year} (${nf(f.tva_gap_pct, 1)} %)`, f.tva_gap_meur / 1000)}
        ${bar(`Effectivement recouvré ${Object.keys(f.recouvre).at(-1)}`, Object.values(f.recouvre).at(-1))}
        ${bar(`Pour comparer : niches fiscales chiffrées ${niches.year}`, niches.total / 1000)}
        <p class="mm-note">La Cour des comptes juge impossible de dire si la fraude coûte 30 ou 130 Md€ par an. Sources : <a href="${esc(f.sources.cour.url)}" target="_blank" rel="noopener">${esc(f.sources.cour.titre)}</a> ; <a href="${esc(f.sources.commission.page)}" target="_blank" rel="noopener">Commission européenne, écart de TVA</a>.</p>
        <div class="mm-actions"><a class="mm-btn mm-btn--ghost" href="impots.html#ecarts" target="_blank" rel="noopener">Contrôle fiscal et fraude ↗</a></div>
      </div></div></div>`;
  }
  function initSignals() {
    const s = D.signals.sdis06, d = D.signals.dunkerque, g = D.signals.int32;
    const W = 640, H = 300, pad = 34, bins = s.bins, max = Math.max(...bins.map(b => b[1]));
    const bw = (W - pad * 2) / bins.length;
    const x90 = pad + bins.findIndex(b => b[0] === s.threshold) * bw;
    const nat = s.national?.national;
    const svg = `<svg class="mm-hist" viewBox="0 0 ${W} ${H}" role="img" aria-label="Marchés du SDIS 06 entre 70 000 et 110 000 €">
      ${bins.map((b, i) => { const h = (H - pad * 2) * b[1] / max; return `<rect class="${b[0] === 88000 ? 'is-hot' : ''}" x="${(pad + i * bw + 2).toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="var(--g2)"><title>${nf(b[0])} à ${nf(b[0] + 1999)} € : ${b[1]} marchés</title></rect>`; }).join('')}
      <line x1="${x90}" x2="${x90}" y1="${pad - 10}" y2="${H - pad}" stroke="var(--red)" stroke-width="3" stroke-dasharray="6 5"/>
      <text x="${x90 + 6}" y="${pad}" fill="var(--red)" font-weight="700" font-size="15">seuil 90 000 € : publicité obligatoire</text>
      ${[70000, 80000, 90000, 100000, 110000].map(v => `<text x="${pad + (v - 70000) / 2000 * bw}" y="${H - 10}" fill="var(--muted)" font-size="12" text-anchor="middle">${v / 1000} k€</text>`).join('')}
    </svg>`;
    $('#mmSignals').innerHTML = `<p class="mm-lead mm-sig__lead">Des règles simples appliquées à toutes les données : elles font remonter des <b>pistes à vérifier</b>, et révèlent aussi <b>des bugs ou données aberrantes dans les données officielles de l’État</b>.</p><div class="mm-sig__grid"><div class="mm-card">
        <p class="mm-city__name">${esc(s.name)}</p>
        <div class="mm-big"><span class="mm-big__v"><span class="mm-count" data-to="${s.exact89000}">0</span> marchés</span><span class="mm-big__l">à exactement <b>89 000 €</b>, 1 000 € sous le seuil</span></div>
        ${svg}
        <p><b>${nf(s.below)}</b> marchés juste sous le seuil contre <b>${nf(s.above)}</b> juste au-dessus, soit <b>${nf(s.below / Math.max(1, s.above), 1)} fois plus</b>${nat ? `. Moyenne nationale : ${nf(nat[0] / nat[1], 1)} fois.` : '.'}</p>
        <p class="mm-warn">Une piste à vérifier, pas une fraude : beaucoup sont des accords-cadres, dont 89 000 € est le plafond, pas la dépense. Règle du site : ${esc(s.rule)}.</p>
        <div class="mm-actions"><a class="mm-btn mm-btn--ghost" href="${s.link}" target="_blank" rel="noopener">Voir dans Signaux ↗</a></div>
      </div><div class="mm-card">
        ${d.first ? `
        <div class="mm-big"><span class="mm-big__v">${nf(d.first.amount / 1e9, 0)} milliards €</span><span class="mm-big__v mm-big__v--sm">${nf(d.first.amount)} €</span></div>
        <p>« ${esc(d.first.object)} » : marché de la ${esc(d.first.buyerName)} notifié le ${new Date(d.first.notified).toLocaleDateString('fr-FR')}, tel que publié par l’acheteur.</p>
        <p><b>${nf(d.n)}</b> lignes aberrantes de ce même acheteur, <b>${eur(d.total)}</b> déclarés au total. Le site les exclut de ses totaux ; leur correction revient à l’acheteur.</p>` : ''}
        ${g.length ? `<p class="mm-line">Bonus : <b>${nf(g[0].amount)} €</b> de gaz naturel (${[...new Set(g.map(x => x.buyerName || 'commune'))].map(esc).join(', ')}). C’est le plus grand nombre qu’un vieux logiciel sait stocker : un bug publié tel quel.</p>` : ''}
        <div class="mm-actions"><a class="mm-btn mm-btn--ghost" href="${d.link}" target="_blank" rel="noopener">Montants aberrants ↗</a></div>
      </div></div>`;
  }

  /* ================================================================ scène 6 */
  function demandesView(rows) {
    const today = new Date().toISOString().slice(0, 10);
    const st = d => (d.reponses?.length ? 'repondue' : d.status === 'close' ? 'close' : d.echeance && d.echeance < today ? 'silence' : 'attente');
    const c = { attente: 0, repondue: 0, silence: 0, close: 0 };
    rows.forEach(d => { c[st(d)]++; });
    $('#mmDemandes').innerHTML = `<div class="mm-dm"><div><b>${nf(rows.length)}</b>demandes envoyées</div><div><b class="mm-down">${nf(c.repondue)}</b>réponses reçues</div><div><b>${nf(c.attente)}</b>en attente</div><div><b class="mm-up">${nf(c.silence)}</b>font le mort</div></div>`;
  }
  async function initDemandes() {
    const cached = store.get('demandes');
    if (cached) demandesView(cached);
    else $('#mmDemandes').innerHTML = '<p class="mm-note">Chargement des demandes en direct…</p>';
    try {
      const r = await getJSON('api/assistant/demandes', 5000);
      const rows = Array.isArray(r) ? r : r.demandes || r.rows || [];
      store.set('demandes', rows);
      demandesView(rows);
    } catch (e) {
      if (!cached) $('#mmDemandes').innerHTML = '<p class="mm-note">Le suivi en direct n’est pas joignable d’ici : bouton « Ouvrir les demandes ».</p>';
    }
  }
  function initFinal() {
    $('#mmVaulx').addEventListener('click', () => askLoupe(VAULX));
  }

  /* the latest citizen reports (signalements.html), as on the page */
  async function initReports() {
    const box = $('#mmReports');
    try {
      const d = await getJSON('api/assistant/signalements', 5000);
      const rows = (d.signalements || []).slice(0, 3);
      box.innerHTML = rows.length ? rows.map(r => `<a class="mm-report" href="signalements.html#${esc(r.ref)}" target="_blank" rel="noopener"><span class="mm-report__tag${r.relu ? ' is-read' : ''}">${r.relu ? 'Relu' : 'Non relu'}</span><b>${esc(r.titre)}</b><small>${esc((r.description || '').slice(0, 140))}${(r.description || '').length > 140 ? '…' : ''}</small></a>`).join('')
        : '<p class="mm-note">Aucune remontée pour l’instant : la page vient d’ouvrir.</p>';
    } catch (e) {
      box.innerHTML = '<p class="mm-note">Les remontées en direct ne sont pas joignables d’ici : bouton « Tableau de bord ».</p>';
    }
  }

  /* a video player with the look of X's: big play button, thin blue scrubber that follows the mouse, time, sound */
  function xPlayer(src, title) {
    return `<div class="xp" tabindex="0" aria-label="${esc(title)}"><video src="${esc(src)}" preload="metadata" playsinline></video>
      <button type="button" class="xp__big" aria-label="Lecture"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
      <div class="xp__bar"><div class="xp__scrub" role="slider" aria-label="Position dans la vidéo" tabindex="0"><div class="xp__buf"></div><div class="xp__fill"></div><div class="xp__thumb"></div></div>
        <div class="xp__ctl"><button type="button" class="xp__play" aria-label="Lecture"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button><span class="xp__time">0:00 / 0:00</span><span class="xp__sp"></span>
        <button type="button" class="xp__mute" aria-label="Son"><svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg></button>
        <button type="button" class="xp__fs" aria-label="Plein écran"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button></div></div>
      <p class="xp__title">${esc(title)}</p></div>`;
  }
  function wirePlayer(el) {
    const v = el.querySelector('video'), scrub = el.querySelector('.xp__scrub'), fill = el.querySelector('.xp__fill'), thumb = el.querySelector('.xp__thumb');
    const buf = el.querySelector('.xp__buf'), time = el.querySelector('.xp__time');
    const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>', PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
    const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const toggle = () => (v.paused ? v.play() : v.pause());
    const paint = () => {
      const p = v.duration ? v.currentTime / v.duration : 0;
      fill.style.width = `${100 * p}%`; thumb.style.left = `${100 * p}%`;
      time.textContent = `${mmss(v.currentTime)} / ${mmss(v.duration || 0)}`;
      if (v.buffered.length) buf.style.width = `${100 * v.buffered.end(v.buffered.length - 1) / (v.duration || 1)}%`;
    };
    v.addEventListener('timeupdate', paint); v.addEventListener('loadedmetadata', paint); v.addEventListener('progress', paint);
    v.addEventListener('play', () => { el.classList.add('is-playing'); el.querySelector('.xp__play').innerHTML = PAUSE; });
    v.addEventListener('pause', () => { el.classList.remove('is-playing'); el.querySelector('.xp__play').innerHTML = PLAY; });
    el.querySelector('.xp__big').addEventListener('click', toggle);
    el.querySelector('.xp__play').addEventListener('click', toggle);
    v.addEventListener('click', toggle);
    el.querySelector('.xp__mute').addEventListener('click', () => { v.muted = !v.muted; el.classList.toggle('is-muted', v.muted); });
    el.querySelector('.xp__fs').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.()));
    const seek = e => { const r = scrub.getBoundingClientRect(); const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); if (v.duration) { v.currentTime = p * v.duration; paint(); } };
    scrub.addEventListener('pointerdown', e => { scrub.setPointerCapture(e.pointerId); el.classList.add('is-seeking'); seek(e); });
    scrub.addEventListener('pointermove', e => { if (el.classList.contains('is-seeking')) seek(e); });
    scrub.addEventListener('pointerup', () => el.classList.remove('is-seeking'));
    el.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 5); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); }
      else if (e.key === 'm') v.muted = !v.muted;
    });
  }

  function watchLoupe() {
    const sync = () => { const p = $('.ai-panel'); document.body.classList.toggle('mm-loupe-open', !!p && !p.hidden && getComputedStyle(p).display !== 'none'); };
    new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'], childList: true });
    sync();
  }

  /* ================================================================ services en direct */
  async function checkLive() {
    const el = $('#mmLive');
    const [search, loupe] = await Promise.all([getJSON('api/health', 3000).then(() => true, () => false), getJSON('api/assistant/status', 3000).then(r => !!r?.enabled, () => false)]);
    el.className = `mm-live ${search && loupe ? 'is-ok' : search || loupe ? 'is-part' : 'is-off'}`;
    el.querySelector('span').textContent = `Recherche ${search ? '✓' : '✗'} · Loupe ${loupe ? '✓' : '✗'} · boutons 1-clic ✓`;
  }

  /* ================================================================ démarrage */
  async function start() {
    initNav();
    try { D = await getJSON('data/modernos.json', 8000); store.set('data', D); } catch (e) { D = store.get('data'); }
    if (!D) { $('#mmTitle').textContent = 'Données de la démo introuvables (data/modernos.json)'; return; }
    fill(); initLoupe(); initCity(); initSiren(); initFraude(); initSignals(); initFinal(); initReports();
    reveal(scenes[current]);
    setSteps(scenes[current], Number(scenes[current].dataset.shown || 0));
    checkLive(); initDemandes(); watchLoupe();
    getJSON('data/modernos-communes.json', 30000).then(c => { C = c; }).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
