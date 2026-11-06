/* « Faire remonter » under each finished answer of the Loupe (assistant.js): the question, the answer and its sources
   are kept for the tab (sessionStorage) and open the report form of signalements.html, prefilled. On every page. */
(() => {
  const here = document.currentScript?.src || location.href;
  const target = new URL('signalements.html#signaler', here).href;
  const css = document.createElement('style');
  css.textContent = `.ai-signal{display:inline-flex;align-items:center;gap:.35rem;margin-top:.6rem;padding:.25rem .7rem;border:1px solid var(--c-line);border-radius:999px;
    background:var(--c-bg);color:var(--c-ink);font-size:.76rem;font-weight:600;text-decoration:none;transition:border-color .2s,transform .2s}
    .ai-signal:hover{border-color:#e11d48;transform:translateY(-1px)}.ai-signal svg{width:14px;height:14px;color:#e11d48}`;
  document.head.appendChild(css);
  const FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>';
  function add(msg) {
    const extra = msg.querySelector('.ai-extra'), text = msg.querySelector('.ai-text');
    if (!extra || !text || extra.querySelector('.ai-signal') || msg.querySelector('.ai-error')) return;
    if (!msg.querySelector('.ai-foot')?.textContent.trim()) return;   // still writing
    let ask = msg.previousElementSibling;
    while (ask && !ask.classList.contains('ai-msg--user')) ask = ask.previousElementSibling;
    if (/^Préparer un signalement/.test(ask?.textContent.trim() || '')) return;   // already written into the form of signalements.html
    const a = document.createElement('a');
    a.className = 'ai-signal'; a.href = target;
    a.innerHTML = `${FLAG}Faire remonter ce point`;
    a.title = 'Préparer un signalement citoyen à partir de cette réponse';
    a.addEventListener('click', () => {
      let q = msg.previousElementSibling;
      while (q && !q.classList.contains('ai-msg--user')) q = q.previousElementSibling;
      const sources = [...msg.querySelectorAll('.ai-chips a[href^="http"]')].map(x => ({ title: x.textContent.trim(), url: x.href }));
      try {
        sessionStorage.setItem('frl-signalement', JSON.stringify({ question: q?.textContent.trim() || '', reponse: text.innerText.trim().slice(0, 6000), sources }));
      } catch (e) { /* private mode: the form opens empty */ }
    });
    extra.appendChild(a);
  }
  const scan = () => document.querySelectorAll('.ai-panel .ai-msg--bot').forEach(add);
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
