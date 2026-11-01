/* Touch screens: the charts' hover tooltips, by finger. The charts are written for a mouse (pointermove shows the
   tooltip, pointerleave hides it); a finger gives neither at the right moment. On a touch device this script:
   - turns a tap, or a finger dragged sideways over a chart, into the mouse moves the charts expect, at the finger's
     position, with the tooltip lifted above the finger so it is not hidden under it;
   - keeps the tooltip after the finger lifts, until another tap elsewhere or a scroll (the « leave » a mouse would give);
   - makes the first tap on a chart item show its tooltip, and a second tap on the same item open it (the click a
     mouse would give), instead of jumping away at once.
   Links, buttons, form fields, the map (its own gestures) and the AI panel are left alone. */
(() => {
  if (!matchMedia('(hover: none), (pointer: coarse)').matches) return;
  const SKIP = '.maplibregl-map, a, button, input, select, textarea, label, summary, [role="button"], .ai-panel, .ai-fab, .site-header, .nav-sheet';
  const LIFT = 64;                         // px: the tooltip goes above the finger
  let current = null;                      // element the finger « hovers »
  let tapItem = null, armed = null, lastDown = 0;
  const changes = new MutationObserver(() => {});
  changes.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

  const itemOf = el => el.closest('[data-id], .tx-dot, .tx-cell') || el;
  const mouse = (type, x, y, bubbles = true) => {
    const init = { bubbles, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1, isPrimary: true, view: window };
    return type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init);
  };
  function leave(next) {
    if (!current) return;
    current.dispatchEvent(mouse('pointerout', -1, -1)); current.dispatchEvent(mouse('mouseout', -1, -1));
    for (let n = current; n && n !== document.documentElement && !(next && n.contains(next)); n = n.parentElement) {
      n.dispatchEvent(mouse('pointerleave', -1, -1, false)); n.dispatchEvent(mouse('mouseleave', -1, -1, false));
    }
    current = next;
  }
  /* Mouse moves at (x, y) on the element under the finger. True if the page reacted (tooltip, highlight…). */
  function hoverAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el.closest(SKIP)) { leave(null); return false; }
    const ly = Math.max(8, y - LIFT);
    changes.takeRecords();
    if (el !== current) { leave(el); el.dispatchEvent(mouse('pointerover', x, ly)); el.dispatchEvent(mouse('mouseover', x, ly)); }
    current = el;
    el.dispatchEvent(mouse('pointermove', x, ly)); el.dispatchEvent(mouse('mousemove', x, ly));
    return changes.takeRecords().length > 0;
  }

  addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || e.target.closest?.('.maplibregl-map')) return;
    lastDown = Date.now();
    const reacted = hoverAt(e.clientX, e.clientY);
    tapItem = reacted ? itemOf(document.elementFromPoint(e.clientX, e.clientY)) : null;
  }, true);
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || e.target.closest?.('.maplibregl-map')) return;
    e.stopImmediatePropagation();          // replaced by the lifted mouse move below
    hoverAt(e.clientX, e.clientY);
  }, true);
  // the finger lifting is not the mouse leaving: keep the tooltip
  ['pointerleave', 'pointerout'].forEach(type => addEventListener(type, e => {
    if (e.pointerType === 'touch' && !e.target.closest?.('.maplibregl-map')) e.stopImmediatePropagation();
  }, true));
  // the page scrolls under the finger: hide, as a mouse leaving would
  addEventListener('pointercancel', e => { if (e.pointerType === 'touch') { tapItem = null; leave(null); } }, true);
  addEventListener('scroll', () => { if (Date.now() - lastDown > 300) leave(null); }, { passive: true, capture: true });
  // first tap on an item: its tooltip only; second tap on the same item: the click
  addEventListener('click', e => {
    if (Date.now() - lastDown > 800 || !tapItem || e.target.closest?.(SKIP)) return;
    if (armed === tapItem) { armed = null; return; }
    armed = tapItem;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
})();
