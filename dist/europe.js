/* La France et ses voisins (europe.html). One data file: data/europe.json (scripts/europe-data.py).
   Always there: public expenditure and compensation of employees, 27 EU countries, 1995 onwards (Eurostat gov_10a_main).
   Shown only when their files have been downloaded (source « international » of fetch-sources.mjs): revenue, balance,
   debt, interest, ten-year rate, expenditure by function, IMF projections. A missing series is never drawn empty.
   Charts are SVG strings redrawn on resize; colours come from the --tx-* tokens of style.css (light and dark themes). */
(() => {
  const { esc, load, bars } = FRL;
  const $ = id => document.getElementById(id);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const nf = (v, d = 1) => isNum(v) ? v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
  const int = v => isNum(v) ? Math.round(v).toLocaleString('fr-FR') : '–';
  const signed = (v, d = 1) => isNum(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), d)}` : '–';
  const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
  const ordinal = n => n === 1 ? '1er' : `${n}e`;
  const PALETTE = ['var(--tx-3)', 'var(--tx-4)', 'var(--tx-7)', 'var(--tx-5)', 'var(--tx-6)', 'var(--tx-8)'];
  const FR_COLOR = 'var(--tx-1)', EU_COLOR = 'var(--c-ink)';

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
    return () => { width = 0; run(); };
  }
  const niceStep = range => { const raw = range / 4, mag = 10 ** Math.floor(Math.log10(raw || 1)), n = raw / mag; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag; };
  function scale(values, { zero = false } = {}) {
    let lo = Math.min(...values), hi = Math.max(...values);
    if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    if (lo === hi) { lo -= 1; hi += 1; }
    const step = niceStep(hi - lo);
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
  }

  /* Lines over the years. series: [{label, color, values[], dash, bold}]. `from` (a year) starts a shaded band of
     projections; the hover guide lists every series for the year under the pointer. */
  function lines(el, years, series, { unit = '', from = null, label = '', digits = 1 } = {}) {
    return responsive(el, W => {
      const small = W < 520, H = small ? 250 : 300, L = 38, R = small ? 10 : 96, T = 14, B = 26;
      const all = series.flatMap(s => s.values.filter(isNum));
      if (!all.length) { el.innerHTML = ''; return; }
      const { lo, hi, step } = scale(all, { zero: Math.min(...all) < 0 });
      const x = i => L + (W - L - R) * (years.length > 1 ? i / (years.length - 1) : .5);
      const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
      let svg = '';
      if (from != null && years.includes(from)) {
        const x0 = x(years.indexOf(from) - .5 < 0 ? 0 : years.indexOf(from) - .5);
        svg += `<rect class="eu-proj" x="${x0.toFixed(1)}" y="${T}" width="${(W - R - x0).toFixed(1)}" height="${H - T - B}"/><text class="tx-tick" x="${(x0 + 5).toFixed(1)}" y="${T + 11}">prévisions</text>`;
      }
      for (let v = lo; v <= hi + step / 2; v += step) svg += `<line class="tx-grid${Math.abs(v) < step / 1e6 ? ' eu-zero' : ''}" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="tx-tick" x="${L - 7}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${nf(v, step < 1 ? 1 : 0)}</text>`;
      const every = Math.max(1, Math.ceil(years.length / (small ? 5 : 9)));
      years.forEach((yr, i) => { if ((years.length - 1 - i) % every === 0) svg += `<text class="tx-tick" x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="middle">${yr}</text>`; });
      const ends = [];
      series.forEach(s => {
        let d = '', pen = false, lastI = -1;
        s.values.forEach((v, i) => { if (isNum(v)) { d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; lastI = i; } else pen = false; });
        svg += `<path class="eu-line${s.bold ? ' is-bold' : ''}" d="${d}" style="stroke:${s.color}"${s.dash ? ' stroke-dasharray="5 4"' : ''}/>`;
        if (lastI >= 0) { svg += `<circle r="${s.bold ? 4 : 3}" cx="${x(lastI).toFixed(1)}" cy="${y(s.values[lastI]).toFixed(1)}" style="fill:${s.color}"/>`; ends.push({ s, y: y(s.values[lastI]), x: x(lastI) }); }
      });
      if (!small) {   // direct labels at the end of each line, pushed apart when they would overlap
        ends.sort((a, b) => a.y - b.y);
        ends.forEach((e, i) => { if (i && e.y - ends[i - 1].ly < 13) e.ly = ends[i - 1].ly + 13; else e.ly = e.y; });
        ends.forEach(e => { svg += `<text class="eu-end${e.s.bold ? ' is-bold' : ''}" x="${W - R + 8}" y="${(e.ly + 4).toFixed(1)}" style="fill:${e.s.color}">${esc(e.s.short || e.s.label)}</text>`; });
      }
      svg += `<line class="eu-guide" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/><rect class="tx-hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/>`;
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${svg}</svg>`;
      const hit = el.querySelector('.tx-hit'), guide = el.querySelector('.eu-guide');
      const move = event => {
        const box = hit.getBoundingClientRect();
        const i = Math.max(0, Math.min(years.length - 1, Math.round((event.clientX - box.left) / box.width * (years.length - 1))));
        guide.style.display = ''; guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i));
        const rows = series.filter(s => isNum(s.values[i])).sort((a, b) => b.values[i] - a.values[i]);
        showTip(event, `<strong>${years[i]}${from != null && years[i] >= from ? ' (prévision)' : ''}</strong><table>${rows.map(s => `<tr><td><i style="background:${s.color}"></i>${esc(s.label)}</td><td>${nf(s.values[i], digits)} ${esc(unit)}</td></tr>`).join('')}</table>`);
      };
      hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
      hit.addEventListener('pointerleave', () => { hideTip(); guide.style.display = 'none'; });
    });
  }

  /* Rank of France year by year: 1 at the top. */
  function rankLine(el, years, ranks, of) {
    return responsive(el, W => {
      const H = 210, L = 34, R = 14, T = 16, B = 26, max = Math.max(...of.filter(isNum), 2);
      const x = i => L + (W - L - R) * (years.length > 1 ? i / (years.length - 1) : .5), y = r => T + (H - T - B) * ((r - 1) / (max - 1));
      let svg = '';
      [1, 5, 10, 15, 20, 25].filter(v => v <= max - 2).concat([max]).forEach(v => { svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 7}" y="${y(v) + 4}" text-anchor="end">${ordinal(v)}</text>`; });
      const every = Math.max(1, Math.ceil(years.length / (W < 520 ? 5 : 9)));
      years.forEach((yr, i) => { if ((years.length - 1 - i) % every === 0) svg += `<text class="tx-tick" x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="middle">${yr}</text>`; });
      let d = '', pen = false;
      ranks.forEach((r, i) => { if (isNum(r)) { d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(r).toFixed(1)}`; pen = true; } else pen = false; });
      svg += `<path class="eu-line is-bold" d="${d}" style="stroke:${FR_COLOR}"/>`;
      ranks.forEach((r, i) => { if (isNum(r)) svg += `<circle class="eu-dot" data-i="${i}" r="${r === 1 ? 4.5 : 3}" cx="${x(i).toFixed(1)}" cy="${y(r).toFixed(1)}" style="fill:${FR_COLOR}"/>`; });
      years.forEach((_, i) => { svg += `<rect class="tx-hit" data-i="${i}" x="${x(i) - (W - L - R) / years.length / 2}" y="0" width="${(W - L - R) / years.length}" height="${H}"/>`; });
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Rang de la France parmi les pays de l’Union européenne, année par année">${svg}</svg>`;
      el.querySelectorAll('.tx-hit').forEach(node => {
        const i = Number(node.dataset.i);
        node.addEventListener('pointermove', event => showTip(event, `<strong>${years[i]}</strong>${isNum(ranks[i]) ? `France : ${ordinal(ranks[i])} sur ${of[i]} pays` : 'Pas de valeur publiée'}`));
        node.addEventListener('pointerleave', hideTip);
      });
    });
  }

  function init(data) {
    const Y = data.years, names = data.names, EU = data.aggregate, M = data.metrics;
    const state = { metric: 'depenses', yi: Y.indexOf(data.france.year), picks: ['DE', 'IT', 'ES'], gapUnit: 'points' };
    const val = (metric, geo, yi) => M[metric].values[geo]?.[yi];
    const rankOf = (metric, yi, geo = 'FR') => {
      const pool = data.eu27.map(g => val(metric, g, yi)).filter(isNum).sort((a, b) => M[metric].order === 'asc' ? a - b : b - a);
      const v = val(metric, geo, yi);
      return { rank: isNum(v) ? pool.indexOf(v) + 1 : null, of: pool.length };
    };
    const unitOf = m => M[m].unit === '% du PIB' ? '% du PIB' : M[m].unit;

    const f = data.france, first = data.gap[0];
    $('euLead').innerHTML = `En ${f.year}, l’État, les collectivités locales et la Sécurité sociale ont dépensé ensemble <strong>${nf(f.france)} % de la richesse produite en France</strong> dans l’année (le PIB). C’est le ${ordinal(f.rank)} niveau le plus élevé des ${f.of} pays de l’Union européenne, dont l’ensemble est à ${nf(f.eu)} %. Mêmes règles de calcul pour tous les pays : les chiffres viennent d’Eurostat, l’office statistique de l’Union.`;

    /* ---- metric chips: only the series that are in the file */
    const keys = Object.keys(M);
    $('euMetric').innerHTML = keys.map(k => `<button type="button" data-metric="${k}"${k === state.metric ? ' class="active"' : ''}>${esc(M[k].label)}</button>`).join('');
    if (keys.length < 2) $('euMetric').hidden = true;
    const slider = $('euYear');
    slider.min = 0; slider.max = Y.length - 1; slider.value = state.yi;

    function drawRanking() {
      const m = M[state.metric], yi = state.yi, year = Y[yi];
      const rows = [...data.eu27, ...data.others].map(g => ({ geo: g, value: val(state.metric, g, yi), eu: data.eu27.includes(g) })).filter(r => isNum(r.value));
      rows.sort((a, b) => m.order === 'asc' ? a.value - b.value : b.value - a.value);
      const eu = val(state.metric, EU, yi);
      const all = rows.map(r => r.value).concat(isNum(eu) ? [eu] : []);
      const lo = Math.min(0, ...all), hi = Math.max(0, ...all), span = hi - lo || 1, pos = v => 100 * (v - lo) / span;
      let n = 0;
      $('euRank').innerHTML = rows.length ? `<ol class="eu-rank" style="--eu:${isNum(eu) ? pos(eu).toFixed(2) : -10}%">${rows.map(r => {
        const a = pos(Math.min(0, r.value)), b = pos(Math.max(0, r.value));
        const cls = r.geo === 'FR' ? ' is-fr' : !r.eu ? ' is-out' : state.picks.includes(r.geo) ? ' is-pick' : '';
        return `<li class="eu-rank__row${cls}" data-geo="${r.geo}"><span class="eu-rank__n">${r.eu ? ++n : ''}</span><span class="eu-rank__name">${esc(names[r.geo] || r.geo)}${r.eu ? '' : ' <small>hors UE</small>'}</span><span class="eu-rank__track"><span class="eu-rank__fill" style="left:${a.toFixed(2)}%;width:${Math.max(.4, b - a).toFixed(2)}%${cls === ' is-pick' ? `;background:${PALETTE[state.picks.indexOf(r.geo) % PALETTE.length]}` : ''}"></span></span><strong>${nf(r.value)}</strong></li>`;
      }).join('')}</ol>` : '<p class="note">Aucune valeur publiée pour cette année.</p>';
      $('euYearOut').textContent = year;
      const fr = rankOf(state.metric, yi);
      const frv = val(state.metric, 'FR', yi);
      $('euRankTitle').textContent = `${m.label} en ${year}, en ${unitOf(state.metric)}`;
      $('euRankNote').innerHTML = `${esc(m.what)} ${isNum(eu) ? `Trait vertical : l’ensemble de l’Union européenne (${nf(eu)} ${esc(m.unit)}), agrégat publié par Eurostat, pas une moyenne simple des 27 pays. ` : ''}Un clic sur un pays l’ajoute ou le retire du graphique d’évolution plus bas. Suisse, Islande et Norvège sont publiées par Eurostat mais ne sont pas classées. Source : ${link(m.url, m.source)}${m.updated ? `, mise à jour du ${esc(String(m.updated).slice(0, 10))}` : ''}.`;
      const top = rows.find(r => r.eu), low = [...rows].reverse().find(r => r.eu);
      $('euKpis').innerHTML = [
        [`France, ${year}`, `${nf(frv)} ${esc(m.unit)}`, fr.rank ? `${ordinal(fr.rank)} sur ${fr.of} pays de l’UE${m.order === 'asc' ? ' (du plus bas au plus haut)' : ''}` : 'pas de valeur publiée'],
        ['Union européenne', isNum(eu) ? `${nf(eu)} ${esc(m.unit)}` : '–', isNum(eu) && isNum(frv) ? `France : ${signed(frv - eu)} point${Math.abs(frv - eu) >= 2 ? 's' : ''}` : 'agrégat non publié'],
        [m.order === 'asc' ? 'Le plus bas de l’UE' : 'Le plus haut de l’UE', top ? `${nf(top.value)} ${esc(m.unit)}` : '–', top ? esc(names[top.geo]) : ''],
        [m.order === 'asc' ? 'Le plus haut de l’UE' : 'Le plus bas de l’UE', low ? `${nf(low.value)} ${esc(m.unit)}` : '–', low ? esc(names[low.geo]) : '']
      ].map(([label, value, sub]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join('');
    }

    let redrawLines = null, redrawRank = null;
    function drawEvolution() {
      const m = M[state.metric];
      const series = [{ label: 'France', color: FR_COLOR, values: m.values.FR, bold: true }];
      if (m.values[EU]) series.push({ label: 'Union européenne', short: 'UE', color: EU_COLOR, values: m.values[EU], dash: true });
      state.picks.filter(g => m.values[g]).forEach((g, i) => series.push({ label: names[g] || g, color: PALETTE[i % PALETTE.length], values: m.values[g] }));
      $('euLines').innerHTML = '';
      const host = $('euLines').cloneNode(false); $('euLines').replaceWith(host);   // drops the previous ResizeObserver with its node
      redrawLines = lines(host, Y, series, { unit: m.unit, label: `${m.label}, ${Y[0]}–${Y[Y.length - 1]}` });
      $('euLinesTitle').textContent = `${m.label}, ${m.firstYear}–${m.lastYear}`;
      $('euLinesLegend').innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('');
      $('euPick').innerHTML = data.eu27.filter(g => g !== 'FR').map(g => `<button type="button" data-geo="${g}"${state.picks.includes(g) ? ' class="active"' : ''}>${esc(names[g])}</button>`).join('');
      const ranks = Y.map((_, i) => rankOf(state.metric, i));
      const rhost = $('euRankLine').cloneNode(false); $('euRankLine').replaceWith(rhost);
      redrawRank = rankLine(rhost, Y, ranks.map(r => r.rank), ranks.map(r => r.of));
      const firsts = ranks.filter(r => r.rank === 1).length, known = ranks.filter(r => r.rank);
      $('euRankLineNote').textContent = `Rang de la France parmi les pays de l’UE qui publient une valeur l’année considérée (${known.length ? `${known[0].of} à ${known[known.length - 1].of} pays` : 'aucun'}), ${m.order === 'asc' ? 'du plus bas au plus haut' : 'du plus haut au plus bas'}. La France est première ${firsts} année${firsts > 1 ? 's' : ''} sur ${known.length}.`;
    }

    function toggle(geo) {
      if (geo === 'FR' || !data.eu27.includes(geo)) return;
      const i = state.picks.indexOf(geo);
      if (i >= 0) state.picks.splice(i, 1); else { state.picks.push(geo); if (state.picks.length > PALETTE.length) state.picks.shift(); }
      drawRanking(); drawEvolution();
    }
    $('euMetric').addEventListener('click', event => {
      const b = event.target.closest('[data-metric]'); if (!b) return;
      state.metric = b.dataset.metric;
      $('euMetric').querySelectorAll('button').forEach(n => n.classList.toggle('active', n === b));
      const m = M[state.metric];
      state.yi = Math.min(Math.max(state.yi, Y.indexOf(m.firstYear)), Y.indexOf(m.lastYear)); slider.value = state.yi;
      drawRanking(); drawEvolution();
    });
    slider.addEventListener('input', () => { state.yi = Number(slider.value); drawRanking(); });
    $('euRank').addEventListener('click', event => { const row = event.target.closest('[data-geo]'); if (row) toggle(row.dataset.geo); });
    $('euPick').addEventListener('click', event => { const b = event.target.closest('[data-geo]'); if (b) toggle(b.dataset.geo); });
    drawRanking(); drawEvolution();

    /* ---- gap to the EU aggregate (expenditure) */
    const G = data.gap, gl = G[G.length - 1];
    const GAP = { points: ['Points de PIB', g => g.points, v => `${signed(v)} pt`], md: ['Milliards d’euros', g => g.mdEur, v => `${signed(v, 0)} Md€`], hab: ['Euros par habitant', g => g.eurPerHead, v => `${v > 0 ? '+' : ''}${int(v)} €`] };
    if (!G.some(g => isNum(g.eurPerHead))) delete GAP.hab;
    $('euGapUnit').innerHTML = Object.entries(GAP).map(([k, [label]]) => `<button type="button" data-unit="${k}"${k === state.gapUnit ? ' class="active"' : ''}>${label}</button>`).join('');
    function drawGap() {
      const [, pick, format] = GAP[state.gapUnit];
      bars($('euGap'), G.filter(g => isNum(pick(g))).map(g => ({ label: String(g.year), value: pick(g), highlight: g.year === gl.year })), { format, height: 230 });
      $('euGapNote').innerHTML = state.gapUnit === 'points'
        ? 'Dépenses publiques de la France moins celles de l’ensemble de l’Union européenne, en points de PIB. Calcul du site à partir des deux séries publiées par Eurostat.'
        : state.gapUnit === 'md'
          ? 'L’écart en points appliqué au PIB de la France de la même année (PIB déduit des dépenses publiées en euros et en % du PIB). Calcul du site, euros courants : l’inflation n’est pas retirée.'
          : 'L’écart en milliards d’euros divisé par la population de la France au 1er janvier (Insee) : ce que chaque habitant représente en plus, par an, par rapport à la part moyenne de l’Union. Calcul du site, euros courants.';
    }
    $('euGapUnit').addEventListener('click', event => {
      const b = event.target.closest('[data-unit]'); if (!b) return;
      state.gapUnit = b.dataset.unit;
      $('euGapUnit').querySelectorAll('button').forEach(n => n.classList.toggle('active', n === b));
      drawGap();
    });
    drawGap();
    $('euGapKpis').innerHTML = [
      [`Écart avec l’UE en ${gl.year}`, `${signed(gl.points)} pt de PIB`, `France ${nf(gl.france)} %, Union ${nf(gl.eu)} %`],
      ['En milliards d’euros', isNum(gl.mdEur) ? `${int(gl.mdEur)} Md€` : '–', `par an, pour un PIB de ${int(data.gdpFrance[gl.year])} Md€`],
      ['Par habitant', isNum(gl.eurPerHead) ? `${int(gl.eurPerHead)} €` : '–', 'par an et par personne, enfants compris'],
      [`Écart en ${first.year}`, `${signed(first.points)} pt de PIB`, `France ${nf(first.france)} %, Union ${nf(first.eu)} %`]
    ].map(([label, value, sub]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join('');

    /* ---- questions the figures raise (never an answer the data does not give) */
    const pay = M.remunerations, li = Y.indexOf(f.year);
    const payRank = pay ? rankOf('remunerations', li) : null, payFr = pay ? val('remunerations', 'FR', li) : null, payEu = pay ? val('remunerations', EU, li) : null;
    const peak = G.reduce((a, b) => b.points > a.points ? b : a), low = G.reduce((a, b) => b.points < a.points ? b : a);
    const q = [];
    q.push([`D’où viennent ${nf(gl.points)} points d’écart ?`, `La France dépense ${nf(gl.points)} points de PIB de plus que l’ensemble de l’Union en ${gl.year}, soit ${int(gl.mdEur)} Md€. Ce chiffre global ne dit pas quelles dépenses font la différence : retraites, santé, aides, fonctionnement ? ${data.cofog ? 'Le détail par fonction est plus bas sur cette page.' : 'Eurostat publie le détail par fonction pour chaque pays ; il sera affiché ici dès que le fichier sera téléchargé.'}`]);
    if (payRank?.rank) q.push(['Les salaires publics expliquent-ils l’écart ?', `Pour la rémunération des agents publics, la France est ${ordinal(payRank.rank)} sur ${payRank.of} avec ${nf(payFr)} % du PIB${isNum(payEu) ? `, contre ${nf(payEu)} % pour l’Union : ${signed(payFr - payEu)} point${Math.abs(payFr - payEu) >= 2 ? 's' : ''}, sur ${nf(gl.points)} points d’écart total` : ''}. Où est le reste de l’écart ?`]);
    q.push([`Pourquoi l’écart a-t-il changé depuis ${first.year} ?`, `L’écart était de ${nf(first.points)} points en ${first.year}. Il a été au plus bas en ${low.year} (${nf(low.points)} points) et au plus haut en ${peak.year} (${nf(peak.points)} points). Est-ce la France qui a dépensé plus, ou ses voisins qui ont dépensé moins ? Le graphique d’évolution montre les deux courbes.`]);
    q.push(['Dépenser plus, pour quels résultats ?', 'Un pourcentage de PIB mesure un effort, pas un résultat. Aucune série de cette page ne dit si les hôpitaux, les écoles ou les tribunaux fonctionnent mieux là où la dépense est plus élevée. Les résultats comparables entre pays (PISA, espérance de vie en bonne santé, délais de justice) sont publiés ailleurs (OCDE, Commission européenne) et ne figurent pas encore sur cette page.']);
    $('euQuestions').innerHTML = q.map(([t, p]) => `<article class="gap"><h3>${esc(t)}</h3><p>${esc(p)}</p></article>`).join('');

    /* ---- optional: expenditure by function */
    if (data.cofog) {
      const c = data.cofog;
      $('fonctions').hidden = false; document.querySelector('[href="#fonctions"]').hidden = false;
      const top = Math.max(...c.functions.flatMap(r => [r.france, r.eu, r.top?.value]).filter(isNum), 1);
      const rows = [...c.functions].sort((a, b) => ((b.france ?? 0) - (b.eu ?? 0)) - ((a.france ?? 0) - (a.eu ?? 0)));
      $('euCofogTitle').textContent = `Dépenses publiques par fonction en ${c.year}, en % du PIB`;
      $('euCofog').innerHTML = `<table class="data-table eu-cofog"><thead><tr><th>Fonction</th><th class="num">France</th><th class="num">UE</th><th class="num">Écart</th><th>France et Union</th><th class="num">Rang</th><th>Le plus haut de l’UE</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${nf(r.france)}</td><td class="num">${nf(r.eu)}</td><td class="num">${isNum(r.france) && isNum(r.eu) ? signed(r.france - r.eu) : '–'}</td><td class="eu-cofog__bars"><span class="eu-pair"><i class="is-fr" style="width:${(100 * Math.max(0, r.france || 0) / top).toFixed(1)}%"></i><i class="is-eu" style="width:${(100 * Math.max(0, r.eu || 0) / top).toFixed(1)}%"></i></span></td><td class="num">${r.rank ? `${ordinal(r.rank)}/${r.of}` : '–'}</td><td class="muted">${r.top ? `${esc(names[r.top.geo] || r.top.geo)}, ${nf(r.top.value)}` : '–'}</td></tr>`).join('')}</tbody></table>`;
      $('euCofogNote').innerHTML = `Lignes triées par écart entre la France et l’Union. Barre pleine : France ; barre claire : Union européenne. Les dix fonctions font ${nf(c.sumFrance)} % du PIB pour la France, pour un total publié de ${nf(c.totalFrance)} %. Dernière année publiée par fonction : ${c.year}. Source : ${link(c.url, c.source)}.`;
    }

    /* ---- optional: IMF projections */
    if (data.imf) {
      const I = data.imf;
      $('fmi').hidden = false; document.querySelector('[href="#fmi"]').hidden = false;
      let current = I.indicators[0].code;
      $('euImfPick').innerHTML = I.indicators.map(i => `<button type="button" data-code="${i.code}"${i.code === current ? ' class="active"' : ''}>${esc(i.label)}</button>`).join('');
      const SHOW = ['FRA', 'DEU', 'ITA', 'ESP', 'GBR', 'USA', 'JPN'];
      const drawImf = () => {
        const ind = I.indicators.find(i => i.code === current);
        const series = SHOW.filter(g => ind.values[g]).map((g, i) => ({ label: I.geos[g], color: g === 'FRA' ? FR_COLOR : PALETTE[(i - 1) % PALETTE.length], values: ind.values[g], bold: g === 'FRA' }));
        const host = $('euImf').cloneNode(false); $('euImf').replaceWith(host);
        lines(host, I.years, series, { unit: ind.unit, from: I.projectionsFrom, label: ind.label });
        $('euImfLegend').innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('');
        const fra = ind.values.FRA, lastI = I.years.length - 1, nowI = I.years.indexOf(I.projectionsFrom - 1);
        const WHAT = { dette: 'Dette brute de l’ensemble des administrations publiques', solde: 'Recettes moins dépenses des administrations publiques (un nombre négatif est un déficit)', croissance: 'Croissance du PIB en volume, c’est-à-dire hors hausse des prix', inflation: 'Hausse des prix à la consommation, moyenne de l’année' };
        $('euImfNote').innerHTML = `${esc(WHAT[ind.key] || ind.label)}, en ${esc(ind.unit)}. Fichier téléchargé le ${esc(I.downloaded.split('-').reverse().join('/'))} : à partir de ${I.projectionsFrom}, ce sont des prévisions du FMI, pas des comptes arrêtés (zone grisée). ${isNum(fra?.[nowI]) && isNum(fra?.[lastI]) ? `Pour la France : ${nf(fra[nowI])} en ${I.years[nowI]}, ${nf(fra[lastI])} prévu en ${I.years[lastI]}. ` : ''}Les définitions du FMI diffèrent en partie de celles d’Eurostat : les deux séries ne se superposent pas exactement. Source : ${link(I.url, I.source)}.`;
      };
      $('euImfPick').addEventListener('click', event => {
        const b = event.target.closest('[data-code]'); if (!b) return;
        current = b.dataset.code;
        $('euImfPick').querySelectorAll('button').forEach(n => n.classList.toggle('active', n === b));
        drawImf();
      });
      drawImf();
    }

    /* ---- series the pipeline knows but whose files are not in this build */
    const PENDING = { recettes: 'recettes publiques', solde: 'déficit notifié à Bruxelles', dette: 'dette de Maastricht', interets: 'intérêts de la dette', taux: 'taux d’emprunt à dix ans', cofog: 'dépenses par fonction (retraites, santé, enseignement, défense…)', fmi: 'prévisions du FMI jusqu’à cinq ans' };
    const pending = (data.pending || []).filter(k => PENDING[k]);
    if (pending.length) {
      $('euPending').hidden = false;
      $('euPendingText').textContent = `Pour les 27 pays, le site sait télécharger et contrôler ces séries d’Eurostat et du FMI : ${pending.map(k => PENDING[k]).join(', ')}. Leurs fichiers ne sont pas encore dans cette version : elles s’afficheront sur cette page, sans autre changement, après la prochaine mise à jour des données.`;
    }
    $('euSources').innerHTML = data.sources.map(s => link(s.url, s.title)).join('') + `<span class="note">Données assemblées le ${esc(data.generated.split('-').reverse().join('/'))}.</span>`;
    FRL.keepHash();
  }

  load('./data/europe.json').then(init).catch(() => { $('euKpis').innerHTML = '<p class="note">Les données de comparaison européenne ne sont pas disponibles.</p>'; });
})();
