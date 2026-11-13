/* Demandes aux instances publiques: the requests sent by the site (server/assistant/demandes.py), read from the Loupe's
   API (GET api/assistant/demandes). One line per request, searchable and filtered (state, level of the body, themes,
   place on the mini-map); a line opens on the whole exchange: the letter as it left, each sending, the automatic
   messages, the replies in full and the documents received (attachments and copies of the linked documents). */
(function () {
  const $ = id => document.getElementById(id);
  const list = $('dmList');
  if (!list) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nrm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');
  const day = (iso, short) => iso ? new Date(iso).toLocaleDateString('fr-FR', short ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;
  const today = new Date().toISOString().slice(0, 10);
  const PAGE = 20;
  const ICON = {
    chevron: 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z',
    clip: 'M16.5,6V17.5A4,4 0 0,1 12.5,21.5A4,4 0 0,1 8.5,17.5V5A2.5,2.5 0 0,1 11,2.5A2.5,2.5 0 0,1 13.5,5V15.5A1,1 0 0,1 12.5,16.5A1,1 0 0,1 11.5,15.5V6H10V15.5A2.5,2.5 0 0,0 12.5,18A2.5,2.5 0 0,0 15,15.5V5A4,4 0 0,0 11,1A4,4 0 0,0 7,5V17.5A5.5,5.5 0 0,0 12.5,23A5.5,5.5 0 0,0 18,17.5V6H16.5Z',
    download: 'M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z',
    close: 'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z',
  };
  const ico = (k, cls = '') => `<svg class="dm-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;

  // ---------------------------------------------------------------------------------------------------- vocabulary
  const STATES = { repondue: 'Réponse reçue', attente: 'En attente', silence: 'Sans réponse', close: 'Close' };
  const LEVELS = { commune: 'Communes', interco: 'Intercommunalités', departement: 'Départements', region: 'Régions', autre: 'État et autres' };
  const LEVEL_ONE = { commune: 'Commune', interco: 'Intercommunalité', departement: 'Département', region: 'Région', autre: 'État ou autre organisme' };
  const ROLES = { annuaire: 'à l’accueil de l’organisme', prada: 'à la personne responsable de l’accès aux documents administratifs (PRADA)', formulaire: 'par le formulaire de contact' };
  const EVENTS = { automatique: 'Accusé de réception automatique', antispam: 'Lettre retenue par un filtre anti-spam, débloquée à la main', rejet: 'Lettre revenue en erreur de distribution' };
  // Themes read in the subject and the documents asked: a fixed list of words, nothing guessed.
  const THEMES = [
    ['Subventions', /\bsubvention/], ['Associations', /\bassociation/], ['Marchés publics', /\bmarche(s)? public|\bmarche\b|appel d offres|\bdevis\b|\bfacture/],
    ['Budget et comptes', /\bbudget|compte administratif|compte financier|\bcomptes?\b/], ['Délibérations', /\bdeliberation/],
    ['Travaux', /\btravaux|\bchantier|\brenovation|\bconstruction/], ['Voirie et stationnement', /\bvoirie|\bstationnement|\bparking|\broute|\brond point|\bgiratoire/],
    ['Véhicules et bornes', /\bvehicule|\bborne|\bvoiture|\bflotte/], ['Énergie', /\benergie|\belectricite|\bphotovolta|\beclairage|\bchauffage/],
    ['Personnel', /\bpersonnel|\beffectif|\bremuneration|\bsalaire|\bagents?\b|\bemplois?\b/], ['Indemnités des élus', /\bindemnite|\belus?\b/],
    ['Frais de représentation', /\bfrais de (representation|mission|bouche|deplacement)|\breception|\brestaurant/],
    ['Communication', /\bcommunication|\bpublicite|\bmagazine|\bbulletin municipal/], ['Événements', /\bevenement|\bfestival|\bfete|\bfeu d artifice|\bconcert/],
    ['Immobilier', /\bimmobilier|\bloyer|\bbail|\bcession|\bacquisition|\bterrain/], ['Numérique', /\bnumerique|\blogiciel|\binformatique|\bsite internet|\bapplication/],
    ['Eau et déchets', /\beau\b|\bassainissement|\bdechet|\bordures/], ['École et cantine', /\becole|\bscolaire|\bcantine|\bcreche|\bperiscolaire/],
    ['Sport', /\bsport|\bpiscine|\bstade|\bgymnase/], ['Culture', /\bculture|\bmusee|\bmediatheque|\bbibliotheque|\btheatre/],
    ['Sécurité', /\bsecurite|\bvideoprotection|\bvideosurveillance|\bpolice municipale/], ['Emprunts et dette', /\bemprunt|\bdette/],
    ['Études et conseil', /\betude|\baudit|\bcabinet|\bconseil en|\bconsultant/],
  ];

  function state(d) {
    if (d.reponses.length) return 'repondue';
    if (d.status === 'close') return 'close';
    return d.echeance && d.echeance < today ? 'silence' : 'attente';
  }
  function stateLine(d) {
    const s = state(d);
    if (s === 'repondue') return `Réponse reçue le ${day(d.reponses.at(-1).date)}`;
    if (s === 'close') return 'Demande close';
    if (s === 'silence') return `Sans réponse depuis le ${day(d.echeance)} : refus implicite, la CADA peut être saisie`;
    return `En attente : réponse due au plus tard le ${day(d.echeance)}`;
  }
  const size = n => n >= 1048576 ? `${(n / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo` : `${Math.max(1, Math.round(n / 1024)).toLocaleString('fr-FR')} ko`;
  const shortName = d => d.organisme.replace(/^Mairie\s*-\s*/, '').replace(/^Mairie (de |d’|d')/, '');
  const linkify = text => esc(text).replace(/https?:\/\/[^\s<>"')\]]+/g, u => {
    const tail = (u.match(/(?:&#39;|&quot;|[.,;:!?»])+$/) || [''])[0], url = tail ? u.slice(0, -tail.length) : u;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>${tail}`;
  });

  // ---------------------------------------------------------------------------------------------------- state
  let rows = [], depts = {};
  const f = { q: '', state: new Set(), level: new Set(), theme: new Set(), place: null, sort: 'recent', shown: PAGE, open: new Set(), moreThemes: false };

  function prepare(d) {
    const text = nrm(`${d.objet} ${d.documents}`);
    d._state = state(d);
    d._themes = THEMES.filter(([, re]) => re.test(text)).map(([label]) => label).concat(d.mots || []);
    d._pieces = d.reponses.reduce((n, r) => n + (r.pieces || []).length, 0);
    d._last = d.reponses.length ? d.reponses.at(-1).date : '';
    d._bag = nrm([d.ref, d.organisme, d.objet, d.documents, d.contexte, d.lettre?.texte, LEVEL_ONE[d.niveau], STATES[d._state], d.lieu?.cp,
      depts[d.lieu?.dep]?.nom, ...d._themes, ...d.reponses.flatMap(r => [r.texte, ...(r.pieces || []).map(p => p.nom)])].join(' '));
    return d;
  }
  const match = (d, skip) => (skip === 'state' || !f.state.size || f.state.has(d._state))
    && (skip === 'level' || !f.level.size || f.level.has(d.niveau))
    && (skip === 'theme' || !f.theme.size || d._themes.some(t => f.theme.has(t)))
    && (skip === 'place' || !f.place || f.place.refs.has(d.ref))
    && nrm(f.q).split(/\s+/).filter(Boolean).every(w => d._bag.includes(w));
  const SORTS = {
    recent: (a, b) => String(b.envoyee || '').localeCompare(String(a.envoyee || '')),
    reponse: (a, b) => String(b._last).localeCompare(String(a._last)) || SORTS.recent(a, b),
    echeance: (a, b) => (a._state === 'attente' ? 0 : 1) - (b._state === 'attente' ? 0 : 1) || String(a.echeance || '').localeCompare(String(b.echeance || '')),
  };

  // ---------------------------------------------------------------------------------------------------- one request
  function piece(p) {
    const inline = ['pdf', 'png', 'jpg', 'jpeg'].includes(p.type);
    const what = p.origine === 'lien' ? `copie du document en lien${p.date ? `, faite le ${day(p.date, true)}` : ''}` : 'pièce jointe';
    return `<li class="dm-file"><a class="dm-file__main" href="${esc(p.href)}" ${inline ? 'target="_blank" rel="noopener"' : 'download'}>`
      + `<span class="dm-file__type dm-file__type--${esc(p.type)}">${esc(p.type.toUpperCase().slice(0, 4))}</span>`
      + `<span class="dm-file__txt"><strong>${esc(p.nom)}</strong><small>${size(p.taille)} · ${what}</small></span>${ico('download', 'dm-file__dl')}</a>`
      + `${p.url ? `<a class="dm-file__src" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer nofollow">adresse d’origine</a>` : ''}</li>`;
  }
  function thread(d) {
    const steps = [];
    const first = (d.envois || [])[0];
    const how = d.formulaire ? `déposée dans <a href="${esc(d.formulaire)}" target="_blank" rel="noopener noreferrer">le formulaire de contact</a> de l’organisme`
      : `envoyée par courriel ${ROLES[first?.role] && first.role !== 'formulaire' ? ROLES[first.role] : ''}`;
    const docs = d.documents.split('\n').map(x => `<li>${esc(x)}</li>`).join('');
    steps.push({ date: d.envoyee, html: `<article class="dm-msg dm-msg--out"><header><strong>FranceRoueLibre</strong><span class="dm-msg__to">à ${esc(d.organisme)}</span><time>${day(d.envoyee)}</time></header>`
      + `<p class="dm-msg__how">Lettre ${how}.</p>`
      + (d.lettre?.texte ? `<p class="dm-msg__subject">${esc(d.lettre.objet || '')}</p><div class="dm-msg__body dm-clamp">${linkify(d.lettre.texte)}</div><button type="button" class="dm-more" data-more>Lire toute la lettre</button>`
        : `<p class="dm-label">Documents demandés</p><ul class="dm-docs">${docs}</ul>${d.contexte ? `<p class="dm-msg__body">${esc(d.contexte)}</p>` : ''}`)
      + '</article>' });
    (d.envois || []).slice(1).forEach(e => steps.push({ date: e.date, html: `<p class="dm-event"><span>La même lettre est envoyée ${ROLES[e.role] || ''}</span><time>${day(e.date, true)}</time></p>` }));
    (d.evenements || []).forEach(e => steps.push({ date: e.date, html: `<p class="dm-event dm-event--${esc(e.type)}"><span>${EVENTS[e.type] || 'Message automatique'}</span><time>${day(e.date, true)}</time></p>` }));
    d.reponses.forEach(r => steps.push({ date: r.date, html: `<article class="dm-msg dm-msg--in"><header><strong>${esc(d.organisme)}</strong><span class="dm-msg__to">à FranceRoueLibre</span><time>${day(r.date)}</time></header>`
      + `<div class="dm-msg__body">${linkify(r.texte)}</div>`
      + `${(r.pieces || []).length ? `<p class="dm-label">${ico('clip')}${plural(r.pieces.length, 'document reçu', 'documents reçus')}</p><ul class="dm-files">${r.pieces.map(piece).join('')}</ul>` : ''}`
      + '<p class="dm-msg__note">Publié sans le nom, l’adresse ni le téléphone des agents.</p></article>' }));
    steps.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const end = d._state === 'repondue' ? '' : `<p class="dm-event dm-event--end dm-event--${d._state}"><span>${esc(stateLine(d))}${d._state === 'silence' ? ' (<a href="https://www.cada.fr/particulier/comment-saisir-la-cada" target="_blank" rel="noopener noreferrer">comment faire</a>)' : ''}</span></p>`;
    return `<div class="dm-thread">${steps.map(s => s.html).join('')}${end}</div>`
      + `<footer class="dm-foot">${d.fiche ? `<a href="${esc(d.fiche)}" target="_blank" rel="noopener noreferrer">Fiche officielle de l’organisme</a>` : ''}<button type="button" data-copy="${esc(d.ref)}">Copier le lien de cette demande</button><span>${esc(d.ref)}</span></footer>`;
  }
  function row(d) {
    const open = f.open.has(d.ref), dep = depts[d.lieu?.dep];
    const where = [LEVEL_ONE[d.niveau], dep ? `${dep.nom} (${d.lieu.dep})` : ''].filter(Boolean).join(' · ');
    return `<li class="dm-row dm-row--${d._state}${open ? ' is-open' : ''}" id="${esc(d.ref)}" data-ref="${esc(d.ref)}">`
      + `<button type="button" class="dm-row__head" aria-expanded="${open}" aria-controls="t-${esc(d.ref)}">`
      + `<span class="dm-dot" aria-hidden="true"></span>`
      + `<span class="dm-row__main"><span class="dm-row__org">${esc(d.organisme)}</span><span class="dm-row__obj">${esc(d.objet)}</span>`
      + `<span class="dm-row__meta"><span class="dm-state dm-state--${d._state}">${STATES[d._state]}</span><span>${esc(where)}</span><span>envoyée le ${day(d.envoyee, true)}</span>${d._pieces ? `<span class="dm-row__clip">${ico('clip')}${plural(d._pieces, 'document', 'documents')}</span>` : ''}</span></span>`
      + `${ico('chevron', 'dm-row__chev')}</button>`
      + `<div class="dm-row__body" id="t-${esc(d.ref)}"${open ? '' : ' hidden'}>${open ? `${d._themes.length ? `<p class="dm-tags">${d._themes.map(t => `<button type="button" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</p>` : ''}${thread(d)}` : ''}</div></li>`;
  }

  // ---------------------------------------------------------------------------------------------------- rendering
  function chips(id, title, entries, set, key) {
    const el = $(id);
    el.hidden = !entries.length;
    el.innerHTML = entries.length ? `<p>${title}</p><div class="dm-chips">${entries.map(([k, label, n]) => `<button type="button" class="dm-chip" data-${key}="${esc(k)}" aria-pressed="${set.has(k)}"${n || set.has(k) ? '' : ' disabled'}>${esc(label)} <small>${n}</small></button>`).join('')}</div>` : '';
  }
  function render() {
    const shown = rows.filter(d => match(d)).sort(SORTS[f.sort]);
    const count = (skip, test) => rows.filter(d => match(d, skip) && test(d)).length;
    chips('dmStates', 'État', Object.entries(STATES).map(([k, l]) => [k, l, count('state', d => d._state === k)]).filter(([k, , n]) => n || rows.some(d => d._state === k)), f.state, 'state');
    chips('dmLevels', 'Échelon', Object.entries(LEVELS).map(([k, l]) => [k, l, count('level', d => d.niveau === k)]).filter(([k]) => rows.some(d => d.niveau === k)), f.level, 'level');
    const themes = new Map();
    rows.forEach(d => d._themes.forEach(t => themes.set(t, 0)));
    rows.filter(d => match(d, 'theme')).forEach(d => d._themes.forEach(t => themes.set(t, themes.get(t) + 1)));
    const all = [...themes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
    const top = f.moreThemes ? all : all.filter(([t], i) => i < 10 || f.theme.has(t));
    chips('dmThemes', 'Mots-clés', top.map(([t, n]) => [t, `#${t}`, n]), f.theme, 'tag');
    if (all.length > top.length || (f.moreThemes && all.length > 10)) $('dmThemes').querySelector('.dm-chips').insertAdjacentHTML('beforeend', `<button type="button" class="dm-chip dm-chip--more" data-more-themes>${f.moreThemes ? 'Moins' : `+ ${all.length - top.length}`}</button>`);

    const active = f.q.trim() || f.state.size || f.level.size || f.theme.size || f.place;
    $('dmCount').innerHTML = `<strong>${shown.length === rows.length ? plural(rows.length, 'demande', 'demandes') : `${shown.length.toLocaleString('fr-FR')} sur ${plural(rows.length, 'demande', 'demandes')}`}</strong>`
      + `${f.place ? `<button type="button" class="dm-place" data-clear-place>${esc(f.place.label)}${ico('close')}</button>` : ''}`
      + `${active ? '<button type="button" class="dm-reset" data-reset>Tout afficher</button>' : ''}`;
    const page = shown.slice(0, f.shown);
    list.innerHTML = page.length ? page.map(row).join('')
      : `<li class="dm-empty">${rows.length ? 'Aucune demande ne correspond : essayez un autre mot ou retirez un filtre.' : 'Aucune demande envoyée pour l’instant.'}</li>`;
    const rest = shown.length - page.length;
    $('dmMore').hidden = rest <= 0;
    $('dmMore').textContent = rest > 0 ? `Afficher ${Math.min(PAGE, rest)} demandes de plus (${rest.toLocaleString('fr-FR')} restantes)` : '';
    drawDots(new Set(shown.map(d => d.ref)));
  }
  function stats() {
    const n = k => rows.filter(d => d._state === k).length;
    const docs = rows.reduce((s, d) => s + d._pieces, 0);
    $('dmStats').innerHTML = [[rows.length, 'demandes envoyées', ''], [n('repondue'), 'réponses reçues', 'repondue'], [n('attente'), 'en attente', 'attente'], [n('silence'), 'sans réponse après un mois', 'silence'], [docs, 'documents obtenus', '']]
      .map(([v, l, k]) => `<div class="dm-stat${k ? ` dm-stat--${k}` : ''}"><strong>${v.toLocaleString('fr-FR')}</strong><span>${l}</span></div>`).join('');
  }

  // ---------------------------------------------------------------------------------------------------- mini-map
  // Mainland France drawn from the site's département outlines; one red dot per place written to (the body's address
  // in the official directory, else the centre of its département), grouped when they overlap.
  const K = Math.cos(46.5 * Math.PI / 180), S = 40, W = 424, H = 400;
  const proj = (lon, lat) => [(lon + 5.45) * K * S, (51.25 - lat) * S];
  const inMap = (lon, lat) => lon > -5.6 && lon < 9.9 && lat > 41.2 && lat < 51.3;
  let clusters = [], offMap = [], mapReady = false;
  function buildMap(geo) {
    const paths = [];
    for (const ft of geo.features) {
      const code = ft.properties.code, polys = ft.geometry.type === 'MultiPolygon' ? ft.geometry.coordinates : [ft.geometry.coordinates];
      depts[code] = { nom: ft.properties.nom, region: ft.properties.region };
      if (code.length > 2) continue;   // overseas: listed under the map
      let best = [], dpath = '';
      for (const poly of polys) {
        const ring = poly[0];
        if (ring.length > best.length) best = ring;
        let last = null;
        ring.forEach(([lon, lat], i) => {
          const [x, y] = proj(lon, lat);
          if (last && i < ring.length - 1 && Math.hypot(x - last[0], y - last[1]) < .7) return;
          dpath += `${last ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
          last = [x, y];
        });
        dpath += 'Z';
      }
      depts[code].c = [best.reduce((s, p) => s + p[0], 0) / best.length, best.reduce((s, p) => s + p[1], 0) / best.length];
      paths.push(`<path data-dep="${code}" d="${dpath}"/>`);
    }
    $('dmMapSvg').innerHTML = `<g class="dm-map__land">${paths.join('')}</g><g class="dm-map__dots" id="dmDots"></g>`;
    mapReady = true;
  }
  function place() {
    const pts = [];
    offMap = [];
    for (const d of rows) {
      const l = d.lieu || {}, dep = depts[l.dep];
      const ll = l.lat && l.lon && inMap(l.lon, l.lat) ? [l.lon, l.lat] : dep?.c;
      if (ll) { const [x, y] = proj(ll[0], ll[1]); pts.push({ x, y, d }); } else offMap.push(d);
    }
    clusters = [];
    for (const p of pts) {
      const c = clusters.find(c => Math.hypot(c.x - p.x, c.y - p.y) < 9);
      if (c) { c.x = (c.x * c.rows.length + p.x) / (c.rows.length + 1); c.y = (c.y * c.rows.length + p.y) / (c.rows.length + 1); c.rows.push(p.d); }
      else clusters.push({ x: p.x, y: p.y, rows: [p.d] });
    }
    clusters.forEach((c, i) => {
      c.id = i;
      const names = [...new Set(c.rows.map(shortName))];
      c.label = names.length > 2 ? `${names.slice(0, 2).join(', ')} et ${names.length - 2} autres` : names.join(' et ');
    });
  }
  function drawDots(visible) {
    if (!mapReady) return;
    const tint = new Set();   // a département or a region written to: its territory lightly tinted
    rows.filter(d => visible.has(d.ref)).forEach(d => {
      if (d.niveau === 'departement' && d.lieu?.dep) tint.add(d.lieu.dep);
      if (d.niveau === 'region' && depts[d.lieu?.dep]) Object.entries(depts).forEach(([code, v]) => { if (v.region === depts[d.lieu.dep].region) tint.add(code); });
    });
    $('dmMapSvg').querySelectorAll('.dm-map__land path').forEach(p => p.classList.toggle('is-asked', tint.has(p.dataset.dep)));
    $('dmDots').innerHTML = clusters.map(c => {
      const on = c.rows.filter(d => visible.has(d.ref)).length, r = Math.min(13, 5 + 2.4 * Math.sqrt(c.rows.length - 1));
      const sel = f.place && c.rows.some(d => f.place.refs.has(d.ref));
      return `<g class="dm-pin${on ? '' : ' is-off'}${sel ? ' is-sel' : ''}" data-c="${c.id}" tabindex="0" role="button" aria-label="${esc(c.label)} : ${plural(c.rows.length, 'demande', 'demandes')}" transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)})">`
        + `<circle class="dm-pin__halo" r="${(r + 5).toFixed(1)}"/><circle class="dm-pin__dot" r="${r.toFixed(1)}"/>${c.rows.length > 1 ? `<text dy=".35em">${c.rows.length}</text>` : ''}</g>`;
    }).join('');
    const off = offMap.filter(d => visible.has(d.ref));
    $('dmOff').hidden = !offMap.length;
    $('dmOff').innerHTML = offMap.length ? `<button type="button" class="dm-chip" data-off aria-pressed="${!!f.place?.off}">Hors de la carte <small>${off.length}</small></button>` : '';
  }
  const tip = $('dmTip');
  function showTip(g) {
    const c = clusters[+g.dataset.c], box = $('dmMap').getBoundingClientRect(), r = g.getBoundingClientRect();
    tip.innerHTML = `<strong>${esc(c.label)}</strong>${plural(c.rows.length, 'demande', 'demandes')}`;
    tip.hidden = false;
    const x = Math.min(Math.max(r.left + r.width / 2 - box.left, tip.offsetWidth / 2 + 4), box.width - tip.offsetWidth / 2 - 4);
    tip.style.left = `${x}px`;
    tip.style.top = `${r.top - box.top - 8}px`;
  }
  function pickCluster(g) {
    const c = clusters[+g.dataset.c];
    const same = f.place && !f.place.off && f.place.id === c.id;
    f.place = same ? null : { id: c.id, label: c.label, refs: new Set(c.rows.map(d => d.ref)) };
    f.shown = PAGE;
    render();
  }
  $('dmMap').addEventListener('click', e => {
    const g = e.target.closest('.dm-pin');
    if (g) return pickCluster(g);
    if (e.target.closest('[data-off]')) { f.place = f.place?.off ? null : { off: true, label: 'Hors de la carte', refs: new Set(offMap.map(d => d.ref)) }; f.shown = PAGE; render(); }
  });
  $('dmMap').addEventListener('keydown', e => { const g = e.target.closest('.dm-pin'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickCluster(g); } });
  ['pointerover', 'focusin'].forEach(t => $('dmMap').addEventListener(t, e => { const g = e.target.closest('.dm-pin'); if (g) showTip(g); }));
  ['pointerout', 'focusout'].forEach(t => $('dmMap').addEventListener(t, e => { if (e.target.closest('.dm-pin')) tip.hidden = true; }));
  // a line under the pointer shows where it is on the map
  list.addEventListener('pointerover', e => {
    const li = e.target.closest('.dm-row');
    document.querySelectorAll('.dm-pin.is-hot').forEach(g => g.classList.remove('is-hot'));
    if (!li) return;
    const c = clusters.find(c => c.rows.some(d => d.ref === li.dataset.ref));
    if (c) $('dmDots')?.querySelector(`[data-c="${c.id}"]`)?.classList.add('is-hot');
  });
  list.addEventListener('pointerleave', () => document.querySelectorAll('.dm-pin.is-hot').forEach(g => g.classList.remove('is-hot')));

  // ---------------------------------------------------------------------------------------------------- events
  function toggle(ref, force) {
    const li = document.getElementById(ref), d = rows.find(x => x.ref === ref);
    if (!d) return;
    const open = force ?? !f.open.has(ref);
    open ? f.open.add(ref) : f.open.delete(ref);
    if (!li) return;
    li.outerHTML = row(d);
    if (open) history.replaceState(null, '', `#${ref}`);
  }
  list.addEventListener('click', e => {
    const more = e.target.closest('[data-more]');
    if (more) { const body = more.previousElementSibling, was = body.classList.toggle('dm-clamp'); more.textContent = was ? 'Lire toute la lettre' : 'Replier la lettre'; return; }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const url = `${location.origin}${location.pathname}#${copy.dataset.copy}`;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { copy.textContent = 'Lien copié'; }, () => { location.hash = copy.dataset.copy; copy.textContent = 'Lien dans la barre d’adresse'; });
      return;
    }
    const tag = e.target.closest('[data-tag]');
    if (tag) { f.theme.has(tag.dataset.tag) ? f.theme.delete(tag.dataset.tag) : f.theme.add(tag.dataset.tag); f.shown = PAGE; render(); return; }
    const head = e.target.closest('.dm-row__head');
    if (head) toggle(head.closest('.dm-row').dataset.ref);
  });
  $('dmFacets').addEventListener('click', e => {
    if (e.target.closest('[data-more-themes]')) { f.moreThemes = !f.moreThemes; return render(); }
    const b = e.target.closest('.dm-chip');
    if (!b) return;
    const [key, set] = b.dataset.state ? ['state', f.state] : b.dataset.level ? ['level', f.level] : ['tag', f.theme];
    const v = b.dataset[key];
    set.has(v) ? set.delete(v) : set.add(v);
    f.shown = PAGE;
    render();
  });
  $('dmCount').addEventListener('click', e => {
    if (e.target.closest('[data-clear-place]')) f.place = null;
    else if (e.target.closest('[data-reset]')) { f.q = $('dmQ').value = ''; f.state.clear(); f.level.clear(); f.theme.clear(); f.place = null; }
    else return;
    f.shown = PAGE;
    render();
  });
  let typing;
  $('dmQ').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { f.q = $('dmQ').value; f.shown = PAGE; render(); }, 120); });
  $('dmSort').addEventListener('change', () => { f.sort = $('dmSort').value; f.shown = PAGE; render(); });
  $('dmMore').addEventListener('click', () => { f.shown += PAGE; render(); });
  $('dmMapToggle').addEventListener('click', () => {
    const side = $('dmSide'), open = side.classList.toggle('is-folded');
    $('dmMapToggle').setAttribute('aria-expanded', String(!open));
    $('dmMapToggle').firstElementChild.textContent = open ? 'Afficher la carte et les filtres' : 'Masquer la carte et les filtres';
  });
  if (window.matchMedia('(max-width: 959px)').matches) $('dmMapToggle').click();   // phone: the list first, the map and filters one tap away
  function fromHash() {
    const ref = decodeURIComponent(location.hash.slice(1));
    const i = rows.filter(d => match(d)).sort(SORTS[f.sort]).findIndex(d => d.ref === ref);
    if (!/^FRL-\d{4}-\d{4}$/.test(ref) || !rows.some(d => d.ref === ref)) return;
    if (i < 0) { f.q = $('dmQ').value = ''; f.state.clear(); f.level.clear(); f.theme.clear(); f.place = null; }
    f.shown = Math.max(f.shown, (i < 0 ? rows.sort(SORTS[f.sort]).findIndex(d => d.ref === ref) : i) + 1);
    f.open.add(ref);
    render();
    requestAnimationFrame(() => document.getElementById(ref)?.scrollIntoView({ block: 'start' }));
  }
  window.addEventListener('hashchange', fromHash);

  // ---------------------------------------------------------------------------------------------------- loading
  const api = fetch('api/assistant/demandes').then(r => r.ok ? r.json() : Promise.reject(r.status));
  const geo = fetch('./data/departments.geojson').then(r => r.ok ? r.json() : null).catch(() => null);
  api.then(async j => {
    const g = await geo;
    if (g) buildMap(g); else $('dmMap').hidden = true;
    rows = (j.demandes || []).map(prepare);
    place();
    stats();
    render();
    fromHash();
  }).catch(() => { list.innerHTML = '<li class="dm-empty">La liste des demandes est indisponible pour le moment.</li>'; });
})();
