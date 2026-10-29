/* Signaux à vérifier: transparent screening rules over procurement, subsidies and local accounts. */
(() => {
  const { money, count, pct, esc, load, sirenLink, resolveNames } = FRL;
  const $ = id => document.getElementById(id);
  const fmtDate = value => value ? new Date(value).toLocaleDateString('fr-FR') : '–';
  const days = value => value == null ? '–' : `${Math.round(value).toLocaleString('fr-FR')} j`;
  const years = value => value == null ? '–' : `${value.toLocaleString('fr-FR', { maximumFractionDigits: value < 100 ? 1 : 0 })} ans`;
  const buyer = (siren, name) => name ? sirenLink(siren, name) : `<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/${esc(siren)}" target="_blank" rel="noopener noreferrer" data-siren-name="${esc(siren)}">${esc(siren)}</a>`;
  const supplier = siret => siret ? `<a href="https://annuaire-entreprises.data.gouv.fr/etablissement/${esc(siret)}" target="_blank" rel="noopener noreferrer" data-siren-name="${esc(String(siret).slice(0, 9))}">${esc(siret)}</a>` : '–';
  const commune = (insee, name, dept) => `${esc(name || insee)} <span class="muted">${esc(dept || '')}</span>`;

  const contractColumns = [
    ['Acheteur', r => buyer(r[0], r[1])], ['Titulaire', r => supplier(r[2])], ['Montant', r => money(r[3]), 'num'], ['Notifié', r => fmtDate(r[4])],
    ['Procédure', r => `${esc(r[5] || '–')}${r[9] ? ' <span class="tag">accord-cadre</span>' : ''}`], ['Offres', r => r[7] ?? '–', 'num'], ['Objet', r => `<span class="muted clamp3" tabindex="0" title="${esc(r[8] || '')}">${esc(r[8] || '')}</span>`]
  ];

  const families = [];
  function add(family, id, title, why, count, rows, columns, extra = '') {
    families.push({ family, id, title, why, count, rows, columns, extra });
  }

  function table(rows, columns, limit) {
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${columns.map(([label, , cls]) => `<th${cls ? ` class="${cls}"` : ''}>${label}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, limit).map(row => `<tr>${columns.map(([, cell, cls]) => `<td${cls ? ` class="${cls}"` : ''}>${cell(row)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function render() {
    const groups = [...new Set(families.map(item => item.family))];
    $('signalIndex').innerHTML = families.map(item => `<a href="#sig-${item.id}">${esc(item.title)}<span>${count(item.count)}</span></a>`).join('');
    $('signalList').innerHTML = groups.map(group => `<h2 class="signal-family">${esc(group)}</h2>` + families.filter(item => item.family === group).map(item => `
      <article class="signal" id="sig-${item.id}">
        <div class="signal__head"><h3>${esc(item.title)}</h3><span class="signal__count">${count(item.count)} cas</span></div>
        <p class="signal__rule"><strong>Règle :</strong> ${esc(item.rule || '')}</p>
        <p class="signal__why">${item.why}</p>
        ${item.extra}
        ${item.rows.length ? table(item.rows, item.columns, 15) : '<p class="note">Aucun cas dans les données intégrées.</p>'}
        ${item.rows.length > 15 ? `<details><summary>Voir les ${Math.min(item.rows.length, 200)} premiers cas</summary>${table(item.rows, item.columns, 200)}</details>` : ''}
      </article>`).join('')).join('');
    resolveNames($('signalList'));
    $('signalList').addEventListener('toggle', event => resolveNames(event.target), true);
  }

  async function init() {
    const [marches, asso, local] = await Promise.all([
      load('./data/marches/signals.json').catch(() => null),
      load('./data/aides/associations.json').catch(() => null),
      load('./data/local/signals.json').catch(() => null)
    ]);
    if (marches) {
      const F = 'Commande publique';
      const s = marches;
      add(F, 'offre-unique', 'Une seule offre pour un gros marché', 'Une procédure ouverte qui n’attire qu’un candidat peut traduire un cahier des charges trop restrictif, un marché peu connu ou un secteur sans concurrence. À vérifier : nombre de retraits du dossier, critères, historique du titulaire.', s.singleBidLarge.rows.length, s.singleBidLarge.rows, contractColumns);
      families.at(-1).rule = s.singleBidLarge.rule;
      add(F, 'sans-publicite', 'Gros marchés sans publicité ni mise en concurrence', 'Ces procédures sont légales dans des cas limités (urgence impérieuse, exclusivité technique, marché infructueux). Le montant justifie de vérifier le motif invoqué.', s.noCompetition.rows.length, s.noCompetition.rows, contractColumns);
      families.at(-1).rule = s.noCompetition.rule;
      add(F, 'avenants', 'Avenants qui font fortement grimper le prix', 'Une hausse importante après attribution peut révéler une sous-estimation initiale ou un contournement de la mise en concurrence. Le droit encadre les modifications substantielles.', s.amendments.rows.length, s.amendments.rows, [...contractColumns.slice(0, 4), ['Après modification', r => money(r[10]), 'num'], ['Hausse', r => pct(r[10] / r[3] - 1, 0), 'num'], contractColumns[6]]);
      families.at(-1).rule = s.amendments.rule;
      const bunch = s.thresholdBunching.byThreshold.flatMap(t => t.rows.map(r => [...r, t.threshold, t.national]));
      add(F, 'seuils', 'Montants calés juste sous un seuil', 'Une accumulation de marchés juste sous un seuil de procédure (90 k€, 143 k€, 221 k€, 5,5 M€) peut indiquer un découpage ou un ajustement pour échapper à une procédure plus exigeante.', bunch.length, bunch, [['Acheteur', r => buyer(r[0], r[1])], ['Seuil', r => money(r[5]), 'num'], ['Juste sous le seuil', r => count(r[2]), 'num'], ['Juste au-dessus', r => count(r[3]), 'num'], ['Marchés de l’acheteur', r => count(r[4]), 'num']]);
      families.at(-1).rule = s.thresholdBunching.rule;
      add(F, 'fractionnement', 'Achats répétés au même fournisseur', 'Plusieurs petits marchés successifs avec le même titulaire, pour le même type d’achat, peuvent correspondre à un besoin unique fractionné. Ils peuvent aussi être légitimes (lots, besoins imprévisibles).', s.splitting.rows.length, s.splitting.rows, [['Acheteur', r => buyer(r[0], r[1])], ['Titulaire', r => supplier(r[2])], ['Famille CPV', r => esc(r[3])], ['Année', r => r[4]], ['Marchés', r => count(r[5]), 'num'], ['Total', r => money(r[6]), 'num']]);
      families.at(-1).rule = s.splitting.rule;
      add(F, 'concentration', 'Un titulaire capte l’essentiel des achats', 'Une forte dépendance à un seul fournisseur réduit la concurrence et accroît le risque de prix élevés. Elle peut s’expliquer par un contrat de concession ou un monopole technique.', s.supplierConcentration.rows.length, s.supplierConcentration.rows, [['Acheteur', r => buyer(r[0], r[1])], ['Marchés', r => count(r[2]), 'num'], ['Montant', r => money(r[3]), 'num'], ['Titulaire principal', r => supplier(r[6])], ['Part', r => pct(r[7], 0), 'num']]);
      families.at(-1).rule = s.supplierConcentration.rule;
      if (s.amendmentOutliers?.rows?.length) {
        add('Qualité des données', 'avenants-aberrants', 'Modifications de montant invraisemblables', 'Un marché dont le montant est multiplié par plus de 20 après attribution relève presque toujours d’une erreur de saisie (unité, séparateur décimal). Ces lignes sont exclues du signal « avenants » mais restent publiées telles quelles.', s.amendmentOutliers.rows.length, s.amendmentOutliers.rows, [...contractColumns.slice(0, 4), ['Après modification', r => money(r[10]), 'num'], contractColumns[6]]);
        families.at(-1).rule = s.amendmentOutliers.rule;
      }
      add('Qualité des données', 'montants-aberrants', 'Montants aberrants dans les données publiées', 'Des montants manifestement faux (1 €, plusieurs milliards, 999 999 999 €) faussent les totaux publics. Leur correction relève de l’acheteur qui les a déclarés.', s.implausibleAmounts.rows.length, s.implausibleAmounts.rows, contractColumns);
      families.at(-1).rule = s.implausibleAmounts.rule;
    }
    if (asso) {
      const F = 'Subventions';
      add(F, 'etablissement-ferme', 'Subventions à un établissement déclaré fermé', 'Le répertoire Sirene indique que l’établissement bénéficiaire était fermé avant l’année de la subvention. Souvent, l’association a simplement déménagé sans mise à jour du numéro dans les systèmes de l’État ; parfois, l’argent est versé à une structure qui n’existe plus. Le financement public des partis politiques (programme 232), fixé par la loi selon les voix et les sièges, est exclu de ce signal.', asso.closedBeneficiaries.length, asso.closedBeneficiaries, [['Année', r => r[0]], ['Bénéficiaire', r => sirenLink(r[1], r[2])], ['Fermé le', r => fmtDate(r[4])], ['Commune', r => esc(r[5] || '')], ['Programme', r => esc(r[6] || '')], ['Montant', r => money(r[3]), 'num']]);
      families.at(-1).rule = 'Subvention inscrite pour une année postérieure à la date de fermeture de l’établissement dans Sirene (ou établissement fermé sans date).';
      const untraceable = asso.perYear.filter(row => row.withoutSiren > 0);
      add(F, 'sans-siren', 'Subventions sans bénéficiaire identifiable', 'Sans SIREN, impossible de relier la subvention aux comptes, aux autres aides ou au statut juridique du bénéficiaire.', untraceable.reduce((s, r) => s + r.withoutSiren, 0), untraceable, [['Année', r => r.year], ['Lignes sans SIREN', r => count(r.withoutSiren), 'num'], ['Montant', r => money(r.amountWithoutSiren), 'num'], ['Part du total', r => pct(r.amountWithoutSiren / r.amount, 2), 'num']]);
      families.at(-1).rule = 'Lignes des annexes « jaunes » dont le SIREN est absent ou invalide (moins de 9 chiffres, mention « NR », « CHORUS »…).';
    }
    if (local) {
      const F = `Finances locales${local.year ? ` (${local.year})` : ''}`;
      if (local.negativeSavings) {
        add(F, 'epargne-negative', 'Communes en épargne brute négative', 'La section de fonctionnement est déficitaire : la commune ne dégage pas de quoi rembourser sa dette sans puiser dans ses réserves. La loi impose un budget équilibré ; une épargne négative durable déclenche normalement un contrôle budgétaire.', local.negativeSavings.count, local.negativeSavings.rows, [['Commune', r => commune(r[0], r[1], r[2])], ['Épargne brute', r => money(r[3]), 'num'], ['Recettes de fonctionnement', r => money(r[4]), 'num'], ['Habitants', r => count(r[5]), 'num']]);
        families.at(-1).rule = local.negativeSavings.rule;
      }
      if (local.debtCapacity) {
        add(F, 'desendettement', 'Dette très lourde au regard de l’épargne', 'Au-delà de 12 ans, le seuil d’alerte retenu par la loi de programmation des finances publiques est dépassé : il faudrait plus de 12 ans d’épargne pour rembourser la dette.', local.debtCapacity.count, local.debtCapacity.rows, [['Commune', r => commune(r[0], r[1], r[2])], ['Durée de désendettement', r => years(r[3]), 'num'], ['Encours de dette', r => money(r[4]), 'num'], ['Épargne brute', r => money(r[5]), 'num'], ['Habitants', r => count(r[6]), 'num']]);
        families.at(-1).rule = local.debtCapacity.rule;
      }
      if (local.staffOutliers) {
        add(F, 'personnel', 'Frais de personnel hors norme', 'Comparaison à la médiane des communes de même taille et de même type. Les communes touristiques et de montagne servent une population bien supérieure à leurs habitants permanents : l’écart y est en partie structurel.', local.staffOutliers.count, local.staffOutliers.rows, [['Commune', r => commune(r[0], r[1], r[2])], ['Type', r => `<span class="tag">${esc(r[7] || 'autre')}</span>`], ['Par habitant', r => money(r[3]), 'num'], ['Médiane comparable', r => money(r[4]), 'num'], ['Écart', r => `× ${r[5].toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`, 'num'], ['Habitants', r => count(r[6]), 'num']]);
        families.at(-1).rule = local.staffOutliers.rule;
      }
      if (local.paymentDelays) {
        const st = local.paymentDelays.stats;
        add(F, 'delais', 'Fournisseurs payés très en retard', 'Les retards de paiement coûtent des intérêts moratoires obligatoires (argent public perdu) et fragilisent les entreprises, surtout les petites.', local.paymentDelays.count, local.paymentDelays.rows, [['Budget', r => esc(r[0])], ['Dép.', r => esc(r[1])], ['Type', r => `<span class="muted">${esc(r[2] || '')}</span>`], ['Délai moyen', r => days(r[3]), 'num']], `<p class="note">Sur ${count(st.budgets)} budgets publiés : ${count(st.over30)} au-delà de 30 jours, ${count(st.over60)} au-delà de 60 jours ; délai médian ${days(st.median)}.</p>`);
        families.at(-1).rule = local.paymentDelays.rule;
      }
    }
    if (!families.length) { $('signalList').innerHTML = '<p class="note">Les signaux seront calculés dès que les sources téléchargées auront été traitées.</p>'; return; }
    render();
  }
  init();
})();
