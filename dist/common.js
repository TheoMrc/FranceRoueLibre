/* Shared by the secondary pages: theme toggle, header state, number formatting, small animated SVG charts,
   and on-demand entity names (public company directory API, cached). */
(() => {
  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');
  let timer = 0;
  toggle?.addEventListener('click', () => {
    const theme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.classList.add('theme-transitioning');
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('frl-theme', theme); } catch (error) { /* storage unavailable */ }
    window.dispatchEvent(new Event('frl-theme'));
    clearTimeout(timer); timer = setTimeout(() => root.classList.remove('theme-transitioning'), (parseFloat(getComputedStyle(root).getPropertyValue('--theme-transition-duration')) || 700) + 50);
  });
  const header = document.getElementById('siteHeader');
  const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

const FRL = (() => {
  const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const money = value => {
    if (value == null || !Number.isFinite(value)) return '–';
    const a = Math.abs(value);
    if (a >= 1e9) return `${(value / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Md€`;
    if (a >= 1e6) return `${(value / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`;
    if (a >= 1e3) return `${(value / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k€`;
    return `${nf0.format(value)} €`;
  };
  const count = value => value == null ? '–' : nf0.format(value);
  const pct = (value, digits = 1) => value == null || !Number.isFinite(value) ? '–' : `${(100 * value).toLocaleString('fr-FR', { maximumFractionDigits: digits })} %`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const load = path => fetch(path).then(response => { if (!response.ok) throw new Error(path); return response.json(); });
  const sirenLink = (siren, label) => siren ? `<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/${esc(String(siren).slice(0, 9))}" target="_blank" rel="noopener noreferrer">${esc(label || siren)}</a>` : esc(label || '–');

  /* Vertical bar chart, animated on value change. data: [{label, value, highlight}] */
  function bars(container, data, { format = money, height = 220, onSelect = null } = {}) {
    const max = Math.max(...data.map(item => Math.abs(item.value || 0)), 1);
    if (!container.querySelector('.bars')) container.innerHTML = '<div class="bars" role="list"></div>';
    const wrap = container.querySelector('.bars');
    wrap.style.height = `${height}px`;
    const existing = new Map([...wrap.children].map(node => [node.dataset.key, node]));
    data.forEach((item, index) => {
      let node = existing.get(String(item.label));
      if (!node) {
        node = document.createElement('button');
        node.type = 'button'; node.className = 'bar'; node.dataset.key = String(item.label); node.setAttribute('role', 'listitem');
        node.innerHTML = '<span class="bar__fill"></span><span class="bar__label"></span>';
        node.querySelector('.bar__fill').style.height = '0%';
        if (onSelect) node.addEventListener('click', () => onSelect(item.label));
      }
      wrap.appendChild(node);
      node.title = `${item.label} : ${format(item.value)}`;
      node.classList.toggle('is-highlight', Boolean(item.highlight));
      node.querySelector('.bar__label').textContent = item.short ?? item.label;
      requestAnimationFrame(() => { node.querySelector('.bar__fill').style.height = `${Math.max(.5, 100 * Math.abs(item.value || 0) / max)}%`; });
      existing.delete(String(item.label));
    });
    existing.forEach(node => node.remove());
  }

  /* Horizontal ranked bars. rows: [{label, value, sub, href}] */
  function ranking(container, rows, { format = money, limit = 15 } = {}) {
    const top = rows.slice(0, limit);
    const max = Math.max(...top.map(row => Math.abs(row.value || 0)), 1);
    container.innerHTML = `<ol class="ranking">${top.map(row => `<li><div class="ranking__line"><span class="ranking__label">${row.html || esc(row.label)}${row.sub ? `<small>${esc(row.sub)}</small>` : ''}</span><strong>${format(row.value)}</strong></div><span class="ranking__track"><span class="ranking__fill" style="--w:${(100 * Math.abs(row.value || 0) / max).toFixed(2)}%"></span></span></li>`).join('')}</ol>`;
    requestAnimationFrame(() => container.querySelectorAll('.ranking__fill').forEach(node => node.classList.add('is-in')));
  }

  /* Names for SIREN numbers not resolved at build time (hospitals, State bodies…), from the public directory API. */
  const nameCache = new Map();
  async function resolveNames(root = document) {
    const nodes = [...root.querySelectorAll('[data-siren-name]')].filter(node => !node.dataset.resolved);
    const sirens = [...new Set(nodes.map(node => node.dataset.sirenName))].filter(siren => /^\d{9}$/.test(siren));
    for (const siren of sirens.slice(0, 40)) {
      if (!nameCache.has(siren)) {
        nameCache.set(siren, fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siren}&per_page=1`).then(r => r.ok ? r.json() : null).then(json => json?.results?.[0]?.nom_complet || null).catch(() => null));
      }
      const name = await nameCache.get(siren);
      nodes.filter(node => node.dataset.sirenName === siren).forEach(node => { node.dataset.resolved = '1'; if (name) node.textContent = name; });
    }
  }

  /* Deep links (page.html#section): sections above fill in after the jump and push the target down.
     Until the reader scrolls by hand, keep the linked section in view each time some content finishes loading. */
  let userMoved = false;
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(type => window.addEventListener(type, () => { userMoved = true; }, { once: true, passive: true }));
  const hashTarget = () => { try { return location.hash.length > 1 ? document.querySelector(decodeURIComponent(location.hash)) : null; } catch (error) { return null; } };
  function keepHash() {
    const target = hashTarget();
    if (!target || userMoved) return;
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }
  window.addEventListener('load', keepHash);

  function lazy(element, init) {
    if (!element) return;
    const run = () => Promise.resolve().then(init).finally(keepHash);
    const target = hashTarget();
    if (typeof IntersectionObserver !== 'function' || (target && (target === element || element.contains(target)))) { run(); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); run(); } }, { rootMargin: '600px 0px' });
    observer.observe(element);
  }

  return { money, count, pct, esc, load, sirenLink, bars, ranking, resolveNames, lazy, keepHash };
})();
