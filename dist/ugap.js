/* UGAP page: catalogue prices vs retailers (study in progress) and UGAP in the DECP. Data: data/ugap.json (scripts/ugap-data.py). */
(() => {
  const $ = id => document.getElementById(id);
  const { esc } = FRL;
  const nf = (v, d = 0) => v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
  const int = v => nf(v, 0);
  const pct = (v, d = 0) => v == null || !Number.isFinite(v) ? '–' : `${nf(100 * v, d)} %`;
  const eur = v => v == null ? '–' : `${nf(v, 2)} €`;
  const meur = v => FRL.money(v);
  // A ratio UGAP / retailer, read as a signed difference: 0.953 -> "−4,7 %".
  const diff = (r, d = 0) => r == null ? '–' : Math.abs(100 * (r - 1)) < 0.5 * 10 ** -d ? '0 %' : `${r >= 1 ? '+' : '−'}${nf(Math.abs(100 * (r - 1)), d)} %`;
  const shortDay = s => { if (!s) return '–'; const [y, m, dd] = s.slice(0, 10).split('-'); return `${+dd} ${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][+m - 1]} ${y}`; };
  const day = s => { if (!s) return '–'; const [y, m, dd] = s.slice(0, 10).split('-'); return `${+dd} ${['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][+m - 1]} ${y}`; };
  const link = (url, text) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const draws = [];
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => draws.forEach(fn => fn()), 150); });
  const drawn = fn => { draws.push(fn); fn(); };

  FRL.load('./data/ugap.json').then(init).catch(error => {
    console.error(error);
    $('ugStatus').innerHTML = '<strong>Données indisponibles.</strong> Le site doit être servi par HTTP.';
  });

  function init(D) {
    const C = D.comparison, V = D.coverage, A = C.all;
    const RET = Object.fromEntries(V.retailers.map(r => [r.key, r]));
    const retName = key => RET[key]?.name || key;

    /* ---------- Status ---------- */
    const done = V.crawled + V.errors;
    $('ugStatus').innerHTML = `<strong>Étude en cours.</strong> Relevés du ${day(V.ugapDates?.[0])} au ${day(V.ugapDates?.[1])} : ${int(V.crawled)} fiches UGAP lues sur ${int(V.catalogue)} produits listés (${pct(V.crawled / V.catalogue)}), trois revendeurs collectés en tout ou en partie, appariement recalculé le ${day(D.matchedAt)}. Les chiffres ne portent que sur les ${int(C.productsCompared)} produits retrouvés des deux côtés, surtout des consommables d’impression et des fournitures de bureau. <a href="#reste">Ce qui reste à faire</a>.`;

    /* ---------- Headline ---------- */
    $('ugResLead').textContent = `${int(C.productsCompared)} produits du catalogue UGAP ont été retrouvés chez un revendeur sous la même référence de fabricant. Pour chacun, on divise le prix UGAP par le prix du revendeur le moins cher trouvé, toutes taxes comprises des deux côtés (aucun revendeur professionnel affichant des prix hors taxes n’a pu être collecté).`;
    $('ugKpis').innerHTML = [
      ['Produits comparés', int(C.productsCompared), `sur ${int(V.crawled)} fiches UGAP lues ; ${int(C.pairsReview)} paires douteuses écartées`],
      ['Écart médian', diff(A.median, 1), `prix UGAP par rapport au revendeur ; la moitié des produits entre ${diff(A.p25)} et ${diff(A.p75)}`],
      ['UGAP plus chère', pct(A.moreExpensive), `des produits comparés ; ${pct(A.within10)} à moins de 10 % d’écart`],
      ['Un exemplaire de chaque', diff(A.basket, 1), `${eur(A.basketUgap)} à l’UGAP contre ${eur(A.basketRetail)} chez les revendeurs, TTC`],
    ].map(([a, b, c]) => `<div class="kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join('');

    const sg = x => x < 1 ? `−${nf(Math.round(100 * (1 - x)))}` : x > 1 ? `+${nf(Math.round(100 * (x - 1)))}` : '0';
    const BIN_LABEL = ([lo, hi]) => lo === 0 ? `${sg(hi)} % ou moins` : hi == null ? `${sg(lo)} % ou plus` : `${sg(lo)} à ${sg(hi)} %`;
    drawn(() => histogram($('ugHist'), C.histogram.map(b => ({ label: BIN_LABEL(b), value: b[2], cheaper: b[1] != null && b[1] <= 1 }))));
    $('ugHistLegend').innerHTML = '<span><i class="ug-sw ug-sw--cheap"></i>UGAP moins chère</span><span><i class="ug-sw ug-sw--dear"></i>UGAP plus chère</span>';
    $('ugHistNote').textContent = `Nombre de produits par tranche d’écart. ${int(C.histogram.filter(b => b[0] >= 2).reduce((s, b) => s + b[2], 0))} produits sont au moins deux fois plus chers à l’UGAP, ${int(C.histogram[0][2])} au moins deux fois moins chers : à ces extrémités, une partie des écarts vient d’erreurs d’appariement (conditionnement différent, référence partagée par deux produits), qui restent à vérifier à la main.`;
    const R = C.refSeen;
    $('ugReadCaution').innerHTML = `<strong>À lire avec prudence.</strong> L’échantillon compare surtout l’UGAP à <strong>${esc(retName(C.byRetailer[0]?.key))}</strong> (${int(C.byRetailer[0]?.n)} produits sur ${int(C.productsCompared)}), et surtout des cartouches, toners et fournitures de bureau : il ne dit rien des véhicules, du mobilier, des services ni du matériel informatique, absents de l’échantillon ou presque. Le résultat tient quand on ne garde que les ${int(R.n)} paires où la référence du fabricant figure aussi dans le nom ou l’adresse de la fiche du revendeur (écart médian ${diff(R.median, 1)}, UGAP plus chère pour ${pct(R.moreExpensive)} d’entre eux), ou que les produits comparés à ${esc(retName(C.byRetailer[0]?.key))} (écart médian ${diff(C.byRetailer[0]?.median, 1)}).`;

    /* ---------- Groups ---------- */
    const groups = [
      { head: 'Ensemble' }, { label: 'Tous les produits comparés', ...A, strong: true },
      { label: 'Référence vue chez le revendeur', ...R, sub: 'contrôle de robustesse' },
      { head: 'Univers UGAP' }, ...C.byUniverse.map(u => ({ ...u })),
      { head: 'Familles (au moins 5 produits)' }, ...C.byCategory.map(c => ({ ...c })),
      { head: 'Revendeur comparé' }, ...C.byRetailer.map(r => ({ ...r })),
    ];
    drawn(() => rangePlot($('ugRange'), groups));
    $('ugRangeNote').textContent = `Échelle logarithmique : un prix deux fois plus élevé et un prix deux fois plus bas sont à la même distance de l’axe. Les groupes de moins de 20 produits sont en pointillés : leurs chiffres peuvent changer beaucoup quand l’échantillon grandira.`;
    $('ugGroupTable').innerHTML = `<table class="data-table"><thead><tr><th>Groupe</th><th class="num">Produits</th><th class="num">Écart médian</th><th class="num">1er quartile</th><th class="num">3e quartile</th><th class="num">UGAP plus chère</th><th class="num">Panier</th></tr></thead><tbody>${groups.filter(g => !g.head).map(g => `<tr><td>${esc(g.label)}${g.sub ? ` <span class="muted">${esc(g.sub)}</span>` : ''}</td><td class="num">${int(g.n)}</td><td class="num">${diff(g.median, 1)}</td><td class="num">${diff(g.p25, 1)}</td><td class="num">${diff(g.p75, 1)}</td><td class="num">${pct(g.moreExpensive)}</td><td class="num">${diff(g.basket, 1)}</td></tr>`).join('')}</tbody></table>`;

    /* ---------- Coverage ---------- */
    const nonLabShare = V.nonLabCrawled / V.nonLabCatalogue;
    $('ugCovLead').textContent = `Les fiches UGAP sont lues dans un ordre tiré au hasard, les réactifs et consommables de laboratoire en dernier (${pct(V.labCatalogue / V.catalogue)} des références, presque jamais vendues ailleurs sous la même référence). Hors laboratoire, ${pct(nonLabShare)} du catalogue est lu : le reste correspond surtout à des pages retirées (erreur 410) ou refusées (erreur 406).`;
    const usable = V.retailers.reduce((s, r) => s + r.usable, 0);
    $('ugCovKpis').innerHTML = [
      ['Produits listés par ugap.fr', int(V.catalogue), 'dans les plans du site (sitemaps), le 29 octobre 2026'],
      ['Fiches UGAP lues', int(V.crawled), `${int(V.errors)} pages illisibles ou retirées, ${int(V.catalogue - done)} pas encore visitées`],
      ['Prix visible sans compte', pct(V.publicPrice / V.crawled), `des fiches lues (${int(V.publicPrice)}) ; les autres prix ne sont pas comparés`],
      ['Offres revendeur exploitables', int(usable), 'avec un prix et une référence fabricant ou un code EAN'],
    ].map(([a, b, c]) => `<div class="kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join('');
    drawn(() => stackRows($('ugUniverses'), V.universes.filter(u => u.catalogue >= 100)));
    $('ugUnivLegend').innerHTML = '<span><i class="ug-sw ug-sw--read"></i>lue</span><span><i class="ug-sw ug-sw--err"></i>retirée ou illisible</span><span><i class="ug-sw ug-sw--todo"></i>pas encore visitée</span>';
    const hidden = V.universes.filter(u => u.crawled > 500 && u.publicPrice / u.crawled < 0.05).map(u => u.label);
    $('ugUnivNote').textContent = `Chaque barre a la longueur du nombre de produits de l’univers (échelle racine carrée, pour que les petits univers restent lisibles). L’UGAP n’affiche pas le prix aux visiteurs non connectés pour ${hidden.join(', ').toLowerCase()} : ces univers ne peuvent pas être comparés à partir des pages publiques. Les fiches UGAP ne publient jamais de code EAN (${int(V.withEan)} sur ${int(V.crawled)}) ; ${int(V.withRef)} donnent une référence fabricant.`;
    $('ugRetailers').innerHTML = `<table class="data-table"><thead><tr><th>Revendeur</th><th class="num">Produits listés</th><th class="num">Fiches lues</th><th class="num">Exploitables</th><th>Relevé</th></tr></thead><tbody>${V.retailers.map(r => `<tr><td>${link(r.site, r.name)}<br><span class="muted">${esc(r.kind)}${r.note ? ` · ${esc(r.note)}` : ''}</span></td><td class="num">${int(r.urls)}</td><td class="num">${int(r.fetched)}<br><span class="muted">${r.urls ? pct(r.fetched / r.urls) : '–'}</span></td><td class="num">${int(r.usable)}</td><td class="ug-nowrap">${r.dates ? (r.dates[0] === r.dates[1] ? shortDay(r.dates[0]) : `${shortDay(r.dates[0]).replace(/ \d{4}$/, '')} au<br>${shortDay(r.dates[1])}`) : '–'}</td></tr>`).join('')}${V.excluded.map(([n, why]) => `<tr class="ug-excluded"><td>${esc(n)}</td><td colspan="4" class="muted">${esc(why)}</td></tr>`).join('')}</tbody></table>`;
    $('ugRetailNote').textContent = 'Les revendeurs sont lus à partir de leurs plans de site, une page par seconde au plus, en respectant leur fichier robots.txt. Bureau Vallée est lu en entier ; Boulanger à environ 10 %. Chez Boulanger, une partie des fiches lues portent un nom générique ou sans rapport avec la référence (« Hub USB C » pour une cartouche d’encre) : ces paires sont gardées, mais à vérifier en priorité. Aucun site professionnel affichant des prix hors taxes n’a pu être lu.';

    decp(D.decp, D.sources);
    table(C, retName);
    method(C, V, D);
  }

  /* ---------- Charts ---------- */
  function svg(w, h, cls) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.setAttribute('width', w); s.setAttribute('height', h);
    if (cls) s.setAttribute('class', cls);
    return s;
  }
  function el(parent, name, attrs = {}, text) {
    const n = document.createElementNS(SVGNS, name);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (text != null) n.textContent = text;
    parent.appendChild(n);
    return n;
  }

  function histogram(container, bins) {
    const w = Math.max(280, container.clientWidth || 600), narrow = w < 560;
    const h = narrow ? 270 : 250, top = 34, bottom = narrow ? 70 : 44, left = 6, right = 6;
    const s = svg(w, h, 'ug-svg');
    const max = Math.max(...bins.map(b => b.value), 1);
    const bw = (w - left - right) / bins.length;
    bins.forEach((b, i) => {
      const bh = (h - top - bottom) * b.value / max, x = left + i * bw;
      const g = el(s, 'g');
      el(g, 'title', {}, `${b.label} : ${int(b.value)} produits`);
      el(g, 'rect', { x: x + 2, y: h - bottom - bh, width: Math.max(1, bw - 4), height: Math.max(0.5, bh), rx: 3, class: b.cheaper ? 'ug-bar--cheap' : 'ug-bar--dear' });
      el(g, 'text', { x: x + bw / 2, y: h - bottom - bh - 6, 'text-anchor': 'middle', class: 'ug-val' }, int(b.value));
      const t = el(g, 'text', { x: x + bw / 2, y: h - bottom + 14, 'text-anchor': narrow ? 'end' : 'middle', class: 'ug-tick' }, b.label);
      if (narrow) t.setAttribute('transform', `rotate(-50 ${x + bw / 2} ${h - bottom + 14})`);
    });
    const zx = left + bw * bins.findIndex(b => !b.cheaper);
    el(s, 'line', { x1: zx, x2: zx, y1: 18, y2: h - bottom + 4, class: 'ug-zero' });
    el(s, 'text', { x: zx, y: 12, 'text-anchor': 'middle', class: 'ug-tick' }, 'même prix');
    container.replaceChildren(s);
  }

  function rangePlot(container, rows) {
    const w = Math.max(280, container.clientWidth || 700), narrow = w < 640;
    const labelW = narrow ? 0 : Math.min(300, w * 0.38), rowH = narrow ? 50 : 30, headH = 28;
    const lo = Math.log(0.5), hi = Math.log(1.6);
    const x0 = labelW + 8, x1 = w - (narrow ? 34 : 70);
    const X = r => x0 + (Math.log(Math.min(1.6, Math.max(0.5, r))) - lo) / (hi - lo) * (x1 - x0);
    let y = 24;
    const heights = rows.map(r => r.head ? headH : rowH);
    const h = y + heights.reduce((a, b) => a + b, 0) + 8;
    const s = svg(w, h, 'ug-svg');
    [0.5, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5].forEach(t => {
      el(s, 'line', { x1: X(t), x2: X(t), y1: 18, y2: h - 4, class: t === 1 ? 'ug-zero' : 'ug-grid' });
      if (!narrow || [0.5, 0.8, 1, 1.25].includes(t)) el(s, 'text', { x: X(t), y: 12, 'text-anchor': 'middle', class: 'ug-tick' }, t === 1 ? '0' : diff(t));
    });
    rows.forEach((r, i) => {
      if (r.head) { el(s, 'text', { x: 0, y: y + 19, class: 'ug-head' }, r.head); y += heights[i]; return; }
      const cy = narrow ? y + 34 : y + rowH / 2;
      const g = el(s, 'g', { class: r.n < 20 ? 'ug-row is-small' : 'ug-row' });
      el(g, 'title', {}, `${r.label} : ${int(r.n)} produits, écart médian ${diff(r.median, 1)}, moitié centrale de ${diff(r.p25)} à ${diff(r.p75)}`);
      const label = `${r.label} (${int(r.n)})`;
      el(g, 'text', { x: narrow ? 0 : labelW, y: narrow ? y + 16 : cy + 4, 'text-anchor': narrow ? 'start' : 'end', class: r.strong ? 'ug-label is-strong' : 'ug-label' }, label);
      el(g, 'line', { x1: X(r.p25), x2: X(r.p75), y1: cy, y2: cy, class: 'ug-iqr' });
      el(g, 'circle', { cx: X(r.median), cy, r: 5.5, class: r.median > 1 ? 'ug-dot--dear' : 'ug-dot--cheap' });
      el(g, 'text', { x: Math.min(w - 2, X(Math.max(r.p75, r.median)) + 8), y: cy + 4, class: 'ug-val', 'text-anchor': X(Math.max(r.p75, r.median)) + 50 > w ? 'end' : 'start' }, diff(r.median, 1));
      y += heights[i];
    });
    container.replaceChildren(s);
  }

  function stackRows(container, rows) {
    const max = Math.sqrt(Math.max(...rows.map(r => r.catalogue)));
    container.innerHTML = `<ul class="ug-stackrows">${rows.map(r => {
      const width = 100 * Math.sqrt(r.catalogue) / max, todo = Math.max(0, r.catalogue - r.crawled - r.errors);
      const seg = (n, cls) => n > 0 ? `<span class="${cls}" style="width:${(100 * n / r.catalogue).toFixed(2)}%"></span>` : '';
      return `<li><div class="ug-stackrows__line"><span>${esc(r.label)}</span><strong>${int(r.crawled)} / ${int(r.catalogue)}</strong></div><span class="ug-stackrows__track" style="width:${width.toFixed(1)}%" title="${esc(r.label)} : ${int(r.crawled)} lues, ${int(r.errors)} retirées ou illisibles, ${int(todo)} restantes ; prix visible sans compte pour ${int(r.publicPrice)}">${seg(r.crawled, 'is-read')}${seg(r.errors, 'is-err')}${seg(todo, 'is-todo')}</span></li>`;
    }).join('')}</ul>`;
  }

  function columns(container, rows, years) {
    const w = Math.max(280, container.clientWidth || 500), h = 220, top = 20, bottom = 26;
    const s = svg(w, h, 'ug-svg');
    const max = Math.max(...rows.map(r => r.a + r.b), 1);
    const bw = w / years.length;
    years.forEach((year, i) => {
      const r = rows.find(x => x.year === year) || { a: 0, b: 0 };
      const x = i * bw + bw * 0.18, cw = bw * 0.64, H = h - top - bottom;
      const ha = H * r.a / max, hb = H * r.b / max;
      const g = el(s, 'g');
      el(g, 'title', {}, `${year} : ${int(r.a)} accords-cadres, ${int(r.b)} autres contrats`);
      el(g, 'rect', { x, y: h - bottom - ha, width: cw, height: Math.max(0, ha), class: 'ug-col--a' });
      el(g, 'rect', { x, y: h - bottom - ha - hb, width: cw, height: Math.max(0, hb), class: 'ug-col--b' });
      el(g, 'text', { x: x + cw / 2, y: h - bottom - ha - hb - 5, 'text-anchor': 'middle', class: 'ug-val' }, int(r.a + r.b));
      el(g, 'text', { x: x + cw / 2, y: h - 8, 'text-anchor': 'middle', class: 'ug-tick' }, w < 420 ? `’${String(year).slice(2)}` : year);
    });
    container.replaceChildren(s);
  }

  /* ---------- DECP ---------- */
  function decp(P, sources) {
    if (!P) { $('ugDecpKpis').innerHTML = '<p class="note">Section non calculée (DuckDB absent lors de la construction des données).</p>'; return; }
    const B = P.asBuyer, S = P.asSupplier;
    const by = Object.fromEntries(B.perYear.map(r => [r[0], Object.fromEntries(B.fields.map((f, i) => [f, r[i]]))]));
    const years = []; for (let y = +B.first.slice(0, 4); y <= +B.last.slice(0, 4); y++) years.push(y);
    const recent = B.perYear.filter(r => r[0] >= 2024);
    const withBids = recent.reduce((s, r) => s + r[4], 0), single = recent.reduce((s, r) => s + r[6], 0);
    const gapYears = years.filter(y => (by[y]?.rows || 0) < 10);
    const sYears = S.perYear.map(r => Object.fromEntries(S.fields.map((f, i) => [f, r[i]])));
    const sLast = sYears.filter(r => r.year < 2026).at(-1);
    $('ugDecpKpis').innerHTML = [
      ['Contrats notifiés par l’UGAP', int(B.rows), `de ${B.first.slice(0, 4)} à ${B.last.slice(0, 4)}, dont ${int(B.perYear.reduce((s, r) => s + r[2], 0))} lots d’accords-cadres`],
      ['Une seule offre reçue', withBids ? pct(single / withBids) : '–', `des contrats UGAP notifiés depuis 2024 dont le nombre d’offres est publié (${int(withBids)})`],
      ['Déclarés avec l’UGAP comme titulaire', int(S.rows), `contrats, ${int(sLast?.buyers)} acheteurs différents en ${sLast?.year}`],
      ['Part des montants déclarés', sLast?.decpAmount ? pct(sLast.amount / sLast.decpAmount, 2) : '–', `en ${sLast?.year} : ${meur(sLast?.amount)} sur ${meur(sLast?.decpAmount)} de contrats et plafonds déclarés, tous acheteurs confondus`],
    ].map(([a, b, c]) => `<div class="kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join('');

    drawn(() => columns($('ugBuyerYears'), years.map(y => ({ year: y, a: by[y]?.frameworks || 0, b: by[y]?.others || 0 })), years));
    $('ugBuyerLegend').innerHTML = '<span><i class="ug-sw ug-sw--a"></i>lots d’accords-cadres</span><span><i class="ug-sw ug-sw--b"></i>autres contrats (marchés subséquents, marchés simples)</span>';
    $('ugBuyerNote').textContent = `Un appel d’offres de l’UGAP est souvent découpé en lots, chacun déclaré comme un contrat. ${gapYears.length ? `Presque rien n’est déclaré pour ${gapYears.join(' et ')} : c’est une lacune des données publiées, qui ne signifie pas que l’UGAP n’a rien attribué ces années-là. ` : ''}Le nombre d’offres reçues n’est renseigné qu’à partir de 2022 (${int(B.rows - B.noBids)} contrats sur ${int(B.rows)}).`;

    $('ugSupplierYears').innerHTML = `<table class="data-table"><thead><tr><th>Année</th><th class="num">Contrats</th><th class="num">Acheteurs</th><th class="num">Montant déclaré</th><th class="num">Part du total DECP</th></tr></thead><tbody>${sYears.map(r => `<tr><td>${r.year}</td><td class="num">${int(r.rows)}</td><td class="num">${int(r.buyers)}</td><td class="num">${meur(r.amount)}</td><td class="num">${r.decpAmount ? pct(r.amount / r.decpAmount, 2) : '–'}</td></tr>`).join('')}</tbody></table>`;
    $('ugSupplierNote').textContent = `Montants tels que déclarés par les acheteurs : souvent l’enveloppe maximale d’une convention avec l’UGAP pour plusieurs années, pas une dépense constatée. Un achat sur le catalogue UGAP n’a pas à faire l’objet d’un contrat propre de l’acheteur : la plupart ne sont jamais déclarés ici. Cette part n’est donc pas la part de l’UGAP dans la commande publique, que les données ouvertes ne permettent pas de calculer. ${sYears.at(-1)?.year} est une année incomplète (données téléchargées le ${day(sources?.[0]?.downloadedAt)}).`;

    const L = B.largest.map(r => Object.fromEntries(B.largestFields.map((f, i) => [f, r[i]])));
    $('ugLargest').innerHTML = `<table class="data-table"><thead><tr><th>Objet de l’appel d’offres</th><th>Notification</th><th class="num">Lots</th><th class="num">Plafond le plus élevé d’un lot</th><th class="num">Offres reçues (moyenne)</th></tr></thead><tbody>${L.map(r => `<tr><td>${esc(r.object.split(' - ')[0])}${r.framework ? ' <span class="tag">accord-cadre</span>' : ''}<br><span class="muted">identifiant ${esc(r.firstId)}</span></td><td>${esc(r.month.split(' à ')[0] === r.month.split(' à ')[1] ? r.month.split(' à ')[0] : r.month)}</td><td class="num">${int(r.lots)}</td><td class="num">${meur(r.maxAmount)}</td><td class="num">${r.avgBids == null ? '–' : nf(r.avgBids, 1)}</td></tr>`).join('')}</tbody></table>`;
    $('ugLargestNote').textContent = `Un accord-cadre fixe un plafond de commandes sur plusieurs années, pas une dépense. Plusieurs lots d’un même appel d’offres déclarent souvent le même plafond : additionner les lignes compterait plusieurs fois la même enveloppe, c’est pourquoi seul le plafond le plus élevé est montré. Les numéros de marché affichés sur ugap.fr (${int(P.marketNumbers.catalogue)} différents dans les fiches lues) n’apparaissent dans aucun identifiant des ${int(P.marketNumbers.decpUgapIds)} contrats déclarés par l’UGAP : impossible, avec les données publiées, de relier un produit du catalogue au contrat qui fixe son prix.`;

    FRL.ranking($('ugTopBuyers'), S.topBuyers.map(r => ({ value: r[3], html: r[1] ? FRL.sirenLink(r[0], r[1]) : `<span data-siren-name="${esc(r[0])}">${FRL.sirenLink(r[0], `SIREN ${r[0]}`)}</span>`, sub: `${int(r[2])} contrat${r[2] > 1 ? 's' : ''}, ${r[4] === r[5] ? r[4] : `${r[4]}–${r[5]}`}` })), { format: meur, limit: 12 });
    FRL.resolveNames($('ugTopBuyers'));
    $('ugTopBuyersNote').textContent = 'Somme des montants déclarés avec l’UGAP comme titulaire (SIREN 776 056 467), toutes années. Une convention pluriannuelle déclarée une fois pèse son enveloppe entière l’année de sa notification.';
    $('ugDecpSources').innerHTML = (sources || []).map(s => link(s.url, `${s.label}, data.economie.gouv.fr (téléchargé le ${day(s.downloadedAt)})`)).join('') + link('marches.html', 'Tous les marchés publics sur ce site');
  }

  /* ---------- Table ---------- */
  function table(C, retName) {
    const F = C.tableFields;
    const rows = C.table.map(r => Object.fromEntries(F.map((f, i) => [f, r[i]])));
    const universes = [...new Set(rows.map(r => r.universe))];
    const UL = Object.fromEntries(C.byUniverse.map(u => [u.key, u.label]));
    $('ugFilterUniverse').insertAdjacentHTML('beforeend', universes.map(u => `<option value="${esc(u)}">${esc(UL[u] || u)}</option>`).join(''));
    $('ugFilterRetailer').insertAdjacentHTML('beforeend', [...new Set(rows.map(r => r.retailer))].map(k => `<option value="${esc(k)}">${esc(retName(k))}</option>`).join(''));
    let sort = { key: 'title', dir: 1 }, limit = 40;
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const COLS = [['title', 'Produit UGAP'], ['ugapTtc', 'Prix UGAP TTC', 1], ['retailName', 'Offre revendeur'], ['retailTtc', 'Prix revendeur TTC', 1], ['ratio', 'Écart', 1]];
    function render() {
      const q = norm($('ugSearch').value).trim(), fu = $('ugFilterUniverse').value, fr = $('ugFilterRetailer').value;
      const list = rows.filter(r => (!fu || r.universe === fu) && (!fr || r.retailer === fr) && (!q || norm(`${r.title} ${r.brand} ${r.ref} ${r.retailName}`).includes(q)))
        .sort((a, b) => { const x = a[sort.key], y = b[sort.key]; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) * sort.dir; });
      $('ugTable').innerHTML = `<table class="data-table ug-table"><thead><tr>${COLS.map(([k, t, num]) => `<th class="${num ? 'num' : ''}"><button type="button" class="ug-sort" data-key="${k}" aria-sort="${sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(t)}${sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr></thead><tbody>${list.slice(0, limit).map(r => `<tr><td>${link(r.ugapUrl, r.title)}<br><span class="muted">réf. ${esc(r.ref)} · ${esc(r.category)}</span></td><td class="num">${eur(r.ugapTtc)}</td><td>${link(r.retailUrl, r.retailName)}<br><span class="muted">${esc(retName(r.retailer))}${r.refSeen ? '' : ' · référence absente du nom de l’offre'}</span></td><td class="num">${eur(r.retailTtc)}</td><td class="num"><span class="ug-pill ${r.ratio > 1 ? 'is-dear' : 'is-cheap'}">${diff(r.ratio)}</span></td></tr>`).join('')}</tbody></table>`;
      $('ugMore').hidden = list.length <= limit;
      $('ugTableNote').textContent = `${int(Math.min(limit, list.length))} lignes affichées sur ${int(list.length)}${list.length < rows.length ? ` (${int(rows.length)} au total)` : ''}. Écart = prix UGAP rapporté au prix du revendeur, moins 1. Les paires où la référence du fabricant n’apparaît pas dans le nom de l’offre ne sont pas forcément fausses, mais méritent plus de vérification.`;
      $('ugTable').querySelectorAll('.ug-sort').forEach(btn => btn.addEventListener('click', () => {
        const k = btn.dataset.key; sort = { key: k, dir: sort.key === k ? -sort.dir : (k === 'ratio' ? -1 : 1) }; render();
      }));
    }
    ['ugSearch', 'ugFilterUniverse', 'ugFilterRetailer'].forEach(id => $(id).addEventListener('input', () => { limit = 40; render(); }));
    $('ugMore').addEventListener('click', () => { limit += 80; render(); });
    render();
  }

  /* ---------- Method, to-do list, missing data ---------- */
  function method(C, V, D) {
    const gap = (h, p, state) => `<article class="gap">${state ? `<span class="gap__state ${state === 'none' ? 'none' : 'partial'}">${state === 'none' ? 'Non publié' : 'Partiel'}</span>` : ''}<h3>${esc(h)}</h3><p>${p}</p></article>`;
    const lab = V.universes.find(u => u.key === 'laboratoire');
    const bv = V.retailers.find(r => r.key === 'bureauvallee'), bo = V.retailers.find(r => r.key === 'boulanger');
    $('ugMethod').innerHTML = [
      gap('Le même produit, pas un produit semblable', `Deux fiches sont appariées quand elles portent la même référence de fabricant, mise en majuscules et débarrassée de la ponctuation, avec un contrôle de marque quand la référence est courte (le code EAN serait plus sûr, mais l’UGAP ne le publie pas). Les ${int(C.productsCompared)} produits comparés le sont tous par la référence fabricant.`),
      gap('Mêmes taxes des deux côtés', 'Prix UGAP toutes taxes comprises face au prix TTC affiché par un site grand public. Une comparaison hors taxes avec des revendeurs professionnels était prévue, mais aucun n’a pu être lu (CAPTCHA, page de vérification) : elle reste à faire.'),
      gap('Le prix d’un exemplaire', 'Prix UGAP pour une unité, hors tarifs dégressifs par quantité. Côté revendeur, l’offre la moins chère trouvée pour ce produit (un seul revendeur dans la plupart des cas).'),
      gap('Paires écartées', `${int(C.pairsReview)} paires sont mises de côté pour vérification manuelle : conditionnement différent repéré dans les intitulés (« lot de 10 », « x 6 ») ou prix UGAP plus de dix fois plus élevé, ou plus de cinq fois plus bas, que celui du revendeur. ${int(C.pairsHiddenPrice)} paire porte sur un prix que l’UGAP ne montre pas aux visiteurs non connectés : elle n’est pas comptée.`),
      gap('Prix catalogue, pas prix payé', 'Les acheteurs sous convention avec l’UGAP peuvent obtenir des remises, et les gros volumes des tarifs dégressifs : le prix public est un plafond, pas forcément le prix payé. Côté revendeur, une promotion du jour de relevé compte comme un prix normal.'),
      gap('Livraison et service', 'Le prix UGAP est un prix de revente, rémunération de la centrale comprise ; la livraison est franco à partir de 80 € HT de commande, en dessous des frais s’ajoutent. Les frais de livraison des revendeurs ne sont pas comptés non plus. La valeur de la procédure déjà faite (pas d’appel d’offres à lancer) n’est pas chiffrable ici.'),
      gap('Un échantillon, pas tout le catalogue', `Les fiches UGAP sont lues dans un ordre aléatoire tiré une fois pour toutes, laboratoire en dernier (${int(lab?.crawled)} fiches sur ${int(lab?.catalogue)} lues pour cet univers). Les produits comparés sont ceux qu’un revendeur grand public vend aussi : surtout des consommables d’impression et des fournitures, pas du mobilier ni des véhicules.`),
      gap('Collecte respectueuse', 'Seules les pages publiques autorisées par le fichier robots.txt de chaque site sont lues, sans connexion à un compte et sans les interfaces internes des sites, avec un robot identifié et une adresse de contact. Aucune page n’est conservée : seulement le titre, la marque, la référence, le prix et la date.'),
    ].join('');
    $('ugSources').innerHTML = [
      link('https://www.ugap.fr/sitemap-produits-1.xml', 'Plan du catalogue ugap.fr (sitemaps produits)'),
      link('https://www.bureau-vallee.fr/pub/media/sitemap_fr_FR_product.xml', 'Plan des produits Bureau Vallée'),
      link('https://www.boulanger.com/sitemap_index.xml', 'Plan des produits Boulanger'),
      link('https://github.com/TheoMrc/FranceRoueLibre/tree/main/ugap', 'Code de collecte et d’appariement (dossier ugap/)'),
      link('https://github.com/TheoMrc/FranceRoueLibre/blob/main/scripts/ugap-data.py', 'Calcul des chiffres de cette page'),
    ].join('');

    const todo = (h, p) => `<article class="gap ug-todo"><span class="gap__state partial">À faire</span><h3>${esc(h)}</h3><p>${p}</p></article>`;
    $('ugTodo').innerHTML = [
      todo('Finir la lecture du catalogue UGAP', `${int(V.catalogue - V.crawled - V.errors)} fiches restent à visiter, presque toutes en laboratoire. Au rythme prudent de la collecte (environ une page par seconde), il faut encore plusieurs jours.`),
      todo('Lire Boulanger en entier, ajouter d’autres revendeurs', `${int(bo?.fetched)} fiches Boulanger lues sur ${int(bo?.urls)}. Bureau Vallée (${int(bv?.urls)} produits) est complet. Les grands sites professionnels (prix HT) bloquent les robots : il faudrait leur accord ou un autre accès.`),
      todo('Vérifier les paires à la main', `Les ${int(C.pairsReview)} paires écartées, et les écarts extrêmes (au moins deux fois plus cher ou moins cher), doivent être relues une à une : erreurs de conditionnement, références partagées par deux produits différents.`),
      todo('Comparer des produits équivalents', 'Mobilier, véhicules, vêtements : les références sont propres aux fournisseurs de l’UGAP et n’existent nulle part ailleurs. Une comparaison « produit équivalent » (même usage, mêmes dimensions) est possible mais devra être présentée comme telle.'),
      todo('Comparer hors taxes avec des prix professionnels', 'Les acheteurs publics comparent des prix HT avec des distributeurs professionnels. Cette comparaison est la plus juste et manque encore.'),
    ].join('');

    $('ugAsk').innerHTML = [
      gap('Ce que les acheteurs publics paient à l’UGAP', 'Les factures passent par Chorus Pro mais ne sont pas ouvertes. Sans elles, on ne connaît ni les quantités, ni les prix réellement payés, ni les remises des conventions. L’UGAP et la DGFiP (Chorus Pro) pourraient publier ces montants par acheteur et par famille de produits.', 'none'),
      gap('Le lien entre un produit et son marché', 'Les fiches ugap.fr donnent un numéro de marché et le nom du fournisseur, mais ce numéro ne se retrouve pas dans les identifiants des DECP. L’UGAP pourrait publier la table de correspondance entre ses numéros de marché et ses déclarations DECP.', 'none'),
      gap('Les prix cachés', `L’UGAP masque le prix de ${pct(1 - V.publicPrice / V.crawled)} des fiches lues aux visiteurs non connectés (laboratoire, santé, énergie, véhicules notamment). Le catalogue d’un établissement public pourrait être consultable en entier sans compte.`, 'partial'),
      gap('Les achats passés par une centrale', 'Un acheteur qui commande sur le catalogue de l’UGAP n’a pas à déclarer de contrat dans les DECP : ces achats sont invisibles dans les données de la commande publique. Seuls quelques acheteurs déclarent leurs conventions, avec des montants d’enveloppe.', 'partial'),
      gap('Les codes EAN', 'Les fiches UGAP ne donnent jamais le code-barres EAN du produit, qui permettrait un appariement exact avec n’importe quel revendeur.', 'none'),
      gap('Les déclarations DECP de l’UGAP entre 2022 et 2023', `Entre mi-2021 et fin 2023, presque aucun contrat de l’UGAP n’apparaît dans les DECP téléchargés le ${day(D.sources?.[0]?.downloadedAt)}. Les déclarations de cette période manquent dans les fichiers consolidés publiés.`, 'partial'),
    ].join('');
    FRL.keepHash();
  }
})();
