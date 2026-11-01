/* Wide tables and charts that scroll sideways (phones mostly): show that there is more to the right.
   Every horizontal scroller gets faded edges on the side that hides content, a « Faire glisser » hint under it until
   the reader scrolls it, and, the first time it comes into view, a short nudge to the right and back.
   Works on content drawn later by the page scripts (tables filtered, charts redrawn). */
(() => {
  const SEL = '.table-wrap, .cx-stage, .history-scroll, .sector-table-wrap, .cx-panel, .mode-tabs, [data-scroll-x]';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const known = new WeakSet();

  function update(el) {
    const max = el.scrollWidth - el.clientWidth;
    const can = max > 6 && el.clientWidth > 0;
    el.classList.toggle('sx', can);
    el.classList.toggle('sx-left', can && el.scrollLeft > 4);
    el.classList.toggle('sx-right', can && el.scrollLeft < max - 4);
  }
  function nudge(el) {
    if (!el.classList.contains('sx') || el.dataset.sxNudged || reduce.matches || el.scrollLeft > 0) return;
    el.dataset.sxNudged = '1';
    el.scrollTo({ left: Math.min(72, el.scrollWidth - el.clientWidth), behavior: 'smooth' });
    setTimeout(() => { el.scrollTo({ left: 0, behavior: 'smooth' }); el.classList.remove('sx-used'); }, 700);
  }
  const seen = new IntersectionObserver(entries => entries.forEach(e => {
    if (!e.isIntersecting) return;
    update(e.target);
    setTimeout(() => nudge(e.target), 350);
  }), { threshold: 0.6 });
  const sized = new ResizeObserver(entries => entries.forEach(e => update(e.target)));

  function attach(el) {
    if (known.has(el)) return;
    known.add(el);
    el.addEventListener('scroll', () => {
      update(el);
      if (!el.dataset.sxNudged || el.scrollLeft > 80) el.classList.add('sx-used');
    }, { passive: true });
    seen.observe(el);
    sized.observe(el);
    if (el.firstElementChild) sized.observe(el.firstElementChild);
    update(el);
  }
  let queued = false;
  const scan = () => { queued = false; document.querySelectorAll(SEL).forEach(el => { attach(el); update(el); }); };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(scan); } };
  scan();
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  addEventListener('resize', later);
})();
