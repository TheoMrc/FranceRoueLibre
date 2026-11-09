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

  /* ------------------------------------------------------------------ categories and keywords
     Several categories per report, in three groups (the same keys as server/assistant/signalements.py, CATEGORIES),
     and up to 8 free keywords. Both live in hidden inputs (categories, mots: comma-separated), so the Loupe fills
     them like any field: her values come in as chips that light up one after the other. */
  const CATEGORIES = [
    ['Échelon', [['commune', 'Commune'], ['intercommunalite', 'Intercommunalité'], ['departement', 'Département'], ['region', 'Région'],
      ['etat', 'État'], ['operateur', 'Opérateur ou agence de l’État'], ['secu', 'Sécurité sociale'], ['europe', 'Union européenne']]],
    ['Nature de la dépense', [['association', 'Association financée'], ['marche-public', 'Marché public'], ['subvention', 'Subvention'],
      ['projet-aide', 'Projet aidé'], ['niche-fiscale', 'Niche fiscale'], ['remunerations', 'Emplois et rémunérations publics'],
      ['elus', 'Élus et anciens élus'], ['train-de-vie', 'Train de vie de l’État'], ['communication', 'Communication et événementiel'],
      ['conseil', 'Cabinets de conseil et études'], ['immobilier', 'Immobilier public'], ['audiovisuel', 'Audiovisuel public']]],
    ['Ce qui interroge', [['depense-inutile', 'Dépense inutile'], ['depense-abusive', 'Dépense abusive'], ['risque-fraude', 'Risque de fraude'],
      ['conflit-interets', 'Conflit d’intérêts possible'], ['cout-disproportionne', 'Coût disproportionné'], ['derive', 'Dérive de coût ou de délai'],
      ['doublon', 'Doublon entre échelons'], ['opacite', 'Donnée manquante, opacité']]],
  ];
  const CAT_LABEL = Object.fromEntries(CATEGORIES.flatMap(([, list]) => list));
  const MAX_TAGS = 8;
  $('sgCatGroups').innerHTML = CATEGORIES.map(([group, list]) => `<div class="sg-catgroup"><p>${esc(group)}</p><div class="sg-chips">${list.map(([k, label]) =>
    `<button type="button" class="sg-chip" data-cat="${k}" aria-pressed="false">${esc(label)}</button>`).join('')}</div></div>`).join('');
  const catsOf = v => String(v || '').split(',').map(x => x.trim()).filter(x => CAT_LABEL[x]);
  const tagsOf = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  function showCats() {
    const on = new Set(catsOf(form.categories.value));
    form.querySelectorAll('[data-cat]').forEach(b => b.setAttribute('aria-pressed', String(on.has(b.dataset.cat))));
  }
  function showTags() {
    $('sgTagList').innerHTML = tagsOf(form.mots.value).map((t, i) => `<span class="sg-tag-chip">${esc(t)}<button type="button" data-untag="${i}" aria-label="Retirer ${esc(t)}">×</button></span>`).join('');
    $('sgTagInput').hidden = tagsOf(form.mots.value).length >= MAX_TAGS;
    $('sgTagInput').placeholder = tagsOf(form.mots.value).length ? 'Ajouter un mot-clé…' : 'Marché public, piscine, Exempleville…';
  }
  $('sgCats').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b || b.disabled || form.classList.contains('is-locked')) return;
    const on = new Set(catsOf(form.categories.value));
    on.has(b.dataset.cat) ? on.delete(b.dataset.cat) : on.add(b.dataset.cat);
    form.categories.value = [...on].join(', ');
    showCats();
  });
  function addTag(text) {
    const t = String(text || '').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    const tags = tagsOf(form.mots.value);
    if (t.length < 2 || tags.length >= MAX_TAGS || tags.some(x => x.toLowerCase() === t.toLowerCase())) return;
    form.mots.value = [...tags, t].join(', ');
    showTags();
  }
  $('sgTagInput').addEventListener('keydown', e => {
    const input = e.currentTarget;
    if ((e.key === 'Enter' || e.key === ',' || e.key === ';') && !e.isComposing) { e.preventDefault(); addTag(input.value); input.value = ''; }
    else if (e.key === 'Backspace' && !input.value && tagsOf(form.mots.value).length) { form.mots.value = tagsOf(form.mots.value).slice(0, -1).join(', '); showTags(); }
  });
  $('sgTagInput').addEventListener('blur', e => { if (e.currentTarget.value.trim()) { addTag(e.currentTarget.value); e.currentTarget.value = ''; } });
  $('sgTagbox').addEventListener('click', e => {
    const x = e.target.closest('[data-untag]');
    if (x && !form.classList.contains('is-locked')) { const tags = tagsOf(form.mots.value); tags.splice(+x.dataset.untag, 1); form.mots.value = tags.join(', '); showTags(); return; }
    if (e.target === e.currentTarget) $('sgTagInput').focus();
  });
  /* the Loupe's categories and keywords: one chip after the other */
  async function popChips(name, value) {
    const step = reduce.matches ? 0 : 140;
    if (name === 'categories') {
      const want = catsOf(value);
      form.categories.value = '';
      showCats();
      for (const k of want) {
        form.categories.value = [...catsOf(form.categories.value), k].join(', ');
        showCats();
        form.querySelector(`[data-cat="${k}"]`)?.classList.add('is-popped');
        await new Promise(ok => setTimeout(ok, step));
      }
    } else {
      form.mots.value = '';
      showTags();
      for (const t of tagsOf(value).slice(0, MAX_TAGS)) {
        form.mots.value = [...tagsOf(form.mots.value), t].join(', ');
        showTags();
        $('sgTagList').lastElementChild?.classList.add('is-popped');
        await new Promise(ok => setTimeout(ok, step));
      }
    }
  }

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
      montant: form.montant.value, email: form.email.value, liens, site: form.site.value, categories: catsOf(form.categories.value), mots: tagsOf(form.mots.value), charte: form.charte.checked, prive: form.prive.checked, loupe: state.loupe,
      preuve: { ...state.challenge, counter: state.counter, trace: state.trace } };
    try {
      const r = await fetch(API + 'signalement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.ok) {
        result.className = 'sg-result is-ok';
        result.innerHTML = !d.ref ? 'Merci !' : d.visible ? `Merci ! Signalement <a href="#${esc(d.ref)}">${esc(d.ref)}</a> en ligne, visible par tous, marqué « non relu » jusqu’à la relecture.`
          : `Merci ! Signalement ${esc(d.ref)} reçu : seul FranceRoueLibre le lira.`;
        form.reset(); count(); showCats(); showTags(); list(d.ref);
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
      form[k].value = Array.isArray(v) ? v.join(k === 'categories' || k === 'mots' ? ', ' : '\n') : v;
      flash(form[k]);
    }
    count(); showCats(); showTags();
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
      if (name === 'categories' || name === 'mots') {
        const box = el.closest('.sg-field');
        box?.classList.add('is-typing');
        box?.scrollIntoView?.({ block: 'nearest', behavior: reduce.matches ? 'auto' : 'smooth' });
        await popChips(name, text);
        box?.classList.remove('is-typing');
        continue;
      }
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
  /* What the Loupe wrote (one event per remplir_signalement or modifier_champ call): whole fields, as plain text. They
     are only ever written with .value, so nothing in them can run on the page. */
  const KEYS = ['titre', 'lieu', 'montant', 'siren', 'description', 'liens', 'categories', 'mots'];
  const QMARK = /\n*Questions à poser :\n[\s\S]*$/;   // the questions end the description
  const draftState = {};
  function applyDraft(champs, sources) {
    champs = { ...(champs || {}) };
    if (champs.questions) {   // only from a text answer read by parseDraft (the server joins them itself)
      champs.description = [String(champs.description ?? draftState.description ?? '').replace(QMARK, ''), `Questions à poser :\n${champs.questions}`].filter(Boolean).join('\n\n');
    }
    for (const k of KEYS) {
      if (!(k in champs) || typeof champs[k] !== 'string' || champs[k] === draftState[k]) continue;
      draftState[k] = champs[k];
      typeInto(k, champs[k]);
    }
    const links = [...new Set([...String(draftState.liens || '').split('\n'), ...(sources || []).map(s => s?.url)].map(u => (u || '').trim()).filter(u => /^https?:\/\//.test(u)))];
    if (links.length && links.join('\n') !== (draftState.liens || '')) { draftState.liens = links.slice(0, 12).join('\n'); typeInto('liens', draftState.liens); }
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
          categories: 'commune, projet-aide, marche-public, cout-disproportionne', mots: 'centre aquatique, piscine, Exempleville, équipement sportif',
        }, 'faits, questions, sources, catégories, mots-clés', 700),
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
          categories: 'association, subvention, conflit-interets, opacite', mots: 'association, subventions, dirigeants, comptes annuels',
        }, 'faits, questions, sources, catégories, mots-clés', 700),
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
  /* A short piste goes in the question; a long one (a dossier pasted, up to 6 000 characters) is sent apart, joined to
     the question by the server as data, after a check for insults and accusations. */
  const LONG = 400;
  const PROMPT = idea => `Je suis sur la page Remontées citoyennes. Prépare un signalement citoyen à partir de ma piste${idea.length > LONG ? ', jointe ci-dessous' : ` : « ${idea} »`}. `
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
  const NAMES = { titre: 'titre', lieu: 'lieu', montant: 'montant', siren: 'SIREN', description: 'faits', questions: 'questions', liens: 'sources', categories: 'catégories', mots: 'mots-clés' };
  function hooks(idea, done) {
    let lastStep = null, tools = 0;
    return {
      shown: `Préparer un signalement : « ${idea.length > 240 ? `${idea.slice(0, 220).trim()}… » (${idea.length.toLocaleString('fr-FR')} caractères joints)` : `${idea} »`}`,
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
      const r = await fetch(API + 'ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', text: prompt }], signalement: h.form || {}, ...(h.piste ? { piste: h.piste } : {}) }) });
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
    begin();
    card.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'start' });
    const finished = new Promise(ok => {
      const h = hooks(idea, ok);
      if (demo) { h.shown = `Préparer un signalement (exemple) : « ${idea} »`; h.script = demo; } else {
        h.form = fields();
        if (idea.length > LONG) h.piste = idea;
      }
      const opened = window.FRLLoupe?.ask && window.FRLLoupe.ask(demo ? `[démonstration] ${idea}` : PROMPT(idea), { hooks: h, background: !wide.matches });
      Promise.resolve(opened).then(started => { if (started) sideBySide(); else if (demo) play(demo, h); else direct(PROMPT(idea), h); });
    });
    end(await finished, demo);
  }
  function begin() {
    st.className = 'sg-loupe__state'; st.textContent = '';
    liveSteps.innerHTML = ''; live.hidden = false; live.classList.remove('is-done');
    now('La Loupe réfléchit');
    lock(true);
  }
  function end(m, demo) {
    lock(false);
    live.classList.add('is-done');
    if (m.error) {
      now('La Loupe s’est arrêtée');
      st.className = 'sg-loupe__state is-error';
      st.textContent = Object.keys(draftState).length ? `${m.error} Ce qui est déjà écrit reste dans le formulaire : complétez-le vous-même.` : m.error;
    } else if (demo) {
      state.demoTitle = form.titre.value;
      now('Démonstration terminée : à vous d’écrire votre propre piste');
      st.className = 'sg-loupe__state'; st.textContent = 'Ce dossier d’exemple ne peut pas être envoyé tel quel.';
    } else {
      state.loupe = true;
      now('Dossier prérempli : relisez, corrigez, puis envoyez, ou demandez une modification à la Loupe');
      if (!wide.matches || !document.querySelector('.ai-panel:not([hidden])')) form.titre.focus({ preventScroll: true });
    }
  }
  /* Every question asked in the Loupe's panel on this page (« ajoute… », « va chercher le maire… », « raccourcis… »):
     the form goes with it (assistant.js sends it), the server gives the Loupe three tools on it (lire_formulaire,
     remplir_signalement, modifier_champ), and her changes are written into the form live, like the first draft.
     The e-mail never leaves the page. */
  const fields = () => Object.fromEntries(KEYS.map(k => [k, form[k].value.trim()]));
  window.FRLLoupePage = {
    wrap(text) {
      if (form.classList.contains('is-locked') || view !== 'faire') return null;
      for (const k of Object.keys(draftState)) delete draftState[k];
      const cur = fields();
      Object.assign(draftState, cur);
      const h = hooks(text, m => end(m, false));
      h.shown = undefined;
      h.form = cur;
      begin();
      card.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'nearest' });
      return h;
    },
  };
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
    $('sgIdea').value = b.dataset.idea; grow();
    draft(b.dataset.demo);
  });
  // Enter sends a short piste; a long one (pasted, several lines) keeps its line breaks: Ctrl+Enter sends it
  $('sgIdea').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (!e.ctrlKey && !e.metaKey && ($('sgIdea').value.includes('\n') || $('sgIdea').value.length > LONG)) return;
    e.preventDefault(); draft();
  });
  const grow = () => {
    const el = $('sgIdea');
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 420)}px`;
    const n = el.value.length;
    $('sgIdeaCount').textContent = n > LONG ? `${n.toLocaleString('fr-FR')} / 6 000 · dossier joint, Ctrl+Entrée pour lancer` : '';
  };
  $('sgIdea').addEventListener('input', grow);

  /* a report started from an answer of the Loupe panel (loupe-signal.js) */
  try {
    const from = JSON.parse(sessionStorage.getItem('frl-signalement') || 'null');
    if (from) {
      $('sgIdea').value = String(from.question || '').slice(0, 6000); grow();
      const links = (from.sources || []).map(s => s.url).filter(Boolean);
      fill({ titre: String(from.question || '').slice(0, 140), description: `${String(from.reponse || '').slice(0, 5500)}`, liens: links });
      state.loupe = true;
      st.textContent = 'Repris de la réponse de la Loupe : reformulez en signalement, gardez les sources.';
      if (location.hash !== '#signaler') document.getElementById('signaler').scrollIntoView();
    }
  } catch (_) { /* private mode */ }
  const params = new URLSearchParams(location.search);
  fill({ siren: params.get('siren'), lieu: params.get('lieu'), titre: params.get('titre') });

  /* ------------------------------------------------------------------ the two doors (route)
     Arriving, the page shows two doors; #faire opens the rules and the form, #voir the reports. A report's own link
     (#S-…) and ?q= open the reports too. */
  const VIEWS = { faire: 'faire', signaler: 'faire', charte: 'faire', voir: 'voir', sgListTitle: 'voir' };
  let view = '';
  function route(scroll) {
    const h = decodeURIComponent(location.hash.slice(1));
    const want = VIEWS[h] || (/^S-\d{8}-[A-Z0-9]{4}$/.test(h) || new URLSearchParams(location.search).get('q') ? 'voir' : '');
    view = want;
    $('portes').hidden = !!want;
    $('sgSwitch').hidden = !want;
    document.querySelectorAll('.sg-view').forEach(v => { v.hidden = v.dataset.view !== want; });
    document.querySelectorAll('.sg-switch [data-go]').forEach(a => a.setAttribute('aria-current', String(a.dataset.go === want)));
    document.body.dataset.sgView = want;
    if (!want || !scroll) return;
    const target = /^S-/.test(h) ? null : document.getElementById(h === 'faire' || h === 'voir' ? 'sgSwitch' : h);
    target?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  addEventListener('hashchange', () => { route(true); if (/^#S-/.test(location.hash)) focusItem(location.hash.slice(1)); });
  // the doors and the switch: their own links (the page's smooth scrolling would only look for the hidden target)
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-go]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault(); e.stopPropagation();
    if (location.hash !== `#${a.dataset.go}`) history.pushState(null, '', `#${a.dataset.go}`);
    route(false);
    // the switch right under the header: the hero's end
    const hero = document.querySelector('.sg-hero'), headerH = headerBottom();
    scrollTo({ top: Math.max(0, hero.offsetTop + hero.offsetHeight - headerH), behavior: 'auto' });
  }, true);
  addEventListener('popstate', () => route(false));
  // the switch sticks right under the header, whose height differs between phone (two rows) and wide screens
  const headerBottom = () => {
    const h = document.getElementById('siteHeader');
    if (!h) return 68;
    return Math.max(...[h, h.querySelector('.nav__links')].filter(Boolean).map(el => el.getBoundingClientRect().bottom), 0);   // the menu row under the header on a phone
  };
  const fitTop = () => document.documentElement.style.setProperty('--sg-top', `${Math.round(headerBottom())}px`);
  fitTop(); addEventListener('resize', fitTop, { passive: true });

  /* ------------------------------------------------------------------ every report shown to all
     Filters: words (title, keywords, place, text), categories and keywords chips (facets), sort. Each report: its
     categories and keywords (a click filters on them), thumbs up or down, the notes of the community with their own
     thumbs. A note « retenue » (3 thumbs up at least, twice as many as down) shows above, as on X. */
  const Q_REPORT = 'Ce signalement est-il légitime, objectif, ou permet-il de mieux comprendre nos dépenses publiques ?';
  const Q_NOTE = 'Cette note est-elle légitime, objective, ou permet-elle de mieux comprendre nos dépenses publiques ?';
  const THUMB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9h3zm2 9h8.3a2 2 0 0 0 2-1.6l1.3-6A2 2 0 0 0 18.6 10H14l.8-4.1a1.6 1.6 0 0 0-2.9-1.2L9 9.6V20z"/></svg>';
  const day = iso => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const nrm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ');
  const words = t => nrm(t).match(/[a-z0-9]+/g) || [];
  const net = v => (v?.up || 0) - (v?.down || 0);
  const retained = n => n.votes.up >= 3 && n.votes.up >= 2 * n.votes.down;
  const reports = { all: [], q: '', cats: new Set(), tags: new Set(), sort: 'recent' };
  let myVotes = {};
  try { myVotes = JSON.parse(localStorage.getItem('frl-votes') || '{}'); } catch (_) { myVotes = {}; }
  const keepVotes = () => { try { localStorage.setItem('frl-votes', JSON.stringify(myVotes)); } catch (_) { /* private mode */ } };

  function thumbs(ref, note, votes, question) {
    const key = note ? `${ref}:${note}` : ref, mine = myVotes[key] || 0, total = votes.up + votes.down;
    const share = total ? Math.round(100 * votes.up / total) : 50;
    return `<div class="sg-vote${note ? ' sg-vote--note' : ''}" data-ref="${esc(ref)}"${note ? ` data-note="${esc(note)}"` : ''}><p>${esc(question)}</p>`
      + `<div class="sg-vote__row"><button type="button" class="sg-thumb sg-thumb--up" data-sens="1" aria-pressed="${mine === 1}" aria-label="Oui">${THUMB}<span>${votes.up}</span></button>`
      + `<button type="button" class="sg-thumb sg-thumb--down" data-sens="-1" aria-pressed="${mine === -1}" aria-label="Non">${THUMB}<span>${votes.down}</span></button>`
      + `${total ? `<span class="sg-vote__bar" aria-hidden="true"><i style="width:${share}%"></i></span>` : ''}<small>${total ? `${share} % oui sur ${total} vote${total > 1 ? 's' : ''}` : 'Pas encore de vote'}</small></div></div>`;
  }
  function noteHtml(ref, n, lead) {
    return `<div class="sg-note${lead ? ' is-retained' : ''}">${lead ? '<p class="sg-note__lead">Note de la communauté retenue</p>' : ''}<p>${esc(n.texte)}</p>`
      + `${n.liens?.length ? `<ul>${n.liens.map(u => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow ugc">${esc(u)}</a></li>`).join('')}</ul>` : ''}`
      + `<p class="sg-note__date">${day(n.recu)}</p>${thumbs(ref, n.id, n.votes, Q_NOTE)}</div>`;
  }
  function item(s) {
    const meta = [s.siren && `SIREN ${esc(s.siren)}`, s.lieu && esc(s.lieu), s.montant && esc(s.montant)].filter(Boolean);
    const notes = [...(s.notes || [])].sort((a, b) => net(b.votes) - net(a.votes));
    const lead = notes.find(retained), others = notes.filter(n => n !== lead);
    const long = (s.description || '').length > 700;
    return `<article class="sg-item${s.relu ? ' is-read' : ''}" id="${esc(s.ref)}"><header><span class="sg-tag${s.relu ? ' sg-tag--read' : ''}">${s.relu ? 'Relu par FranceRoueLibre' : 'Non relu'}</span>`
      + `<span>${esc(s.ref)}</span><span>${day(s.publie)}</span>${s.loupe ? '<span>préparé avec la Loupe</span>' : ''}</header>`
      + `<h3>${esc(s.titre)}</h3>`
      + `${(s.categories || []).length || (s.mots || []).length ? `<div class="sg-item__tags">${(s.categories || []).map(c => `<button type="button" class="sg-pill" data-fcat="${esc(c)}">${esc(CAT_LABEL[c] || c)}</button>`).join('')}${(s.mots || []).map(m => `<button type="button" class="sg-kw" data-ftag="${esc(m)}">#${esc(m)}</button>`).join('')}</div>` : ''}`
      + `<div class="sg-item__text${long ? ' is-long' : ''}"><p>${esc(s.description)}</p>${long ? '<button type="button" class="sg-more">Lire la suite</button>' : ''}</div>`
      + `${meta.length ? `<p class="note">${meta.join(' · ')}</p>` : ''}`
      + `${(s.liens || []).length ? `<ul>${s.liens.map(u => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow ugc">${esc(u)}</a></li>`).join('')}</ul>` : ''}`
      + `${s.reponse ? `<div class="sg-reply"><strong>Réponse</strong><p>${esc(s.reponse)}</p></div>` : ''}`
      + `${lead ? noteHtml(s.ref, lead, true) : ''}`
      + thumbs(s.ref, null, s.votes || { up: 0, down: 0 }, Q_REPORT)
      + `<details class="sg-notes"><summary>${others.length ? `Notes de la communauté (${others.length})` : 'Ajouter une note de la communauté'}</summary>`
      + `${others.map(n => noteHtml(s.ref, n, false)).join('')}`
      + `<form class="sg-noteform" data-ref="${esc(s.ref)}" novalidate><label><span>Votre note : un contexte, une correction, une source qui manque</span><textarea name="texte" rows="3" maxlength="1000" placeholder="Les faits, avec leurs sources. Pas d’insulte, pas d’accusation."></textarea></label>`
      + `<label><span>Sources <em>un lien par ligne</em></span><textarea name="liens" rows="2" placeholder="https://…"></textarea></label><input name="site" class="sg-hp" tabindex="-1" autocomplete="off" aria-hidden="true">`
      + `<div class="sg-noteform__row"><button type="submit" class="btn btn--ghost">Proposer la note</button><span class="sg-noteform__state" aria-live="polite"></span></div></form></details>`
      + `<footer><span>Une piste à vérifier, pas un verdict.</span><button type="button" class="sg-abuse" data-ref="${esc(s.ref)}">Signaler un abus</button></footer></article>`;
  }
  function matches(s) {
    if (reports.cats.size && ![...reports.cats].every(c => (s.categories || []).includes(c))) return false;
    if (reports.tags.size && ![...reports.tags].every(t => (s.mots || []).some(m => nrm(m) === nrm(t)))) return false;
    const ws = words(reports.q);
    if (!ws.length) return true;
    const bag = words(`${s.titre} ${(s.mots || []).join(' ')} ${(s.categories || []).map(c => CAT_LABEL[c]).join(' ')} ${s.lieu} ${s.siren} ${s.montant} ${s.description} ${(s.notes || []).map(n => n.texte).join(' ')}`);
    return ws.every((w, i) => bag.includes(w) || (i === ws.length - 1 && w.length >= 3 && bag.some(x => x.startsWith(w))));
  }
  function facets(rows) {
    const cat = new Map(), tag = new Map();
    for (const s of rows) {
      (s.categories || []).forEach(c => cat.set(c, (cat.get(c) || 0) + 1));
      (s.mots || []).forEach(m => { const k = m.trim(); tag.set(k, (tag.get(k) || 0) + 1); });
    }
    const cats = [...cat].sort((a, b) => b[1] - a[1]);
    const tags = [...tag].sort((a, b) => b[1] - a[1]).slice(0, 14);
    $('sgFacets').innerHTML = (cats.length ? `<div class="sg-facet"><p>Thèmes</p><div class="sg-chips">${cats.map(([c, n]) => `<button type="button" class="sg-chip" data-fcat="${esc(c)}" aria-pressed="${reports.cats.has(c)}">${esc(CAT_LABEL[c] || c)} <small>${n}</small></button>`).join('')}</div></div>` : '')
      + (tags.length ? `<div class="sg-facet"><p>Mots-clés</p><div class="sg-chips">${tags.map(([t, n]) => `<button type="button" class="sg-chip sg-chip--kw" data-ftag="${esc(t)}" aria-pressed="${[...reports.tags].some(x => nrm(x) === nrm(t))}">#${esc(t)} <small>${n}</small></button>`).join('')}</div></div>` : '');
  }
  function render() {
    const rows = reports.all.filter(matches);
    const by = { recent: (a, b) => String(b.publie).localeCompare(String(a.publie)), note: (a, b) => net(b.votes) - net(a.votes) || String(b.publie).localeCompare(String(a.publie)),
      notes: (a, b) => (b.notes || []).length - (a.notes || []).length || String(b.publie).localeCompare(String(a.publie)) }[reports.sort];
    rows.sort(by);
    facets(reports.all);
    const filtered = reports.q || reports.cats.size || reports.tags.size;
    $('sgFilterState').innerHTML = filtered ? `${rows.length.toLocaleString('fr-FR')} remontée${rows.length > 1 ? 's' : ''} sur ${reports.all.length.toLocaleString('fr-FR')} <button type="button" class="sg-clear">Tout afficher</button>` : '';
    $('sgList').innerHTML = rows.length ? rows.map(item).join('') : reports.all.length ? '<p class="note">Aucune remontée ne correspond : essayez un autre mot.</p>' : '<p class="note">Aucune remontée pour l’instant : soyez le premier.</p>';
  }
  function focusItem(ref) {
    const el = document.getElementById(ref);
    if (!el) return;
    el.classList.add('is-focus');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => el.classList.remove('is-focus'), 2400);
  }
  async function list(focus) {
    try {
      const r = await fetch(API + 'signalements', { cache: 'no-store' });
      const d = await r.json();
      reports.all = d.signalements || [];
      const n = reports.all.length;
      const label = n ? `${n.toLocaleString('fr-FR')} remontée${n > 1 ? 's' : ''}` : '';
      $('sgListCount').textContent = label ? `· ${label}` : '';
      $('sgSwitchCount').textContent = n ? `(${n.toLocaleString('fr-FR')})` : '';
      $('sgDoorCount').textContent = n ? `${label[0].toUpperCase()}${label.slice(1)}` : 'Les pistes';
      render();
      const want = focus || (/^#S-/.test(location.hash) ? location.hash.slice(1) : '');
      if (want) { if (view !== 'voir') { location.hash = want; } else focusItem(want); }
    } catch (e) {
      $('sgList').innerHTML = '<p class="note">La liste n’est pas joignable pour l’instant.</p>';
    }
  }
  $('sgFilterQ').addEventListener('input', e => { reports.q = e.currentTarget.value; render(); });
  $('sgSort').addEventListener('change', e => { reports.sort = e.currentTarget.value; render(); });
  function toggleFilter(t) {
    const c = t.closest('[data-fcat]'), k = t.closest('[data-ftag]');
    if (!c && !k) return false;
    if (c) { const v = c.dataset.fcat; reports.cats.has(v) ? reports.cats.delete(v) : reports.cats.add(v); }
    else { const v = k.dataset.ftag, has = [...reports.tags].find(x => nrm(x) === nrm(v)); has ? reports.tags.delete(has) : reports.tags.add(v); }
    render();
    $('sgFilters')?.scrollIntoView?.({ block: 'nearest' });
    return true;
  }
  $('sgFacets').addEventListener('click', e => toggleFilter(e.target));
  $('sgFilterState').addEventListener('click', e => {
    if (!e.target.closest('.sg-clear')) return;
    reports.q = ''; reports.cats.clear(); reports.tags.clear(); $('sgFilterQ').value = ''; render();
  });

  /* the notes: a challenge asked when the reader starts writing (answered 3 s later at the soonest), its proof of
     work done meanwhile; no drawing here */
  const noteProof = new WeakMap();
  async function proofFor(f) {
    if (!noteProof.has(f)) noteProof.set(f, (async () => {
      const r = await fetch(API + 'signalement/defi', { cache: 'no-store' });
      const c = await r.json();
      const enc = new TextEncoder();
      for (let i = 0; ; i++) {
        const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${c.nonce}:${i}`)));
        if (zeroBits(h) >= c.difficulty) return { ...c, counter: i, at: Date.now() };
      }
    })().catch(() => null));
    return noteProof.get(f);
  }
  $('sgList').addEventListener('focusin', e => { const f = e.target.closest('.sg-noteform'); if (f) proofFor(f); });
  $('sgList').addEventListener('submit', async e => {
    const f = e.target.closest('.sg-noteform');
    if (!f) return;
    e.preventDefault();
    const st = f.querySelector('.sg-noteform__state'), btn = f.querySelector('button[type=submit]');
    const texte = f.texte.value.trim();
    if (texte.length < 30) { st.className = 'sg-noteform__state is-error'; st.textContent = 'Une note explique, avec ses sources : 30 caractères au moins.'; return; }
    btn.disabled = true; st.className = 'sg-noteform__state'; st.textContent = 'Envoi…';
    const proof = await proofFor(f);
    if (!proof) { st.className = 'sg-noteform__state is-error'; st.textContent = 'Le service ne répond pas : réessayez plus tard.'; btn.disabled = false; noteProof.delete(f); return; }
    const wait = proof.at + 3200 - Date.now();
    if (wait > 0) await new Promise(ok => setTimeout(ok, wait));
    try {
      const liens = f.liens.value.split(/\s+/).filter(u => /^https?:\/\//i.test(u));
      const r = await fetch(API + 'signalement/note', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: f.dataset.ref, texte, liens, site: f.site.value, preuve: { nonce: proof.nonce, ts: proof.ts, sig: proof.sig, counter: proof.counter } }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Note refusée.');
      if (d.id) myVotes[`${f.dataset.ref}:${d.id}`] = 1;
      keepVotes();
      await list(f.dataset.ref);
    } catch (err) {
      st.className = 'sg-noteform__state is-error'; st.textContent = err.message; btn.disabled = false; noteProof.delete(f);
    }
  });
  $('sgList').addEventListener('click', async e => {
    if (toggleFilter(e.target)) return;
    const more = e.target.closest('.sg-more');
    if (more) { more.parentElement.classList.remove('is-long'); more.remove(); return; }
    const t = e.target.closest('.sg-thumb');
    if (t) {
      const box = t.closest('.sg-vote'), ref = box.dataset.ref, note = box.dataset.note || null, key = note ? `${ref}:${note}` : ref;
      const sens = myVotes[key] === +t.dataset.sens ? 0 : +t.dataset.sens;
      box.querySelectorAll('.sg-thumb').forEach(b => { b.disabled = true; });
      try {
        const r = await fetch(API + 'signalement/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref, note, sens }) });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error);
        if (sens) myVotes[key] = sens; else delete myVotes[key];
        keepVotes();
        const s = reports.all.find(x => x.ref === ref);
        const target = note ? s?.notes.find(n => n.id === note) : s;
        if (target) target.votes = d.votes;
        box.outerHTML = thumbs(ref, note, d.votes, note ? Q_NOTE : Q_REPORT);
      } catch (err) {
        box.querySelectorAll('.sg-thumb').forEach(b => { b.disabled = false; });
        box.querySelector('small').textContent = err.message || 'Vote non pris en compte';
      }
      return;
    }
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
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { reports.q = q0; $('sgFilterQ').value = q0; }
  document.querySelectorAll('[data-ico]').forEach(el => { if (window.FRL_ICONS) el.innerHTML = FRL_ICONS.icon(el.dataset.ico); });
  route(true); getChallenge(); list(); count(); update(); showCats(); showTags();
})();
