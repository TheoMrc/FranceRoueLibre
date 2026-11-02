/* Header search box, on every page. It gives the same suggestions as the big box of the home page (omni-search.js,
   loaded here when the page does not already have it): pages and sections of the site, the Loupe for a question,
   the spending search for a word. Pictograms (icons.js) are used when the page loads them. */
(() => {
  const here = document.currentScript?.src || location.href;
  const asset = path => new URL(path, here).href;
  const actions = document.querySelector('.nav__actions');
  if (!actions || document.querySelector('.nav-search')) return;

  const form = document.createElement('form');
  form.className = 'nav-search';
  form.setAttribute('role', 'search');
  form.action = asset('recherche.html');
  form.innerHTML = `<label class="sr-only" for="navSearch">Rechercher sur le site, dans les dépenses ou demander à la Loupe</label>
    <svg class="nav-search__icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m13 13 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <input id="navSearch" name="q" type="search" placeholder="Une page, une question, une dépense…" autocomplete="off" spellcheck="false">
    <div class="nav-search__panel" id="navSearchList" hidden></div>`;
  actions.prepend(form);
  const input = form.querySelector('input'), panel = form.querySelector('.nav-search__panel');
  const params = new URLSearchParams(location.search);
  if (location.pathname.endsWith('recherche.html') && params.get('q')) input.value = params.get('q');

  const load = src => new Promise(resolve => {
    const s = Object.assign(document.createElement('script'), { src: asset(src) });
    s.onload = s.onerror = resolve;
    document.head.appendChild(s);
  });
  let ready = null;
  const ensure = () => ready || (ready = (window.FRLOmni ? Promise.resolve() : load('omni-search.js'))
    .then(() => (typeof FRL_ICONS === 'undefined' ? load('icons.js') : null))
    .then(() => window.FRLOmni?.attach(form, input, panel)));
  /* until the code is there, a typed search still works: Enter goes to the results page */
  form.addEventListener('submit', event => { if (!ready) { event.preventDefault(); if (input.value.trim()) location.href = `${form.action}?q=${encodeURIComponent(input.value.trim())}`; } });
  input.addEventListener('focus', () => ensure().then(() => { if (input.value.trim()) input.dispatchEvent(new Event('input')); }), { once: true });
  if (window.FRLOmni) ensure();
})();
