/* Search results: every published spending line whose label contains the query, with an explanatory summary.
   Reading is staged so the page can show its progress: words → matching lines → compact figures (table agg, in batches)
   → labels of the lines on screen (table doc). */
(() => {
  const { money, count, esc, bars, ranking, resolveNames } = FRL;
  const S = FRLSearch;
  const $ = id => document.getElementById(id);
  const EXAMPLES = ['discrimination', 'égalité femmes hommes', 'LGBT', 'inclusion', 'laïcité', 'radicalisation', 'violences conjugales', 'écriture inclusive', 'photovoltaïque', 'cybersécurité', 'jeux olympiques', 'conseil en stratégie'];
  const MAX_ROWS = 30000, BATCH = 600, PAGE = 50;
  const state = { q: '', words: [], rows: [], mode: 'live', src: 0, sort: 'amount', shown: PAGE, stats: null, related: [], deptNames: null, details: new Map(), labels: { who: new Map(), extra: new Map() }, run: 0 };

  const pct = (part, whole) => whole ? `${Math.round(100 * part / whole)} %` : '–';
  const sirenLink = (siren, html) => /^\d{9}$/.test(siren || '') ? `<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}" target="_blank" rel="noopener noreferrer"${html ? '' : ` data-siren-name="${siren}"`}>${html || siren}</a>` : (html || '–');
  const spending = row => !row.fw && row.src !== 6; // frameworks publish ceilings; budget lines are whole policies
  const mo = bytes => `${(bytes / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;

  /* ---------- Progress display ---------- */
  const progress = { started: 0 };
  async function showProgress(share, step, detail = '') {
    const stats = await S.stats();
    const elapsed = ((performance.now() - progress.started) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    $('srSummary').innerHTML = `<div class="sr-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(share)}">
      <div class="sr-progress__head"><span>${esc(step)}</span><strong>${Math.round(share)} %</strong></div>
      <div class="sr-progress__track"><span style="width:${share.toFixed(1)}%"></span></div>
      <div class="sr-progress__meta">${detail ? `${esc(detail)} · ` : ''}${stats ? `${mo(stats.totalFetchedBytes)} lus en ${count(stats.totalRequests)} requêtes · ` : ''}${elapsed} s</div></div>`;
  }
  function showError(error) {
    if (error?.code === 'NOINDEX') {
      $('srSummary').innerHTML = '<div class="sr-error"><strong>La recherche n’est pas disponible sur cette version du site.</strong><p>L’index de recherche (environ 600 Mo) n’est publié qu’avec la version complète du site, servie par <code>node serve.mjs</code> ou un hébergement statique qui accepte les gros fichiers.</p></div>';
      return;
    }
    const advice = error?.code === 'RANGE' || /malformed|disk image/i.test(error?.message || '')
      ? (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)
        ? 'Le serveur local ne lit pas l’index correctement. Arrêtez tous les serveurs en cours, relancez <code>node serve.mjs</code>, puis rechargez la page avec Ctrl+F5.'
        : 'L’index de recherche était peut-être en cours de mise à jour. Réessayez dans une minute ; si l’erreur persiste, rechargez la page avec Ctrl+F5.')
      : 'Rechargez la page ; si l’erreur persiste, reconstruisez l’index avec <code>python scripts/process_search.py</code>.';
    $('srSummary').innerHTML = `<div class="sr-error"><strong>La recherche a échoué.</strong><p>${esc(error?.message || String(error))}</p><p>${advice}</p><button class="more-btn" type="button" id="srRetry">Réessayer</button></div>`;
    $('srRetry').addEventListener('click', () => run(state.q));
  }
  function clearPanels() {
    ['srKpis', 'srYears', 'srWho', 'srExtra', 'srDepts', 'srList', 'srRelated', 'srSources'].forEach(id => { $(id).innerHTML = ''; });
    $('srMore').hidden = true; $('srPanels').hidden = true;
  }

  /* ---------- Search ---------- */
  // Words of the query that exist nowhere in the index, replaced by their closest existing word (transphobe → transphobie).
  async function correction(words, prefix) {
    let changed = false;
    const out = [];
    for (const [i, word] of words.entries()) {
      const last = i === words.length - 1;
      const known = await S.lookup(word) || (last && (prefix || word.length >= 4) && (await S.complete(word, 1)).length);
      const best = known ? null : (await S.nearest(word, 1))[0];
      out.push(best ? best.display : word);
      if (best) changed = true;
    }
    return changed ? out.join(' ') : null;
  }

  async function run(q, { exact = false, from = null } = {}) {
    const runId = ++state.run;
    const stale = () => runId !== state.run;
    state.q = q.trim(); state.words = S.tokens(state.q); state.prefix = S.wantsPrefix(state.q); state.from = from; state.exact = exact;
    state.src = 0; state.shown = PAGE; state.details = new Map();
    state.labels = { who: new Map(), extra: new Map() };
    $('srInput').value = state.q;
    document.title = state.q ? `« ${state.q} » · Recherche · FranceRoueLibre` : 'Recherche · FranceRoueLibre';
    if (!state.words.length) { document.body.classList.remove('has-query'); $('srResults').hidden = true; $('srTitle').innerHTML = 'Chercher <span class="gradient-text">n’importe quel mot.</span>'; return; }
    document.body.classList.add('has-query');
    $('srTitle').innerHTML = `« ${esc(state.q)} »`;
    $('srResults').hidden = false; clearPanels();
    progress.started = performance.now();
    try {
      await showProgress(5, 'Recherche sur le serveur');
      const api = await apiSearch(state.q, state.prefix);
      if (stale()) return;
      if (api) {
        // Searched on the server, next to the index (server/search_api.py): totals, rankings and the largest lines.
        state.mode = 'api'; state.api = api; state.stats = api.stats;
        state.rows = api.top.map(row => { state.details.set(row.id, row); return { ...row, whoKey: row.who || row.siren ? `${row.who}|${row.siren}` : null, extraKey: row.extra }; });
        if (!api.lines && !exact && !from) {
          const fixed = await correction(state.words, state.prefix);
          if (stale()) return;
          if (fixed) {
            history.replaceState(null, '', `?q=${encodeURIComponent(fixed)}&de=${encodeURIComponent(state.q)}`);
            return run(fixed, { from: state.q });
          }
        }
      } else {
      await showProgress(3, 'Ouverture de l’index de recherche');
      const meta = await S.meta(); await S.db();
      if (stale()) return;
      await showProgress(10, 'Recherche des mots dans l’index');
      const single = state.words.length === 1 ? (await S.query('SELECT norm, display, df FROM term WHERE norm = ?', state.words[0]))[0] : null;
      if (single && single.df > meta.frequentThreshold && !state.prefix) {
        // Very common word: totals and largest lines were precomputed when the index was built.
        state.mode = 'frequent';
        state.stats = await S.query('SELECT src, year, fw, n, amount FROM stat WHERE norm = ?', single.norm);
        await showProgress(50, 'Lecture des totaux précalculés', `${count(single.df)} lignes contiennent ce mot`);
        const top = await S.query('SELECT d.id, d.src, d.year, d.amount, d.fw, d.dept, d.title, d.who, d.siren, d.extra FROM top t JOIN doc d ON d.id = t.id WHERE t.norm = ? ORDER BY t.rank', single.norm);
        state.rows = top.map(row => { state.details.set(row.id, row); return { ...row, whoKey: row.who || row.siren ? `${row.who}|${row.siren}` : null, extraKey: row.extra }; });
        top.forEach(row => { if (row.who || row.siren) state.labels.who.set(`${row.who}|${row.siren}`, { name: row.who, siren: row.siren }); if (row.extra) state.labels.extra.set(row.extra, row.extra); });
      } else {
        state.mode = 'live'; state.stats = null;
        const match = S.ftsQuery(state.words, true, state.prefix);
        const ids = (await S.query(`SELECT rowid AS id FROM fts WHERE fts MATCH ? ORDER BY rowid LIMIT ${MAX_ROWS + 1}`, match)).map(row => row.id);
        if (stale()) return;
        if (!ids.length && !exact && !from) {
          // Nothing found: if a word is misspelt or in a form that never appears, search its closest existing word instead.
          const fixed = await correction(state.words, state.prefix);
          if (stale()) return;
          if (fixed) {
            history.replaceState(null, '', `?q=${encodeURIComponent(fixed)}&de=${encodeURIComponent(state.q)}`);
            return run(fixed, { from: state.q });
          }
        }
        if (ids.length > MAX_ROWS) { state.mode = 'broad'; ids.length = MAX_ROWS; }
        state.rows = [];
        await showProgress(20, ids.length ? 'Lecture des montants' : 'Aucune ligne trouvée', `${count(ids.length)} ligne${ids.length > 1 ? 's' : ''} trouvée${ids.length > 1 ? 's' : ''}`);
        for (let i = 0; i < ids.length; i += BATCH) {
          const part = ids.slice(i, i + BATCH);
          const rows = await S.query(`SELECT id, src, year, amount, fw, dept, who, extra FROM agg WHERE id IN (${part.join(',')})`);
          if (stale()) return;
          rows.forEach(row => state.rows.push({ ...row, whoKey: row.who, extraKey: row.extra }));
          await showProgress(20 + 65 * Math.min(1, (i + part.length) / ids.length), 'Lecture des montants', `${count(Math.min(ids.length, i + part.length))} / ${count(ids.length)} lignes`);
        }
      }
      }
      await showProgress(88, 'Préparation de la synthèse');
      // Other forms of the last word and close spellings, each with its own number of lines and amount.
      const last = state.words[state.words.length - 1];
      const head = state.words.slice(0, -1).join(' ');
      // With « mot* », the words starting with it are already in the results.
      // Once the word has results, only its other forms are worth showing (close spellings of an existing word are other words).
      const found = state.rows.length || state.mode === 'frequent' || (state.mode === 'api' && state.api.lines);
      const near = (await S.nearest(last, 30)).filter(entry => !(state.prefix && entry.norm.startsWith(last)) && (entry.family || !found))
        .sort((a, b) => found ? b.lines - a.lines : 0).slice(0, 10);
      const family = near.filter(entry => entry.family);
      const root = family.length ? S.familyRoot(last, family) : null;
      const withHead = word => head ? `${head} ${word}` : word;
      state.related = near.map(entry => ({ q: withHead(entry.display), label: entry.display, lines: entry.lines, amount: entry.amount }));
      state.family = root && !(state.prefix && root === last) ? { q: withHead(`${root}*`), label: `${root}…` } : null;
      if (state.mode === 'live' || state.mode === 'broad') await resolveLabels();
      await loadDetails(visibleRows());
      if (stale()) return;
      state.elapsed = performance.now() - progress.started;
      render();
    } catch (error) {
      if (!stale()) showError(error);
      console.error(error);
    }
  }

  let apiDown = false;
  async function apiSearch(q, prefix) {
    if (apiDown) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`api/search?q=${encodeURIComponent(q)}${prefix ? '&prefix=1' : ''}`, { signal: controller.signal });
      if (response.status === 404 || response.status === 405) { apiDown = true; return null; } // no API on this copy of the site
      if (!response.ok || !/json/.test(response.headers.get('content-type') || '')) return null;
      const data = await response.json();
      return Array.isArray(data.stats) && Array.isArray(data.top) ? data : null;
    } catch (error) { return null; } finally { clearTimeout(timer); }
  }
  // Server rankings are per (key, source): filtered by the selected source, then added up across sources.
  function apiTop(list, label) {
    const map = new Map();
    list.filter(item => !state.src || item.src === state.src).forEach(item => {
      const entry = map.get(item.key) || { id: item.key, src: item.src, n: 0, value: 0, best: 0, label: label(item), siren: item.siren };
      entry.n += item.n; entry.value += item.value;
      if (item.value > entry.best) { entry.best = item.value; entry.src = item.src; }
      map.set(item.key, entry);
    });
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 10).filter(item => item.label);
  }

  // Names of the top beneficiaries / programmes (compact rows only carry dictionary ids).
  async function resolveLabels() {
    const tops = key => { const sums = new Map(); state.rows.filter(spending).forEach(row => { if (row[key] != null) sums.set(row[key], (sums.get(row[key]) || 0) + (row.amount || 0)); }); return [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id); };
    const whoIds = tops('whoKey'), extraIds = tops('extraKey');
    if (whoIds.length) (await S.query(`SELECT id, name, siren FROM who WHERE id IN (${whoIds.join(',')})`)).forEach(row => state.labels.who.set(row.id, { name: row.name, siren: row.siren }));
    if (extraIds.length) (await S.query(`SELECT id, label FROM extra WHERE id IN (${extraIds.join(',')})`)).forEach(row => state.labels.extra.set(row.id, row.label));
  }
  // Labels (title, beneficiary, programme) for the lines on screen only.
  async function loadDetails(rows) {
    const missing = rows.map(row => row.id).filter(id => !state.details.has(id));
    if (!missing.length) return;
    (await S.query(`SELECT id, title, who, siren, extra FROM doc WHERE id IN (${missing.join(',')})`)).forEach(row => state.details.set(row.id, row));
  }

  /* ---------- Aggregates ---------- */
  function totals() {
    const bySrc = {}, byYear = {};
    let lines = 0, amount = 0, fwLines = 0, fwAmount = 0, budgetLines = 0, budgetAmount = 0;
    const years = [];
    const add = (src, year, fw, n, value) => {
      if (state.src && src !== state.src) return;
      if (fw) { fwLines += n; fwAmount += value; return; }
      if (src === 6) { budgetLines += n; budgetAmount += value; return; }
      lines += n; amount += value;
      const s = bySrc[src] || (bySrc[src] = { n: 0, amount: 0 }); s.n += n; s.amount += value;
      if (year) { byYear[year] = (byYear[year] || 0) + value; years.push(year); }
    };
    if (state.mode === 'frequent' || state.mode === 'api') state.stats.forEach(row => add(row.src, row.year, row.fw, row.n, row.amount || 0));
    else state.rows.forEach(row => add(row.src, row.year, row.fw, 1, row.amount || 0));
    const all = {};
    (state.mode === 'frequent' || state.mode === 'api' ? state.stats.map(r => [r.src, r.n]) : state.rows.map(r => [r.src, 1])).forEach(([src, n]) => { all[src] = (all[src] || 0) + n; });
    return { bySrc, byYear, lines, amount, fwLines, fwAmount, budgetLines, budgetAmount, all, first: Math.min(...years), last: Math.max(...years) };
  }
  function groupTop(rows, key, label, limit = 10) {
    const map = new Map();
    rows.filter(spending).forEach(row => {
      const id = row[key];
      if (id == null) return;
      const item = map.get(id) || { id, src: row.src, n: 0, value: 0 };
      item.n += 1; item.value += row.amount || 0; map.set(id, item);
    });
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, limit).map(item => ({ ...item, ...label(item.id) })).filter(item => item.label);
  }
  const whoLabel = id => { const w = state.labels.who.get(id); return w ? { label: w.name || w.siren, siren: w.siren } : {}; };
  const extraLabel = id => ({ label: state.labels.extra.get(id) });

  function summaryText(t, whoTop, extraTop) {
    const q = `« ${esc(state.q)} »`;
    if (!t.lines && !t.fwLines && !t.budgetLines) {
      const advice = state.family || state.related.length ? `<p class="sr-didyoumean">Mots proches qui apparaissent dans les libellés : ${[...(state.family ? [`<a href="?q=${encodeURIComponent(state.family.q)}">toutes les formes de « ${esc(state.family.label)} »</a>`] : []), ...state.related.filter(r => r.lines).slice(0, 4).map(r => `<a href="?q=${encodeURIComponent(r.q)}">${esc(r.label)}</a> (${count(r.lines)} ligne${r.lines > 1 ? 's' : ''}${r.amount ? `, ${money(r.amount)}` : ''})`)].join(' · ')}.</p>` : '';
      return `${advice}<p class="sr-lead">${q} n’apparaît dans aucun libellé de dépense publique publié en données ouvertes.</p>
        <p>Cela ne veut pas dire qu’aucun argent public n’y est consacré : les libellés sont courts, rédigés par chaque administration, et beaucoup de dépenses (salaires, subventions des collectivités, petits marchés) ne sont pas publiées ligne à ligne.${state.related.length ? ' Essayez un mot proche ci-dessous.' : ''}</p>`;
    }
    const parts = [];
    const sources = Object.entries(t.bySrc).sort((a, b) => b[1].amount - a[1].amount);
    const period = Number.isFinite(t.first) ? (t.first === t.last ? `en ${t.first}` : `de ${t.first} à ${t.last}`) : '';
    if (t.lines) parts.push(`<p class="sr-lead">${q} apparaît dans <strong>${count(t.lines)} ligne${t.lines > 1 ? 's' : ''} de dépense publique</strong> ${period}, pour un total de <strong>${money(t.amount)}</strong>${state.mode === 'frequent' ? ' (mot exact)' : ''}.</p>`);
    if (sources.length) parts.push(`<p>${sources.length > 1 ? 'Répartition : ' : 'Source : '}${sources.map(([src, s]) => `${esc(S.SOURCES[src].phrase)} (${count(s.n)} ligne${s.n > 1 ? 's' : ''}, ${money(s.amount)}, ${pct(s.amount, t.amount)})`).join(' ; ')}.</p>`);
    const facts = [];
    if (whoTop[0]) facts.push(`le premier bénéficiaire ou acheteur est <strong>${sirenLink(whoTop[0].siren, /^\d{9}$/.test(whoTop[0].label) ? null : esc(whoTop[0].label))}</strong> (${money(whoTop[0].value)} sur ${count(whoTop[0].n)} ligne${whoTop[0].n > 1 ? 's' : ''})`);
    if (extraTop[0]) facts.push(`le principal programme, mesure ou famille d’achat est « ${esc(extraTop[0].label)} » (${money(extraTop[0].value)})`);
    const peak = Object.entries(t.byYear).sort((a, b) => b[1] - a[1])[0];
    if (peak && Object.keys(t.byYear).length > 1) facts.push(`l’année la plus élevée est ${peak[0]} (${money(peak[1])})`);
    if (state.mode === 'frequent') facts.push('le mot est très courant : bénéficiaires et liste portent sur les 60 lignes les plus importantes');
    if (state.mode === 'api' && state.api.lines > state.api.top.length) facts.push(`la liste ci-dessous montre les ${count(state.api.top.length)} lignes les plus importantes`);
    if (facts.length) parts.push(`<p>Dans ces lignes, ${facts.join(' ; ')}.</p>`);
    if (t.fwLines) parts.push(`<p>En plus, ${count(t.fwLines)} accord${t.fwLines > 1 ? 's' : ''}-cadre${t.fwLines > 1 ? 's' : ''} affiche${t.fwLines > 1 ? 'nt' : ''} ${money(t.fwAmount)} de plafonds : ce sont des montants maximums autorisés, pas des dépenses, ils ne sont donc pas additionnés.</p>`);
    if (t.budgetLines) parts.push(`<p>${count(t.budgetLines)} ligne${t.budgetLines > 1 ? 's' : ''} du budget de l’État 2026 (${money(t.budgetAmount)}) contien${t.budgetLines > 1 ? 'nent' : 't'} aussi ce mot dans l’intitulé d’un programme ou d’une dépense : elles portent sur des politiques entières, comptées à part.</p>`);
    if (state.from) parts.unshift(`<p class="sr-didyoumean">Aucun résultat pour « ${esc(state.from)} » : résultats affichés pour le mot le plus proche, <strong>« ${esc(state.q)} »</strong>. <a href="?q=${encodeURIComponent(state.from)}&exact=1">Chercher uniquement « ${esc(state.from)} »</a></p>`);
    if (state.prefix) parts.push(`<p class="sr-caveat">Le signe * cherche tous les mots qui commencent par « ${esc(state.words[state.words.length - 1])} ».</p>`);
    if (state.mode === 'broad') parts.push(`<p class="sr-warning">Plus de ${count(MAX_ROWS)} lignes correspondent : seules les ${count(MAX_ROWS)} premières sont analysées. Précisez la recherche (deux mots, une expression).</p>`);
    parts.push(`<p class="sr-caveat">Le mot est cherché dans les libellés publiés : un résultat ne signifie pas que tout le montant y est consacré, et certains sont des homonymes. Vérifiez chaque ligne dans sa source. Recherche faite en ${(state.elapsed / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s.</p>`);
    return parts.join('');
  }

  /* ---------- Rendering ---------- */
  const filtered = () => state.rows.filter(row => !state.src || row.src === state.src);
  function sortedGroups() {
    const rows = [...filtered()].sort((a, b) => state.sort === 'year' ? (b.year - a.year) || (b.amount - a.amount) : (b.amount || 0) - (a.amount || 0));
    // Identical published lines (same source, year, amount, buyer and programme: lots, co-contractors) are shown once with a counter.
    const grouped = [], seen = new Map();
    rows.forEach(row => {
      const key = `${row.src}|${row.year}|${row.amount}|${row.whoKey}|${row.extraKey}|${row.fw}`;
      const item = seen.get(key);
      if (item) item.repeat.push(row.id); else { const copy = { ...row, repeat: [row.id] }; seen.set(key, copy); grouped.push(copy); }
    });
    return grouped;
  }
  const visibleRows = () => sortedGroups().slice(0, state.shown);

  function render() {
    const t = totals();
    const rows = filtered();
    const api = state.mode === 'api' ? state.api : null;
    const whoTop = api ? apiTop(api.who, item => item.label) : groupTop(rows, 'whoKey', whoLabel);
    const extraTop = api ? apiTop(api.extra, item => item.label) : groupTop(rows, 'extraKey', extraLabel);
    $('srSummary').innerHTML = summaryText(t, whoTop, extraTop);
    const chips = Object.keys(t.all).map(Number).sort((a, b) => t.all[b] - t.all[a]);
    $('srSources').innerHTML = chips.length ? [`<button type="button" data-src="0" class="${state.src ? '' : 'active'}">Toutes (${count(Object.values(t.all).reduce((s, n) => s + n, 0))})</button>`,
      ...chips.map(src => `<button type="button" data-src="${src}" class="${state.src === src ? 'active' : ''}">${esc(S.SOURCES[src].short)} (${count(t.all[src])})</button>`)].join('') : '';
    $('srPanels').hidden = !(t.lines || t.fwLines || t.budgetLines);
    $('srKpis').innerHTML = [
      ['Montant des lignes trouvées', money(t.amount), `${count(t.lines)} lignes${state.mode === 'frequent' ? ' (mot exact)' : ''}`],
      ['Plafonds d’accords-cadres', money(t.fwAmount), `${count(t.fwLines)} accords-cadres, non additionnés`],
      ['Budget de l’État 2026', money(t.budgetAmount), `${count(t.budgetLines)} lignes (politiques entières)`],
      ['Période', Number.isFinite(t.first) ? (t.first === t.last ? String(t.first) : `${t.first}–${t.last}`) : '–', `recherche en ${(state.elapsed / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`]
    ].map(([label, value, sub]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join('');
    const years = Object.keys(t.byYear).map(Number).sort((a, b) => a - b);
    if (years.length) {
      const full = []; for (let y = years[0]; y <= years[years.length - 1]; y++) full.push({ label: y, value: t.byYear[y] || 0 });
      bars($('srYears'), full, { height: 200 });
      $('srYearsNote').textContent = 'Hors plafonds d’accords-cadres et lignes du budget de l’État. Les années couvertes diffèrent selon les sources (associations 2010–2023 avec des trous, marchés 2014–2026, projets DGCL 2018–2025, Fonds vert 2023–2025).';
    } else { $('srYears').innerHTML = '<p class="note">Aucun montant daté.</p>'; $('srYearsNote').textContent = ''; }
    ranking($('srWho'), whoTop.map(item => ({ label: item.label, html: sirenLink(item.siren, /^\d{9}$/.test(item.label) ? null : esc(item.label)), value: item.value, sub: `${S.SOURCES[item.src].short} · ${count(item.n)} ligne${item.n > 1 ? 's' : ''}` })), { limit: 10 });
    if (!whoTop.length) $('srWho').innerHTML = '<p class="note">–</p>';
    ranking($('srExtra'), extraTop.map(item => ({ label: item.label, value: item.value, sub: `${S.SOURCES[item.src].short} · ${count(item.n)} ligne${item.n > 1 ? 's' : ''}` })), { limit: 10 });
    if (!extraTop.length) $('srExtra').innerHTML = '<p class="note">–</p>';
    const deptLabel = id => `${state.deptNames?.[id] || ''} (${id})`.trim();
    const depts = api ? apiTop(api.depts, item => deptLabel(item.key)) : groupTop(rows, 'dept', id => ({ label: deptLabel(id) }), 10);
    ranking($('srDepts'), depts.map(item => ({ label: item.label, value: item.value, sub: `${count(item.n)} ligne${item.n > 1 ? 's' : ''}` })), { limit: 10 });
    if (!depts.length) $('srDepts').innerHTML = '<p class="note">Département non renseigné pour ces lignes.</p>';
    renderList();
    const related = [
      ...(state.family ? [`<a class="sr-chip sr-chip--family" href="?q=${encodeURIComponent(state.family.q)}">Toutes les formes : ${esc(state.family.label)}</a>`] : []),
      ...state.related.map(row => `<a class="sr-chip" href="?q=${encodeURIComponent(row.q)}">${esc(row.label)}<small>${count(row.lines)} ligne${row.lines > 1 ? 's' : ''}${row.amount ? ` · ${money(row.amount)}` : ''}</small></a>`)];
    $('srRelated').innerHTML = related.length ? `<h3>Autres formes et mots proches</h3><div class="sr-chips">${related.join('')}</div>` : '';
    $('srMethod').textContent = 'Méthode : recherche plein texte sans accents ni majuscules dans 2,1 millions de lignes publiées (subventions de l’État aux associations 2010–2023, marchés publics 2014–2026, projets DGCL 2018–2025, Fonds vert 2023–2025, aides de minimis 2026, budget vert de l’État 2026). Plusieurs mots sont cherchés comme une expression ; le dernier mot inclut ses terminaisons (pluriel, féminin).';
    resolveNames($('srResults'));
  }

  function renderList() {
    const mark = S.highlighter(state.words);
    const groups = sortedGroups();
    const shown = groups.slice(0, state.shown);
    $('srListTitle').textContent = `Lignes de dépense${state.rows.length ? ` (${count(filtered().length)}${state.mode === 'frequent' || (state.mode === 'api' && state.api.lines > state.api.top.length) ? ' plus importantes' : ''})` : ''}`;
    $('srList').innerHTML = shown.length ? `<table class="data-table sr-table"><thead><tr><th>Source</th><th>Année</th><th>Libellé</th><th>Bénéficiaire / acheteur</th><th class="num">Montant</th></tr></thead><tbody>${shown.map(row => {
      const d = state.details.get(row.id) || {};
      return `<tr><td><span class="tag tag--src${row.src}">${esc(S.SOURCES[row.src].short)}</span></td><td>${row.year ?? '–'}</td>
        <td>${mark(d.title)}${d.extra ? `<small class="sr-extra">${mark(d.extra)}</small>` : ''}</td>
        <td>${/^\d{9}$/.test(d.siren || '') ? sirenLink(d.siren, d.who ? mark(d.who) : null) : (d.who ? mark(d.who) : '–')}</td>
        <td class="num">${money(row.amount)}${row.repeat.length > 1 ? `<small class="sr-extra">× ${row.repeat.length} lignes identiques</small>` : ''}${row.fw ? '<small class="sr-extra">plafond</small>' : ''}</td></tr>`;
    }).join('')}</tbody></table>` : '<p class="note">Aucune ligne.</p>';
    $('srMore').hidden = shown.length >= groups.length;
    $('srMore').textContent = `Afficher plus (${count(groups.length - shown.length)} restantes)`;
  }
  async function refreshList() {
    $('srMore').disabled = true;
    try { await loadDetails(visibleRows()); } finally { $('srMore').disabled = false; }
    renderList(); resolveNames($('srList'));
  }

  function init() {
    $('srExamples').innerHTML = `<span>Exemples :</span>${EXAMPLES.map(word => `<a class="sr-chip" href="?q=${encodeURIComponent(word)}">${esc(word)}</a>`).join('')}`;
    $('srForm').addEventListener('submit', event => { event.preventDefault(); const q = $('srInput').value; history.pushState(null, '', `?q=${encodeURIComponent(q.trim())}`); run(q); });
    $('srSources').addEventListener('click', async event => { const b = event.target.closest('[data-src]'); if (!b) return; state.src = Number(b.dataset.src); state.shown = PAGE; await loadDetails(visibleRows()); render(); });
    $('srSort').addEventListener('change', () => { state.sort = $('srSort').value; refreshList(); });
    $('srMore').addEventListener('click', () => { state.shown += 100; refreshList(); });
    const fromUrl = () => { const p = new URLSearchParams(location.search); return run(p.get('q') || '', { exact: p.has('exact'), from: p.get('de') }); };
    window.addEventListener('popstate', fromUrl);
    fetch('./data/local/departements/_entities.json').then(r => r.json()).then(json => { state.deptNames = Object.fromEntries((json.codes || []).map((code, i) => [code, json.names[i]])); }).catch(() => {});
    fromUrl();
  }
  init();
})();
