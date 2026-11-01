/* AI assistant panel, on every page (server/assistant_api.py behind /api/assistant/). It only shows when the server
   says a model can answer: on the static preview without the API, or once the budgets are spent, nothing appears.
   Conversations are kept in this browser (localStorage, « Historique ») and sent with each question; the server keeps
   nothing. Test the animations without spending a token: assistant_demo.bat (or assistant_api.py --fake).
   The model button shows the models' logos from dist/img/ai/ (gemini.svg, claude.svg: Icons8, credited in mentions.html). */
(() => {
  const API = 'api/assistant/';
  const STORE = 'frl-assistant-v2', UI = 'frl-assistant-ui';
  const MAX_CONVS = 30, MAX_MSGS = 40;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const PROVIDERS = { gemini: { label: 'Gemini', img: './img/ai/gemini.svg' }, claude: { label: 'Claude', img: './img/ai/claude.svg' } };
  const EXAMPLES = [
    'Combien Rennes dépense-t-elle en frais de personnel, et par habitant ?',
    'Quelles subventions publiques pour la vidéoprotection, et à qui ?',
    'Combien coûtent les niches fiscales en 2026 ?',
  ];
  let status = null, busy = null, provider = 'auto', store = { v: 1, convs: [], current: null };
  const logoOK = {};

  // ------------------------------------------------------------------------------------------------ helpers
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (s, k, d) => { try { return JSON.parse(s.getItem(k)) ?? d; } catch { return d; } };
  const write = (s, k, v) => { try { s.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const label = p => PROVIDERS[p]?.label || p;
  const when = t => {
    const d = (Date.now() - t) / 1000;
    if (d < 60) return 'à l’instant';
    if (d < 3600) return `il y a ${Math.round(d / 60)} min`;
    if (d < 86400) return `il y a ${Math.round(d / 3600)} h`;
    return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  /* The logo: a hexagonal speech bubble drawn in one stroke, a magnifying glass, a spark in the lens. Its parts are
     animated by assistant.css (thinking, writing, idle). Colours come from the shared gradient defined below. */
  const LOGO = (cls = '') => `<svg class="ai-logo ${cls}" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path class="l-bubble" pathLength="100" d="M24 4L41 14V34L24 44L16.5 39.6L6 45.5L10.8 36.2L7 34V14Z"/><g class="l-lens"><circle cx="22" cy="21" r="8.5"/><path d="M28.3 27.3L33.3 32.3"/></g><path class="l-spark" d="M22 15.6Q22.8 20.2 27.4 21Q22.8 21.8 22 26.4Q21.2 21.8 16.6 21Q21.2 20.2 22 15.6Z"/></svg>`;
  const DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><linearGradient id="ai-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#0e7490"/><stop offset="1" stop-color="#2563eb"/></linearGradient><linearGradient id="ai-grad-dark" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#2cc2dc"/><stop offset="1" stop-color="#5b8ef7"/></linearGradient></defs></svg>';
  const ICON = {
    history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const provBadge = (p, text = label(p)) => p ? `<span class="ai-prov ai-prov--${esc(p)}">${logoOK[p] ? `<img src="${PROVIDERS[p].img}" alt="">` : '<i aria-hidden="true"></i>'}<span>${esc(text)}</span></span>` : '';

  /* Answers use a small subset of Markdown: paragraphs, lists, **bold**, *italic*, [links](https://…). Everything is
     escaped first, and only http(s) or site-relative links become anchors. */
  function inline(text) {
    let s = esc(text);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|\.\/)?[^\s)]+)\)/g, (m, text, url) => {
      if (/^(javascript|data|vbscript):/i.test(url.replace(/&amp;/g, '&'))) return text;
      const ext = /^https?:/i.test(url) && !/^https?:\/\/(www\.)?francerouelibre\.fr/i.test(url);
      return `<a href="${url}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
    });
    return s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }
  function markdown(text) {
    const out = [];
    let list = null, para = [];
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      const bullet = /^[-*•]\s+(.*)$/.exec(line), num = /^\d+[.)]\s+(.*)$/.exec(line), head = /^#{1,4}\s+(.*)$/.exec(line);
      if (bullet || num) {
        flushPara();
        const tag = bullet ? 'ul' : 'ol';
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push((bullet || num)[1]);
      } else if (!line) { flushPara(); flushList(); }
      else if (head) { flushPara(); flushList(); out.push(`<p class="ai-h">${inline(head[1])}</p>`); }
      else { flushList(); para.push(line); }
    }
    flushPara(); flushList();
    return out.join('');
  }

  // ------------------------------------------------------------------------------------------------ storage
  function loadStore() {
    const s = read(localStorage, STORE, null);
    if (s && Array.isArray(s.convs)) store = { v: 1, convs: s.convs.filter(c => c && Array.isArray(c.messages)), current: s.current || null };
    provider = read(localStorage, UI, {}).provider || 'auto';
  }
  function saveStore() {
    store.convs = store.convs.filter(c => c.messages.length).sort((a, b) => b.updated - a.updated).slice(0, MAX_CONVS);
    store.convs.forEach(c => { c.messages = c.messages.slice(-MAX_MSGS); });
    if (!write(localStorage, STORE, store) && store.convs.length > 1) { store.convs.pop(); saveStore(); }
  }
  const current = () => store.convs.find(c => c.id === store.current) || null;
  function startConv(question) {
    const c = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: question.slice(0, 90), updated: Date.now(), messages: [] };
    store.convs.unshift(c); store.current = c.id;
    return c;
  }

  // ------------------------------------------------------------------------------------------------ elements
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = './assistant.css';
  const defs = document.createElement('div');
  defs.innerHTML = DEFS;
  const fab = document.createElement('button');
  fab.type = 'button'; fab.className = 'ai-fab'; fab.hidden = true;
  fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML = `<span class="ai-fab__icon">${LOGO('ai-logo--mono')}</span><span class="ai-fab__text"><strong>Poser une question</strong><small>La Loupe · données publiques et web</small></span>`;
  const panel = document.createElement('section');
  panel.className = 'ai-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'La Loupe, agent IA de FranceRoueLibre');
  panel.innerHTML = `
    <header class="ai-head">
      <div class="ai-head__brand">${LOGO('ai-logo--head')}<div><strong>La Loupe</strong><small>Fouille les données et le web</small></div><span class="ai-demo" hidden>Démo</span></div>
      <button type="button" class="ai-icon" data-act="history" title="Historique" aria-label="Historique">${ICON.history}</button>
      <button type="button" class="ai-icon" data-act="new" title="Nouvelle discussion" aria-label="Nouvelle discussion">${ICON.plus}</button>
      <button type="button" class="ai-icon" data-act="close" title="Fermer" aria-label="Fermer">${ICON.close}</button>
    </header>
    <div class="ai-body">
      <div class="ai-log"></div>
      <aside class="ai-hist" aria-label="Historique des discussions" hidden>
        <div class="ai-hist__head"><button type="button" class="ai-icon" data-act="hist-close" aria-label="Retour">${ICON.back}</button><strong>Historique</strong><button type="button" class="ai-link" data-act="hist-clear">Tout effacer</button></div>
        <p class="ai-hist__note">Gardé dans ce navigateur seulement.</p>
        <ul class="ai-hist__list"></ul>
      </aside>
    </div>
    <form class="ai-form">
      <div class="ai-row">
        <button type="button" class="ai-model"><span class="ai-model__icon"></span><span class="ai-model__swap" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2 4.5h7.5L7.5 2.5M10 7.5H2.5l2 2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="ai-model__tip" aria-hidden="true"></span></button>
        <textarea rows="1" placeholder="Votre question sur l’argent public…" aria-label="Votre question"></textarea>
        <button type="submit" class="ai-send" aria-label="Envoyer">${ICON.send}</button>
      </div>
      <p class="ai-note">Réponses rédigées par une IA, à vérifier avec les sources. Vos questions sont envoyées à Google ou à Anthropic : n’y mettez pas d’informations personnelles. <a href="mentions.html#assistant">En savoir plus</a></p>
    </form>
    <p class="ai-sr" aria-live="polite"></p>`;
  const $ = s => panel.querySelector(s);
  const log = $('.ai-log'), form = $('.ai-form'), input = $('textarea'), send = $('.ai-send'), modelBtn = $('.ai-model');
  const hist = $('.ai-hist'), histList = $('.ai-hist__list'), live = $('.ai-sr'), headLogo = $('.ai-logo--head');

  // ------------------------------------------------------------------------------------------------ model switch
  /* One small button cycles Auto (the Loupe's logo: the first model available answers, the other takes over if it
     fails) → Gemini → Claude, skipping a model that cannot answer now. */
  const modes = () => ['auto', ...status.providers.filter(p => p.available).map(p => p.id)];
  const modeIcon = p => p === 'auto' || !logoOK[p] ? (p === 'auto' ? LOGO() : `<i class="ai-model__dot ai-model__dot--${esc(p)}"></i>`) : `<img src="${PROVIDERS[p].img}" alt="">`;
  function syncModel(animate) {
    if (!modes().includes(provider)) provider = 'auto';
    const name = provider === 'auto' ? 'Auto' : label(provider);
    const info = status.providers.find(p => p.id === provider);
    const help = provider === 'auto' ? 'le premier modèle disponible répond, l’autre prend le relais en cas de panne'
      : `${name} répond seul${info?.until ? ` (disponible jusqu’au ${new Date(info.until).toLocaleDateString('fr-FR')})` : ''}`;
    modelBtn.querySelector('.ai-model__icon').innerHTML = modeIcon(provider);
    modelBtn.querySelector('.ai-model__tip').textContent = name;
    modelBtn.dataset.p = provider;
    modelBtn.title = `Modèle : ${name}, ${help}. Cliquer pour changer.`;
    modelBtn.setAttribute('aria-label', `Modèle : ${name}. Changer de modèle`);
    modelBtn.hidden = modes().length < 2;
    if (animate) { modelBtn.classList.remove('is-switch'); void modelBtn.offsetWidth; modelBtn.classList.add('is-switch'); }
  }
  modelBtn.addEventListener('click', () => {
    const list = modes();
    provider = list[(list.indexOf(provider) + 1) % list.length];
    write(localStorage, UI, { provider });
    syncModel(true);
    live.textContent = `Modèle : ${provider === 'auto' ? 'Auto' : label(provider)}`;
  });

  // ------------------------------------------------------------------------------------------------ messages
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  const stick = was => { if (was) log.scrollTop = log.scrollHeight; };

  function introHtml() {
    return `<div class="ai-intro">${LOGO('ai-logo--intro')}<p><strong>Une question sur l’argent public ?</strong><br>Je fouille les données publiées sur ce site (comptes des collectivités, budget de l’État, impôts, subventions, marchés publics…) et sur le web, puis je réponds avec mes sources.</p><div class="ai-examples">${EXAMPLES.map((e, i) => `<button type="button" style="--i:${i}">${esc(e)}</button>`).join('')}</div><p class="ai-support">La Loupe vit de vos dons : <a href="https://fr.tipeee.com/francerouelibre/" target="_blank" rel="noopener">la soutenir sur Tipeee</a></p></div>`;
  }
  function userEl(m) {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg--user';
    el.innerHTML = `<div class="ai-bubble">${esc(m.text).replace(/\n/g, '<br>')}</div>`;
    return el;
  }
  /* One answer. Built once, then updated piece by piece while it runs, so the animations are not restarted. */
  function botView(m) {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg--bot';
    el.innerHTML = `<div class="ai-av">${LOGO()}<span class="ai-av__p" title=""></span></div><div class="ai-card"><div class="ai-notes"></div><details class="ai-steps" hidden><summary></summary><ol></ol></details><div class="ai-think" hidden></div><div class="ai-text"></div><div class="ai-extra"></div><div class="ai-foot"></div></div>`;
    const q = s => el.querySelector(s);
    const v = {
      el,
      setRunning(on) { el.classList.toggle('is-running', on); },
      think(text) {
        const t = q('.ai-think');
        el.classList.toggle('is-thinking', !!text);
        if (!text) { t.hidden = true; return; }
        t.hidden = false;
        t.innerHTML = `<span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="ai-shimmer">${esc(text)}</span>`;
      },
      step(s, fresh) {
        const d = q('.ai-steps');
        d.hidden = false;
        const li = document.createElement('li');
        li.className = s.done ? (s.ok ? 'is-ok' : 'is-bad') : 'is-run';
        if (!fresh) li.classList.add('no-anim');
        li.innerHTML = `<span class="ai-step__label">${esc(s.label)}</span>${s.summary ? `<small>${esc(s.summary)}</small>` : ''}`;
        q('.ai-steps ol').appendChild(li);
        v.summary(m.running);
      },
      stepDone(s) {
        const li = q('.ai-steps ol li:last-child');
        if (!li) return;
        li.className = s.ok ? 'is-ok' : 'is-bad';
        if (s.summary) li.insertAdjacentHTML('beforeend', `<small>${esc(s.summary)}</small>`);
      },
      summary(running) {
        const n = m.steps.length, d = q('.ai-steps');
        d.querySelector('summary').textContent = running ? 'Recherches en cours' : `${n} étape${n > 1 ? 's' : ''} de recherche`;
        d.open = !!running;
      },
      note(n) {
        if (!n || !PROVIDERS[n.from] || !PROVIDERS[n.to]) return;
        q('.ai-notes').insertAdjacentHTML('beforeend', `<p class="ai-switch"><strong>${esc(label(n.from))}</strong> n’a pas pu répondre. <strong>${esc(label(n.to))}</strong> prend le relais.</p>`);
      },
      provider(p) {
        const av = q('.ai-av'), b = q('.ai-av__p');
        if (b.dataset.p === p) return;
        b.dataset.p = p || ''; b.title = p ? label(p) : '';
        b.innerHTML = p && logoOK[p] ? `<img src="${PROVIDERS[p].img}" alt="">` : '';
        av.classList.remove('is-flip'); void av.offsetWidth; av.classList.add('is-flip');
      },
      text(html) { q('.ai-text').innerHTML = html; },
      async type(text) {
        const box = q('.ai-text');
        if (reduce.matches || !text) { box.innerHTML = markdown(text); return; }
        el.classList.add('is-writing');
        const total = text.length, dur = Math.min(4200, Math.max(700, total * 10)), t0 = performance.now();
        await new Promise(done => {
          const tick = now => {
            const k = Math.min(1, (now - t0) / dur), was = nearBottom();
            let n = Math.ceil(total * (1 - Math.pow(1 - k, 1.6)));
            const space = text.indexOf(' ', n);
            if (k < 1 && space > 0 && space - n < 12) n = space;  // whole words only
            box.innerHTML = markdown(text.slice(0, n));
            if (k < 1) {
              const last = box.querySelector('p:last-child, li:last-child') || box;
              last.insertAdjacentHTML('beforeend', '<span class="ai-caret" aria-hidden="true"></span>');
              stick(was);
              requestAnimationFrame(tick);
            } else { stick(was); done(); }
          };
          requestAnimationFrame(tick);
        });
        el.classList.remove('is-writing');
      },
      finish() {
        v.think(null); v.setRunning(false);
        if (m.steps.length) v.summary(false);
        const parts = [];
        if (m.sources?.length) parts.push(`<div class="ai-chips"><span>Sources web</span>${m.sources.map((s, i) => `<a style="--i:${i}" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`).join('')}</div>`);
        if (m.searches?.length) parts.push(`<div class="ai-chips ai-chips--search"><span>Recherches Google</span>${m.searches.map((s, i) => `<a style="--i:${i + 2}" href="https://www.google.com/search?q=${encodeURIComponent(s)}" target="_blank" rel="noopener noreferrer">${esc(s)}</a>`).join('')}</div>`);
        q('.ai-extra').innerHTML = parts.join('');
        q('.ai-foot').innerHTML = m.provider ? `${provBadge(m.provider, m.label || label(m.provider))}${m.s ? `<span>${Math.round(m.s)} s</span>` : ''}` : '';
        if (m.error) q('.ai-text').innerHTML = `<p class="ai-error">${esc(m.error)}</p>`;
      },
    };
    if (m.provider) v.provider(m.provider);
    return v;
  }
  function staticBot(m) {
    const v = botView(m);
    v.el.classList.add('no-anim');
    (m.notes || []).forEach(n => v.note(n));
    (m.steps || []).forEach(s => v.step({ ...s, done: true }, false));
    v.text(markdown(m.text));
    v.finish();
    return v.el;
  }
  function renderLog() {
    const c = current();
    log.innerHTML = '';
    if (!c || !c.messages.length) { log.innerHTML = introHtml(); return; }
    for (const m of c.messages) log.appendChild(m.role === 'user' ? userEl(m) : staticBot(m));
    log.querySelectorAll('.ai-msg').forEach(e => e.classList.add('no-anim'));
    log.style.scrollBehavior = 'auto';
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; log.style.scrollBehavior = ''; });
  }

  // ------------------------------------------------------------------------------------------------ asking
  function setBusy(on) {
    panel.classList.toggle('is-busy', on);
    fab.classList.toggle('is-busy', on);
    send.classList.toggle('is-stop', on);
    send.setAttribute('aria-label', on ? 'Arrêter' : 'Envoyer');
    send.innerHTML = on ? ICON.stop : ICON.send;
    modelBtn.disabled = on;
  }
  async function ask(text) {
    text = text.trim();
    if (!text || busy) return;
    const limit = status?.limits?.question_chars || 1500;
    if (text.length > limit) text = text.slice(0, limit);
    const c = current() || startConv(text);
    const intro = log.querySelector('.ai-intro');
    if (intro) intro.remove();
    const history = c.messages.filter(m => !m.error && m.text).map(m => ({ role: m.role, text: m.text }));
    history.push({ role: 'user', text });
    c.messages.push({ role: 'user', text }); c.updated = Date.now(); saveStore();
    log.appendChild(userEl({ text }));
    send.classList.add('is-sent');
    setTimeout(() => send.classList.remove('is-sent'), 450);
    input.value = ''; autosize();
    const m = { role: 'assistant', text: '', steps: [], notes: [], running: true, provider: null };
    const v = botView(m);
    v.setRunning(true); v.think('Réflexion');
    log.appendChild(v.el); log.scrollTop = log.scrollHeight;
    busy = { job: null };
    setBusy(true);
    try {
      const r = await fetch(API + 'ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-11), provider }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.job) throw new Error(data.error || `Erreur ${r.status}`);
      busy.job = data.job;
      let after = 0, fails = 0;
      for (;;) {
        await sleep(650);
        let j;
        try {
          const res = await fetch(`${API}job/${data.job}?after=${after}`);
          j = await res.json();
          if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`);
          fails = 0;
        } catch (e) { if (++fails > 6) throw e; continue; }
        after = j.next;
        const was = nearBottom();
        for (const ev of j.events) {
          if (ev.type === 'model') { m.provider = ev.provider; m.label = ev.label; v.provider(ev.provider); }
          if (ev.type === 'think') v.think(m.steps.length ? 'Analyse des résultats' : 'Réflexion');
          if (ev.type === 'tool_start') { const s = { label: ev.label }; m.steps.push(s); v.think(null); v.step(s, true); }
          if (ev.type === 'tool_done') { const s = m.steps[m.steps.length - 1]; if (s) { Object.assign(s, { ok: ev.ok, summary: ev.summary, done: true }); v.stepDone(s); } }
          if (ev.type === 'switch') {
            const note = { from: ev.from, to: ev.to };
            m.notes.push(note); v.note(note);
          }
        }
        stick(was);
        if (j.done) {
          const res = j.result || {};
          Object.assign(m, { text: res.reply || '', error: res.error || '', sources: res.sources || [], searches: res.searches || [],
            label: res.label || m.label, provider: res.provider || m.provider, s: res.s });
          break;
        }
      }
    } catch (e) {
      m.error = e.message || 'La Loupe est injoignable.';
    }
    m.running = false;
    m.steps.forEach(s => { if (!s.done) Object.assign(s, { done: true, ok: false }); });
    v.think(null);
    if (!m.error) await v.type(m.text);
    v.finish();
    if (m.error) v.el.classList.add('has-error');
    live.textContent = m.error ? `Erreur : ${m.error}` : `Réponse : ${m.text.replace(/[*#[\]]/g, '').slice(0, 600)}`;
    delete m.running;
    c.messages.push(m); c.updated = Date.now(); saveStore();
    busy = null;
    setBusy(false);
    if (panel.hidden) fab.classList.add('has-news');
  }

  // ------------------------------------------------------------------------------------------------ history
  function renderHistory() {
    histList.innerHTML = store.convs.length ? store.convs.map((c, i) => `<li style="--i:${i}"><button type="button" class="ai-hist__open" data-id="${esc(c.id)}"${c.id === store.current ? ' aria-current="true"' : ''}><span>${esc(c.title)}</span><small>${when(c.updated)} · ${c.messages.filter(m => m.role === 'user').length} question(s)</small></button><button type="button" class="ai-icon" data-del="${esc(c.id)}" aria-label="Supprimer cette discussion">${ICON.trash}</button></li>`).join('')
      : '<li class="ai-hist__empty">Aucune discussion pour l’instant.</li>';
  }
  function showHistory(on) {
    if (busy && on) return;
    hist.hidden = !on;
    panel.classList.toggle('has-hist', on);
    if (on) { renderHistory(); hist.querySelector('button')?.focus(); }
  }

  // ------------------------------------------------------------------------------------------------ open / close
  function openPanel(open) {
    if (open === !panel.hidden) return;
    write(sessionStorage, UI, { open });
    if (open) {
      panel.hidden = false; fab.hidden = true; fab.classList.remove('has-news');
      panel.classList.remove('is-closing');
      headLogo.classList.remove('is-drawn'); void headLogo.offsetWidth; headLogo.classList.add('is-drawn');
      setTimeout(() => input.focus(), 60);
    } else {
      showHistory(false);
      panel.classList.add('is-closing');
      setTimeout(() => { panel.hidden = true; panel.classList.remove('is-closing'); fab.hidden = false; fab.focus(); }, reduce.matches ? 0 : 180);
    }
    fab.setAttribute('aria-expanded', String(open));
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
    if (act === 'new' && !busy) { store.current = null; showHistory(false); renderLog(); input.focus(); }
    if (act === 'history') showHistory(hist.hidden);
    if (act === 'hist-close') showHistory(false);
    if (act === 'hist-clear' && store.convs.length && confirm('Effacer toutes les discussions gardées dans ce navigateur ?')) {
      store = { v: 1, convs: [], current: null }; saveStore(); renderHistory(); renderLog();
    }
    const open = e.target.closest('.ai-hist__open');
    if (open) { store.current = open.dataset.id; write(localStorage, STORE, store); showHistory(false); renderLog(); }
    const del = e.target.closest('[data-del]');
    if (del) {
      const li = del.closest('li');
      li.classList.add('is-leaving');
      setTimeout(() => {
        store.convs = store.convs.filter(c => c.id !== del.dataset.del);
        if (store.current === del.dataset.del) { store.current = null; renderLog(); }
        saveStore(); renderHistory();
      }, reduce.matches ? 0 : 220);
    }
  });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!hist.hidden) showHistory(false); else openPanel(false); } });
  fab.addEventListener('click', () => openPanel(true));

  /* The open button folds to its icon while the reader scrolls down a page, and unfolds when they scroll back up. */
  let lastY = scrollY;
  addEventListener('scroll', () => {
    const y = scrollY;
    if (Math.abs(y - lastY) > 24) { fab.classList.toggle('is-compact', y > lastY && y > 300); lastY = y; }
  }, { passive: true });

  // ------------------------------------------------------------------------------------------------ start
  const probe = p => new Promise(done => { const i = new Image(); i.onload = () => done(logoOK[p] = true); i.onerror = () => done(false); i.src = PROVIDERS[p].img; });
  async function start() {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(API + 'status', { signal: ctrl.signal });
      if (!r.ok) return;
      status = await r.json();
    } catch { return; }
    if (!status?.enabled) return;
    await Promise.all(Object.keys(PROVIDERS).map(probe));
    loadStore();
    document.head.appendChild(css);
    document.body.append(defs, fab, panel);
    $('.ai-demo').hidden = !status.demo;
    input.maxLength = status.limits?.question_chars || 1500;
    if (matchMedia('(max-width: 680px)').matches) input.placeholder = 'Votre question…';
    syncModel(false);
    renderLog();
    if (read(sessionStorage, UI, {}).open) openPanel(true);
    else { fab.hidden = false; fab.classList.add('is-intro'); setTimeout(() => fab.classList.remove('is-intro'), 4000); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
