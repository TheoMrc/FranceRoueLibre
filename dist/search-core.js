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

  let workerRef = null;
  // Checks that the server honours HTTP Range requests (an old preview server returned whole files, which corrupts reads).
  async function preflight(info) {
    const first = info.chunks ? new URL(`${info.chunks.urlPrefix}${'0'.repeat(info.chunks.suffixLength)}`, base) : new URL('data/search/frl-search.sqlite3', base);
    first.searchParams.set('v', info.size);
    const response = await fetch(first, { headers: { Range: 'bytes=0-15' }, cache: 'no-store' });
    if (response.status !== 206) throw Object.assign(new Error('Le serveur ne gère pas les requêtes partielles (Range).'), { code: 'RANGE' });
    const head = new TextDecoder().decode(await response.arrayBuffer());
    if (!head.startsWith('SQLite format 3')) throw Object.assign(new Error('Fichier d’index illisible.'), { code: 'FORMAT' });
  }
  function db() {
    if (!dbPromise) {
      // The index is split into files of 45 Mo (dist/data/search/db/) so that it fits in Git and on any static host.
      dbPromise = Promise.all([loadScript(new URL('vendor/sqljs-httpvfs/index.js', base).href), meta()]).then(async ([, info]) => {
        await preflight(info);
        const cacheBust = String(info.size); // a new index never mixes with pages of an old one cached by the browser
        workerRef = await window.createDbWorker(
          [{ from: 'inline', config: info.chunks
            ? { serverMode: 'chunked', urlPrefix: new URL(info.chunks.urlPrefix, base).href, serverChunkSize: info.chunks.serverChunkSize, databaseLengthBytes: info.chunks.databaseLengthBytes, suffixLength: info.chunks.suffixLength, requestChunkSize: 4096, cacheBust }
            : { serverMode: 'full', url: new URL('data/search/frl-search.sqlite3', base).href, requestChunkSize: 4096, cacheBust } }],
          new URL('vendor/sqljs-httpvfs/sqlite.worker.js?v=3', base).href, new URL('vendor/sqljs-httpvfs/sql-wasm.wasm', base).href, 1e10);
        return workerRef.db;
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }
  // Bytes and requests read so far, for the progress display.
  const stats = async () => { try { return workerRef ? await workerRef.worker.getStats() : null; } catch (error) { return null; } };
  const meta = () => metaPromise || (metaPromise = fetch(new URL('data/search/meta.json', base), { cache: 'no-cache' }).then(r => {
    if (!r.ok) throw Object.assign(new Error('Index de recherche absent de cette copie du site.'), { code: 'NOINDEX' });
    return r.json();
  }));
  const query = async (sql, ...params) => (await db()).query(sql, params); // sql.js exec(sql, [params])

  const norm = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tokens = text => (norm(text).match(/[\p{L}\p{N}]+/gu) || []).filter(token => token.length >= 2);
  // Phrase query; the last word also matches its endings (plural, feminine…) when it is long enough.
  // Words are letters and digits only (see tokens), so they are valid FTS5 barewords; lower case avoids AND/OR/NOT.
  // A trailing * (« transphob* ») asks for every word starting with the last word, whatever its length.
  const ftsQuery = (words, prefix = true, force = false) => words.map((word, i) => `${word}${prefix && i === words.length - 1 && (force || word.length >= 4) ? '*' : ''}`).join(' + ');
  const wantsPrefix = text => /\*\s*$/.test(String(text || ''));

  /* ---------- Lexicon: every indexed word with its number of lines and amount (data/search/lexicon/<2 letters>.json) ----------
     Small static files, read without opening the index: suggestions are instant and work before the database is ready. */
  const shards = new Map();
  const shardKey = word => [...word.slice(0, 2)].map(c => c >= 'a' && c <= 'z' ? c : '_').join('');
  function shard(word) {
    const key = shardKey(word);
    if (!shards.has(key)) shards.set(key, fetch(new URL(`data/search/lexicon/${key}.json`, base)).then(r => r.ok ? r.json() : []).catch(() => [])
      .then(entries => entries.map(([norm, lines, amount, display]) => ({ norm, lines, amount, display: display || norm }))));
    return shards.get(key);
  }
  const lookup = async word => (await shard(word)).find(entry => entry.norm === word) || null;
  // Words starting with the prefix, most frequent first.
  const complete = async (prefix, limit = 8) => (await shard(prefix)).filter(entry => entry.norm.startsWith(prefix)).sort((a, b) => b.lines - a.lines).slice(0, limit);
  const commonPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
  // Optimal string alignment distance, stopped early above max.
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prev2[j - 2] + 1);
        row.push(value); best = Math.min(best, value);
      }
      if (best > max) return max + 1;
      prev2 = prev; prev = row;
    }
    return prev[b.length];
  }
  /* Words close to a word: other forms of the same family (transphobe → transphobie: same root, different ending) and
     spelling mistakes (discrimnation → discrimination). Ranked by closeness, then by number of lines. */
  async function nearest(word, limit = 6) {
    if (!word || word.length < 3) return [];
    const max = word.length <= 5 ? 1 : 2;
    const root = Math.max(5, Math.ceil(0.7 * word.length)); // a family shares at least 70 % of the word
    const candidates = [];
    for (const entry of await shard(word)) {
      if (entry.norm === word) continue;
      const shared = commonPrefix(word, entry.norm);
      const family = shared >= root && entry.norm.length - shared <= 5;
      const d = distance(word, entry.norm, max);
      if (d > max && !family) continue;
      candidates.push({ ...entry, family, distance: d, score: Math.min(d, max + 1) - (family ? 1.5 : 0) - 0.15 * Math.log10(entry.lines + 1) });
    }
    return candidates.sort((a, b) => a.score - b.score).slice(0, limit);
  }
  // The root shared by a word and its family, to search every form at once (transphob*).
  const familyRoot = (word, others) => {
    const shared = Math.min(...others.map(other => commonPrefix(word, other.norm)));
    return shared >= 4 ? word.slice(0, shared) : null;
  };

  async function suggest(text) {
    const words = tokens(text);
    const last = words[words.length - 1];
    if (!last || last.length < 3 || !/[\p{L}\p{N}]$/u.test(text.trim())) return [];
    const head = text.trim().slice(0, text.trim().length - last.length).trim();
    const join = word => `${head ? head + ' ' : ''}${word}`;
    const found = await complete(last);
    const items = found.map(entry => ({ text: join(entry.display), count: entry.lines, amount: entry.amount }));
    if (items.length < 4) {
      // Few or no words start like this: offer the closest words that do exist.
      const close = (await nearest(last, 8)).filter(entry => !found.some(f => f.norm === entry.norm));
      const sure = close.filter(entry => entry.family || entry.distance <= 1);
      (sure.length ? sure : close.slice(0, 2)).slice(0, 6 - items.length)
        .forEach(entry => items.push({ text: join(entry.display), count: entry.lines, amount: entry.amount, near: true }));
    }
    return items;
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

  return { SOURCES, db, meta, query, stats, norm, tokens, ftsQuery, wantsPrefix, suggest, lookup, complete, nearest, familyRoot, highlighter, escapeHtml };
})();
