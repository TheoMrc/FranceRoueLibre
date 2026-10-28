/* Données: inventory of integrated sources and blind spots. */
(() => {
  const { count, esc, load } = FRL;
  const $ = id => document.getElementById(id);
  const size = bytes => !bytes ? '—' : bytes > 1048576 ? `${(bytes / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo` : `${Math.round(bytes / 1024)} ko`;
  const date = value => value ? new Date(value).toLocaleDateString('fr-FR') : '—';

  load('./data/catalog.json').then(catalog => {
    const topics = [...new Set(catalog.sources.map(s => s.topic))];
    $('sourceTable').innerHTML = `<table class="data-table"><thead><tr><th>Thème</th><th>Source</th><th>Producteur</th><th class="num">Lignes</th><th class="num">Taille (gz)</th><th>Téléchargé</th></tr></thead><tbody>${topics.flatMap(topic => catalog.sources.filter(s => s.topic === topic).map(s =>
      `<tr><td><span class="tag">${esc(topic)}</span></td><td>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>` : esc(s.title)}${s.period ? ` <span class="muted">· ${esc(s.period)}</span>` : ''}</td><td class="muted">${esc(s.publisher || '')}</td><td class="num">${s.records ? count(s.records) : '—'}</td><td class="num">${size(s.bytes)}</td><td class="muted">${date(s.downloadedAt)}</td></tr>`)).join('')}</tbody></table>`;
    $('gapList').innerHTML = catalog.gaps.map(gap => `<article class="gap"><span class="gap__state ${gap.state}">${gap.state === 'none' ? 'Aucune donnée ouverte' : 'Données partielles'}</span><h3>${esc(gap.title)}</h3><p>${esc(gap.text)}</p></article>`).join('');
  }).catch(() => { $('sourceTable').innerHTML = '<p class="note">Inventaire indisponible.</p>'; });
})();
