/* Search results: every published spending line whose label contains the query, with an explanatory summary. */
(() => {
  const { money, count, esc, bars, ranking, resolveNames } = FRL;
  const S = FRLSearch;
  const $ = id => document.getElementById(id);
  const EXAMPLES = ['discrimination', 'égalité femmes hommes', 'LGBT', 'inclusion', 'laïcité', 'radicalisation', 'violences conjugales', 'écriture inclusive', 'photovoltaïque', 'cybersécurité', 'jeux olympiques', 'conseil en stratégie'];
  const MAX_ROWS = 20000;
  const state = { q: '', words: [], rows: [], mode: 'live', src: 0, sort: 'amount', shown: 50, stats: null, related: [], deptNames: null };

  const pct = (part, whole) => whole ? `${Math.round(100 * part / whole)} %` : '—';
  const sirenCell = (siren, label) => /^\d{9}$/.test(siren || '') ? `<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}" target="_blank" rel="noopener noreferrer"${label ? '' : ` data-siren-name="${siren}"`}>${esc(label || siren)}</a>` : esc(label || '—');
  const whoCell = (row, mark) => /^\d{9}$/.test(row.siren || '')
    ? `<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/${row.siren}" target="_blank" rel="noopener noreferrer"${row.who ? '' : ` data-siren-name="${row.siren}"`}>${mark(row.who || row.siren)}</a>`
    : (row.who ? mark(row.who) : '—');
  const spending = row => !row.fw && row.src !== 6; // frameworks publish ceilings; budget lines are whole policies

  function setLoading(text) {
    $('srResults').hidden = false;
    $('srSummary').innerHTML = `<p class="sr-loading"><span class="spinner"></span>${esc(text)}</p>`;
    ['srKpis', 'srYears', 'srWho', 'srExtra', 'srDepts', 'srList', 'srRelated'].forEach(id => { $(id).innerHTML = ''; });
    $('srMore').hidden = true;
  }

  async function run(q) {
    state.q = q.trim(); state.words = S.tokens(state.q); state.src = 0; state.shown = 50;
    $('srInput').value = state.q;
    document.title = state.q ? `« ${state.q} » — Recherche — FranceRoueLibre` : 'Recherche — FranceRoueLibre';
    if (!state.words.length) { document.body.classList.remove('has-query'); $('srResults').hidden = true; $('srTitle').innerHTML = 'Chercher <span class="gradient-text">n’importe quel mot.</span>'; return; }
    $('srTitle').innerHTML = `« ${esc(state.q)} »`;
    document.body.classList.add('has-query');
    setLoading('Ouverture de l’index de recherche…');
    let meta;
    try { meta = await S.meta(); await S.db(); }
    catch (error) { $('srSummary').innerHTML = '<p class="note">L’index de recherche n’est pas disponible. Il se construit avec <code>python scripts/process_search.py</code>.</p>'; return; }
    setLoading('Recherche dans 1,9 million de lignes…');
    const started = performance.now();
    const single = state.words.length === 1 ? (await S.query('SELECT norm, display, df FROM term WHERE norm = ?', state.words[0]))[0] : null;
    if (single && single.df > meta.frequentThreshold) {
      // Very common word: totals and largest lines were precomputed when the index was built.
      state.mode = 'frequent';
      state.stats = await S.query('SELECT src, year, fw, n, amount FROM stat WHERE norm = ?', single.norm);
      state.rows = await S.query('SELECT d.id, d.src, d.year, d.amount, d.fw, d.title, d.who, d.siren, d.extra, d.dept FROM top t JOIN doc d ON d.id = t.id WHERE t.norm = ? ORDER BY t.rank', single.norm);
    } else {
      state.mode = 'live'; state.stats = null;
      state.rows = await S.query(`SELECT id, src, year, amount, fw, title, who, siren, extra, dept FROM doc WHERE id IN (SELECT rowid FROM fts WHERE fts MATCH ? LIMIT ${MAX_ROWS + 1})`, S.ftsQuery(state.words));
      if (state.rows.length > MAX_ROWS) state.mode = 'broad';
    }
    const stem = state.words[0].slice(0, Math.max(4, Math.min(state.words[0].length - 2, 7)));
    state.related = (await S.query('SELECT display, df FROM term WHERE norm >= ? AND norm < ? ORDER BY df DESC LIMIT 14', stem, `${stem}￿`)).filter(row => S.norm(row.display) !== state.words[0] || state.words.length > 1);
    state.elapsed = performance.now() - started;
    render();
  }

  /* Aggregates, either from the matched rows or from the precomputed table. */
  function totals() {
    const bySrc = {}, byYear = {};
    let lines = 0, amount = 0, fwLines = 0, fwAmount = 0, budgetLines = 0, budgetAmount = 0, years = [];
    const add = (src, year, fw, n, value) => {
      if (state.src && src !== state.src) return;
      if (fw) { fwLines += n; fwAmount += value; return; }
      if (src === 6) { budgetLines += n; budgetAmount += value; return; }
      lines += n; amount += value;
      const s = bySrc[src] || (bySrc[src] = { n: 0, amount: 0 }); s.n += n; s.amount += value;
      if (year) { byYear[year] = (byYear[year] || 0) + value; years.push(year); }
    };
    if (state.mode === 'frequent') state.stats.forEach(row => add(row.src, row.year, row.fw, row.n, row.amount || 0));
    else state.rows.forEach(row => add(row.src, row.year, row.fw, 1, row.amount || 0));
    // Source counts for the chips ignore the current filter.
    const all = {};
    (state.mode === 'frequent' ? state.stats.map(r => [r.src, r.n]) : state.rows.map(r => [r.src, 1])).forEach(([src, n]) => { all[src] = (all[src] || 0) + n; });
    return { bySrc, byYear, lines, amount, fwLines, fwAmount, budgetLines, budgetAmount, all, first: Math.min(...years), last: Math.max(...years) };
  }

  function groupTop(rows, key, limit = 10) {
    const map = new Map();
    rows.filter(spending).forEach(row => {
      const label = key(row);
      if (!label) return;
      const item = map.get(label.id) || { ...label, n: 0, value: 0 };
      item.n += 1; item.value += row.amount || 0; map.set(label.id, item);
    });
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, limit);
  }

  function summaryText(t, whoTop, extraTop) {
    const q = `« ${esc(state.q)} »`;
    if (!t.lines && !t.fwLines && !t.budgetLines) {
      return `<p class="sr-lead">${q} n’apparaît dans aucun libellé de dépense publique publié en données ouvertes.</p>
        <p>Cela ne veut pas dire qu’aucun argent public n’y est consacré : les libellés sont courts, rédigés par chaque administration, et beaucoup de dépenses (salaires, subventions des collectivités, petits marchés) ne sont pas publiées ligne à ligne.${state.related.length ? ' Essayez un mot proche ci-dessous.' : ''}</p>`;
    }
    const parts = [];
    const sources = Object.entries(t.bySrc).sort((a, b) => b[1].amount - a[1].amount);
    const period = Number.isFinite(t.first) ? (t.first === t.last ? `en ${t.first}` : `de ${t.first} à ${t.last}`) : '';
    if (t.lines) parts.push(`<p class="sr-lead">${q} apparaît dans <strong>${count(t.lines)} ligne${t.lines > 1 ? 's' : ''} de dépense publique</strong> ${period}, pour un total de <strong>${money(t.amount)}</strong>${state.mode === 'frequent' ? ' (mot exact)' : ''}.</p>`);
    if (sources.length) parts.push(`<p>${sources.length > 1 ? 'Répartition : ' : 'Source : '}${sources.map(([src, s]) => `${esc(S.SOURCES[src].phrase)} (${count(s.n)} ligne${s.n > 1 ? 's' : ''}, ${money(s.amount)}, ${pct(s.amount, t.amount)})`).join(' ; ')}.</p>`);
    const facts = [];
    if (whoTop[0]) facts.push(`le premier bénéficiaire ou acheteur est <strong>${sirenCell(whoTop[0].siren, /^\d{9}$/.test(whoTop[0].label) ? null : whoTop[0].label)}</strong> (${money(whoTop[0].value)} sur ${count(whoTop[0].n)} ligne${whoTop[0].n > 1 ? 's' : ''})`);
    if (extraTop[0]) facts.push(`le principal programme, mesure ou famille d’achat est « ${esc(extraTop[0].label)} » (${money(extraTop[0].value)})`);
    const peak = Object.entries(t.byYear).sort((a, b) => b[1] - a[1])[0];
    if (peak && Object.keys(t.byYear).length > 1) facts.push(`l’année la plus élevée est ${peak[0]} (${money(peak[1])})`);
    if (state.mode === 'frequent') facts.push('le mot est très courant : la liste se limite aux 60 lignes les plus importantes');
    if (facts.length) parts.push(`<p>Dans ces lignes, ${facts.join(' ; ')}.</p>`);
    if (t.fwLines) parts.push(`<p>En plus, ${count(t.fwLines)} accord${t.fwLines > 1 ? 's' : ''}-cadre${t.fwLines > 1 ? 's' : ''} affiche${t.fwLines > 1 ? 'nt' : ''} ${money(t.fwAmount)} de plafonds : ce sont des montants maximums autorisés, pas des dépenses, ils ne sont donc pas additionnés.</p>`);
    if (t.budgetLines) parts.push(`<p>${count(t.budgetLines)} ligne${t.budgetLines > 1 ? 's' : ''} du budget de l’État 2026 (${money(t.budgetAmount)}) contien${t.budgetLines > 1 ? 'nent' : 't'} aussi ce mot dans l’intitulé d’un programme ou d’une dépense : elles portent sur des politiques entières, comptées à part.</p>`);
    if (state.mode === 'broad') parts.push(`<p class="sr-warning">Plus de ${count(MAX_ROWS)} lignes correspondent : seules les ${count(MAX_ROWS)} premières sont analysées. Précisez la recherche (deux mots, une expression).</p>`);
    parts.push('<p class="sr-caveat">Le mot est cherché dans les libellés publiés : un résultat ne signifie pas que tout le montant y est consacré, et certains sont des homonymes. Vérifiez chaque ligne dans sa source.</p>');
    return parts.join('');
  }

  function render() {
    const t = totals();
    const rows = state.rows.filter(row => !state.src || row.src === state.src);
    const whoTop = groupTop(rows, row => row.who || row.siren ? { id: `${row.src}|${row.siren || row.who}`, label: row.who || row.siren, siren: row.siren, src: row.src } : null);
    const extraTop = groupTop(rows, row => row.extra ? { id: `${row.src}|${row.extra}`, label: row.extra, src: row.src } : null);
    $('srSummary').innerHTML = summaryText(t, whoTop, extraTop);
    // Source chips (filters).
    const chips = Object.keys(t.all).map(Number).sort((a, b) => t.all[b] - t.all[a]);
    $('srSources').innerHTML = [`<button type="button" data-src="0" class="${state.src ? '' : 'active'}">Toutes (${count(Object.values(t.all).reduce((s, n) => s + n, 0))})</button>`,
      ...chips.map(src => `<button type="button" data-src="${src}" class="${state.src === src ? 'active' : ''}">${esc(S.SOURCES[src].short)} (${count(t.all[src])})</button>`)].join('');
    $('srSources').parentElement.hidden = !chips.length;
    // KPIs.
    $('srKpis').innerHTML = !t.lines && !t.fwLines && !t.budgetLines ? '' : [
      ['Montant des lignes trouvées', money(t.amount), `${count(t.lines)} lignes${state.mode === 'live' || state.mode === 'broad' ? '' : ' (mot exact)'}`],
      ['Plafonds d’accords-cadres', money(t.fwAmount), `${count(t.fwLines)} accords-cadres, non additionnés`],
      ['Budget de l’État 2026', money(t.budgetAmount), `${count(t.budgetLines)} lignes (politiques entières)`],
      ['Période', Number.isFinite(t.first) ? (t.first === t.last ? String(t.first) : `${t.first}–${t.last}`) : '—', `recherche en ${(state.elapsed / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`]
    ].map(([label, value, sub]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join('');
    // Charts.
    const years = Object.keys(t.byYear).map(Number).sort((a, b) => a - b);
    if (years.length) {
      const full = []; for (let y = years[0]; y <= years[years.length - 1]; y++) full.push({ label: y, value: t.byYear[y] || 0 });
      bars($('srYears'), full, { height: 200 });
      $('srYearsNote').textContent = 'Hors plafonds d’accords-cadres et lignes du budget de l’État. Les années couvertes diffèrent selon les sources (associations 2010–2023 avec des trous, marchés 2014–2026, Fonds vert 2023–2025).';
    } else { $('srYears').innerHTML = '<p class="note">Aucun montant daté.</p>'; $('srYearsNote').textContent = ''; }
    ranking($('srWho'), whoTop.map(item => ({ label: item.label, html: sirenCell(item.siren, /^\d{9}$/.test(item.label) ? null : item.label), value: item.value, sub: `${S.SOURCES[item.src].short} · ${count(item.n)} ligne${item.n > 1 ? 's' : ''}` })), { limit: 10 });
    if (!whoTop.length) $('srWho').innerHTML = '<p class="note">—</p>';
    ranking($('srExtra'), extraTop.map(item => ({ label: item.label, value: item.value, sub: `${S.SOURCES[item.src].short} · ${count(item.n)} ligne${item.n > 1 ? 's' : ''}` })), { limit: 10 });
    if (!extraTop.length) $('srExtra').innerHTML = '<p class="note">—</p>';
    const depts = groupTop(rows, row => row.dept ? { id: row.dept, label: row.dept } : null, 10);
    ranking($('srDepts'), depts.map(item => ({ label: `${state.deptNames?.[item.label] || ''} (${item.label})`.trim(), value: item.value, sub: `${count(item.n)} ligne${item.n > 1 ? 's' : ''}` })), { limit: 10 });
    if (!depts.length) $('srDepts').innerHTML = '<p class="note">Département non renseigné pour ces lignes.</p>';
    renderList(rows);
    // Related words.
    $('srRelated').innerHTML = state.related.length ? `<h3>Mots proches dans les libellés</h3><div class="sr-chips">${state.related.map(row => `<a class="sr-chip" href="?q=${encodeURIComponent(row.display)}">${esc(row.display)}<small>${count(row.df)}</small></a>`).join('')}</div>` : '';
    $('srMethod').textContent = 'Méthode : recherche plein texte sans accents ni majuscules dans 1,9 million de lignes publiées (subventions de l’État aux associations 2010–2023, marchés publics 2014–2026, projets DGCL 2025, Fonds vert 2023–2025, aides de minimis 2026, budget vert de l’État 2026). Plusieurs mots sont cherchés comme une expression ; le dernier mot inclut ses terminaisons (pluriel, féminin).';
    resolveNames($('srResults'));
  }

  function renderList(rows) {
    const mark = S.highlighter(state.words);
    const sorted = [...rows].sort((a, b) => state.sort === 'year' ? (b.year - a.year) || (b.amount - a.amount) : (b.amount || 0) - (a.amount || 0));
    // Identical published lines (same source, year, label, buyer and amount: lots, co-contractors) are shown once with a counter.
    const grouped = [];
    const seen = new Map();
    sorted.forEach(row => {
      const key = `${row.src}|${row.year}|${row.title}|${row.siren || row.who}|${row.amount}|${row.fw}`;
      const item = seen.get(key);
      if (item) item.repeat += 1; else { const copy = { ...row, repeat: 1 }; seen.set(key, copy); grouped.push(copy); }
    });
    const shown = grouped.slice(0, state.shown);
    $('srListTitle').textContent = `Lignes de dépense${rows.length ? ` (${count(rows.length)}${state.mode === 'frequent' ? ' plus importantes' : ''})` : ''}`;
    $('srList').innerHTML = rows.length ? `<table class="data-table sr-table"><thead><tr><th>Source</th><th>Année</th><th>Libellé</th><th>Bénéficiaire / acheteur</th><th class="num">Montant</th></tr></thead><tbody>${shown.map(row => `<tr>
      <td><span class="tag tag--src${row.src}">${esc(S.SOURCES[row.src].short)}</span></td><td>${row.year ?? '—'}</td>
      <td>${mark(row.title)}${row.extra ? `<small class="sr-extra">${mark(row.extra)}</small>` : ''}</td>
      <td>${whoCell(row, mark)}</td>
      <td class="num">${money(row.amount)}${row.repeat > 1 ? `<small class="sr-extra">× ${row.repeat} lignes identiques</small>` : ''}${row.fw ? '<small class="sr-extra">plafond</small>' : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="note">Aucune ligne.</p>';
    $('srMore').hidden = shown.length >= grouped.length;
    $('srMore').textContent = `Afficher plus (${count(grouped.length - shown.length)} restantes)`;
  }

  function init() {
    $('srExamples').innerHTML = `<span>Exemples :</span>${EXAMPLES.map(word => `<a class="sr-chip" href="?q=${encodeURIComponent(word)}">${esc(word)}</a>`).join('')}`;
    $('srForm').addEventListener('submit', event => { event.preventDefault(); const q = $('srInput').value; history.pushState(null, '', `?q=${encodeURIComponent(q.trim())}`); run(q); });
    $('srSources').addEventListener('click', event => { const b = event.target.closest('[data-src]'); if (b) { state.src = Number(b.dataset.src); state.shown = 50; render(); } });
    $('srSort').addEventListener('change', () => { state.sort = $('srSort').value; renderList(state.rows.filter(row => !state.src || row.src === state.src)); resolveNames($('srList')); });
    $('srMore').addEventListener('click', () => { state.shown += 100; renderList(state.rows.filter(row => !state.src || row.src === state.src)); resolveNames($('srList')); });
    window.addEventListener('popstate', () => run(new URLSearchParams(location.search).get('q') || ''));
    fetch('./data/local/departements/_entities.json').then(r => r.json()).then(json => {
      const codes = json.codes || json.code || [], names = json.names || [];
      state.deptNames = Object.fromEntries(codes.map((code, i) => [code, names[i]]));
    }).catch(() => {});
    run(new URLSearchParams(location.search).get('q') || '');
  }
  init();
})();
