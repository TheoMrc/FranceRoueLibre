/* Communes and départements from what a reader types (a name, even misspelt, a postal code, a département number),
   answered by the search API (GET api/lieux, server/assistant/places.py), with the links that lead to them:
   the commune's accounts on the map and the projects the State funded there. Used by the search boxes
   (omni-search.js), the results page (recherche.js) and the map (app.js). */
(() => {
  const here = document.currentScript?.src || location.href;
  const asset = path => new URL(path, here).href;
  const cache = new Map();
  const looksLikePlace = q => /\d{2,5}/.test(q) || q.trim().length >= 3;
  async function find(q) {
    const key = String(q || '').trim().toLowerCase();
    if (!key || !looksLikePlace(key)) return { communes: [], departement: null, type: '' };
    if (!cache.has(key)) {
      cache.set(key, fetch(`${asset('api/lieux')}?q=${encodeURIComponent(key)}`).then(r => r.ok ? r.json() : null)
        .catch(() => null).then(d => d || { communes: [], departement: null, type: '' }));
    }
    return cache.get(key);
  }
  const mapUrl = c => asset(`index.html?commune=${encodeURIComponent(c.insee)}#explorer`);
  const projectsUrl = c => asset(`index.html?commune=${encodeURIComponent(c.insee)}&vue=projets${c.projets_annee ? `&annee=${c.projets_annee}` : ''}#explorer`);
  const deptUrl = d => asset(`index.html?departement=${encodeURIComponent(d.code)}#explorer`);
  const people = n => n ? `${Number(n).toLocaleString('fr-FR')} hab.` : '';
  /* a match good enough for Enter to go straight to the commune (exact name, postal code, département) */
  const sure = r => r && (r.type === 'nom' || r.type === 'code_postal' || r.type === 'departement' || (r.type === 'approchant' && r.communes.length === 1));
  /* The links of a commune level by level (server/assistant/places.py links()), as a row of small buttons:
     the commune, its intercommunality, its département, its region, the State-aided projects, elected officials. */
  const ICONS = {
    commune: '<path d="M3 21h18M5 21V10l7-5 7 5v11M10 21v-5h4v5"/>',
    interco: '<path d="M2 21h20M4 21v-7l4-3 4 3v7M12 21v-9l4-3 4 3v9"/>',
    departement: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
    region: '<path d="M4 21V4M4 4h12l-2 4 2 4H4"/>',
    projets: '<path d="M2 20h20M6 20V9h12v11M9 9V5h6v4M10 13h4"/>',
    elus: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6"/>',
  };
  const icon = key => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" aria-hidden="true">${ICONS[key] || ICONS.commune}</svg>`;
  const escH = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function chips(links, { attr = '' } = {}) {
    const short = l => l.cle === 'commune' ? 'Commune' : l.cle === 'projets' ? 'Projets aidés' : l.cle === 'elus' ? 'Élus' : l.libelle;
    return `<div class="frl-chips">${(links || []).map((l, i) => `<a class="frl-chip frl-chip--${escH(l.cle)}" href="${escH(asset(l.url))}" title="${escH(l.libelle)}"${attr ? ` ${attr}="${i}"` : ''}>${icon(l.cle)}<span>${escH(short(l))}</span></a>`).join('')}</div>`;
  }
  window.FRLPlaces = { find, mapUrl, projectsUrl, deptUrl, people, sure, chips, icon };
})();
