/* Header menu, on every page: three groups (Recettes, Dépenses, Contrôle) open on click, hover or keyboard.
   Wide screens: each group drops its own panel under the button. Phones: the menu is the second header row and an
   open group shows its pages in a sheet under that row (the row scrolls sideways, so a panel inside it would be clipped). */
(() => {
  // Phones: no page zoom, except on the map (MapLibre zooms it itself). Safari ignores touch-action for pinch: block
  // its gesture events outside the map (style.css sets touch-action for the other browsers and for double taps).
  if (matchMedia('(max-width: 680px)').matches) {
    document.addEventListener('gesturestart', e => { if (!e.target.closest?.('.map, .maplibregl-map')) e.preventDefault(); }, { passive: false });
  }
  const links = document.querySelector('.nav__links');
  if (!links) return;
  const groups = [...links.querySelectorAll('.nav__group')];
  const phone = matchMedia('(max-width: 680px)');
  const sheet = document.createElement('div');
  sheet.className = 'nav-sheet'; sheet.hidden = true;
  document.querySelector('.site-header')?.appendChild(sheet);
  let open = null, byHover = false;

  function close() {
    if (!open) return;
    open.classList.remove('is-open');
    open.querySelector('.nav__toggle').setAttribute('aria-expanded', 'false');
    open = null; byHover = false; sheet.hidden = true; sheet.innerHTML = '';
  }
  function show(group, focusFirst = false) {
    if (open === group) return;
    close();
    open = group;
    group.classList.add('is-open');
    group.querySelector('.nav__toggle').setAttribute('aria-expanded', 'true');
    if (phone.matches) {
      const menu = group.querySelector('.nav__menu').cloneNode(true);
      menu.removeAttribute('id');
      sheet.innerHTML = '';
      sheet.appendChild(menu);
      sheet.hidden = false;
    }
    if (focusFirst) (phone.matches ? sheet : group).querySelector('.nav__menu a')?.focus();
  }

  groups.forEach(group => {
    const toggle = group.querySelector('.nav__toggle');
    // A click on a group that the mouse just opened keeps it open (it would otherwise open then close at once).
    toggle.addEventListener('click', event => { event.stopPropagation(); if (open === group && !byHover) close(); else { show(group); byHover = false; } });
    toggle.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(group, true); } });
    // Hover opens on devices with a real pointer only; a tap must not open then close the panel.
    group.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse' && !phone.matches && open !== group) { show(group); byHover = true; } });
    group.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && !phone.matches && open === group) close(); });
    group.addEventListener('focusout', event => { if (!phone.matches && open === group && !group.contains(event.relatedTarget)) close(); });
  });
  document.addEventListener('click', event => { if (open && !open.contains(event.target) && !sheet.contains(event.target)) close(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !open) return;
    const toggle = open.querySelector('.nav__toggle');
    close(); toggle.focus();
  });
  phone.addEventListener?.('change', close);
  addEventListener('scroll', () => { if (phone.matches) close(); }, { passive: true });
})();
