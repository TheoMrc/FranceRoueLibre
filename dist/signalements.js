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
    if (state.demoTitle && form.titre.value === state.demoTitle) {
      result.className = 'sg-result is-error';
      result.textContent = 'C’est le dossier de démonstration : écrivez votre propre piste, ou corrigez au moins le titre et les faits, avant d’envoyer.';
      return;
    }
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
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const flash = el => { const box = el.closest('.sg-field'); if (box) { box.classList.remove('is-filled'); void box.offsetWidth; box.classList.add('is-filled'); } };
  function fill(fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (!v || !form[k]) continue;
      form[k].value = Array.isArray(v) ? v.join('\n') : v;
      flash(form[k]);
    }
    count();
  }
  /* The Loupe writes into the form as it goes (remplir_signalement, one event per call): one field after the other,
     typed, so the reader sees the dossier take shape. */
  const typing = { queue: [], running: null };
  function typeInto(name, text) {
    typing.queue.push([name, String(text)]);
    if (!typing.running) typing.running = drain();
    return typing.running;
  }
  async function drain() {
    while (typing.queue.length) {
      const [name, text] = typing.queue.shift();
      const el = form[name];
      if (!el) continue;
      const box = el.closest('.sg-field');
      const from = text.startsWith(el.value) ? el.value.length : 0;
      if (!from) el.value = '';
      box?.classList.add('is-typing');
      box?.scrollIntoView?.({ block: 'nearest', behavior: reduce.matches ? 'auto' : 'smooth' });
      const rest = text.length - from, steps = reduce.matches ? 1 : Math.min(60, Math.max(8, Math.ceil(rest / 6)));
      for (let i = 1; i <= steps; i++) {
        el.value = text.slice(0, from + Math.round(rest * i / steps));
        if (el.tagName === 'TEXTAREA') el.scrollTop = el.scrollHeight;
        if (name === 'description') count();
        await new Promise(ok => setTimeout(ok, reduce.matches ? 0 : 18));
      }
      box?.classList.remove('is-typing');
      if (el.tagName === 'TEXTAREA' && !typing.queue.some(q => q[0] === name)) el.scrollTop = 0;
      flash(el);
    }
    typing.running = null;
  }
  const draftState = {};
  const descOf = d => [d.description, d.questions && `Questions à poser :\n${d.questions}`].filter(Boolean).join('\n\n');
  function applyDraft(champs, sources) {
    const before = descOf(draftState);
    Object.assign(draftState, champs || {});
    for (const k of ['titre', 'lieu', 'montant', 'siren']) if (champs?.[k]) typeInto(k, champs[k]);
    const desc = descOf(draftState);
    if (desc && desc !== before) typeInto('description', desc);
    const links = [...new Set([...String(draftState.liens || '').split('\n'), ...(sources || []).map(s => s?.url)].map(u => (u || '').trim()).filter(u => /^https?:\/\//.test(u)))];
    if (links.length && links.join('\n') !== form.liens.value) typeInto('liens', links.slice(0, 12).join('\n'));
  }
  /* A Loupe that answered in text without filling the form: « ### Titre », « ### Ce qui interroge »… (or « **Titre :** … ») */
  function parseDraft(text) {
    const parts = {};
    let key = null;
    for (const line of String(text || '').split('\n')) {
      const h = line.match(/^\s*(?:#{2,4}\s*|\*\*)([^*:#]{2,40}?)\s*(?:\*\*)?\s*:?\s*(?:\*\*)?\s*:?\s*(.*)$/);
      if (h && /titre|interroge|constat|faits|questions?|siren|lieu|commune|territoire|montant|sources?/i.test(h[1]) && (line.trim().startsWith('#') || line.trim().startsWith('**'))) {
        key = h[1].toLowerCase(); parts[key] = h[2] ? [h[2].replace(/\*\*/g, '')] : []; continue;
      }
      if (key) parts[key].push(line);
    }
    const get = re => { const k = Object.keys(parts).find(x => re.test(x)); return k ? parts[k].join('\n').trim() : ''; };
    const strip = s => s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/\*\*/g, '');
    const first = s => strip(s).split('\n').map(x => x.replace(/^[-•\s]+/, '').trim()).find(Boolean) || '';
    const site = new URL('.', location.href).href, links = [];
    for (const k of Object.keys(parts).filter(x => /sources?/.test(x))) {
      const t = parts[k].join('\n');
      t.replace(/\]\(([^)]+)\)/g, (m, u) => { try { links.push(new URL(u, site).href); } catch (e) { /* not a link */ } return m; });
      (t.match(/https?:\/\/[^\s)\]>"]+/g) || []).forEach(u => links.push(u.replace(/[.,;]+$/, '')));
    }
    return { titre: first(get(/^titre/)), description: strip(get(/interroge|constat|faits/)), questions: strip(get(/questions?/)),
      siren: (get(/siren/).match(/\d{9}(\d{5})?/) || [''])[0], lieu: first(get(/lieu|commune|territoire/)), montant: first(get(/montant/)),
      liens: [...new Set(links)].join('\n') };
  }

  /* ------------------------------------------------------------------ the two examples: a demonstration
     A click on « Exemple 1 » or « Exemple 2 » plays a scripted job: the same panel, the same steps, tools and live
     filling as a real dossier, but nothing is sent to the Loupe and nothing is searched (no token, no request).
     The dossier says so in its first line, its place is fictitious, and it cannot be sent as it is. */
  const SITE = 'https://francerouelibre.fr/';
  const NOTE = 'Démonstration : aucun appel à la Loupe, rien n’a été cherché pour de vrai. Écrivez votre propre piste pour obtenir un vrai dossier, sourcé.';
  const t = (name, label, summary, ms = 1300) => [[260, { type: 'tool_start', name, label }], [ms, { type: 'tool_done', name, label, ok: true, summary }]];
  const fillStep = (champs, summary, ms = 500) => [[260, { type: 'tool_start', name: 'remplir_signalement', label: 'Remplit le dossier de signalement' }],
    [120, { type: 'signalement', champs }], [ms, { type: 'tool_done', name: 'remplir_signalement', label: 'Remplit le dossier de signalement', ok: true, summary }]];
  const DEMOS = {
    piscine: () => ({
      steps: [
        [350, { type: 'model', provider: 'demo', label: 'Démonstration' }],
        [900, { type: 'think', step: 1 }],
        ...fillStep({ titre: 'Exemple : un centre aquatique à 500 M€ à Exempleville', lieu: 'Exempleville (commune fictive)', montant: '500 000 000 €' }, 'titre, lieu, montant'),
        ...t('dossier_collectivite', 'Dossier de « Exempleville »', 'comptes, échelons, projets aidés, signaux', 1600),
        [700, { type: 'think', step: 2 }],
        ...t('rechercher_depenses', 'Recherche « piscine » dans les dépenses publiées', 'marchés et subventions qui citent le mot', 1500),
        ...t('comparer', 'Comparaison de « Exempleville » avec les collectivités de même taille', 'dépenses d’équipement par habitant'),
        [800, { type: 'think', step: 3 }],
        ...t('recherche_web', 'Recherche sur le web : « coût de construction d’un centre aquatique public »', 'sources officielles et presse', 1900),
        [700, { type: 'think', step: 4 }],
        ...fillStep({
          description: `${NOTE}\n\nLa piste : un centre aquatique annoncé à 500 000 000 € à Exempleville.\n\n`
            + 'Ce qu’un vrai dossier vérifierait dans les documents publics :\n- le montant voté en conseil municipal (délibération) et sa part dans le budget d’investissement de la commune ;\n'
            + '- le coût d’équipements comparables dans des communes de même taille ;\n- les subventions de l’État (DETR, DSIL) et des autres échelons qui financeraient le projet.\n\n'
            + 'Tant que ces pièces ne sont pas réunies, rien n’est établi : le dossier pose la question, il n’affirme rien.',
          questions: 'Quel est le coût total voté, études et frais financiers compris ?\nQui finance, et à quelle hauteur (commune, intercommunalité, département, région, État) ?\n'
            + 'Une étude de besoin et de fréquentation a-t-elle été publiée ?\nQuel coût de fonctionnement annuel est prévu ?',
          liens: [`${SITE}recherche.html?q=piscine`, `${SITE}index.html#explorer`, `${SITE}aides.html`, 'https://www.collectivites-locales.gouv.fr/'].join('\n'),
        }, 'faits, questions, sources', 700),
      ],
      result: { reply: 'Le dossier est prérempli : un titre factuel, les faits à vérifier, les questions à poser à la mairie et les sources, du site d’abord, puis du web.\n\n'
        + `*${NOTE}*`, provider: 'demo', label: 'Démonstration', sources: [{ title: 'collectivites-locales.gouv.fr', url: 'https://www.collectivites-locales.gouv.fr/' }] },
    }),
    asso: () => ({
      steps: [
        [350, { type: 'model', provider: 'demo', label: 'Démonstration' }],
        [900, { type: 'think', step: 1 }],
        ...fillStep({ titre: 'Exemple : les subventions publiques d’une association (SIREN à préciser)' }, 'titre'),
        ...t('dossier_beneficiaire', 'Argent public reçu par « l’association de l’exemple »', 'subventions de l’État, aides, marchés', 1700),
        [700, { type: 'think', step: 2 }],
        ...t('chercher_fiche', 'Recherche « subventions associations » (aides)', 'programmes qui financent ce type d’association'),
        ...t('page_du_site', 'Section du site sur « subventions aux associations »', 'Aides et subventions', 900),
        [800, { type: 'think', step: 3 }],
        ...t('recherche_web', 'Recherche sur le web : « dirigeants déclarés de l’association, Journal officiel »', 'annonces du Journal officiel', 1900),
        [700, { type: 'think', step: 4 }],
        ...fillStep({
          description: `${NOTE}\n\nLa piste : une association qui recevrait beaucoup de subventions et serait dirigée par une personne proche d’un responsable public.\n\n`
            + 'Ce qu’un vrai dossier vérifierait :\n- les subventions de l’État publiées pour ce SIREN (annexes « jaunes » des lois de finances) et celles des collectivités ;\n'
            + '- les dirigeants déclarés (Journal officiel des associations, annuaire des entreprises) ;\n- les comptes annuels, que l’association doit publier au-delà de 153 000 € de subventions par an.\n\n'
            + 'La proximité avec un responsable public n’est pas un fait tant qu’aucune source publique ne l’établit : le dossier pose la question, au conditionnel, sans nommer d’accusé.',
          questions: 'Quelles subventions l’association a-t-elle reçues, de qui et pour quels projets ?\nLes conventions d’objectifs et les comptes annuels sont-ils publiés ?\n'
            + 'Un élu ou un agent ayant voté ou instruit ces subventions a-t-il un lien avec l’association, et s’est-il déporté ?',
          liens: [`${SITE}aides.html`, `${SITE}recherche.html`, 'https://annuaire-entreprises.data.gouv.fr/', 'https://www.journal-officiel.gouv.fr/'].join('\n'),
        }, 'faits, questions, sources', 700),
      ],
      result: { reply: 'Le dossier est prérempli. Ajoutez le SIREN de l’association : la Loupe y lirait alors l’argent public réellement publié pour cet organisme.\n\n'
        + `*${NOTE}*`, provider: 'demo', label: 'Démonstration', sources: [{ title: 'annuaire-entreprises.data.gouv.fr', url: 'https://annuaire-entreprises.data.gouv.fr/' }] },
    }),
  };
  /* Without the Loupe's panel (its API not reachable), the demonstration plays in the card alone. */
  async function play(script, h) {
    for (const [ms, ev] of script.steps) {
      if (play.stopped) break;
      await new Promise(ok => setTimeout(ok, reduce.matches ? Math.min(ms, 150) : ms));
      h.onEvent(ev);
    }
    const r = play.stopped ? { reply: 'Arrêté à votre demande.' } : script.result;
    play.stopped = false;
    await h.onDone({ text: r.reply, error: '', sources: r.sources || [], signalement: null });
  }

  /* ------------------------------------------------------------------ the Loupe at work */
  const PROMPT = idea => `Je suis sur la page Remontées citoyennes. Prépare un signalement citoyen à partir de ma piste : « ${idea} ». `
    + 'Remplis le formulaire avec remplir_signalement : le titre, le lieu et le montant dès ta première étape, puis le dossier complet '
    + '(faits sourcés, questions à poser, sources du site et du web), en cherchant dans les données du site et, si utile, sur le web.';
  const card = $('sgLoupe'), live = $('sgLive'), liveNow = $('sgLiveNow'), liveSteps = $('sgLiveSteps'), st = $('sgDraftState');
  const lockable = () => [...form.querySelectorAll('input, textarea, button')].filter(el => el.name !== 'email' && el.name !== 'site');
  function lock(on) {
    form.classList.toggle('is-locked', on);
    form.setAttribute('aria-busy', String(on));
    for (const el of lockable()) {
      if (el.type === 'checkbox' || el.tagName === 'BUTTON') el.disabled = on || (el === send && !(state.human && form.charte.checked));
      else el.readOnly = on;
    }
    card.classList.toggle('is-working', on);
    $('sgIdea').readOnly = on;
    card.querySelectorAll('.sg-examples button').forEach(b => { b.disabled = on; });
    $('sgDraft').disabled = on;
    if (!on) update();
  }
  function now(text) { liveNow.textContent = text; }
  function stepEl(label, fill) {
    const li = document.createElement('li');
    li.textContent = label;
    if (fill) li.classList.add('is-fill');
    liveSteps.appendChild(li);
    return li;
  }
  const NAMES = { titre: 'titre', lieu: 'lieu', montant: 'montant', siren: 'SIREN', description: 'faits', questions: 'questions', liens: 'sources' };
  function hooks(idea, done) {
    let lastStep = null, tools = 0;
    return {
      shown: `Préparer un signalement : « ${idea} »`,
      onEvent(ev) {
        if (ev.type === 'queue') now(ev.place === 1 ? 'Vous êtes le prochain dans la file' : `File d’attente : ${ev.place - 1} question(s) avant la vôtre`);
        if (ev.type === 'model') now(`La Loupe se met au travail${ev.label ? ` (${ev.label})` : ''}`);
        if (ev.type === 'think') now(tools ? 'La Loupe analyse les résultats' : 'La Loupe réfléchit');
        if (ev.type === 'tool_start') { tools++; lastStep = stepEl(ev.label || 'Recherche', ev.name === 'remplir_signalement'); now(ev.name === 'remplir_signalement' ? 'La Loupe écrit le dossier' : `La Loupe cherche : ${ev.label || 'données'}`); }
        if (ev.type === 'tool_done' && lastStep) {
          lastStep.classList.add(ev.ok === false ? 'is-fail' : 'is-done');
          if (ev.summary && ev.name !== 'remplir_signalement') lastStep.insertAdjacentHTML('beforeend', `<small>${esc(ev.summary)}</small>`);
        }
        if (ev.type === 'signalement') {
          const names = Object.keys(ev.champs || {}).map(k => NAMES[k]).filter(Boolean);
          if (lastStep && names.length) lastStep.firstChild.textContent = `Remplit le dossier : ${names.join(', ')}`;
          card.classList.add('is-writing');
          applyDraft(ev.champs);
        }
        if (ev.type === 'switch') stepEl(`Relais : ${ev.to === 'claude' ? 'Claude' : 'Gemini'} reprend la question`);
      },
      async onDone(m) {
        card.classList.remove('is-writing');
        if (!m.error) {
          if (!Object.keys(draftState).length) applyDraft(Object.fromEntries(Object.entries(m.signalement || parseDraft(m.text)).filter(([, v]) => v)), m.sources);
          else applyDraft({}, m.sources);
        }
        await (typing.running || Promise.resolve());
        done(m);
      },
    };
  }
  /* Without the Loupe's panel on the page (its script not loaded yet): the same job, polled here. */
  async function direct(prompt, h) {
    const m = { text: '', error: '', sources: [], signalement: null };
    try {
      const r = await fetch(API + 'ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', text: prompt }] }) });
      const d = await r.json().catch(() => ({}));
      if (!d.job) throw new Error(d.error || 'La Loupe ne peut pas répondre pour l’instant.');
      direct.job = d.job;
      for (let after = 0; ;) {
        await new Promise(ok => setTimeout(ok, 800));
        const j = await (await fetch(`${API}job/${d.job}?after=${after}`, { cache: 'no-store' })).json();
        after = j.next ?? after;
        if (j.queue) h.onEvent({ type: 'queue', place: j.queue });
        (j.events || []).forEach(ev => h.onEvent(ev));
        if (j.done) { Object.assign(m, { text: j.result?.reply || '', error: j.result?.error || '', sources: j.result?.sources || [], signalement: j.result?.signalement || null }); break; }
      }
    } catch (e) { m.error = e.message || 'La Loupe ne répond pas.'; }
    direct.job = null;
    await h.onDone(m);
  }
  /* Wide screens: the Loupe's panel opens on the right, the form moves aside so both stay visible. */
  const wide = matchMedia('(min-width: 1000px)');
  function sideBySide() {
    const panel = document.querySelector('.ai-panel');
    if (!wide.matches || !panel) return;
    document.body.classList.add('sg-side');
    const off = new MutationObserver(() => { if (panel.hidden) { document.body.classList.remove('sg-side'); off.disconnect(); } });
    off.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  }
  async function draft(demoKey) {
    const idea = $('sgIdea').value.trim();
    const demo = typeof demoKey === 'string' && DEMOS[demoKey] ? DEMOS[demoKey]() : null;
    if (idea.length < 8) { st.className = 'sg-loupe__state is-error'; st.textContent = 'Décrivez votre piste en une phrase.'; $('sgIdea').focus(); return; }
    if (window.FRLLoupe?.busy?.()) { st.className = 'sg-loupe__state is-error'; st.textContent = 'La Loupe répond déjà à une question : attendez la fin, ou arrêtez-la.'; return; }
    for (const k of Object.keys(draftState)) delete draftState[k];
    st.className = 'sg-loupe__state'; st.textContent = '';
    liveSteps.innerHTML = ''; live.hidden = false; live.classList.remove('is-done');
    now('La Loupe réfléchit');
    lock(true);
    card.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'start' });
    const finished = new Promise(ok => {
      const h = hooks(idea, ok);
      if (demo) { h.shown = `Préparer un signalement (exemple) : « ${idea} »`; h.script = demo; }
      const opened = window.FRLLoupe?.ask && window.FRLLoupe.ask(demo ? `[démonstration] ${idea}` : PROMPT(idea), { hooks: h, background: !wide.matches });
      Promise.resolve(opened).then(started => { if (started) sideBySide(); else if (demo) play(demo, h); else direct(PROMPT(idea), h); });
    });
    const m = await finished;
    lock(false);
    live.classList.add('is-done');
    if (m.error) {
      now('La Loupe s’est arrêtée');
      st.className = 'sg-loupe__state is-error';
      st.textContent = `${m.error} Ce qui est déjà écrit reste dans le formulaire : complétez-le vous-même.`;
    } else if (demo) {
      state.demoTitle = form.titre.value;
      now('Démonstration terminée : à vous d’écrire votre propre piste');
      st.className = 'sg-loupe__state'; st.textContent = 'Ce dossier d’exemple ne peut pas être envoyé tel quel.';
    } else {
      state.loupe = true;
      now('Dossier prérempli : relisez, corrigez, puis envoyez');
      form.titre.focus({ preventScroll: true });
    }
  }
  $('sgDraft').addEventListener('click', () => draft());
  $('sgStop').addEventListener('click', () => {
    play.stopped = true;
    if (direct.job) fetch(`${API}job/${direct.job}/cancel`, { method: 'POST' }).catch(() => {});
    else window.FRLLoupe?.stop?.();
    now('Arrêt demandé…');
  });
  card.querySelector('.sg-examples').addEventListener('click', e => {
    const b = e.target.closest('[data-idea]');
    if (!b || b.disabled) return;
    $('sgIdea').value = b.dataset.idea;
    draft(b.dataset.demo);
  });
  $('sgIdea').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); draft(); } });

  /* a report started from an answer of the Loupe panel (loupe-signal.js) */
  try {
    const from = JSON.parse(sessionStorage.getItem('frl-signalement') || 'null');
    if (from) {
      $('sgIdea').value = String(from.question || '').slice(0, 600);
      const links = (from.sources || []).map(s => s.url).filter(Boolean);
      fill({ titre: String(from.question || '').slice(0, 140), description: `${String(from.reponse || '').slice(0, 5500)}`, liens: links });
      state.loupe = true;
      st.textContent = 'Repris de la réponse de la Loupe : reformulez en signalement, gardez les sources.';
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
