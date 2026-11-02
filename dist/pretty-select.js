/* Styled drop-down for a native <select>: the select stays in the page (form value, change events, keyboard users of
   the page scripts) but is hidden behind a button and a list drawn with the theme tokens, so the open list follows the
   light and dark themes instead of the browser's white menu. Options added or changed later by the page are picked up.
   Usage: <select data-pretty> … ; the list opens upward when there is no room below. */
(() => {
  function enhance(select) {
    if (select.dataset.prettyDone) return;
    select.dataset.prettyDone = '1';
    const wrap = document.createElement('div');
    wrap.className = 'psel';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'psel__button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    if (select.getAttribute('aria-label')) button.setAttribute('aria-label', select.getAttribute('aria-label'));
    const list = document.createElement('ul');
    list.className = 'psel__list';
    list.setAttribute('role', 'listbox');
    list.tabIndex = -1;
    list.hidden = true;
    select.after(wrap);
    wrap.append(select, button, list);
    select.classList.add('psel__native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    let active = -1;
    const options = () => [...select.options];
    function label() { button.textContent = select.selectedOptions[0]?.textContent || ''; }
    function draw() {
      list.innerHTML = '';
      options().forEach((o, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = `${select.id || 'psel'}-o${i}`;
        li.dataset.i = i;
        li.textContent = o.textContent;
        li.setAttribute('aria-selected', String(o.selected));
        if (o.disabled) li.setAttribute('aria-disabled', 'true');
        list.appendChild(li);
      });
      label();
    }
    function mark(i) {
      active = i;
      [...list.children].forEach((li, k) => li.classList.toggle('is-active', k === i));
      const li = list.children[i];
      if (li) { list.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    }
    function open() {
      draw();
      list.hidden = false;
      wrap.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
      const box = button.getBoundingClientRect();
      wrap.classList.toggle('is-up', innerHeight - box.bottom < Math.min(280, list.scrollHeight + 16) && box.top > innerHeight - box.bottom);
      mark(select.selectedIndex);
      list.focus({ preventScroll: true });
    }
    function close(focus = true) {
      if (list.hidden) return;
      list.hidden = true;
      wrap.classList.remove('is-open', 'is-up');
      button.setAttribute('aria-expanded', 'false');
      if (focus) button.focus({ preventScroll: true });
    }
    function pick(i) {
      const o = options()[i];
      if (!o || o.disabled) return;
      if (select.selectedIndex !== i) {
        select.selectedIndex = i;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      label();
      close();
    }
    button.addEventListener('click', () => (list.hidden ? open() : close()));
    button.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); open(); }
    });
    list.addEventListener('click', event => { const li = event.target.closest('li'); if (li) pick(+li.dataset.i); });
    list.addEventListener('pointermove', event => { const li = event.target.closest('li'); if (li) mark(+li.dataset.i); });
    list.addEventListener('keydown', event => {
      const n = list.children.length;
      if (event.key === 'ArrowDown') { event.preventDefault(); mark(Math.min(n - 1, active + 1)); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); mark(Math.max(0, active - 1)); }
      else if (event.key === 'Home') { event.preventDefault(); mark(0); }
      else if (event.key === 'End') { event.preventDefault(); mark(n - 1); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(active); }
      else if (event.key === 'Escape' || event.key === 'Tab') { close(event.key === 'Escape'); }
    });
    document.addEventListener('pointerdown', event => { if (!wrap.contains(event.target)) close(false); });
    select.addEventListener('change', label);
    new MutationObserver(() => { label(); if (!list.hidden) draw(); }).observe(select, { childList: true, subtree: true, attributes: true, characterData: true });
    /* the page sets select.value directly (year animation): keep the button in step */
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); label(); } });
    label();
  }
  const scan = () => document.querySelectorAll('select[data-pretty]').forEach(enhance);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
  window.FRLSelect = { enhance };
})();
