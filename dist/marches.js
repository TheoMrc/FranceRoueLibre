/* Marchés publics (DECP): volume, competition, buyers. */
(() => {
  const { money, count, pct, esc, load, sirenLink, bars, ranking, resolveNames } = FRL;
  const $ = id => document.getElementById(id);
  let buyers = null;

  function buyerCell(siren, name) {
    return name ? sirenLink(siren, name) : `<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/${esc(siren)}" target="_blank" rel="noopener noreferrer" data-siren-name="${esc(siren)}">${esc(siren)}</a>`;
  }

  function renderBuyers() {
    const query = $('mpSearch').value.trim().toLowerCase();
    const rows = buyers.rows.filter(([siren, name]) => !query || siren.includes(query) || (name || '').toLowerCase().includes(query)).slice(0, 80);
    $('mpBuyerTable').innerHTML = `<table class="data-table"><thead><tr><th>Acheteur</th><th class="num">Marchés</th><th class="num">Montant (hors accords-cadres)</th><th class="num">Offres en moyenne</th><th class="num">Offre unique</th><th class="num">Part du 1er titulaire</th></tr></thead><tbody>${rows.map(([siren, name, n, amount, avgBids, single, topSupplier, topShare]) =>
      `<tr><td>${buyerCell(siren, name)}</td><td class="num">${count(n)}</td><td class="num">${money(amount)}</td><td class="num">${avgBids ? avgBids.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '—'}</td><td class="num">${pct(single, 0)}</td><td class="num">${topSupplier ? `<a href="https://annuaire-entreprises.data.gouv.fr/etablissement/${esc(topSupplier)}" target="_blank" rel="noopener noreferrer" title="Titulaire ${esc(topSupplier)}">${pct(topShare, 0)}</a>` : '—'}</td></tr>`).join('') || '<tr><td colspan="6">Aucun acheteur</td></tr>'}</tbody></table>`;
    resolveNames($('mpBuyerTable'));
  }

  async function init() {
    let summary;
    try { summary = await load('./data/marches/summary.json'); }
    catch (error) { $('mpKpis').innerHTML = '<p class="note">Les données de la commande publique (DECP) sont en cours d’intégration.</p>'; return; }
    const F = Object.fromEntries((summary.perYearFields || []).map((name, i) => [name, i]));
    const years = summary.perYear.filter(row => row[0] >= 2019);
    const total = years.reduce((s, r) => s + (r[F.amountContracts] || 0), 0);
    const contracts = years.reduce((s, r) => s + (r[F.contracts] || 0), 0);
    const single = years.reduce((s, r) => s + (r[F.singleBid] || 0), 0);
    const bidsKnown = summary.bidsDistribution.reduce((s, r) => s + r[1], 0);
    const q = summary.quality;
    $('mpKpis').innerHTML = [
      ['Marchés publiés (2019+)', count(contracts), `${money(total)} hors accords-cadres`],
      ['Plafonds d’accords-cadres', money(years.reduce((s, r) => s + (r[F.ceilingFrameworks] || 0), 0)), `${count(years.reduce((s, r) => s + (r[F.frameworks] || 0), 0))} accords-cadres (montants maximums)`],
      ['Une seule offre reçue', pct(bidsKnown ? single / bidsKnown : null, 0), 'des marchés où le nombre d’offres est renseigné', true],
      ['Lignes écartées', count(q.implausible), `montants aberrants ou plafonds fictifs sur ${count(q.unique)}`]
    ].map(([label, value, sub, alert]) => `<div class="kpi${alert ? ' is-alert' : ''}"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join('');
    bars($('mpYears'), years.map(r => ({ label: r[0], value: r[F.amountContracts] })));
    bars($('mpBids'), summary.bidsDistribution.map(([n, c]) => ({ label: n >= 10 ? '10+' : n, value: bidsKnown ? c / bidsKnown : 0, highlight: n === 1 })), { format: v => pct(v, 1) });
    ranking($('mpProcedures'), summary.byProcedure.filter(r => r[0]).map(([label, n, amount, avg]) => ({ label, value: amount, sub: `${count(n)} marchés${avg ? ` · ${avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} offres en moyenne` : ''}` })), { limit: 10 });
    bars($('mpBands'), summary.amountBands.map(([band, n]) => ({ label: `${Math.round(band / 1000)} k€`, value: n, highlight: [35000, 85000, 215000].includes(band) })), { format: count, height: 200 });
    $('mpQuality').textContent = `Qualité : ${count(q.raw)} lignes brutes, ${count(q.unique)} marchés après dédoublonnage, ${count(q.noBidCount)} sans nombre d’offres, ${count(q.implausible)} montants écartés. Source : ${summary.source}.`;
    buyers = await load('./data/marches/buyers.json');
    $('mpSearch').addEventListener('input', () => { clearTimeout(window.__mpTimer); window.__mpTimer = setTimeout(renderBuyers, 180); });
    renderBuyers();
  }
  init().finally(() => FRL.keepHash());
})();
