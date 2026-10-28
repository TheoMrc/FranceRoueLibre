/* Header search box with suggestions, on every page. The engine (search-core.js and the SQLite worker)
   is loaded only when the box is first focused. */
(() => {
  const here = document.currentScript?.src || location.href;
  const asset = path => new URL(path, here).href;
  const results = asset('recherche.html');
  const actions = document.querySelector('.nav__actions');
  if (!actions || document.querySelector('.nav-search')) return;

  const form = document.createElement('form');
  form.className = 'nav-search';
  form.setAttribute('role', 'search');
  form.action = results;
  form.innerHTML = `<label class="sr-only" for="navSearch">Rechercher dans les dépenses publiques</label>
    <svg class="nav-search__icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m13 13 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <input id="navSearch" name="q" type="search" placeholder="Rechercher une dépense…" autocomplete="off" spellcheck="false" aria-autocomplete="list" aria-controls="navSearchList" aria-expanded="false">
    <ul class="nav-search__list" id="navSearchList" role="listbox" hidden></ul>`;
  actions.prepend(form);
  const input = form.querySelector('input'), list = form.querySelector('ul');
  const params = new URLSearchParams(location.search);
  if (location.pathname.endsWith('recherche.html') && params.get('q')) input.value = params.get('q');

  let core = null, timer = 0, active = -1, items = [], seq = 0;
  const ensure = () => core || (core = new Promise((resolve, reject) => {
    if (window.FRLSearch) { resolve(window.FRLSearch); return; }
    const script = Object.assign(document.createElement('script'), { src: asset('search-core.js') });
    script.onload = () => resolve(window.FRLSearch); script.onerror = reject;
    document.head.appendChild(script);
  }));
  const go = text => { if (text.trim()) location.href = `${results}?q=${encodeURIComponent(text.trim())}`; };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const paint = () => {
    list.innerHTML = items.map((item, i) => `<li role="option" id="navOpt${i}" class="${i === active ? 'is-active' : ''}" data-i="${i}" aria-selected="${i === active}">
      ${item.kind === 'go' ? `<span>Rechercher « <strong>${window.FRLSearch.escapeHtml(item.text)}</strong> »</span>` : `<span>${window.FRLSearch.escapeHtml(item.text)}</span><small>${item.count.toLocaleString('fr-FR')} lignes</small>`}</li>`).join('');
    list.hidden = !items.length; input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    if (active >= 0) input.setAttribute('aria-activedescendant', `navOpt${active}`); else input.removeAttribute('aria-activedescendant');
  };
  async function update() {
    const text = input.value, mine = ++seq;
    if (!text.trim()) { items = []; close(); return; }
    const engine = await ensure();
    let suggestions = [];
    try { suggestions = await engine.suggest(text); } catch (error) { suggestions = []; }
    if (mine !== seq) return;
    items = [{ kind: 'go', text }, ...suggestions.filter(s => engine.norm(s.text) !== engine.norm(text)).map(s => ({ kind: 'term', ...s }))];
    active = -1; paint();
  }
  input.addEventListener('focus', () => { ensure().then(engine => engine.db()).catch(() => {}); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 120); });
  input.addEventListener('keydown', event => {
    if (list.hidden) return;
    if (event.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); paint(); event.preventDefault(); }
    else if (event.key === 'ArrowUp') { active = Math.max(-1, active - 1); paint(); event.preventDefault(); }
    else if (event.key === 'Escape') close();
    else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); go(items[active].text); }
  });
  list.addEventListener('mousedown', event => { const li = event.target.closest('[data-i]'); if (li) { event.preventDefault(); go(items[Number(li.dataset.i)].text); } });
  form.addEventListener('submit', event => { event.preventDefault(); go(input.value); });
  document.addEventListener('click', event => { if (!form.contains(event.target)) close(); });
})();
