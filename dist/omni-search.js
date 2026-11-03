/* One search for the whole site, used by the big box of the home page and by the header box of every page. It looks
   in three places and lets the reader pick:
   - « Sur le site »: pages and sections of the site (data/site-index.json, built by scripts/site-index.py);
   - « Demander à la Loupe »: a question (Pourquoi, Combien, Qu’est-ce que…, or a sentence ending with « ? ») opens the
     Loupe with the question already asked;
   - « Communes » / « Département »: a commune or a département typed by its name (even misspelt), its postal code or
     its number (places.js, api/lieux), to its accounts on the map; under the first commune, a row of buttons to each
     level (its intercommunality, département, region), the projects the State funded and its elected officials;
   - « Chercher dans les dépenses »: the spending lines search (recherche.html?q=…), with the words of the published
     lines that start like the query and their number of lines (search-core.js, loaded on first use).
   Enter follows the first suggestion: the Loupe for a question, a section when one matches, the spending search
   otherwise. In the big box, example searches type themselves while it is empty.
   Usage: FRLOmni.mount(container, { size: 'hero' }) builds a box; FRLOmni.attach(form, input, panel) gives an existing
   box (the header's) the same suggestions. */
(() => {
  const here = document.currentScript?.src || location.href;
  const asset = path => new URL(path, here).href;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const STOP = new Set('le la les l de des du d un une et en a au aux pour par sur dans est ce que qui quoi quel quelle quels quelles combien pourquoi comment ou on il elle se sa son ses leur leurs plus moins y'.split(' '));
  const QUESTION = /^\s*(pourquoi|combien|comment|qu[’' ]?est[- ]ce|que |quel(le)?s? |qui |quand|o[uù] |est[- ]ce|peut[- ]on|faut[- ]il|explique|c[’']est quoi)|\?\s*$/i;
  const DEFAULT_EXAMPLES = [
    'Carte des dépenses par commune', 'Levallois-Perret', 'Emplois publics', 'Fonctionnaires',
    'De combien a augmenté la dette sous le mandat de Bruno Le Maire ?', '33000', 'Pourquoi la dette de la France augmente-t-elle ?',
    'Piscines', 'Combien a coûté le nouveau fauteuil de Gérard Larcher ?', 'Disneyland', 'Terrain de pétanque',
  ];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const results = asset('recherche.html');
  const spendUrl = q => `${results}?q=${encodeURIComponent(q)}`;

  let indexPromise = null;
  const siteIndex = () => indexPromise || (indexPromise = fetch(asset('data/site-index.json')).then(r => r.ok ? r.json() : { entries: [] })
    .then(d => d.entries.map(e => ({ ...e, url: asset(e.url), nTitle: norm(e.title), nKeys: norm(`${e.keywords} ${e.page}`), nMore: norm(`${e.eyebrow || ''} ${e.text} ${(e.figures || []).join(' ')}`) })))
    .catch(() => []));
  /* the spending lexicon (search-core.js): optional, only where the search index is published */
  let corePromise = null;
  const core = () => corePromise || (corePromise = window.FRLSearch ? Promise.resolve(window.FRLSearch) : new Promise(resolve => {
    fetch(asset('data/search/meta.json'), { method: 'HEAD' }).then(r => {
      if (!r.ok) return resolve(null);
      const s = Object.assign(document.createElement('script'), { src: asset('search-core.js') });
      s.onload = () => resolve(window.FRLSearch || null); s.onerror = () => resolve(null);
      document.head.appendChild(s);
    }).catch(() => resolve(null));
  }));

  /* communes and départements (places.js, api/lieux) */
  let placesPromise = null;
  const placesLib = () => placesPromise || (placesPromise = window.FRLPlaces ? Promise.resolve(window.FRLPlaces) : new Promise(resolve => {
    const s = Object.assign(document.createElement('script'), { src: asset('places.js') });
    s.onload = () => resolve(window.FRLPlaces || null); s.onerror = () => resolve(null);
    document.head.appendChild(s);
  }));
  const ICON_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

  /* « de Lyon », « d’Audenge », « du Havre », « des Mureaux » */
  const ofName = n => /^Le /.test(n) ? `du ${n.slice(3)}` : /^Les /.test(n) ? `des ${n.slice(4)}` : /^[aeiouyhâàéèêëîïôöûüAEIOUYHÂÀÉÈÊËÎÏÔÖÛÜ]/.test(n) ? `d’${n}` : `de ${n}`;
  const isQuestion = q => QUESTION.test(q) && norm(q).split(' ').length >= 3;
  /* pages and sections that match the words typed; the last word may be unfinished */
  function matchSite(entries, q) {
    const words = norm(q).split(' ').filter(w => w.length > 1 && !STOP.has(w));
    if (!words.length) return [];
    return entries.map(e => {
      /* every word must match for a short query; for a sentence (a question), most of its words */
      let score = 0, hits = 0, strong = 0;
      for (const [i, w] of words.entries()) {
        const pre = i === words.length - 1 && w.length >= 3;
        const has = text => pre ? new RegExp(`(^| )${w}`).test(text) : new RegExp(`(^| )${w}( |s |x |$)`).test(text);
        const s = has(e.nTitle) ? 3 : has(e.nKeys) ? 2 : has(e.nMore) ? 1 : 0;
        if (s) { hits++; score += s; if (s > 1) strong++; }
      }
      const need = words.length <= 2 ? words.length : Math.ceil(words.length / 2);
      if (hits < need || !strong) return null;
      return { e, score: score / words.length + (e.section ? 0 : .2) };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 5).map(x => x.e);
  }
  const euros = v => { const a = Math.abs(v), f = (x, d) => x.toLocaleString('fr-FR', { maximumFractionDigits: d });
    return a >= 1e9 ? `${f(v / 1e9, 1)} Md€` : a >= 1e6 ? `${f(v / 1e6, 1)} M€` : a >= 1e3 ? `${f(v / 1e3, 0)} k€` : `${f(v, 0)} €`; };

  const ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
  const ICON_SPARK = '<svg class="omni__spark-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3Q12.3 10.7 20 12Q12.3 13.3 11 21Q9.7 13.3 2 12Q9.7 10.7 11 3Z"/><path d="M19 1.5Q19.4 3.6 21.5 4Q19.4 4.4 19 6.5Q18.6 4.4 16.5 4Q18.6 3.6 19 1.5Z"/></svg>';
  const ICON_LOUPE = '<svg class="omni__loupe" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 4L41 14V34L24 44L16.5 39.6L6 45.5L10.8 36.2L7 34V14Z"/><circle cx="22" cy="21" r="8.5"/><path d="M28.3 27.3L33.3 32.3"/><path class="omni__spark" d="M22 15.6Q22.8 20.2 27.4 21Q22.8 21.8 22 26.4Q21.2 21.8 16.6 21Q21.2 20.2 22 15.6Z"/></svg>';
  const ICON_LINES = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h13"/></svg>';
  const ENTER = '<kbd class="omni__enter" aria-hidden="true">Entrée ↵</kbd>';
  let uidN = 0;

  /* Suggestions under any search input. panel: an empty element placed near the input. */
  function attach(form, input, panel, { root = form } = {}) {
    const uid = input.id || `omni${++uidN}`;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-controls', panel.id || (panel.id = `${uid}-list`));
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    panel.classList.add('omni__panel');
    panel.setAttribute('role', 'listbox');
    panel.hidden = true;
    let items = [], active = 0, seq = 0;

    const go = item => {
      if (!item) return;
      if (item.kind === 'site' || item.kind === 'place') { close(); location.href = item.url; }
      else if (item.kind === 'loupe') {
        close(); input.blur();
        if (window.FRLLoupe) window.FRLLoupe.ask(item.q);
        else location.href = spendUrl(item.q);
      } else location.href = spendUrl(item.q);
    };
    function close() { panel.hidden = true; input.setAttribute('aria-expanded', 'false'); root.classList.remove('is-open'); }
    function mark(i) {
      active = i;
      const opts = panel.querySelectorAll('[role=option]');
      opts.forEach((n, k) => { n.classList.toggle('is-active', k === i); n.setAttribute('aria-selected', String(k === i)); });
      if (opts[i]) { input.setAttribute('aria-activedescendant', opts[i].id); opts[i].scrollIntoView({ block: 'nearest' }); }
    }
    async function suggest() {
      const q = input.value.trim(), my = ++seq;
      if (!q) { close(); return; }
      const [entries, engine, lib] = await Promise.all([siteIndex(), core(), placesLib()]);
      const where = lib && !isQuestion(q) ? await lib.find(q) : null;
      let words = [];
      if (engine && !isQuestion(q)) { try { words = (await engine.suggest(q)).filter(s => engine.norm(s.text) !== engine.norm(q)).slice(0, 3); } catch { words = []; } }
      if (my !== seq) return;
      const site = matchSite(entries, q).map(e => ({ kind: 'site', url: e.url, title: e.title, page: e.section ? e.page : '', sub: e.eyebrow || '' }));
      const spend = [{ kind: 'lines', q }, ...words.map(w => ({ kind: 'lines', q: w.text, count: w.count, amount: w.amount }))];
      /* a commune or a département typed: the Loupe is offered the question a reader means by it */
      const placeQ = !where || !lib?.sure(where) ? '' : where.communes.length === 1 || (where.communes.length && where.type !== 'departement')
        ? `Quelles sont les informations disponibles sur les dépenses ${ofName(where.communes[0].nom)} (${where.communes[0].dep}) ?`
        : where.departement ? `Quelles sont les informations disponibles sur les dépenses du département ${where.departement.nom} (${where.departement.code}) ?` : '';
      const loupe = [{ kind: 'loupe', q: placeQ || q }];
      const place = [];
      if (where?.departement) place.push({ kind: 'place', url: lib.deptUrl(where.departement), title: `${where.departement.nom} (${where.departement.code})`, sub: 'Département · ses comptes et ses communes sur la carte', icon: ICON_PIN });
      for (const [k, c] of (where?.communes || []).slice(0, where?.departement ? 2 : 4).entries()) {
        const fix = c.correspondance === 'approchant' ? 'Vouliez-vous dire ? · ' : '';
        place.push({ kind: 'place', url: lib.mapUrl(c), title: c.nom, sub: `${fix}${c.dep_nom} (${c.dep})${c.population ? ` · ${lib.people(c.population)}` : ''}`, icon: ICON_PIN, links: k === 0 ? c.liens : null });
      }
      const placeTitle = where?.type === 'approchant' ? 'Commune (orthographe approchante)' : where?.departement && !where.communes.length ? 'Département' : 'Communes';
      const placeFirst = lib && lib.sure(where);
      const groups = isQuestion(q)
        ? [['Demander à la Loupe', loupe], ['Sur le site', site], ['Chercher dans les dépenses', spend]]
        : placeFirst ? [[placeTitle, place], ['Sur le site', site], ['Chercher dans les dépenses', spend], ['Demander à la Loupe', loupe]]
          : [['Sur le site', site], [placeTitle, place], ['Chercher dans les dépenses', spend], ['Demander à la Loupe', loupe]];
      items = [];
      panel.innerHTML = groups.filter(([, list]) => list.length).map(([title, list]) => `<div class="omni__group"><p class="omni__group-title">${esc(title)}</p>${list.map(it => {
        const i = items.push(it) - 1;
        const icon = it.kind === 'place' ? it.icon : it.kind === 'site' ? ((typeof FRL_ICONS !== 'undefined' && FRL_ICONS.forText(`${it.title} ${it.page}`)) || ICON_LINES) : it.kind === 'loupe' ? ICON_LOUPE : ICON_SEARCH;
        const body = it.kind === 'place' ? `<strong>${esc(it.title)}</strong><small>${esc(it.sub)}</small>`
          : it.kind === 'site' ? `<strong>${esc(it.title)}</strong><small>${esc(it.page || 'Page du site')}${it.sub ? ` · ${esc(it.sub)}` : ''}</small>`
          : it.kind === 'loupe' ? `<strong>« ${esc(it.q)} »</strong><small>La Loupe cherche dans les données et sur le web, puis répond avec ses sources</small>`
            : it.count != null ? `<strong>${esc(it.q)}</strong><small>${it.count.toLocaleString('fr-FR')} ligne${it.count > 1 ? 's' : ''}${it.amount ? ` · ${euros(it.amount)}` : ''} dans les dépenses publiées</small>`
              : `<strong>« ${esc(it.q)} » dans les dépenses publiées</strong><small>Associations, marchés publics, projets, aides, budget de l’État</small>`;
        const link = `<a class="omni__item omni__item--${it.kind}" role="option" id="${uid}-o${i}" data-i="${i}" href="${it.kind === 'site' || it.kind === 'place' ? esc(it.url) : esc(spendUrl(it.q))}"><span class="omni__item-icon">${icon}</span><span class="omni__item-body">${body}</span>${i === 0 ? ENTER : ''}</a>`;
        return it.links?.length && window.FRLPlaces ? `${link}<div class="omni__chips">${FRLPlaces.chips(it.links, { attr: 'data-side' })}</div>` : link;
      }).join('')}</div>`).join('');
      panel.hidden = false;
      root.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
      mark(0);
    }
    let timer = 0;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(suggest, 90); });
    input.addEventListener('focus', () => { siteIndex(); core(); placesLib(); if (input.value.trim()) suggest(); });
    input.addEventListener('keydown', event => {
      if (panel.hidden) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); mark(Math.min(items.length - 1, active + 1)); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); mark(Math.max(0, active - 1)); }
      else if (event.key === 'Escape') close();
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const q = input.value.trim();
      if (!q) { input.focus(); return; }
      if (!panel.hidden && items[active]) go(items[active]);
      else go(isQuestion(q) ? { kind: 'loupe', q } : { kind: 'lines', q });
    });
    panel.addEventListener('mousedown', event => event.preventDefault());   // keep the focus in the input
    panel.addEventListener('click', event => {
      const side = event.target.closest('[data-side]');
      if (side) { event.preventDefault(); close(); location.href = side.href; return; }   // a level of the commune
      const a = event.target.closest('[data-i]'); if (!a) return;
      event.preventDefault(); go(items[+a.dataset.i]);
    });
    panel.addEventListener('pointermove', event => { const a = event.target.closest('[data-i]'); if (a) mark(+a.dataset.i); });
    document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(); });
    return { close, suggest };
  }

  /* The big box (home page) */
  function mount(root, { size = 'hero', examples = DEFAULT_EXAMPLES } = {}) {
    const uid = `omni${++uidN}`;
    root.classList.add('omni', `omni--${size}`);
    root.innerHTML = `<form class="omni__form" role="search" action="${esc(results)}">
        <span class="omni__ring" aria-hidden="true"></span>
        <span class="omni__icon">${ICON_SEARCH}</span>
        <label class="sr-only" for="${uid}">Rechercher sur le site, dans les dépenses ou demander à la Loupe</label>
        <input id="${uid}" name="q" type="search" autocomplete="off" spellcheck="false">
        <span class="omni__ghost" aria-hidden="true"><span class="omni__ghost-inner"><span class="omni__ghost-text"></span><i class="omni__caret"></i></span></span>
        <button class="omni__go" type="submit" aria-label="Rechercher"><span>Rechercher</span>${ICON_SPARK}</button>
      </form>
      <div class="omni__panel" id="${uid}-list" hidden></div>`;
    const form = root.querySelector('form'), input = root.querySelector('input'), panel = root.querySelector('.omni__panel');
    const ghost = root.querySelector('.omni__ghost'), ghostText = root.querySelector('.omni__ghost-text'), ghostInner = root.querySelector('.omni__ghost-inner');
    /* a long example scrolls to the left as it is typed, so the end being typed stays in view */
    const goBtn = root.querySelector('.omni__go');
    /* the example stops before the button, whatever its width (« Rechercher » on a wide screen, an icon on a phone) */
    /* and starts exactly where the reader's own text starts (the icon and paddings differ between phone and PC) */
    const fitGhost = () => {
      if (goBtn?.offsetWidth) ghost.style.right = `${form.clientWidth - goBtn.offsetLeft + 10}px`;
      const f = form.getBoundingClientRect(), r = input.getBoundingClientRect();
      if (r.width) ghost.style.left = `${r.left - f.left + (parseFloat(getComputedStyle(input).paddingLeft) || 0)}px`;
    };
    addEventListener('resize', fitGhost, { passive: true });
    const setGhost = text => { fitGhost(); ghostText.textContent = text; const over = Math.max(0, ghostInner.scrollWidth - ghost.clientWidth); ghostInner.style.transform = `translateX(${-over}px)`; ghost.classList.toggle('is-scrolled', over > 0); };
    /* examples typing themselves while the box is empty */
    let ex = 0, typing = null;
    function typeLoop() {
      clearTimeout(typing);
      if (input.value) { ghost.hidden = true; return; }
      ghost.hidden = false;
      const text = examples[ex % examples.length];
      if (reduce.matches) { setGhost(text); typing = setTimeout(() => { ex++; typeLoop(); }, 3200); return; }
      let n = 0, dir = 1;
      const step = () => {
        if (input.value) { ghost.hidden = true; return; }
        n += dir;
        setGhost(text.slice(0, n));
        if (dir > 0 && n >= text.length) { dir = -1; typing = setTimeout(step, 1700); return; }
        if (dir < 0 && n <= 0) { ex++; typing = setTimeout(typeLoop, 350); return; }
        typing = setTimeout(step, dir > 0 ? 42 + Math.random() * 40 : 18);
      };
      typing = setTimeout(step, 400);
    }
    input.addEventListener('input', () => { ghost.hidden = !!input.value; if (!input.value) typeLoop(); });
    typeLoop();
    return attach(form, input, panel, { root });
  }

  window.FRLOmni = { mount, attach, isQuestion, matchSite: async q => matchSite(await siteIndex(), q) };
  const auto = () => document.querySelectorAll('[data-omni]').forEach(el => mount(el, { size: el.dataset.omni || 'hero' }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
