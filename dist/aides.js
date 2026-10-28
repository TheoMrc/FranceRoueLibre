/* Aides et subventions: State grants to associations (annexes jaunes), de minimis aid, Fonds vert. */
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
      ['Instrument principal', esc(data.byInstrument[0]?.[0] || '—'), money(data.byInstrument[0]?.[2])]
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

  lazy($('associations'), initAsso);
  lazy($('entreprises'), initEntreprises);
  lazy($('fondsvert'), initFondsVert);
})();
