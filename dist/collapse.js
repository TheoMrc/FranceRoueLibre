/* Long tables, bar lists and sections, on every page: past LIMIT + SLACK rows, only the first LIMIT are shown, with a button to
   show them all (and to fold them again). Works on content drawn later by the page scripts (filters, sorting): a
   container that the reader opened stays open when it is redrawn. Tables that already page themselves (a « Afficher… »
   button of their own) and elements marked data-full are left alone. */
(() => {
  const LIMIT = 12, SLACK = 6;
  const SELECTOR = '.table-wrap table, ul.tx-bars, ol.tx-bars, .ranking';
  const opened = new WeakSet();
  const nf = n => n.toLocaleString('fr-FR');
  // Writing the same text again would be seen by the observer below and start an endless loop.
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

  const rowsOf = el => el.tagName === 'TABLE' ? [...(el.tBodies[0]?.rows || [])] : [...el.children].filter(c => c.tagName === 'LI');
  const holder = el => el.closest('.table-wrap') || el;
  const pagesItself = box => {
    const scope = box.parentElement || box;
    return !!scope.querySelector('.tx-more, .ug-more, .more-btn') ||
      [...scope.querySelectorAll('button')].some(b => !b.classList.contains('clip-more__btn') && /^\s*Afficher/.test(b.textContent));
  };

  function apply(el) {
    if (el.closest('[data-full], .nav, .nav-sheet, dialog, .tx-tip')) return;
    const box = holder(el);
    const rows = rowsOf(el);
    let bar = box.nextElementSibling?.classList.contains('clip-more') ? box.nextElementSibling : null;
    if (rows.length <= LIMIT + SLACK || pagesItself(box)) { bar?.remove(); el.classList.remove('is-clipped'); rows.forEach(r => r.classList.remove('clip-hidden')); return; }
    const open = opened.has(box);
    rows.forEach((r, i) => r.classList.toggle('clip-hidden', !open && i >= LIMIT));
    el.classList.toggle('is-clipped', !open);
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'clip-more';
      bar.innerHTML = '<button type="button" class="clip-more__btn"></button>';
      box.after(bar);
      bar.firstChild.addEventListener('click', () => {
        const wasOpen = opened.has(box);
        wasOpen ? opened.delete(box) : opened.add(box);
        const target = box.querySelector(SELECTOR) || box;
        apply(target.matches(SELECTOR) ? target : el);
        if (wasOpen) box.scrollIntoView({ block: 'nearest' });
      });
    }
    const word = el.tagName === 'TABLE' ? 'lignes' : 'éléments';
    setText(bar.firstChild, open ? 'Réduire' : `Afficher les ${nf(rows.length)} ${word}`);
    bar.firstChild.setAttribute('aria-expanded', String(open));
  }

  /* Long sections (content pages only, not the home page): past FOLD screens, a section is cut to one screen and a half
     with a fade and a button; it opens by itself when a link leads into it. */
  const FOLD = 1.6;
  const contentPage = !!document.querySelector('.hero--page');
  const unfolded = new WeakSet();
  function fold(section) {
    const inner = section.querySelector(':scope > .container');
    if (!inner) return;
    let bar = section.querySelector(':scope > .fold-more');
    const keep = Math.max(900, Math.round(innerHeight * 1.5));
    const tall = inner.scrollHeight > Math.max(1400, innerHeight * FOLD);
    if (!tall || unfolded.has(section)) {
      section.classList.remove('is-folded'); inner.style.maxHeight = '';
      if (bar && !unfolded.has(section)) bar.remove();
      if (bar && unfolded.has(section)) bar.hidden = !tall;
      return;
    }
    section.classList.add('is-folded');
    inner.style.maxHeight = `${keep}px`;
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'fold-more container';
      bar.innerHTML = '<button type="button" class="clip-more__btn"></button>';
      section.appendChild(bar);
      bar.firstChild.addEventListener('click', () => {
        if (unfolded.has(section)) { unfolded.delete(section); fold(section); section.scrollIntoView({ block: 'start' }); }
        else { unfolded.add(section); fold(section); }
        label(section);
      });
    }
    bar.hidden = false;
    label(section);
  }
  function label(section) {
    const btn = section.querySelector(':scope > .fold-more button');
    if (!btn) return;
    const open = unfolded.has(section);
    const title = section.querySelector('h2')?.textContent.trim();
    setText(btn, open ? 'Replier la section' : `Voir toute la section${title ? ` « ${title.length > 48 ? `${title.slice(0, 46)}…` : title} »` : ''}`);
    btn.setAttribute('aria-expanded', String(open));
  }
  const sections = () => contentPage ? [...document.querySelectorAll('main > section.section:not(.related)')] : [];
  function openFor(target) {
    const section = target?.closest?.('main > section.section');
    if (section?.classList.contains('is-folded')) { unfolded.add(section); fold(section); label(section); }
  }
  const fromHash = hash => { try { return hash && hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null; } catch { return null; } };
  // Before the browser jumps to an in-page link, open the folded section that holds its target.
  document.addEventListener('click', event => {
    const a = event.target.closest?.('a[href*="#"]');
    if (a && a.pathname === location.pathname) openFor(fromHash(a.hash));
  }, true);
  addEventListener('hashchange', () => { const t = fromHash(location.hash); openFor(t); t?.scrollIntoView(); });

  let queued = false;
  const scan = () => {
    queued = false;
    document.querySelectorAll(SELECTOR).forEach(apply);
    sections().forEach(fold);
    if (location.hash && !scan.done) { scan.done = true; const t = fromHash(location.hash); if (t) { openFor(t); t.scrollIntoView(); } }
  };
  let resizeTimer = 0;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(queue, 200); });
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(scan); } };
  new MutationObserver(records => {
    // Ignore the changes this script makes itself (classes, its own buttons).
    if (records.some(r => r.type === 'childList' && ![...r.addedNodes].every(n => n.nodeType === 1 && (n.classList?.contains('clip-more') || n.classList?.contains('fold-more'))))) queue();
  }).observe(document.body, { childList: true, subtree: true });
  queue();
})();
