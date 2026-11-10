/* Demandes aux instances publiques: the requests sent by the site (server/assistant/demandes.py) and their replies,
   read from the Loupe's API (GET api/assistant/demandes). */
(function () {
  const list = document.getElementById('dmList');
  const filters = document.getElementById('dmFilters');
  if (!list) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const day = iso => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const today = new Date().toISOString().slice(0, 10);
  function state(d) {
    if (d.reponses.length) return { k: 'repondue', label: 'Réponse reçue' };
    if (d.status === 'close') return { k: 'close', label: 'Close' };
    if (d.echeance && d.echeance < today) return { k: 'silence', label: `Sans réponse depuis le ${day(d.echeance)} : refus implicite` };
    return { k: 'attente', label: `En attente, réponse due au plus tard le ${day(d.echeance)}` };
  }
  const LABELS = { tout: 'Toutes', attente: 'En attente', repondue: 'Réponse reçue', silence: 'Sans réponse' };
  let rows = [], current = 'tout';
  function card(d) {
    const s = state(d);
    const docs = d.documents.split('\n').map(x => `<li>${esc(x)}</li>`).join('');
    const replies = d.reponses.map(r => `<div class="dm-reply"><h4>Réponse du ${day(r.date)}</h4><p>${esc(r.texte).replace(/\n/g, '<br>')}</p>${r.pieces?.length ? `<p class="note">Pièces jointes : ${r.pieces.map(esc).join(', ')}</p>` : ''}</div>`).join('');
    return `<article class="dm-card" id="${esc(d.ref)}"><header><span class="dm-state dm-state--${s.k}">${esc(s.label)}</span><small>${esc(d.ref)} · ${d.formulaire ? `déposée le ${day(d.envoyee)} via <a href="${esc(d.formulaire)}" target="_blank" rel="noopener noreferrer">le formulaire de contact</a>` : `envoyée le ${day(d.envoyee)}`}</small></header>`
      + `<h3>${esc(d.objet)}</h3><p class="dm-to">À ${d.fiche ? `<a href="${esc(d.fiche)}" target="_blank" rel="noopener noreferrer">${esc(d.organisme)}</a>` : esc(d.organisme)}</p>`
      + `<p class="dm-label">Documents demandés</p><ul>${docs}</ul>${d.contexte ? `<p class="dm-ctx">${esc(d.contexte)}</p>` : ''}${replies}</article>`;
  }
  function render() {
    const shown = rows.filter(d => current === 'tout' || state(d).k === current);
    list.innerHTML = shown.length ? shown.map(card).join('') : `<p class="note">${rows.length ? 'Aucune demande dans cet état.' : 'Aucune demande envoyée pour l’instant.'}</p>`;
    filters.innerHTML = Object.entries(LABELS).map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === current}">${l} <span>${k === 'tout' ? rows.length : rows.filter(d => state(d).k === k).length}</span></button>`).join('');
  }
  filters.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) { current = b.dataset.k; render(); } });
  fetch('api/assistant/demandes').then(r => r.ok ? r.json() : Promise.reject(r.status)).then(j => { rows = j.demandes || []; render(); })
    .catch(() => { list.innerHTML = '<p class="note">La liste des demandes est indisponible pour le moment.</p>'; });
})();
