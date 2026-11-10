/* Aides et subventions: State grants to associations (annexes jaunes), grants published by local authorities, de minimis aid, Fonds vert, plan de relance. */
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
      $('assoTable').innerHTML = `<table class="data-table"><thead><tr><th>Bénéficiaire</th><th>Dép.</th><th>Années subventionnées</th><th class="num">Total toutes années</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="4">Aucun résultat dans les subventions de l’État. Les subventions des régions, départements et communes sont dans la section suivante : <a href="#collectivites">chercher dans les subventions des collectivités</a>.</td></tr>'}</tbody></table>`;
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

  /* ---- Subventions des collectivités (SCDL files harvested on data.gouv.fr, scripts/subventions-collectivites.py) ---- */
  async function initCollectivites() {
    let col;
    try { col = await load('./data/aides/collectivites.json'); }
    catch (error) { $('collectivites').hidden = true; return; }
    let colIndex = null;
    const T = col.totals, C = col.coverage, limit = col.threshold;
    const plural = (n, word) => `${count(n)} ${word}${n > 1 ? 's' : ''}`;
    const state = row => !row.published ? (row.deadLink || row.otherFormat ? 'dead' : 'none') : row.underThreshold > 0 ? 'all' : 'min';
    const describe = row => row.published
      ? `${row.name} : ${plural(row.lines, 'ligne')}, ${money(row.amount)}, ${row.years.length ? `conventions de ${row.years[0]}${row.years.length > 1 ? ' à ' + row.years[row.years.length - 1] : ''}` : 'années non renseignées'}, plus petite subvention publiée ${money(row.min)}`
      : row.otherFormat ? `${row.name} : un fichier de subventions existe sur data.gouv.fr, mais pas avec les colonnes du modèle national`
        : row.deadLink ? `${row.name} : un fichier de subventions est annoncé sur data.gouv.fr, mais son lien ne répond plus`
        : `${row.name} : aucun fichier de subventions au format national trouvé sur data.gouv.fr`;
    const missingReg = col.regions.filter(r => !r.published), missingDep = col.departments.filter(r => !r.published);
    const unusable = rows => rows.filter(r => !r.published && (r.deadLink || r.otherFormat));
    $('colKpis').innerHTML = [
      ['Subventions publiées', money(T.amount), `${plural(T.lines, 'ligne')}, toutes années`],
      ['Attribuants', count(T.givers), `dont ${count(C.communes)} communes et ${count(C.groupements)} groupements`],
      ['Régions qui publient', `${C.regions[0]} sur ${C.regions[1]}`, missingReg.length ? `rien pour ${missingReg.length} région${missingReg.length > 1 ? 's' : ''}` : 'toutes', missingReg.length > 0],
      ['Départements qui publient', `${C.departments[0]} sur ${C.departments[1]}`, `rien pour ${missingDep.length} département${missingDep.length > 1 ? 's' : ''}`, missingDep.length > 0]
    ].map(([label, value, sub, alert]) => `<div class="kpi${alert ? ' is-alert' : ''}"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join('');
    $('colRegions').innerHTML = col.regions.map(r => `<span class="col-cell is-${state(r)}" title="${esc(describe(r))}"><b>${esc(r.name)}</b>${r.published ? `<small>${count(r.lines)} lignes</small>` : '<small>rien</small>'}</span>`).join('');
    $('colRegNote').textContent = `${missingReg.length ? `Aucun fichier lisible sur data.gouv.fr pour : ${missingReg.map(r => r.name).join(', ')}${unusable(col.regions).length ? ` (fichier annoncé mais inutilisable pour ${unusable(col.regions).map(r => r.name).join(', ')})` : ''}. Une région peut publier sur son propre portail sans le signaler sur data.gouv.fr : ce site ne lit que le portail national. ` : ''}Vert : la région publie aussi des subventions inférieures à ${count(limit)} €. Orange : seulement celles que le décret impose. Survolez une case pour le détail.`;
    $('colDeps').innerHTML = col.departments.map(r => `<span class="col-cell is-${state(r)}" title="${esc(describe(r))}">${esc(r.code)}</span>`).join('');
    $('colDepNote').textContent = `Chaque case est un département (numéro). ${count(missingDep.length)} sur ${col.departments.length} n’ont aucun fichier de subventions lisible au format national sur data.gouv.fr${unusable(col.departments).length ? `, dont ${unusable(col.departments).length} avec un fichier annoncé mais inutilisable (lien mort ou autre format : ${unusable(col.departments).map(r => r.code).join(', ')})` : ''}. Une case grise ne dit pas que le département ne subventionne personne : elle dit que la liste n’est pas publiée là où elle devrait l’être, ou pas dans un format lisible par une machine.`;
    const years = col.perYear.filter(y => y.year);
    bars($('colBars'), years.map(y => ({ label: y.year, value: y.amount })));
    const noYear = col.perYear.find(y => !y.year);
    $('colBarsNote').textContent = `Ce graphique ne mesure pas les subventions versées en France : il mesure ce qui est publié. Une année monte quand davantage de collectivités publient.${noYear ? ` ${plural(noYear.lines, 'ligne')} (${money(noYear.amount)}) n’ont pas de date de convention lisible.` : ''}`;
    ranking($('colTypes'), col.types.map(t => ({ label: t.label, value: t.amount, sub: `${plural(t.givers, 'attribuant')} · ${plural(t.lines, 'ligne')}` })), { limit: 8 });
    $('colTypesNote').textContent = `${count(col.files.read)} fichiers lus sur ${count(col.files.csv)} trouvés (${count(col.files.otherFormats)} dans un autre format que le modèle national, ${count(col.files.unreachable + col.files.unreadable)} inaccessibles ou illisibles). ${count(col.quality.republished)} lignes publiées deux fois ne sont comptées qu’une fois ; ${count(col.quality.stateServices)} lignes de préfectures et services de l’État, déjà dans les subventions de l’État ci-dessus, sont écartées. Données téléchargées le ${col.downloaded.split('-').reverse().join('/')}.`;

    const top = () => `<table class="data-table"><thead><tr><th>Attribuant</th><th>Type</th><th>Années</th><th class="num">Lignes</th><th class="num">Plus petite</th><th class="num">Montant publié</th></tr></thead><tbody>${col.givers.slice(0, 40).map(g =>
      `<tr><td>${g.pages[0] ? `<a href="${esc(g.pages[0])}" target="_blank" rel="noopener noreferrer">${esc(g.name)}</a>` : esc(g.name)}</td><td class="muted">${esc((col.types.find(t => t.type === g.type) || {}).label || '')}</td><td class="muted">${g.years.length ? `${g.years[0]}${g.years.length > 1 ? '–' + g.years[g.years.length - 1] : ''}` : '–'}</td><td class="num">${count(g.lines)}</td><td class="num">${g.min != null ? money(g.min) : '–'}</td><td class="num">${money(g.amount)}</td></tr>`).join('')}</tbody></table>`;
    function renderCol() {
      const query = $('colSearch').value.trim().toLowerCase();
      if (!query || !colIndex) {
        $('colTable').innerHTML = top();
        $('colTableNote').textContent = 'Sans recherche : les quarante attribuants qui publient les plus gros montants, avec un lien vers leur jeu de données. « Plus petite » est la plus petite subvention de leurs fichiers : au-dessus de 23 000 €, la collectivité ne publie que le minimum légal.';
        return;
      }
      const words = query.split(/\s+/);
      const rows = colIndex.rows.filter(([siren, name]) => siren.includes(query) || words.every(w => (name || '').toLowerCase().includes(w))).slice(0, 100);
      if (rows.length) {
        $('colTable').innerHTML = `<table class="data-table"><thead><tr><th>Bénéficiaire</th><th>Années</th><th class="num">Attribuants</th><th class="num">Lignes</th><th class="num">Total publié</th><th></th></tr></thead><tbody>${rows.map(([siren, name, total, yrs, givers, lines]) =>
          `<tr><td>${sirenLink(siren, name)}</td><td class="muted">${yrs.join(', ')}</td><td class="num">${count(givers)}</td><td class="num">${count(lines)}</td><td class="num">${money(total)}</td><td><a href="recherche.html?q=${encodeURIComponent(siren)}">Voir les lignes</a></td></tr>`).join('')}</tbody></table>`;
        $('colTableNote').textContent = 'Total des lignes publiées par les collectivités pour ce SIREN, toutes années. Ce n’est pas forcément tout ce que le bénéficiaire a reçu : voir plus bas qui ne publie pas.';
        return;
      }
      $('colTable').innerHTML = `<div class="col-empty"><strong>Aucune ligne pour « ${esc($('colSearch').value.trim())} ».</strong> Cela ne veut pas dire que ce bénéficiaire n’a rien reçu. Trois raisons possibles :<ul>
        <li>la collectivité qui l’a subventionné ne publie rien : c’est le cas de ${missingReg.length} région${missingReg.length > 1 ? 's' : ''} sur ${col.regions.length}${missingReg.length ? ` (${esc(missingReg.map(r => r.name).join(', '))})` : ''} et de ${missingDep.length} départements sur ${col.departments.length} ;</li>
        <li>la subvention est inférieure à ${count(limit)} € : sous ce seuil, la publication n’est pas obligatoire, et la plupart des collectivités s’arrêtent au minimum ;</li>
        <li>elle vient d’une commune : seules ${count(C.communes)} communes sur près de 35 000 publient un fichier.</li></ul>
        Toute personne peut demander la liste à la collectivité : c’est un document administratif communicable. <a href="demandes.html">Voir les demandes aux instances publiques</a>.</div>`;
      $('colTableNote').textContent = '';
    }
    let timer = 0;
    $('colSearch').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!colIndex && $('colSearch').value.trim()) { $('colTable').innerHTML = '<p class="note">Chargement de l’index des bénéficiaires…</p>'; colIndex = await load('./data/aides/collectivites-index.json').catch(() => ({ rows: [] })); }
        renderCol();
      }, 200);
    });
    renderCol();
    $('colGaps').innerHTML = [
      ['none', 'Sous 23 000 €, le trou est la règle', `Le décret du 5 mai 2017 n’impose la publication qu’à partir de ${count(limit)} € par an et par bénéficiaire. Une association qui reçoit quelques milliers d’euros de sa région ou de sa commune n’apparaît donc nulle part, sauf si la collectivité choisit d’aller plus loin que la loi.`],
      ['partial', 'Pas de fichier national', 'Les subventions de l’État ont une annexe au budget. Celles des collectivités n’ont rien d’équivalent : il faut ramasser un par un les fichiers de chaque région, département, intercommunalité et commune, quand ils existent.'],
      ['partial', 'Un modèle national peu suivi', `Sur ${count(col.files.csv)} fichiers de subventions trouvés sur data.gouv.fr, ${count(col.files.otherFormats)} n’ont pas les colonnes du modèle national et ne peuvent pas être additionnés aux autres sans les réécrire à la main, ce que ce site ne fait pas.`],
      ['partial', `${count(T.withoutSiren)} lignes sans SIRET`, `Sans identifiant, impossible de savoir si deux lignes concernent le même bénéficiaire, ni de le retrouver dans l’annuaire des entreprises. ${count(T.withoutYear)} lignes n’ont pas non plus de date lisible.`]
    ].map(([st, title, text]) => `<article class="gap"><span class="gap__state ${st}">${st === 'none' ? 'Aucune donnée ouverte' : 'Données partielles'}</span><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`).join('');
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
  lazy($('collectivites'), initCollectivites);
  lazy($('entreprises'), initEntreprises);
  lazy($('fondsvert'), initFondsVert);
  lazy($('relance'), initRelance);
})();
