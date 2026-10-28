/* Shared search engine: opens the SQLite full-text index over HTTP range requests (vendor/sqljs-httpvfs),
   normalises queries like the index does (lower case, accents removed) and serves suggestions. */
window.FRLSearch = (() => {
  const SOURCES = {
    1: { label: 'Subventions aux associations', phrase: 'subventions de l’État aux associations', short: 'Associations', who: 'Association' },
    2: { label: 'Marchés publics', phrase: 'marchés publics', short: 'Marchés', who: 'Acheteur' },
    3: { label: 'Projets aidés par l’État (DGCL)', phrase: 'projets locaux aidés par l’État', short: 'Projets DGCL', who: 'Commune' },
    4: { label: 'Fonds vert', phrase: 'Fonds vert', short: 'Fonds vert', who: 'Bénéficiaire' },
    5: { label: 'Aides aux entreprises (de minimis)', phrase: 'aides de minimis aux entreprises', short: 'Entreprises', who: 'Entreprise' },
    6: { label: 'Budget de l’État (PLF 2026)', phrase: 'budget de l’État 2026', short: 'Budget État', who: 'Programme' }
  };
  const base = new URL('.', document.currentScript?.src || location.href);
  let dbPromise = null, metaPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.createDbWorker) { resolve(); return; }
      const script = Object.assign(document.createElement('script'), { src, async: true });
      script.onload = resolve; script.onerror = () => reject(new Error('sql.js-httpvfs'));
      document.head.appendChild(script);
    });
  }

  function db() {
    if (!dbPromise) {
      // The index is split into files of 45 Mo (dist/data/search/db/) so that it fits in Git and on any static host.
      dbPromise = Promise.all([loadScript(new URL('vendor/sqljs-httpvfs/index.js', base).href), meta()]).then(([, info]) => window.createDbWorker(
        [{ from: 'inline', config: info.chunks
          ? { serverMode: 'chunked', urlPrefix: new URL(info.chunks.urlPrefix, base).href, serverChunkSize: info.chunks.serverChunkSize, databaseLengthBytes: info.chunks.databaseLengthBytes, suffixLength: info.chunks.suffixLength, requestChunkSize: 4096 }
          : { serverMode: 'full', url: new URL('data/search/frl-search.sqlite3', base).href, requestChunkSize: 4096 } }],
        new URL('vendor/sqljs-httpvfs/sqlite.worker.js', base).href, new URL('vendor/sqljs-httpvfs/sql-wasm.wasm', base).href, 1e10
      )).then(worker => worker.db);
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }
  const meta = () => metaPromise || (metaPromise = fetch(new URL('data/search/meta.json', base)).then(r => r.json()));
  const query = async (sql, ...params) => (await db()).query(sql, params); // sql.js exec(sql, [params])

  const norm = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tokens = text => (norm(text).match(/[\p{L}\p{N}]+/gu) || []).filter(token => token.length >= 2);
  // Phrase query; the last word also matches its endings (plural, feminine…) when it is long enough.
  // Words are letters and digits only (see tokens), so they are valid FTS5 barewords; lower case avoids AND/OR/NOT.
  const ftsQuery = (words, prefix = true) => words.map((word, i) => `${word}${prefix && i === words.length - 1 && word.length >= 4 ? '*' : ''}`).join(' + ');

  async function suggest(text) {
    const words = tokens(text);
    const last = words[words.length - 1];
    if (!last || last.length < 3 || !/[\p{L}\p{N}]$/u.test(text.trim())) return [];
    const head = text.trim().slice(0, text.trim().length - last.length).trim();
    const rows = await query('SELECT display, df FROM term WHERE norm >= ? AND norm < ? ORDER BY df DESC LIMIT 8', last, `${last}￿`);
    return rows.map(row => ({ text: `${head ? head + ' ' : ''}${row.display}`, count: row.df }));
  }

  // Accent-insensitive highlighting of the query words (and their endings) in a label.
  const CLASSES = { a: 'aàâäáã', c: 'cç', e: 'eéèêë', i: 'iîïíì', o: 'oôöóò', u: 'uùûüú', y: 'yÿ', n: 'nñ' };
  function highlighter(words) {
    if (!words.length) return text => escapeHtml(text);
    const pattern = words.map(word => [...word].map(ch => CLASSES[ch] ? `[${CLASSES[ch]}${CLASSES[ch].toUpperCase()}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '[\\p{L}]*').join('|');
    const regex = new RegExp(`(${pattern})`, 'giu');
    return text => String(text || '').split(regex).map((part, i) => i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join('');
  }
  const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  return { SOURCES, db, meta, query, norm, tokens, ftsQuery, suggest, highlighter, escapeHtml };
})();
