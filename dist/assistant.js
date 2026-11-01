/* AI assistant panel, on every page (server/assistant_api.py behind /api/assistant/). It only shows when the server
   says a model can answer: on the static preview without the API, or once the budgets are spent, nothing appears.
   The conversation stays in this tab (sessionStorage) and is sent with each question; the server keeps nothing. */
(() => {
  const API = 'api/assistant/';
  const KEY = 'frl-assistant';
  const EXAMPLES = [
    'Combien Rennes dépense-t-elle en frais de personnel, et par habitant ?',
    'Quelles subventions publiques pour la vidéoprotection, et à qui ?',
    'Combien coûtent les niches fiscales en 2026 ?',
  ];
  let state = { messages: [], open: false, provider: 'auto' };
  let status = null, busy = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = () => { try { Object.assign(state, JSON.parse(sessionStorage.getItem(KEY) || '{}')); } catch { /* private mode */ } };
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ ...state, messages: state.messages.slice(-20) })); } catch { /* full or blocked */ } };

  /* Answers use a small subset of Markdown: paragraphs, lists, **bold**, [links](https://…). Everything is escaped
     first, and only http(s) or site-relative links become anchors. */
  function inline(text) {
    let s = esc(text);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|\.\/)?[^\s)]+)\)/g, (m, label, url) => {
      if (/^(javascript|data|vbscript):/i.test(url.replace(/&amp;/g, '&'))) return label;
      const ext = /^https?:/i.test(url) && !/^https?:\/\/(www\.)?francerouelibre\.fr/i.test(url);
      return `<a href="${url}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return s;
  }
  function markdown(text) {
    const out = [];
    let list = null;
    const flush = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
    let para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      const bullet = /^[-*•]\s+(.*)$/.exec(line), num = /^\d+[.)]\s+(.*)$/.exec(line), head = /^#{1,4}\s+(.*)$/.exec(line);
      if (bullet || num) {
        flushPara();
        const tag = bullet ? 'ul' : 'ol';
        if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; }
        list.items.push((bullet || num)[1]);
      } else if (!line) { flushPara(); flush(); }
      else if (head) { flushPara(); flush(); out.push(`<p><strong>${inline(head[1])}</strong></p>`); }
      else { flush(); para.push(line); }
    }
    flushPara(); flush();
    return out.join('');
  }

  // ------------------------------------------------------------------------------------------------ elements
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = './assistant.css';
  const fab = document.createElement('button');
  fab.type = 'button'; fab.className = 'ai-fab'; fab.hidden = true;
  fab.setAttribute('aria-haspopup', 'dialog');
  fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" fill="currentColor"/><path d="M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="currentColor"/></svg><span>Poser une question</span>';
  const panel = document.createElement('section');
  panel.className = 'ai-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Assistant IA de FranceRoueLibre');
  panel.innerHTML = `
    <header class="ai-head">
      <div><strong>Assistant IA</strong><small>Données du site et recherche web</small></div>
      <label class="ai-model"><span class="ai-sr">Modèle</span><select></select></label>
      <button type="button" class="ai-icon" data-act="reset" title="Nouvelle discussion" aria-label="Nouvelle discussion"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button type="button" class="ai-icon" data-act="close" title="Fermer" aria-label="Fermer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    </header>
    <div class="ai-log" aria-live="polite"></div>
    <form class="ai-form">
      <p class="ai-note">Réponses rédigées par une IA (Gemini ou Claude) : elle peut se tromper, vérifiez avec les sources. Vos questions sont envoyées à Google ou à Anthropic : n’y mettez pas d’informations personnelles. <a href="mentions.html#assistant">En savoir plus</a></p>
      <div class="ai-row">
        <textarea rows="1" placeholder="Votre question sur l’argent public…" aria-label="Votre question"></textarea>
        <button type="submit" class="ai-send" aria-label="Envoyer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </form>`;
  const log = panel.querySelector('.ai-log'), form = panel.querySelector('.ai-form'), input = panel.querySelector('textarea');
  const select = panel.querySelector('select'), send = panel.querySelector('.ai-send');

  // ------------------------------------------------------------------------------------------------ rendering
  function stepsHtml(steps, running) {
    if (!steps?.length) return running ? '<p class="ai-wait">Réflexion…</p>' : '';
    const items = steps.map(s => `<li class="${s.done ? (s.ok ? 'is-ok' : 'is-bad') : 'is-run'}">${esc(s.label)}${s.summary ? ` <small>${esc(s.summary)}</small>` : ''}</li>`).join('');
    const last = steps[steps.length - 1];
    return `<details class="ai-steps"${running ? ' open' : ''}><summary>${running ? esc(last.label) + '…' : `${steps.length} étape${steps.length > 1 ? 's' : ''} de recherche`}</summary><ol>${items}</ol></details>`;
  }
  function messageHtml(m, i) {
    if (m.role === 'user') return `<div class="ai-msg ai-msg--user">${esc(m.text).replace(/\n/g, '<br>')}</div>`;
    const sources = (m.sources || []).length ? `<div class="ai-sources"><span>Sources web :</span>${m.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`).join('')}</div>` : '';
    const searches = (m.searches || []).length ? `<div class="ai-sources ai-searches"><span>Recherches Google :</span>${m.searches.map(q => `<a href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener noreferrer">${esc(q)}</a>`).join('')}</div>` : '';
    const meta = m.label ? `<div class="ai-meta">${esc(m.label)}${m.s ? ` · ${Math.round(m.s)} s` : ''}</div>` : '';
    const body = m.error ? `<p class="ai-error">${esc(m.error)}</p>` : markdown(m.text);
    return `<div class="ai-msg ai-msg--bot" data-i="${i}">${stepsHtml(m.steps, m.running)}${m.running ? '' : body + sources + searches + meta}</div>`;
  }
  function render() {
    const intro = `<div class="ai-msg ai-msg--bot ai-intro"><p>Bonjour ! Je cherche dans les données publiées sur ce site (comptes des collectivités, budget de l’État, impôts, subventions, marchés publics…) et sur le web pour répondre à vos questions.</p><div class="ai-examples">${EXAMPLES.map(e => `<button type="button">${esc(e)}</button>`).join('')}</div></div>`;
    log.innerHTML = intro + state.messages.map(messageHtml).join('');
    log.scrollTop = log.scrollHeight;
    const running = !!busy;
    send.classList.toggle('is-stop', running);
    send.setAttribute('aria-label', running ? 'Arrêter' : 'Envoyer');
    send.innerHTML = running ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function openPanel(open) {
    state.open = open; save();
    panel.hidden = !open; fab.hidden = open || !status?.enabled;
    fab.setAttribute('aria-expanded', String(open));
    if (open) { render(); setTimeout(() => input.focus(), 30); } else fab.focus();
  }

  // ------------------------------------------------------------------------------------------------ asking
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function ask(text) {
    text = text.trim();
    if (!text || busy) return;
    const limit = status?.limits?.question_chars || 1500;
    if (text.length > limit) text = text.slice(0, limit);
    state.messages.push({ role: 'user', text });
    const bot = { role: 'assistant', text: '', steps: [], running: true };
    state.messages.push(bot);
    input.value = ''; autosize();
    busy = { cancel: false, job: null };
    render();
    const history = state.messages.filter(m => !m.running && !m.error && m.text).map(m => ({ role: m.role, text: m.text }));
    try {
      const r = await fetch(API + 'ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, provider: state.provider }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.job) throw new Error(data.error || `Erreur ${r.status}`);
      busy.job = data.job;
      let after = 0, fails = 0;
      for (;;) {
        await sleep(800);
        let j;
        try {
          const res = await fetch(`${API}job/${data.job}?after=${after}`);
          j = await res.json();
          if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`);
          fails = 0;
        } catch (e) { if (++fails > 5) throw e; continue; }
        after = j.next;
        for (const ev of j.events) {
          if (ev.type === 'model') bot.label = ev.label;
          if (ev.type === 'tool_start') bot.steps.push({ label: ev.label });
          if (ev.type === 'tool_done') Object.assign(bot.steps[bot.steps.length - 1] || {}, { done: true, ok: ev.ok, summary: ev.summary });
        }
        if (j.done) {
          const res = j.result || {};
          Object.assign(bot, { running: false, text: res.reply || '', error: res.error || '', sources: res.sources || [], searches: res.searches || [], label: res.label || bot.label, s: res.s });
          break;
        }
        render();
      }
    } catch (e) {
      Object.assign(bot, { running: false, error: e.message || 'Assistant injoignable.' });
    }
    bot.steps.forEach(s => { s.done = true; if (s.ok === undefined) s.ok = false; });
    busy = null;
    save(); render();
    if (!state.open) fab.classList.add('has-news');
  }

  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (busy) { if (busy.job) fetch(`${API}job/${busy.job}/cancel`, { method: 'POST' }).catch(() => {}); return; }
    ask(input.value);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  input.addEventListener('input', autosize);
  log.addEventListener('click', e => { const b = e.target.closest('.ai-examples button'); if (b) ask(b.textContent); });
  panel.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') openPanel(false);
    if (act === 'reset' && !busy) { state.messages = []; save(); render(); input.focus(); }
  });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') openPanel(false); });
  select.addEventListener('change', () => { state.provider = select.value; save(); });
  fab.addEventListener('click', () => { fab.classList.remove('has-news'); openPanel(true); });

  // ------------------------------------------------------------------------------------------------ start
  async function start() {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(API + 'status', { signal: ctrl.signal });
      if (!r.ok) return;
      status = await r.json();
    } catch { return; }
    if (!status?.enabled) return;
    load();
    state.messages = state.messages.filter(m => !m.running);
    const ok = status.providers.filter(p => p.available);
    select.innerHTML = '<option value="auto">Auto</option>' + ok.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
    if (![...select.options].some(o => o.value === state.provider)) state.provider = 'auto';
    select.value = state.provider;
    select.parentElement.hidden = ok.length < 2;
    input.maxLength = status.limits?.question_chars || 1500;
    document.head.appendChild(css);
    document.body.append(fab, panel);
    if (state.open) openPanel(true); else fab.hidden = false;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
