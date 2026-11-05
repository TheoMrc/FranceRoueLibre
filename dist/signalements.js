/* Signalements citoyens (signalements.html). The report goes to the Loupe's API (server/assistant/signalements.py),
   which shows it to every reader at once, marked « non relu » until the site has read it, unless its author ticks
   « seulement à FranceRoueLibre ». Every reader can flag an abuse under a shown report. The « human » check is made here: the reader draws a loop in a
   box (trace sent to the server) while the browser solves a small proof of work on a challenge signed by the server.
   « Préparer le dossier avec la Loupe » asks the Loupe (same API as its panel) to draft the report, then fills the form.
   A report started from an answer of the Loupe (loupe-signal.js) arrives through sessionStorage. */
(() => {
  const API = 'api/assistant/';
  const form = document.getElementById('sgForm');
  if (!form) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const send = $('sgSend'), result = $('sgResult');
  const state = { challenge: null, counter: null, trace: [], human: false, loupe: false };

  /* ------------------------------------------------------------------ human check: proof of work */
  async function getChallenge() {
    state.challenge = null; state.counter = null;
    try {
      const r = await fetch(API + 'signalement/defi', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      state.challenge = await r.json();
      work(state.challenge);
    } catch (e) {
      $('sgHumanState').textContent = 'Le service des signalements ne répond pas pour l’instant : réessayez plus tard.';
    }
  }
  const zeroBits = bytes => { let n = 0; for (const b of bytes) { if (b === 0) { n += 8; continue; } return n + Math.clz32(b) - 24; } return n; };
  async function work(c) {
    const enc = new TextEncoder();
    for (let i = 0; ; i++) {
      if (state.challenge !== c) return;           // a newer challenge replaced it
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${c.nonce}:${i}`)));
      if (zeroBits(h) >= c.difficulty) { state.counter = i; update(); return; }
    }
  }

  /* ------------------------------------------------------------------ human check: the drawn loop */
  const pad = $('sgPad'), cv = $('sgCanvas'), ctx = cv.getContext('2d');
  const ring = $('sgRing'), ringTxt = $('sgRingTxt');
  let drawing = false, t0 = 0;
  function point(e) {
    const r = cv.getBoundingClientRect();
    return [Math.round(1000 * (e.clientX - r.left) / r.width), Math.round(1000 * (e.clientY - r.top) / r.height), Math.round(performance.now() - t0)];
  }
  function score() {   // the same measures as the server, with a margin
    const p = state.trace;
    if (p.length < 2) return 0;
    let len = 0, turns = 0, prev = null;
    for (let i = 1; i < p.length; i++) {
      const dx = p[i][0] - p[i - 1][0], dy = p[i][1] - p[i - 1][1];
      len += Math.hypot(dx, dy);
      if (Math.abs(dx) + Math.abs(dy) < 4) continue;
      const s = `${dx > 0}${dy > 0}`;
      if (prev !== null && s !== prev) turns++;
      prev = s;
    }
    const dur = p[p.length - 1][2] - p[0][2];
    return Math.min(1, Math.min(len / 1400, 1) * .5 + Math.min(turns / 6, 1) * .3 + Math.min(p.length / 40, 1) * .1 + Math.min(dur / 900, 1) * .1);
  }
  function paint() {
    const css = getComputedStyle(document.documentElement);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const g = ctx.createLinearGradient(0, 0, cv.width, cv.height);
    g.addColorStop(0, css.getPropertyValue('--c-teal-600').trim() || '#0e7490'); g.addColorStop(1, '#2563eb');
    ctx.strokeStyle = g;
    ctx.beginPath();
    state.trace.forEach(([x, y], i) => { const X = x * cv.width / 1000, Y = y * cv.height / 1000; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
    ctx.stroke();
  }
  function move(e) {
    if (state.human) return;
    if (!drawing) { drawing = true; if (!state.trace.length) t0 = performance.now(); }
    const p = point(e);
    if (p[0] < 0 || p[1] < 0 || p[0] > 1000 || p[1] > 1000) return;
    const last = state.trace[state.trace.length - 1];
    if (last && Math.abs(last[0] - p[0]) + Math.abs(last[1] - p[1]) < 3) return;
    state.trace.push(p);
    if (state.trace.length > 1500) state.trace.shift();
    paint(); update();
  }
  pad.addEventListener('pointermove', move);
  pad.addEventListener('pointerdown', e => { pad.setPointerCapture?.(e.pointerId); move(e); });
  pad.addEventListener('pointerup', () => { drawing = false; });

  function update() {
    const s = score();
    ring.style.strokeDashoffset = String(97.4 * (1 - s));
    ringTxt.textContent = state.human ? '✓' : `${Math.round(100 * s)} %`;
    const traced = s >= 1;
    if (traced && state.counter !== null && !state.human) {
      state.human = true;
      pad.classList.add('is-ok');
      ringTxt.textContent = '✓';
      $('sgHumanState').textContent = 'Humain confirmé. Merci !';
      $('sgHumanState').classList.add('is-ok');
    } else if (traced && state.counter === null && state.challenge) {
      $('sgHumanState').textContent = 'Tracé validé, dernière vérification en cours…';
    }
    send.disabled = !(state.human && form.charte.checked);
  }
  form.charte.addEventListener('change', update);
  const count = () => { $('sgCount').textContent = `${form.description.value.length.toLocaleString('fr-FR')} / 6 000`; };
  form.description.addEventListener('input', count);

  /* ------------------------------------------------------------------ sending */
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.human) return;
    send.disabled = true;
    result.className = 'sg-result'; result.textContent = 'Envoi…';
    const liens = form.liens.value.split(/\s+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s));
    const body = { titre: form.titre.value, description: form.description.value, siren: form.siren.value, lieu: form.lieu.value,
      montant: form.montant.value, email: form.email.value, liens, site: form.site.value, charte: form.charte.checked, prive: form.prive.checked, loupe: state.loupe,
      preuve: { ...state.challenge, counter: state.counter, trace: state.trace } };
    try {
      const r = await fetch(API + 'signalement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.ok) {
        result.className = 'sg-result is-ok';
        result.innerHTML = !d.ref ? 'Merci !' : d.visible ? `Merci ! Signalement <a href="#${esc(d.ref)}">${esc(d.ref)}</a> en ligne, visible par tous, marqué « non relu » jusqu’à la relecture.`
          : `Merci ! Signalement ${esc(d.ref)} reçu : seul FranceRoueLibre le lira.`;
        form.reset(); count(); list(d.ref);
        try { sessionStorage.removeItem('frl-signalement'); } catch (_) { /* private mode */ }
        resetHuman();
      } else {
        result.className = 'sg-result is-error';
        result.textContent = d.error || 'Envoi refusé.';
        if (/vérification|tracé|rapide/.test(d.error || '')) resetHuman();
        else update();
      }
    } catch (err) {
      result.className = 'sg-result is-error';
      result.textContent = 'Le service des signalements ne répond pas : réessayez dans un moment.';
      update();
    }
  });
  function resetHuman() {
    state.trace = []; state.human = false; drawing = false;
    pad.classList.remove('is-ok'); $('sgHumanState').classList.remove('is-ok');
    $('sgHumanState').textContent = 'Bougez la souris ou le doigt dans le cadre, en traçant une boucle.';
    paint(); getChallenge(); update();
  }

  /* ------------------------------------------------------------------ filling the form */
  function fill(fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (!v || !form[k]) continue;
      form[k].value = Array.isArray(v) ? v.join('\n') : v;
      const box = form[k].closest('.sg-field');
      if (box) { box.classList.remove('is-filled'); void box.offsetWidth; box.classList.add('is-filled'); }
    }
    count();
  }
  /* The Loupe's draft: « ### Titre », « ### Ce qui interroge », « ### Sources sur le site », « ### Sources web »,
     « ### Questions à poser », « ### SIREN », « ### Lieu », « ### Montant » (only what it found). */
  function parseDraft(text, sources) {
    const parts = {};
    let key = null;
    for (const line of String(text || '').split('\n')) {
      const h = line.match(/^#{2,4}\s*(.+?)\s*:?\s*$/) || line.match(/^\*\*(.+?)\*\*\s*:?\s*$/);
      if (h) { key = h[1].toLowerCase(); parts[key] = []; continue; }
      if (key) parts[key].push(line);
    }
    const get = re => { const k = Object.keys(parts).find(x => re.test(x)); return k ? parts[k].join('\n').trim() : ''; };
    const links = new Set();
    const addLinks = s => (s.match(/https?:\/\/[^\s)\]>"]+/g) || []).forEach(u => links.add(u.replace(/[.,;]+$/, '')));
    const site = new URL('.', location.href).href;
    addLinks(get(/sources?/));
    String(get(/sources? sur le site/)).replace(/\]\(([^)]+)\)/g, (m, u) => { links.add(new URL(u, site).href); return m; });
    (sources || []).forEach(s => s?.url && links.add(s.url));
    const strip = s => s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/\*\*/g, '');
    const desc = [get(/interroge|constat|faits|description/), get(/questions?/) && `Questions à poser :\n${get(/questions?/)}`].filter(Boolean).map(strip).join('\n\n');
    return { titre: strip(get(/^titre/)).split('\n')[0].replace(/^[-•]\s*/, ''), description: desc, siren: (get(/siren/).match(/\d{9}(\d{5})?/) || [''])[0],
      lieu: strip(get(/lieu|commune|territoire/)).split('\n')[0], montant: strip(get(/montant/)).split('\n')[0], liens: [...links].slice(0, 12) };
  }
  const PROMPT = idea => `Aide-moi à préparer un signalement citoyen sur une dépense publique, sobre et vérifiable, à partir de ma piste : « ${idea} ».
Cherche dans les données du site et, si utile, sur le web. Réponds uniquement avec ces rubriques, dans cet ordre, en titres « ### » :
### Titre (une ligne factuelle, sans accusation)
### Ce qui interroge (les faits et montants trouvés, sourcés ; le conditionnel pour ce qui n'est pas établi ; aucune accusation contre une personne nommée sans source publique ; pas de vie privée)
### Questions à poser (à l'organisme concerné)
### SIREN (si un organisme est identifié)
### Lieu (commune ou territoire, si pertinent)
### Montant (si pertinent)
### Sources sur le site (liens)
### Sources web (liens)`;
  async function draft() {
    const idea = $('sgIdea').value.trim();
    const st = $('sgDraftState');
    if (idea.length < 8) { st.className = 'sg-loupe__state is-error'; st.textContent = 'Décrivez votre piste en une phrase.'; return; }
    $('sgDraft').disabled = true;
    st.className = 'sg-loupe__state'; st.textContent = 'La Loupe cherche dans les données…';
    try {
      const r = await fetch(API + 'ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', text: PROMPT(idea) }] }) });
      const d = await r.json();
      if (!d.job) throw new Error(d.error || 'La Loupe ne peut pas répondre pour l’instant.');
      let after = 0, steps = 0;
      for (;;) {
        await new Promise(ok => setTimeout(ok, 1200));
        const j = await (await fetch(`${API}job/${d.job}?after=${after}`, { cache: 'no-store' })).json();
        after = j.next ?? after;
        for (const ev of j.events || []) if (ev.type === 'tool_start') { steps++; st.textContent = `La Loupe cherche : ${ev.label || 'données'}… (${steps})`; }
        if (j.queue) st.textContent = `La Loupe est très demandée : vous êtes ${j.queue}e dans la file…`;
        if (j.done) {
          if (j.result?.error) throw new Error(j.result.error);
          fill(parseDraft(j.result?.reply, j.result?.sources));
          state.loupe = true;
          st.textContent = 'Dossier prérempli : relisez, corrigez, puis envoyez.';
          form.titre.focus();
          break;
        }
      }
    } catch (e) {
      st.className = 'sg-loupe__state is-error';
      st.textContent = e.message || 'La Loupe ne répond pas pour l’instant : remplissez le formulaire vous-même.';
    } finally { $('sgDraft').disabled = false; }
  }
  $('sgDraft').addEventListener('click', draft);

  /* a report started from an answer of the Loupe panel (loupe-signal.js) */
  try {
    const from = JSON.parse(sessionStorage.getItem('frl-signalement') || 'null');
    if (from) {
      $('sgIdea').value = String(from.question || '').slice(0, 600);
      const links = (from.sources || []).map(s => s.url).filter(Boolean);
      fill({ titre: String(from.question || '').slice(0, 140), description: `${String(from.reponse || '').slice(0, 5500)}`, liens: links });
      state.loupe = true;
      $('sgDraftState').textContent = 'Repris de la réponse de la Loupe : reformulez en signalement, gardez les sources.';
      if (location.hash !== '#signaler') document.getElementById('signaler').scrollIntoView();
    }
  } catch (_) { /* private mode */ }
  const params = new URLSearchParams(location.search);
  fill({ siren: params.get('siren'), lieu: params.get('lieu'), titre: params.get('titre') });

  /* ------------------------------------------------------------------ every report shown to all */
  const day = iso => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  function item(s) {
    const meta = [s.siren && `SIREN ${esc(s.siren)}`, s.lieu && esc(s.lieu), s.montant && esc(s.montant)].filter(Boolean);
    return `<article class="sg-item${s.relu ? ' is-read' : ''}" id="${esc(s.ref)}"><header><span class="sg-tag${s.relu ? ' sg-tag--read' : ''}">${s.relu ? 'Relu par FranceRoueLibre' : 'Non relu'}</span>`
      + `<span>${esc(s.ref)}</span><span>${day(s.publie)}</span>${s.loupe ? '<span>préparé avec la Loupe</span>' : ''}</header>`
      + `<h3>${esc(s.titre)}</h3><p>${esc(s.description)}</p>${meta.length ? `<p class="note">${meta.join(' · ')}</p>` : ''}`
      + `${(s.liens || []).length ? `<ul>${s.liens.map(u => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow ugc">${esc(u)}</a></li>`).join('')}</ul>` : ''}`
      + `${s.reponse ? `<div class="sg-reply"><strong>Réponse</strong><p>${esc(s.reponse)}</p></div>` : ''}`
      + `<footer><span>Une piste à vérifier, pas un verdict.</span><button type="button" class="sg-abuse" data-ref="${esc(s.ref)}">Signaler un abus</button></footer></article>`;
  }
  async function list(focus) {
    const box = $('sgList');
    try {
      const r = await fetch(API + 'signalements', { cache: 'no-store' });
      const d = await r.json();
      const rows = d.signalements || [];
      $('sgListCount') && ($('sgListCount').textContent = rows.length ? `· ${rows.length.toLocaleString('fr-FR')} signalement${rows.length > 1 ? 's' : ''}` : '');
      box.innerHTML = rows.length ? rows.map(item).join('') : '<p class="note">Aucun signalement pour l’instant : soyez le premier.</p>';
      if (focus) document.getElementById(focus)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      box.innerHTML = '<p class="note">La liste n’est pas joignable pour l’instant.</p>';
    }
  }
  $('sgList').addEventListener('click', async e => {
    const b = e.target.closest('.sg-abuse');
    if (!b || b.disabled) return;
    const motif = prompt('Pourquoi ce signalement pose-t-il problème ? (insulte, accusation sans preuve, vie privée, faux…)');
    if (motif === null) return;
    b.disabled = true;
    try {
      const r = await fetch(API + 'signalement/abus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: b.dataset.ref, motif }) });
      b.textContent = r.ok ? 'Merci, alerte transmise' : 'Alerte non transmise';
    } catch (err) { b.textContent = 'Alerte non transmise'; }
  });
  document.querySelectorAll('[data-ico]').forEach(el => { if (window.FRL_ICONS) el.innerHTML = FRL_ICONS.icon(el.dataset.ico); });
  getChallenge(); list(); count(); update();
})();
