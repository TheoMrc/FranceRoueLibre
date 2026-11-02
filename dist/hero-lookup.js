/* Home page: under « Où va l’argent public ? », one line that rolls from post to post, biggest spending first: a
   pictogram (icons.js) that rises turning, and facing it the amount, counting up from zero, the share and what it pays for. Data: public
   spending by function, all public administrations (Eurostat COFOG, data/national-functions.json), with the debt interest
   taken out of the general services. A mouse over it pauses it; a tap shows the next post. */
(() => {
  const root = document.getElementById('heroLookup');
  if (!root || typeof FRL_ICONS === 'undefined') return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const DUR = 5200;
  const md = v => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Md€`;
  const pct = v => `${v.toLocaleString('fr-FR', { maximumFractionDigits: v < 10 ? 1 : 0 })} %`;
  /* [function code(s), name in the sentence, short label, pictogram, what it pays for]; 'A-B' = A without B */
  const POSTS = [
    ['GF10', 'la protection sociale', 'Social', 'heart', 'Retraites, famille, chômage, handicap, exclusion.'],
    ['GF07', 'la santé', 'Santé', 'health', 'Hôpitaux, soins de ville, médicaments, prévention.'],
    ['GF01-GF0107', 'l’administration générale', 'Admin.', 'admin', 'Ministères, impôts, relations entre administrations, recherche fondamentale.'],
    ['GF04', 'les affaires économiques', 'Économie', 'chart', 'Transports, énergie, aides aux entreprises, politique de l’emploi.'],
    ['GF09', 'l’enseignement', 'Écoles', 'school', 'Écoles, collèges, lycées, universités.'],
    ['GF0107', 'les intérêts de la dette', 'Dette', 'money', 'Ce que coûte chaque année la dette déjà contractée.'],
    ['GF02', 'la défense', 'Armées', 'army', 'Armées, équipements, opérations.'],
    ['GF03', 'l’ordre et la sécurité', 'Sécurité', 'police', 'Police, gendarmerie, justice, prisons, pompiers.'],
    ['GF08', 'la culture et le sport', 'Culture', 'palette', 'Culture, sport, médias, cultes.'],
    ['GF06', 'le logement et les équipements', 'Logement', 'pin', 'Logement, aménagement, eau, éclairage public.'],
    ['GF05', 'l’environnement', 'Écologie', 'leaf', 'Déchets, eaux usées, biodiversité, pollution.'],
  ];
  fetch('data/national-functions.json').then(r => r.ok ? r.json() : null).then(data => {
    if (!data) return;
    const te = data.data.TE, yi = data.years.length - 1, year = data.years[yi], total = te.TOTAL[yi];
    const value = code => code.split('-').reduce((s, c, i) => s + (i ? -1 : 1) * (te[c]?.[yi] || 0), 0);
    const posts = POSTS.map(([code, name, short, icon, what]) => ({ code, name, short, icon, what, v: value(code) })).filter(p => p.v > 0).sort((a, b) => b.v - a.v);
    root.style.setProperty('--lk-dur', `${DUR}ms`);
    const slot = (p, i) => `<div class="lookup__card${i ? '' : ' is-active'}">${FRL_ICONS.icon(p.icon)}</div>`;
    const line = (p, i) => `<div class="lookup__line${i ? '' : ' is-active'}"><span><strong class="gradient-text" data-v="${p.v}">${md(p.v)}</strong> pour ${p.name}</span><small>${pct(100 * p.v / total)} des dépenses publiques en ${year} · ${p.what.replace(/\.$/, '')}</small></div>`;
    root.innerHTML = `<p class="sr-only">Dépenses publiques ${year}, ${md(total)} : ${posts.map(p => `${p.name} ${md(p.v)}`).join(', ')}.</p>
      <div class="lookup__icon" aria-hidden="true">${posts.map(slot).join('')}</div>
      <div class="lookup__text" aria-hidden="true">${posts.map(line).join('')}</div>
      <span class="lookup__progress" aria-hidden="true"></span>`;
    root.title = 'Dépenses par fonction de toutes les administrations publiques. Source : Eurostat et Insee.';
    const cards = [...root.querySelectorAll('.lookup__card')], lines = [...root.querySelectorAll('.lookup__line')];
    let cur = 0, timer = null, inView = false, hovered = false, raf = 0;
    /* the amount counts up from zero while the line slides in */
    function countUp(el) {
      cancelAnimationFrame(raf);
      const to = +el.dataset.v, t0 = performance.now(), ms = 1800;
      const tick = t => { const k = Math.min(1, (t - t0) / ms); el.textContent = md(to * (1 - (1 - k) ** 3)); if (k < 1) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    }
    function show(i) {
      const prev = cur;
      cur = (i + posts.length) % posts.length;
      [cards, lines].forEach(list => list.forEach((el, k) => {
        el.classList.toggle('is-active', k === cur);
        el.classList.toggle('is-leaving', k === prev && k !== cur);
      }));
      if (!reduce.matches) countUp(lines[cur].querySelector('strong'));
    }
    const stop = () => { clearInterval(timer); timer = null; root.classList.remove('is-playing'); };
    const bar = () => { root.classList.remove('is-playing'); void root.offsetWidth; root.classList.add('is-playing'); };
    function play() {
      stop();
      if (reduce.matches || !inView || hovered) return;
      bar();
      timer = setInterval(() => { show(cur + 1); bar(); }, DUR);
    }
    root.addEventListener('click', () => { show(cur + 1); play(); });
    root.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hovered = true; stop(); } });
    root.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hovered = false; play(); } });
    new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) play(); else stop(); }, { threshold: .35 }).observe(root);
    show(0);
  }).catch(() => {});
})();
