/* Défilement doux à la molette, comme sur zebrafish-research.com et bio-devs.com : Lenis (vendor/lenis.min.js),
   même réglage (1,15 s, freinage exponentiel), le tactile reste natif.
   - Les liens internes (#section) glissent jusqu'à leur cible en tenant compte de l'en-tête (scroll-padding-top).
   - La molette garde son rôle natif là où elle sert à autre chose : zoom de la carte, listes et panneaux qui
     défilent tout seuls (suggestions, Loupe, tableaux), boîtes de dialogue.
   - Rien ne change pour qui demande moins d'animations (prefers-reduced-motion). */
(() => {
  if (!window.Lenis || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const KEEP_NATIVE = '.maplibregl-map, dialog, .ai-panel, [data-lenis-prevent]';
  const lenis = new Lenis({
    duration: 1.15,
    easing: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    syncTouch: false,
    allowNestedScroll: true,          // une liste qui peut encore défiler garde la molette
    prevent: node => node.matches?.(KEEP_NATIVE),
    autoRaf: true
  });
  window.lenis = lenis;

  // Liens vers une section de la page : glissement doux, l'adresse garde le #ancre.
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href*="#"]');
    if (!link || link.target === '_blank') return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || url.hash.length < 2) return;
    let target = null;
    try { target = document.querySelector(decodeURIComponent(url.hash)); } catch (error) { return; }
    if (!target) return;
    event.preventDefault();
    if (location.hash !== url.hash) history.pushState(null, '', url.hash);
    lenis.scrollTo(target);
  });
})();
