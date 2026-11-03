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
  window.FRLPlaces = { find, mapUrl, projectsUrl, deptUrl, people, sure };
})();
