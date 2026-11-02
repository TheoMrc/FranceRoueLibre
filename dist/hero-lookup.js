/* Home page: « Où va l’argent public ? » answered post by post, in a panel like BioDevs' mission selector: the name of the
   post in gradient letters, its amount and share, what it pays for, and below a grid of pictograms (icons.js) where the
   current one lights up; a thin bar shows the time left before the next one. Biggest spending first. Data: public
   spending by function, all public administrations (Eurostat COFOG, data/national-functions.json), with the debt interest
   taken out of the general services. A tap on a pictogram stops on it; a mouse over the panel pauses it. */
(() => {
  const root = document.getElementById('heroLookup');
  if (!root || typeof FRL_ICONS === 'undefined') return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const DUR = 4200;
  const md = v => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Md€`;
  const pct = v => `${v.toLocaleString('fr-FR', { maximumFractionDigits: v < 10 ? 1 : 0 })} %`;
  /* [function code(s), name in the sentence, short label, pictogram, what it pays for]; 'A-B' = A without B */
  const POSTS = [
    ['GF10', 'la protection sociale', 'Social', 'heart', 'Retraites, famille, chômage, handicap, exclusion.'],
    ['GF07', 'la santé', 'Santé', 'health', 'Hôpitaux, soins de ville, médicaments, prévention.'],
    ['GF01-GF0107', 'l’administration générale', 'Administration', 'admin', 'Ministères, impôts, relations entre administrations, recherche fondamentale.'],
    ['GF04', 'les affaires économiques', 'Économie', 'chart', 'Transports, énergie, aides aux entreprises, politique de l’emploi.'],
    ['GF09', 'l’enseignement', 'Écoles', 'school', 'Écoles, collèges, lycées, universités.'],
    ['GF0107', 'les intérêts de la dette', 'Dette', 'money', 'Ce que coûte chaque année la dette déjà contractée.'],
    ['GF02', 'la défense', 'Armées', 'army', 'Armées, équipements, opérations.'],
    ['GF03', 'l’ordre et la sécurité', 'Sécurité', 'police', 'Police, gendarmerie, justice, prisons, pompiers.'],
    ['GF08', 'la culture et le sport', 'Culture', 'palette', 'Culture, sport, médias, cultes.'],
    ['GF06', 'le logement et les équipements', 'Logement', 'pin', 'Logement, aménagement, eau, éclairage public.'],
    ['GF05', 'l’environnement', 'Environnement', 'leaf', 'Déchets, eaux usées, biodiversité, pollution.'],
  ];
  fetch('data/national-functions.json').then(r => r.ok ? r.json() : null).then(data => {
    if (!data) return;
    const te = data.data.TE, yi = data.years.length - 1, year = data.years[yi], total = te.TOTAL[yi];
    const value = code => code.split('-').reduce((s, c, i) => s + (i ? -1 : 1) * (te[c]?.[yi] || 0), 0);
    const posts = POSTS.map(([code, name, short, icon, what]) => ({ code, name, short, icon, what, v: value(code) })).filter(p => p.v > 0).sort((a, b) => b.v - a.v);
    root.style.setProperty('--lk-dur', `${DUR}ms`);
    root.innerHTML = `<p class="lookup__prefix">En ${year}, sur ${md(total)} de dépenses publiques,</p>
      <div class="lookup__slides" aria-live="polite">${posts.map((p, i) => `<div class="lookup__slide${i ? '' : ' is-active'}"><span class="lookup__word gradient-text">${md(p.v)} pour ${p.name}</span><p class="lookup__desc"><strong>${pct(100 * p.v / total)} des dépenses.</strong> ${p.what}</p></div>`).join('')}</div>
      <div class="lookup__icons" role="tablist" aria-label="Postes de dépense">${posts.map((p, i) => `<button type="button" class="lookup__icon${i ? '' : ' is-active'}" role="tab" aria-selected="${!i}" style="--i:${i}"><span class="lookup__box">${FRL_ICONS.icon(p.icon)}</span><span class="lookup__label">${p.short}</span></button>`).join('')}</div>
      <p class="lookup__source">Toutes administrations publiques (État, Sécurité sociale, collectivités). Source : Eurostat et Insee, dépenses par fonction. <a href="#circuit">Le circuit de l’argent public</a></p>
      <span class="lookup__progress" aria-hidden="true"></span>`;
    const slides = [...root.querySelectorAll('.lookup__slide')], icons = [...root.querySelectorAll('.lookup__icon')];
    let cur = 0, timer = null, chosen = false, inView = false, hovered = false;
    function show(i) {
      cur = (i + posts.length) % posts.length;
      slides.forEach((s, k) => s.classList.toggle('is-active', k === cur));
      icons.forEach((b, k) => { b.classList.toggle('is-active', k === cur); b.setAttribute('aria-selected', String(k === cur)); });
    }
    const stop = () => { clearInterval(timer); timer = null; root.classList.remove('is-playing'); };
    const bar = () => { root.classList.remove('is-playing'); void root.offsetWidth; root.classList.add('is-playing'); };
    function play() {
      stop();
      if (chosen || reduce.matches || !inView || hovered) return;
      bar();
      timer = setInterval(() => { show(cur + 1); bar(); }, DUR);
    }
    icons.forEach((b, k) => b.addEventListener('click', () => { chosen = true; stop(); show(k); }));
    root.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hovered = true; stop(); } });
    root.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hovered = false; play(); } });
    new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) { root.classList.add('is-visible'); play(); } else stop(); }, { threshold: .35 }).observe(root);
    show(0);
  }).catch(() => {});
})();
