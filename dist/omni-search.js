/* One search box for the whole site: it looks in three places and lets the reader pick.
   - « Sur le site »: pages and sections of the site (data/site-index.json, built by scripts/site-index.py);
   - « Demander à la Loupe »: a question (Pourquoi, Combien, Qu’est-ce que…, or a sentence ending with « ? ») opens the
     Loupe with the question already asked;
   - « Chercher dans les dépenses »: the spending lines search (recherche.html?q=…).
   Enter follows the first suggestion: the Loupe for a question, a section when one matches well, the spending search
   otherwise. While the box is empty, example searches type themselves in it.
   Usage: FRLOmni.mount(container, { size: 'hero' | 'nav', examples: [...] }). */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const STOP = new Set('le la les l de des du d un une et en a au aux pour par sur dans est ce que qui quoi quel quelle quels quelles combien pourquoi comment ou on il elle se sa son ses leur leurs plus moins y'.split(' '));
  const QUESTION = /^\s*(pourquoi|combien|comment|qu[’' ]?est[- ]ce|que |quel(le)?s? |qui |quand|o[uù] |est[- ]ce|peut[- ]on|faut[- ]il|explique|c[’']est quoi)|\?\s*$/i;
  const DEFAULT_EXAMPLES = [
    'Carte des dépenses par commune', 'Emplois publics', 'Fonctionnaires',
    'De combien a augmenté la dette sous le mandat de Bruno Le Maire ?', 'Pourquoi la dette de la France augmente-t-elle ?',
    'Piscines', 'Disneyland', 'Terrain de pétanque',
  ];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let indexPromise = null;
  const siteIndex = () => indexPromise || (indexPromise = fetch('data/site-index.json').then(r => r.ok ? r.json() : { entries: [] })
    .then(d => d.entries.map(e => ({ ...e, nTitle: norm(e.title), nKeys: norm(`${e.keywords} ${e.page}`), nMore: norm(`${e.eyebrow || ''} ${e.text} ${(e.figures || []).join(' ')}`) })))
    .catch(() => []));

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

  const ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
  const ICON_LOUPE = '<svg class="omni__loupe" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 4L41 14V34L24 44L16.5 39.6L6 45.5L10.8 36.2L7 34V14Z"/><circle cx="22" cy="21" r="8.5"/><path d="M28.3 27.3L33.3 32.3"/><path class="omni__spark" d="M22 15.6Q22.8 20.2 27.4 21Q22.8 21.8 22 26.4Q21.2 21.8 16.6 21Q21.2 20.2 22 15.6Z"/></svg>';
  const ICON_LINES = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h13"/></svg>';
  const ENTER = '<kbd class="omni__enter" aria-hidden="true">Entrée ↵</kbd>';

  function mount(root, { size = 'hero', examples = DEFAULT_EXAMPLES, autofocus = false } = {}) {
    const uid = `omni${Math.random().toString(36).slice(2, 7)}`;
    root.classList.add('omni', `omni--${size}`);
    root.innerHTML = `<form class="omni__form" role="search" action="recherche.html">
        <span class="omni__ring" aria-hidden="true"></span>
        <span class="omni__icon">${ICON_SEARCH}</span>
        <label class="sr-only" for="${uid}">Rechercher sur le site, dans les dépenses ou demander à la Loupe</label>
        <input id="${uid}" name="q" type="search" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="${uid}-list" aria-autocomplete="list">
        <span class="omni__ghost" aria-hidden="true"><span class="omni__ghost-text"></span><i class="omni__caret"></i></span>
        <button class="omni__go" type="submit" aria-label="Rechercher">${size === 'hero' ? '<span>Rechercher</span>' : ''}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button>
      </form>
      <div class="omni__panel" id="${uid}-list" role="listbox" hidden></div>`;
    const form = root.querySelector('form'), input = root.querySelector('input'), panel = root.querySelector('.omni__panel');
    const ghost = root.querySelector('.omni__ghost'), ghostText = root.querySelector('.omni__ghost-text');
    let items = [], active = 0, seq = 0;

    /* ---- examples typing themselves while the box is empty ---- */
    let ex = 0, typing = null;
    function typeLoop() {
      clearTimeout(typing);
      if (input.value) { ghost.hidden = true; return; }
      ghost.hidden = false;
      if (reduce.matches) { ghostText.textContent = examples[ex % examples.length]; typing = setTimeout(() => { ex++; typeLoop(); }, 3200); return; }
      const text = examples[ex % examples.length];
      let n = 0, dir = 1;
      const step = () => {
        if (input.value) { ghost.hidden = true; return; }
        n += dir;
        ghostText.textContent = text.slice(0, n);
        if (dir > 0 && n >= text.length) { dir = -1; typing = setTimeout(step, 1700); return; }
        if (dir < 0 && n <= 0) { ex++; typing = setTimeout(typeLoop, 350); return; }
        typing = setTimeout(step, dir > 0 ? 42 + Math.random() * 40 : 18);
      };
      typing = setTimeout(step, 400);
    }

    /* ---- suggestions ---- */
    const go = item => {
      if (!item) return;
      if (item.kind === 'site') location.href = item.url;
      else if (item.kind === 'loupe') {
        close();
        if (window.FRLLoupe) window.FRLLoupe.ask(item.q);
        else location.href = `recherche.html?q=${encodeURIComponent(item.q)}`;
      } else location.href = `recherche.html?q=${encodeURIComponent(item.q)}`;
    };
    function close() { panel.hidden = true; input.setAttribute('aria-expanded', 'false'); root.classList.remove('is-open'); }
    function mark(i) {
      active = i;
      panel.querySelectorAll('[role=option]').forEach((n, k) => { n.classList.toggle('is-active', k === i); n.setAttribute('aria-selected', String(k === i)); });
      const n = panel.querySelectorAll('[role=option]')[i];
      if (n) input.setAttribute('aria-activedescendant', n.id);
    }
    async function suggest() {
      const q = input.value.trim(), my = ++seq;
      if (!q) { close(); return; }
      const site = matchSite(await siteIndex(), q);
      if (my !== seq) return;
      const question = isQuestion(q);
      const groups = [];
      const siteItems = site.map(e => ({ kind: 'site', url: e.url, title: e.title, page: e.section ? e.page : '', sub: e.eyebrow || '' }));
      const loupe = { kind: 'loupe', q };
      const lines = { kind: 'lines', q };
      /* order: a question goes to the Loupe first; a strong site match first otherwise; the spending search last */
      if (question) groups.push(['Demander à la Loupe', [loupe]], ['Sur le site', siteItems], ['Chercher dans les dépenses', [lines]]);
      else groups.push(['Sur le site', siteItems], ['Chercher dans les dépenses', [lines]], ['Demander à la Loupe', [loupe]]);
      items = [];
      panel.innerHTML = groups.filter(([, list]) => list.length).map(([title, list]) => `<div class="omni__group"><p class="omni__group-title">${esc(title)}</p>${list.map(it => {
        const i = items.push(it) - 1;
        const icon = it.kind === 'site' ? ((typeof FRL_ICONS !== 'undefined' && FRL_ICONS.forText(`${it.title} ${it.page}`)) || ICON_LINES) : it.kind === 'loupe' ? ICON_LOUPE : ICON_SEARCH;
        const body = it.kind === 'site' ? `<strong>${esc(it.title)}</strong><small>${esc(it.page || 'Page du site')}${it.sub ? ` · ${esc(it.sub)}` : ''}</small>`
          : it.kind === 'loupe' ? `<strong>« ${esc(it.q)} »</strong><small>La Loupe cherche dans les données et sur le web, puis répond avec ses sources</small>`
            : `<strong>« ${esc(it.q)} » dans les dépenses publiées</strong><small>Associations, marchés publics, projets, aides, budget de l’État</small>`;
        return `<a class="omni__item omni__item--${it.kind}" role="option" id="${uid}-o${i}" data-i="${i}" href="${it.kind === 'site' ? esc(it.url) : `recherche.html?q=${encodeURIComponent(it.q)}`}"><span class="omni__item-icon">${icon}</span><span class="omni__item-body">${body}</span>${i === 0 ? ENTER : ''}</a>`;
      }).join('')}</div>`).join('');
      panel.hidden = false;
      root.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
      mark(0);
    }

    input.addEventListener('input', () => { ghost.hidden = !!input.value; if (!input.value) typeLoop(); suggest(); });
    input.addEventListener('focus', () => { siteIndex(); if (input.value) suggest(); });
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
    panel.addEventListener('click', event => {
      const a = event.target.closest('[data-i]'); if (!a) return;
      const it = items[+a.dataset.i];
      if (it.kind === 'loupe') { event.preventDefault(); go(it); }
    });
    panel.addEventListener('pointermove', event => { const a = event.target.closest('[data-i]'); if (a) mark(+a.dataset.i); });
    document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(); });
    typeLoop();
    if (autofocus) input.focus({ preventScroll: true });
    return { input, close, suggest };
  }

  window.FRLOmni = { mount, isQuestion, matchSite: async q => matchSite(await siteIndex(), q) };
  const auto = () => document.querySelectorAll('[data-omni]').forEach(el => mount(el, { size: el.dataset.omni || 'hero' }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
