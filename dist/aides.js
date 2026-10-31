/* Aides et subventions: State grants to associations (annexes jaunes), de minimis aid, Fonds vert, plan de relance. */
(() => {
  const { money, count, pct, esc, load, sirenLink, bars, ranking, lazy } = FRL;
  const $ = id => document.getElementById(id);

  /* ---- Associations ---- */
  let asso = null, index = null, year = null;

  function programmeName(code) {
    const label = asso.programmeLabels?.[code];
    return label ? `${code} · ${label}` : `Programme ${code}`;
  }

  function renderAsso() {
    const row = asso.perYear.find(item => item.year === year);
    $('assoYears').querySelectorAll('button').forEach(button => button.classList.toggle('active', Number(button.dataset.year) === year));
    $('assoKpis').innerHTML = [
      ['Montant versé', money(row.amount), `subventions ${year} (PLF ${row.year + 2})`],
      ['Lignes de subvention', count(row.lines), `${count(row.beneficiaries)} bénéficiaires distincts`],
      ['Sans SIREN exploitable', money(row.amountWithoutSiren), `${count(row.withoutSiren)} lignes non traçables`, row.amountWithoutSiren > 0],
      ['Établissement fermé (Sirene)', money(row.amountClosed), `${count(row.closed)} lignes · voir Signaux`, row.amountClosed > 0]
    ].map(([label, value, sub, alert]) => `<div class="kpi${alert ? ' is-alert' : ''}"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join('');
    bars($('assoBars'), asso.perYear.map(item => ({ label: item.year, value: item.amount, highlight: item.year === year })), { onSelect: selected => { year = Number(selected); renderAsso(); } });
    $('assoBarsNote').textContent = `Années disponibles : ${asso.years.join(', ')}. Les annexes ne sont pas publiées pour toutes les années en données ouvertes, et leur périmètre change d’une édition à l’autre : l’édition 2011 (PLF 2013) totalise un montant bien supérieur aux autres sans que la source en documente la raison. Comparer les années demande donc de la prudence.`;
    const programmes = (asso.programmes[String(year)] || []).map(([code, amount, lines]) => ({ label: programmeName(code), value: amount, sub: `${count(lines)} subventions${asso.programmeMissions?.[code] ? ' · ' + asso.programmeMissions[code] : ''}` }));
    ranking($('assoProgrammes'), programmes, { limit: 14 });
    renderAssoTable();
  }

  function renderAssoTable() {
    const query = $('assoSearch').value.trim().toLowerCase();
    let rows;
    if (query && index) {
      rows = index.rows.filter(([siren, name]) => siren.includes(query) || (name || '').toLowerCase().includes(query)).slice(0, 100)
        .map(([siren, name, total, years, dept]) => `<tr><td>${sirenLink(siren, name)}</td><td class="muted">${esc(dept || '')}</td><td class="muted">${years.join(', ')}</td><td class="num">${money(total)}</td></tr>`);
      $('assoTable').innerHTML = `<table class="data-table"><thead><tr><th>Bénéficiaire</th><th>Dép.</th><th>Années subventionnées</th><th class="num">Total toutes années</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="4">Aucun résultat</td></tr>'}</tbody></table>`;
      return;
    }
    rows = (asso.top[String(year)] || []).slice(0, 60).map(([siren, name, amount, lines, dept, city]) =>
      `<tr><td>${sirenLink(siren, name)}</td><td class="muted">${esc(city || '')}${dept ? ` (${esc(dept)})` : ''}</td><td class="num">${count(lines)}</td><td class="num">${money(amount)}</td></tr>`);
    $('assoTable').innerHTML = `<table class="data-table"><thead><tr><th>Bénéficiaire (${year})</th><th>Commune</th><th class="num">Lignes</th><th class="num">Montant</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  async function initAsso() {
    try { asso = await load('./data/aides/associations.json'); }
    catch (error) { $('assoKpis').innerHTML = '<p class="note">Données des annexes « jaunes » pas encore intégrées.</p>'; return; }
    year = asso.years[asso.years.length - 1];
    $('assoYears').innerHTML = asso.years.map(y => `<button type="button" data-year="${y}">${y}</button>`).join('');
    $('assoYears').addEventListener('click', event => { const b = event.target.closest('[data-year]'); if (b) { year = Number(b.dataset.year); renderAsso(); } });
    let timer = 0;
    $('assoSearch').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!index && $('assoSearch').value.trim()) { $('assoTable').innerHTML = '<p class="note">Chargement de l’index des bénéficiaires…</p>'; index = await load('./data/aides/associations-index.json').catch(() => ({ rows: [] })); }
        renderAssoTable();
      }, 200);
    });
    renderAsso();
  }

  /* ---- De minimis ---- */
  async function initEntreprises() {
    let data;
    try { data = await load('./data/aides/entreprises.json'); }
    catch (error) { $('entKpis').innerHTML = '<p class="note">Données de minimis pas encore intégrées.</p>'; return; }
    const total = data.perYear.reduce((s, r) => s + (r[2] || 0), 0);
    const lines = data.perYear.reduce((s, r) => s + (r[1] || 0), 0);
    const last = data.perYear.filter(r => r[0]).at(-1);
    $('entKpis').innerHTML = [
      ['Montant déclaré (équivalent-subvention)', money(total), `${count(lines)} aides`],
      [`Année ${last?.[0] ?? ''}`, money(last?.[2]), `${count(last?.[1])} aides · ${count(last?.[3])} bénéficiaires`],
      ['Instrument principal', esc(data.byInstrument[0]?.[0] || '–'), money(data.byInstrument[0]?.[2])]
    ].map(([label, value, sub]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join('');
    ranking($('entAuthorities'), data.byAuthority.map(([label, n, amount]) => ({ label: label || 'Non renseigné', value: amount, sub: `${count(n)} aides` })), { limit: 12 });
    ranking($('entTop'), data.top.map(([id, name, amount, n, city]) => ({ label: name, html: sirenLink(id, name), value: amount, sub: `${count(n)} aide(s)${city ? ' · ' + city : ''}` })), { limit: 12 });
  }

  /* ---- Fonds vert ---- */
  async function initFondsVert() {
    try {
      const data = await load('./data/aides/fonds-vert.json');
      $('fvContent').innerHTML = `<div class="kpis">${data.perYear.map(([y, n, amount]) => `<div class="kpi"><span>${y}</span><strong>${money(amount)}</strong><small>${count(n)} projets</small></div>`).join('')}</div><div id="fvMeasures"></div>`;
      ranking($('fvMeasures'), data.byMeasure.map(([label, n, amount]) => ({ label, value: amount, sub: `${count(n)} projets` })), { limit: 14 });
      $('fvContent').insertAdjacentHTML('beforeend', `<h3 style="margin-top:1.5rem">Projets les plus subventionnés</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Année</th><th>Bénéficiaire</th><th>Projet</th><th>Mesure</th><th class="num">Montant</th></tr></thead><tbody>${data.topProjects.slice(0, 30).map(([y, siren, name, project, measure, amount]) => `<tr><td>${y}</td><td>${sirenLink(siren, name)}</td><td class="muted">${esc(project || '')}</td><td class="muted">${esc(measure || '')}</td><td class="num">${money(amount)}</td></tr>`).join('')}</tbody></table></div>${data.programme113?.length ? `<p class="note">Fichiers « programme 113 » (biodiversité) publiés à part : ${data.programme113.map(([y, n, a]) => `${y} : ${money(a)} (${count(n)} projets)`).join(' · ')}.</p>` : ''}`);
    } catch (error) {
      $('fvContent').innerHTML = '<p class="note">Les fichiers du Fonds vert (2023–2025) sont dans la liste de téléchargement ; leur intégration détaillée suivra leur réception.</p>';
    }
  }

  /* ---- Plan de relance (data/aides/relance.json, scripts/relance-data.py) ---- */
  async function initRelance() {
    let data;
    try { data = await load('./data/aides/relance.json'); }
    catch (error) { $('relKpis').innerHTML = '<p class="note">Données du plan de relance pas encore intégrées.</p>'; return; }
    const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const month = ym => { const [y, m] = String(ym).split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };
    const NATURE = { aide: 'aide versée', 'aide-validee': 'aide validée, pas forcément versée', fiscal: 'baisse d’impôt estimée', projet: 'coût des projets ou investissement déclaré' };
    const byId = Object.fromEntries(data.indicators.map(i => [i.id, i]));
    const deptName = code => data.deptNames[code] || (code === '' ? 'Non renseigné' : code);
    const perHab = (v, p) => p ? v / p : null;
    const euro = v => v == null ? '–' : `${count(Math.round(v))} €`;
    const kpi = (label, value, sub, alert) => `<div class="kpi${alert ? ' is-alert' : ''}"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;

    const bip = byId.BIP2, mpr = byId.MPR1;
    $('relKpis').innerHTML = [
      kpi('Mesures suivies', count(data.measures), `${count(data.indicatorsCount)} indicateurs, ${month(data.dates[0])} – ${month(data.dates[1])}`),
      bip ? kpi('Baisse des impôts de production', money(bip.total), `montant estimé, ${month(bip.lastDate)}`) : '',
      mpr ? kpi('MaPrimeRénov’ : primes payées', money(mpr.total), `cumul à fin ${month(mpr.lastDate)}`) : '',
      kpi('Entreprises lauréates', count(data.laureates.count), 'appels à projets industriels, sans montant publié', true)
    ].join('');

    const row = i => ({ label: `${i.measure}`, value: i.total, sub: `${i.label} · ${NATURE[i.nature]} · ${month(i.lastDate)}` });
    const aid = data.indicators.filter(i => i.nature !== 'projet').map(row)
      .concat(data.nationalEuros.filter(n => /attribués/.test(n.label)).map(n => ({ label: n.measure, value: n.value, sub: `${n.label} · national · ${month(n.date)}` })))
      .sort((a, b) => b.value - a.value);
    ranking($('relAid'), aid, { limit: 10 });
    $('relAidNote').textContent = 'Dernière valeur cumulée publiée par le tableau de bord, somme des départements (y compris « Étranger » et collectivités d’outre-mer quand ils figurent). La baisse des impôts de production est un manque à gagner estimé, pas une dépense. Le tableau de bord ne publie pas de total national pour ces indicateurs : aucun total officiel à confronter.';
    const projects = data.indicators.filter(i => i.nature === 'projet').map(row)
      .concat(data.nationalEuros.filter(n => !/attribués/.test(n.label)).map(n => ({ label: n.measure, value: n.value, sub: `${n.label} · national · ${month(n.date)}` })))
      .sort((a, b) => b.value - a.value);
    ranking($('relProjects'), projects, { limit: 12 });
    $('relProjectsNote').textContent = `Montants des projets aidés ou de l’investissement que les bénéficiaires déclarent avoir engagé grâce à l’aide : ce n’est pas l’argent public versé, qui n’est pas publié pour ces mesures. Les fonds labellisés « Relance » sont des fonds d’investissement privés. Indicateurs nationaux nommés « montant » sans unité indiquée, non repris ici : ${data.nationalUnknownUnit.map(n => `${n.id} (${count(n.value)})`).join(', ')}.`;

    /* One indicator: series and departments */
    const pick = $('relPick');
    pick.innerHTML = data.indicators.map(i => `<option value="${i.id}">${esc(i.measure)} : ${esc(i.label.toLowerCase())}</option>`).join('');
    pick.value = byId.MPR1 ? 'MPR1' : data.indicators[0].id;
    let unit = 'total';
    const drawPick = () => {
      const ind = byId[pick.value];
      const withPop = ind.depts.filter(([, , p]) => p);
      $('relPickTitle').textContent = ind.measure;
      $('relPickKpis').innerHTML = [
        kpi(ind.label, money(ind.total), `${NATURE[ind.nature]} · cumul à fin ${month(ind.lastDate)}`),
        kpi('Volet du plan', esc(ind.volet || '–'), esc(ind.ministry || '')),
        kpi('Départements avec un montant', count(ind.depts.filter(d => d[1] > 0).length), `sur ${count(ind.depts.length)} territoires publiés`)
      ].join('');
      bars($('relSeries'), ind.series.map(([ym, v]) => ({ label: month(ym), short: ym.endsWith('-01') ? ym.slice(0, 4) : '', value: v })), { height: 200 });
      const peak = ind.series.reduce((m, s) => s[1] > m[1] ? s : m, ind.series[0]);
      $('relSeriesNote').textContent = `De ${month(ind.series[0][0])} à ${month(ind.series.at(-1)[0])}.` + (ind.drops.length ? ` La série, censée être cumulée, chute en ${ind.drops.map(([ym, a, b]) => `${month(ym)} (${money(a)} → ${money(b)})`).join(', ')} ; le fichier ne l’explique pas. Le plus haut publié est ${money(peak[1])} (${month(peak[0])}) ; la valeur retenue ailleurs est la dernière publiée.` : '');
      const rows = (unit === 'hab' ? withPop.map(([c, v, p]) => ({ c, value: perHab(v, p), sub: `${money(v)} · ${count(p)} habitants` })) : ind.depts.map(([c, v, p]) => ({ c, value: v, sub: p ? `${euro(perHab(v, p))} par habitant` : 'population non disponible' })))
        .sort((a, b) => b.value - a.value).map(r => ({ label: `${deptName(r.c)}${/^\d|^2[AB]$/.test(r.c) ? ` (${r.c})` : ''}`, value: r.value, sub: r.sub }));
      $('relDeptTitle').textContent = `Départements, cumul à fin ${month(ind.lastDate)}`;
      ranking($('relDepts'), rows, { limit: 15, format: unit === 'hab' ? euro : money });
      $('relDeptsNote').textContent = `${unit === 'hab' ? `Par habitant : population municipale ${data.popYear} (Insee, via l’OFGL), pour les ${count(withPop.length)} départements où elle est disponible. ` : ''}Quinze premiers territoires sur ${count(ind.depts.length)}. Un montant rattaché à un département suit le lieu du bénéficiaire déclaré dans le tableau de bord.`;
    };
    pick.addEventListener('change', drawPick);
    $('relUnit').addEventListener('click', event => {
      const b = event.target.closest('[data-unit]'); if (!b) return;
      unit = b.dataset.unit;
      $('relUnit').querySelectorAll('button').forEach(n => n.classList.toggle('active', n === b));
      drawPick();
    });
    drawPick();

    /* Laureates (no amount published) */
    const L = data.laureates;
    ranking($('relLauMeasures'), L.byMeasure.map(([label, n]) => ({ label, value: n })), { limit: 10, format: count });
    $('relLauNote').textContent = `${count(L.count)} projets lauréats publiés entre ${new Date(L.updates[0]).toLocaleDateString('fr-FR')} et ${new Date(L.updates[1]).toLocaleDateString('fr-FR')}, dont ${L.byType.map(([t, n]) => `${count(n)} ${t}`).slice(0, 3).join(', ')}. Le fichier ne donne aucun montant d’aide.`;
    ranking($('relLauDepts'), L.byDept.map(([c, name, n, p]) => ({ label: `${name || deptName(c)}${c ? ` (${c})` : ''}`, value: n, sub: p ? `${(100000 * n / p).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} pour 100 000 habitants` : '' })), { limit: 10, format: count });
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const drawTable = () => {
      const q = norm($('relSearch').value.trim());
      const hits = (q ? L.rows.filter(r => norm(`${r[0]} ${r[1]} ${r[6]} ${L.filieres[r[4]]} ${deptName(r[2])}`).includes(q)) : L.rows.filter(r => r[0])).slice(0, q ? 100 : 25);
      $('relTable').innerHTML = `<table class="data-table"><thead><tr><th>Entreprise${q ? '' : ' (25 premières par ordre alphabétique, cherchez pour voir les autres)'}</th><th>Commune</th><th>Mesure</th><th>Filière</th><th>Type</th></tr></thead><tbody>${hits.map(r => `<tr><td>${sirenLink(/^\d{9}$/.test(r[1]) ? r[1] : '', r[0])}</td><td class="muted">${esc(r[6])}${r[2] ? ` (${esc(r[2])})` : ''}</td><td class="muted">${esc(L.measures[r[3]])}</td><td class="muted">${esc(L.filieres[r[4]])}</td><td class="muted">${esc(L.types[r[5]])}</td></tr>`).join('') || '<tr><td colspan="5">Aucun résultat</td></tr>'}</tbody></table>`;
    };
    let timer = 0;
    $('relSearch').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(drawTable, 200); });
    drawTable();

    const ends = data.indicators.map(i => i.lastDate).sort();
    $('relStopText').textContent = `Selon les mesures, les séries s’arrêtent entre ${month(ends[0])} et ${month(ends.at(-1))}, et la liste des lauréats en ${month(L.updates[1].slice(0, 7))}. Aucun bilan final n’est publié dans ces jeux de données.`;
    const S = data.sources, linkTo = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
    $('relSources').innerHTML = [linkTo(S.dashboard.page, `Tableau de bord France Relance, données agrégées (data.economie.gouv.fr, ${count(S.dashboard.rows)} lignes)`), linkTo(S.laureates.page, 'Lauréats du plan de relance (data.economie.gouv.fr)'), linkTo(S.population.url, S.population.label)].join('');
  }

  lazy($('associations'), initAsso);
  lazy($('entreprises'), initEntreprises);
  lazy($('fondsvert'), initFondsVert);
  lazy($('relance'), initRelance);
})();
