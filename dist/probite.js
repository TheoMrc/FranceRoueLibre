/* Probité : atteintes à la probité dans les décisions de justice, données nationales agrégées 2021-2025.
   One data file: data/probite.json (scripts/probite-data.py). Counts below 5 are masked by the producer (« <5 »),
   some others by secondary masking (« n.d. ») : they stay masked, never estimated nor counted as zero.
   Charts are SVG strings redrawn on resize; colours come from the --tx-* tokens of style.css (light and dark themes). */
(() => {
  const { esc, load } = FRL;
  const $ = id => document.getElementById(id);
  const nf = value => Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  /* A published count, the producer's mask, or « – » when the file has no line for it. */
  const show = v => isNum(v) ? nf(v) : v == null ? '–' : esc(v);
  /* Source labels use an em dash; the site never does. */
  const clean = s => String(s || '').replace(/\s*—\s*/g, ', ');
  const PROC = { 'Jugement — opposition comprise': 'Jugement (opposition comprise)', 'Ordonnance pénale ou homologation CRPC': 'Ordonnance pénale ou CRPC' };
  const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

  /* Tooltip, same look as the other pages (.tx-tip). */
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

  /* Stacked vertical bars, one bar per year. layers: [{label, color, values[]}], totals[] (published total, drawn above). */
  function stackBars(el, years, layers, totals, { label = '' } = {}) {
    return responsive(el, W => {
      const H = 250, L = 40, R = 8, T = 22, B = 26;
      const sums = years.map((_, i) => layers.reduce((s, l) => s + (isNum(l.values[i]) ? l.values[i] : 0), 0));
      const hi0 = Math.max(...sums, ...totals.filter(isNum), 1), step = niceStep(hi0), hi = Math.ceil(hi0 / step) * step;
      const y = v => T + (H - T - B) * (1 - v / hi);
      const band = (W - L - R) / years.length, bw = Math.min(64, band * .62);
      let svg = '';
      for (let v = 0; v <= hi + step / 2; v += step) svg += `<line class="tx-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tx-tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${nf(v)}</text>`;
      years.forEach((yr, i) => {
        const cx = L + band * (i + .5);
        let base = 0;
        layers.forEach(l => {
          const v = isNum(l.values[i]) ? l.values[i] : 0;
          if (v > 0) svg += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(base + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(base) - y(base + v)).toFixed(1)}" style="fill:${l.color}" class="pb-seg"/>`;
          base += v;
        });
        const t = isNum(totals[i]) ? totals[i] : sums[i];
        svg += `<text class="tx-label" x="${cx}" y="${y(Math.max(t, sums[i])) - 7}" text-anchor="middle">${nf(t)}</text><text class="tx-tick" x="${cx}" y="${H - 7}" text-anchor="middle">${yr}</text>`;
        svg += `<rect class="tx-hit" data-i="${i}" x="${cx - band / 2}" y="0" width="${band}" height="${H}"/>`;
      });
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${svg}</svg>`;
      el.querySelectorAll('.tx-hit').forEach(node => {
        const i = Number(node.dataset.i);
        node.addEventListener('pointermove', event => showTip(event, `<strong>${years[i]}${isNum(totals[i]) ? ` · ${nf(totals[i])} affaires` : ''}</strong><table>${layers.map(l => `<tr><td><i style="background:${l.color}"></i>${esc(l.label)}</td><td>${show(l.values[i])}</td></tr>`).join('')}</table>`));
        node.addEventListener('pointerleave', hideTip);
      });
    });
  }

  /* Five small bars for one series, own scale; masked values drawn as a dashed outline up to 5. */
  function miniBars(values, years) {
    const W = 220, H = 92, T = 16, B = 18, band = W / years.length, bw = band * .56;
    const hi = Math.max(5, ...values.filter(isNum));
    const y = v => T + (H - T - B) * (1 - v / hi);
    let svg = '';
    values.forEach((v, i) => {
      const cx = band * (i + .5);
      if (isNum(v)) svg += `<rect class="pb-mini" x="${cx - bw / 2}" y="${y(v)}" width="${bw}" height="${Math.max(.5, y(0) - y(v))}"/>`;
      else if (v === '<5') svg += `<rect class="pb-mini pb-mini--masked" x="${cx - bw / 2 + .5}" y="${y(5)}" width="${bw - 1}" height="${y(0) - y(5)}"/>`;
      svg += `<text class="pb-mini__v${isNum(v) ? '' : ' is-masked'}" x="${cx}" y="${(isNum(v) ? y(v) : v === '<5' ? y(5) : y(0)) - 4}" text-anchor="middle">${show(v)}</text><text class="tx-tick" x="${cx}" y="${H - 4}" text-anchor="middle">${String(years[i]).slice(2)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${svg}<line class="tx-grid" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/></svg>`;
  }

  /* Horizontal bars (.tx-bars look); masked rows keep an empty track and their mask as value. */
  function hbars(el, rows) {
    const top = Math.max(...rows.map(r => isNum(r.value) ? r.value : 0), 1);
    el.innerHTML = `<ul class="tx-bars">${rows.map(r => `<li><div class="tx-bars__line"><span>${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><strong>${show(r.value)}</strong></div><span class="tx-bars__track" aria-hidden="true"><span class="tx-bars__fill" style="--w:${(100 * (isNum(r.value) ? r.value : 0) / top).toFixed(2)}%"></span></span></li>`).join('')}</ul>`;
    requestAnimationFrame(() => el.querySelectorAll('.tx-bars__fill').forEach(n => { n.style.width = n.style.getPropertyValue('--w'); }));
  }

  function chips(el, years, current, onPick) {
    el.innerHTML = years.map(y => `<button type="button" data-year="${y}"${y === current ? ' class="active"' : ''}>${y}</button>`).join('');
    el.addEventListener('click', event => {
      const b = event.target.closest('[data-year]'); if (!b) return;
      el.querySelectorAll('button').forEach(n => n.classList.toggle('active', n === b));
      onPick(Number(b.dataset.year));
    });
  }

  function init(data) {
    const Y = data.years, last = Y.length - 1, yi = y => Y.indexOf(y);
    const perYear = data.perYear;
    const situ = Object.fromEntries(data.situation.map(s => [s.label, s]));
    const first = perYear[0], end = perYear[last];
    const proc = Object.entries(data.procedures).map(([k, v], i) => ({ key: k, label: PROC[k] || clean(k), color: `var(--tx-${i + 1})`, values: v.affaires }));
    const ord = proc.find(p => /Ordonnance/.test(p.key));
    const assim = data.infractions.find(r => r.code === 'Corruption | infractions assimilées');

    $('pbKpis').innerHTML = [
      [`Affaires jugées ${Y[0]}–${Y[last]}`, nf(data.total.affaires), `${nf(data.total.unites)} couples prévenu × infraction`],
      [`Affaires jugées en ${end.year}`, nf(end.affaires), `${nf(first.affaires)} en ${first.year}, soit ×${nf(Math.round(10 * end.affaires / first.affaires) / 10)}`],
      ['Au moins une peine prononcée', show(situ['Au moins une peine comptée']?.affaires), `affaires ${Y[0]}–${Y[last]}`],
      ['Absence de culpabilité', show(situ['Sans objet — absence de culpabilité']?.affaires), `affaires ${Y[0]}–${Y[last]} (relaxe)`]
    ].map(([label, value, sub]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join('');

    stackBars($('pbYears'), Y, proc, perYear.map(p => p.affaires), { label: 'Affaires jugées par année et type de décision' });
    $('pbYearsLegend').innerHTML = proc.map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)}</span>`).join('');
    const c = data.checks;
    $('pbYearsNote').textContent = `Nombre au-dessus de chaque barre : total publié pour l’année. Une affaire qui donne lieu à deux décisions la même année compte dans les deux types, d’où un empilement parfois légèrement supérieur au total. Contrôle : la somme des années donne ${nf(c.sumYearsAffaires)} affaires pour ${nf(c.periodAffaires)} sur la période publiée (une affaire jugée sur deux années compte dans chacune) ; ${nf(c.sumYearsUnites)} couples prévenu × infraction pour ${nf(c.periodUnites)}, identique. CRPC : comparution sur reconnaissance préalable de culpabilité.`;

    const auth = Object.entries(data.authors).map(([k, v], i) => ({ label: k, color: i ? 'var(--tx-4)' : 'var(--tx-3)', values: v.affaires })).sort((a, b) => a.label.localeCompare(b.label)).reverse();
    auth.forEach((a, i) => { a.color = i ? 'var(--tx-4)' : 'var(--tx-3)'; });
    stackBars($('pbAuthors'), Y, auth, perYear.map(p => p.affaires), { label: 'Affaires par type d’auteur' });
    $('pbAuthorsLegend').innerHTML = auth.map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${show(p.values[last])}</b> en ${Y[last]}</span>`).join('');
    const pm = auth.find(a => /morale/.test(a.label));
    $('pbAuthorsNote').textContent = `Personnes morales (entreprises, associations, collectivités) : ${pm.values.map((v, i) => `${show(v)} en ${Y[i]}`).join(', ')}. Une affaire qui vise à la fois une personne physique et une personne morale compte dans les deux couleurs.`;

    if (ord && assim) {
      const a0 = assim.affaires[0], a1 = assim.affaires[last];
      $('pbWarn').innerHTML = `<strong>À noter.</strong> La hausse de ${first.year} à ${end.year} (${nf(first.affaires)} → ${nf(end.affaires)} affaires) tient surtout à un libellé, « corruption, infractions assimilées » (${show(a0)} affaires en ${Y[0]}, ${show(a1)} en ${Y[last]}), et va de pair avec les ordonnances pénales et CRPC (${show(ord.values[0])} → ${show(ord.values[last])}), procédures pénales simplifiées. Le fichier ne dit pas quelles qualifications composent ce libellé ; le chiffre ne permet pas, seul, de conclure à une hausse de la corruption.`;
    }

    /* Small multiples */
    let unit = 'affaires';
    const drawMultiples = () => {
      let family = '';
      $('pbMultiples').innerHTML = data.infractions.map(r => {
        const head = r.family !== family ? (family = r.family, `<h3 class="pb-family">${esc(r.family)}</h3>`) : '';
        return `${head}<article class="pb-card" title="Libellé du fichier : ${esc(r.code)}"><h4>${esc(r.label)}</h4>${miniBars(r[unit], Y)}</article>`;
      }).join('');
    };
    drawMultiples();
    $('pbUnit').addEventListener('click', event => {
      const b = event.target.closest('[data-unit]'); if (!b) return;
      unit = b.dataset.unit;
      $('pbUnit').querySelectorAll('button').forEach(n => n.classList.toggle('active', n === b));
      drawMultiples();
    });
    $('pbMultiplesNote').innerHTML = `Chaque case a sa propre échelle : comparer les hauteurs d’une case à l’autre n’a pas de sens, lisez les nombres. Cadre en pointillé : effectif masqué par le producteur, compris entre 1 et 4. « n.d. » : masqué pour empêcher de retrouver une case voisine par différence. « – » : aucune ligne publiée. Libellés lisibles à partir de la typologie du fichier (colonne « libelle_afa ») : APE, agent public étranger ; DFP, détournement de fonds publics ; AAP, atteinte à la probité.`;

    /* Decisions */
    const DEC = ['Condamnation', 'Relaxe', 'Autre issue'];
    const drawDec = year => {
      const i = yi(year);
      const rows = data.infractions.map(r => {
        const v = DEC.map(k => r.decisions?.[k]?.affaires?.[i] ?? null);
        const sumOk = isNum(v[0]) && isNum(v[1]) && (isNum(v[2]) || v[2] == null);
        const share = sumOk ? v[1] / (v[0] + v[1] + (v[2] || 0)) : null;
        return `<tr><td>${esc(r.label)}<span class="muted pb-code"> ${esc(r.code)}</span></td>${v.map(x => `<td class="num">${show(x)}</td>`).join('')}<td class="num">${share == null ? '<span class="muted">non calculable</span>' : `${nf(Math.round(share * 100))} %`}</td></tr>`;
      }).join('');
      $('pbDecTable').innerHTML = `<table class="data-table"><thead><tr><th>Infraction (${year})</th><th class="num">Condamnation</th><th class="num">Relaxe</th><th class="num">Autre issue</th><th class="num">Part des relaxes</th></tr></thead><tbody>${rows}</tbody></table>`;
    };
    chips($('pbDecYears'), Y, Y[last], drawDec);
    drawDec(Y[last]);
    $('pbDecNote').textContent = `Nombre d’affaires selon l’issue de la décision pour l’infraction. Part des relaxes : relaxes rapportées à l’ensemble des issues, calculée seulement quand aucune des trois cases n’est masquée (« – » compté comme zéro). Une affaire peut aboutir à une condamnation pour une infraction et à une relaxe pour une autre, ou pour un prévenu et pas pour l’autre.`;

    /* Penalties */
    const P = data.penaltiesDetail;
    const find = (cat, sub, mod) => P.find(p => p.category === cat && p.sub === sub && (!mod || p.modalite === mod));
    const MOD = { 'Ferme': 'ferme', 'Partie ferme': 'en partie ferme', 'Sursis total': 'avec sursis total', 'Aménagement': 'aménagée' };
    const drawPen = year => {
      const i = yi(year), cat = data.penalties;
      $('pbPenKpis').innerHTML = [['Prison', 'Prison'], ['Amende', 'Amende'], ['Peine complémentaire', 'Peine complémentaire']].map(([k, label]) => [label, show(cat[k]?.affaires[i]), `affaires ${year}`])
        .concat([['Inéligibilité', show(find('Peine complémentaire', 'Inéligibilité')?.affaires[i]), `affaires ${year}`]])
        .map(([label, value, sub]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join('');
      $('pbPrisonTitle').textContent = `Prison et amende : ferme ou avec sursis, ${year}`;
      hbars($('pbPrison'), ['Ferme', 'Partie ferme', 'Sursis total', 'Aménagement'].map(m => ({ label: `Prison ${MOD[m]}`, value: find('Prison', 'Prison', m)?.affaires[i] ?? null }))
        .concat(['Ferme', 'Partie ferme', 'Sursis total'].map(m => ({ label: `Amende ${MOD[m]}`, value: find('Amende', 'Amende', m)?.affaires[i] ?? null })))
        .concat([{ label: 'Jours-amende', value: find('Amende', 'Jours-amende')?.affaires[i] ?? null }]));
      $('pbComplTitle').textContent = `Peines complémentaires, ${year}`;
      hbars($('pbCompl'), P.filter(p => p.category === 'Peine complémentaire').map(p => ({ label: p.sub, value: p.affaires[i] })).sort((a, b) => (isNum(b.value) ? b.value : 0) - (isNum(a.value) ? a.value : 0))
        .concat(P.filter(p => p.category === 'Autre peine ou mesure').map(p => ({ label: p.sub, value: p.affaires[i], sub: 'Autre peine ou mesure' }))));
    };
    chips($('pbPenYears'), Y, Y[last], drawPen);
    drawPen(Y[last]);
    const fermeShare = i => { const f = find('Prison', 'Prison', 'Ferme')?.affaires[i], p = find('Prison', 'Prison', 'Partie ferme')?.affaires[i], s = find('Prison', 'Prison', 'Sursis total')?.affaires[i]; return isNum(f) && isNum(p) && isNum(s) ? { f, p, s } : null; };
    const fs = fermeShare(last);
    $('pbPrisonNote').textContent = `Nombre d’affaires où une peine de ce type a été prononcée.${fs ? ` En ${Y[last]}, la prison avec sursis total (${nf(fs.s)} affaires) est bien plus fréquente que la prison ferme (${nf(fs.f)}) ou en partie ferme (${nf(fs.p)}).` : ''} La durée des peines et le montant des amendes ne sont pas publiés.`;
    $('pbComplNote').textContent = 'L’inéligibilité, l’interdiction d’exercer une fonction publique et l’exclusion des marchés publics sont les peines propres aux atteintes à la probité. Leur durée n’est pas publiée.';
    const cats = Object.keys(data.penalties);
    $('pbPenTable').innerHTML = `<table class="data-table"><thead><tr><th>Catégorie de peine</th>${Y.map(y => `<th class="num">${y}</th>`).join('')}</tr></thead><tbody>${cats.map(k => `<tr><td>${esc(k)}</td>${data.penalties[k].affaires.map(v => `<td class="num">${show(v)}</td>`).join('')}</tr>`).join('')}<tr><td><strong>Affaires jugées</strong></td>${perYear.map(p => `<td class="num"><strong>${nf(p.affaires)}</strong></td>`).join('')}</tr></tbody></table>`;
    $('pbPenNote').innerHTML = `Situation sur ${Y[0]}–${Y[last]} : ${data.situation.map(s => `${esc(clean(s.label))} : ${show(s.affaires)}`).join(' ; ')} (affaires ; une affaire à plusieurs prévenus peut figurer dans plusieurs situations, d’où un total de ${nf(c.sumSituationAffaires)} pour ${nf(c.periodAffaires)} affaires). « PHAROS » est le nom de la base de données citée par le fichier.`;

    const s = data.source;
    const mod = s.modified ? new Date(s.modified).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    $('pbSources').innerHTML = [link(s.page, `Source : ${s.title} (data.economie.gouv.fr${mod ? `, mis à jour le ${mod}` : ''})`), link(s.url, `Fichier CSV (${nf(s.rows)} lignes)`)].join('');
  }

  load('./data/probite.json').then(init).then(() => FRL.keepHash()).catch(error => {
    console.error(error);
    $('pbKpis').innerHTML = '<p class="note">Données indisponibles. Le site doit être servi par HTTP.</p>';
  });
})();
