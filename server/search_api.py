"""Search API of francerouelibre.fr: the same full-text search as the browser engine (dist/search-core.js), run on the
server next to the SQLite index, so a search reads a local file instead of hundreds of HTTP range requests.

GET /api/search?q=mise+en+place[&prefix=1]  →  JSON
  lines   number of matching published lines
  stats   [{src, year, fw, n, amount}]          totals per source, year and framework flag (all matching lines)
  who     [{key, label, siren, src, n, value}]  largest beneficiaries / buyers, per source (spending lines only)
  extra   [{key, label, src, n, value}]         largest programmes / measures / purchase families, per source
  depts   [{key, src, n, value}]                largest départements, per source
  top     [{id, src, year, amount, fw, dept, title, who, siren, extra}]  the TOP largest spending lines, with labels
  ms      server time
GET /api/lieux?q=33980  →  {"communes": [...], "departement": {...} | null, "type": ...}  communes and départements
  from a name (typos tolerated), a postal code or a département number (server/assistant/places.py)
GET /api/personne?q=gerard+larcher  →  {"personnes": [{nom, mandats, parcours, wikipedia, question}]}  the public figures a
  search names (server/assistant/personnes.py: Répertoire national des élus, Wikidata), for a card above the results
GET /api/health  →  {"ok": true, "lines": …}

Python standard library only. The index is opened read-only (immutable). Run behind nginx (rate limit, HTTPS):
  python3 server/search_api.py --db /var/lib/francerouelibre/frl-search.sqlite3 --port 8017 [--journal DIR]

The searched words are journaled by nginx (deploy/vps.sh: one JSON line per search, without IP address, in DIR/
YYYY-MM-DD.jsonl, answers from nginx's cache included). With --journal, this API sweeps that folder once a day:
finished days are gzipped, files older than JOURNAL_DAYS deleted. Read with scripts/search-review.py.
"""
import argparse
import collections
import datetime as dt
import functools
import gzip
import json
import shutil
import re
import sqlite3
import threading
import time
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from assistant import places  # noqa: E402
from assistant import personnes  # noqa: E402

DATA_DIR = Path(__file__).resolve().parents[1] / 'dist' / 'data'

TOP = 200        # spending lines returned with their labels
RANK = 15        # entries in each ranking
MAX_QUERY = 200  # characters
TIME_LIMIT = 8   # seconds of SQLite work per request, then the query is interrupted
WORD = re.compile(r'[^\W_]+', re.UNICODE)

DB_PATH = None
_db = None
LOCK = threading.Lock()  # one connection, one search at a time: its page cache stays warm between requests
# Under a rush: answers already computed are served without waiting for the lock (RESULTS, also cached by nginx);
# at most MAX_WAITING requests wait for it, each WAIT seconds at most, the others get 503 at once and the page falls
# back to its own search in the browser (recherche.js).
MAX_WAITING = 16
WAIT = 10
RESULTS = collections.OrderedDict()
RESULTS_MAX = 500
RESULTS_LOCK = threading.Lock()
WAITING = [0]
JOURNAL = None       # folder of the searched words (written by nginx), swept here
JOURNAL_DAYS = 90
_swept = {'day': None}


def sweep_journal(folder, today=None):
    """Gzip the finished days, delete the files older than JOURNAL_DAYS. Never raises."""
    today = today or dt.date.today()
    try:
        for path in Path(folder).iterdir():
            try:
                day = dt.date.fromisoformat(path.name[:10])
            except ValueError:
                continue
            if (today - day).days > JOURNAL_DAYS:
                path.unlink(missing_ok=True)
            elif path.suffix == '.jsonl' and day < today:
                with open(path, 'rb') as src, gzip.open(path.with_suffix('.jsonl.gz'), 'ab') as dst:
                    shutil.copyfileobj(src, dst)
                path.unlink(missing_ok=True)
    except OSError:
        pass


def maybe_sweep():
    day = dt.date.today()
    if JOURNAL and _swept['day'] != day:
        _swept['day'] = day
        threading.Thread(target=sweep_journal, args=(JOURNAL,), daemon=True).start()


def connection():
    global _db
    if _db is None:
        _db = sqlite3.connect(f'file:{DB_PATH}?mode=ro&immutable=1', uri=True, check_same_thread=False)
        _db.execute('PRAGMA cache_size = -65536')  # 64 Mo of page cache (the VPS hosts other sites)
        _db.execute('PRAGMA temp_store = MEMORY')
    return _db


def norm(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if unicodedata.category(c) != 'Mn')


def fts_query(q, prefix):
    """Same rules as search-core.js: words of 2+ letters or digits, phrase match, last word with its endings
    when it has 4+ characters (or always with a trailing *). Words are letters/digits only: valid FTS5 barewords."""
    words = [w for w in WORD.findall(norm(q)) if len(w) >= 2]
    if not words:
        return None
    last = len(words) - 1
    return ' + '.join(w + ('*' if i == last and (prefix or len(w) >= 4) else '') for i, w in enumerate(words))


try:
    import numpy as np
except ImportError:  # without NumPy the aggregations run in SQLite (about 10 times slower on very common words)
    np = None
COLS = None


def load_columns(db):
    """The compact table agg (1.9 M lines: source, year, amount, framework flag, département, beneficiary, programme)
    held in memory as NumPy columns, about 60 Mo: a search then only asks SQLite for the matching ids, and every
    total and ranking is a vectorised group-by (np.unique + np.bincount) instead of a SQL GROUP BY.
    Read in blocks of 50 000 lines straight into the arrays, so loading never needs more memory than the columns."""
    size = db.execute('SELECT max(id) FROM agg').fetchone()[0] + 1  # columns indexed directly by line id
    cols = dict(src=np.zeros(size, np.int16), year=np.zeros(size, np.int16), amount=np.zeros(size, np.float64),
                fw=np.zeros(size, np.int8), dept=np.full(size, -1, np.int16), who=np.full(size, -1, np.int64),
                extra=np.full(size, -1, np.int64))
    codes = [c for (c,) in db.execute('SELECT DISTINCT dept FROM agg WHERE dept IS NOT NULL ORDER BY 1')]
    code_index = {c: i for i, c in enumerate(codes)}
    cursor = db.execute('SELECT id, src, year, coalesce(amount, 0), fw, dept, coalesce(who, -1), coalesce(extra, -1) FROM agg')
    while rows := cursor.fetchmany(50000):
        ids, src, year, amount, fw, dept, who, extra = zip(*rows)
        at = np.asarray(ids)
        cols['src'][at], cols['year'][at], cols['amount'][at], cols['fw'][at] = src, year, amount, fw
        cols['dept'][at] = [code_index.get(d, -1) for d in dept]
        cols['who'][at], cols['extra'][at] = who, extra
    cols['codes'] = codes
    return cols


def group(keys, values, limit=None):
    """Distinct keys with their count and sum of values, largest sums first."""
    if not len(keys):
        return []
    uniq, inverse, counts = np.unique(keys, return_inverse=True, return_counts=True)
    sums = np.bincount(inverse, weights=values)
    order = np.argsort(-sums) if limit is None else np.argsort(-sums)[:limit]
    return [(int(uniq[i]), int(counts[i]), float(sums[i])) for i in order]


def aggregate_numpy(ids):
    c = COLS
    src, year, fw, amount = c['src'][ids], c['year'][ids], c['fw'][ids], c['amount'][ids]
    stats = [dict(src=k // 100000, year=(k // 10) % 10000, fw=k % 10, n=n, amount=v)
             for k, n, v in group(src.astype(np.int64) * 100000 + year.astype(np.int64) * 10 + fw, amount)]
    spend = (fw == 0) & (src != 6)

    def ranking(column):
        keys = c[column][ids]
        mask = spend & (keys >= 0)
        return [(k // 8, k % 8, n, v) for k, n, v in group(keys[mask] * 8 + src[mask], amount[mask], RANK * 3)]
    depts = [(c['codes'][k], s, n, v) for k, s, n, v in ranking('dept')]
    candidates = ids[fw == 0]
    top_ids = candidates[np.argsort(-amount[fw == 0], kind='stable')[:TOP]] if len(candidates) else candidates
    return stats, ranking('who'), ranking('extra'), depts, [int(i) for i in top_ids]


def aggregate_sql(db):
    stats = [dict(src=s, year=y, fw=f, n=n, amount=a or 0) for s, y, f, n, a in db.execute(
        'SELECT src, year, fw, count(*), sum(amount) FROM m CROSS JOIN agg USING (id) GROUP BY 1, 2, 3')]
    spending = 'FROM m CROSS JOIN agg USING (id) WHERE fw = 0 AND src != 6'

    def ranking(column):
        return db.execute(f'SELECT {column}, src, count(*), sum(amount) AS v {spending} AND {column} IS NOT NULL '
                          f'GROUP BY 1, 2 ORDER BY v DESC LIMIT {RANK * 3}').fetchall()
    top = [r[0] for r in db.execute(f'SELECT id FROM m CROSS JOIN agg USING (id) WHERE fw = 0 ORDER BY amount DESC LIMIT {TOP}')]
    return stats, ranking('who'), ranking('extra'), ranking('dept'), top


@functools.lru_cache(maxsize=512)
def search(match):
    db = connection()
    started = time.monotonic()
    db.set_progress_handler(lambda: 1 if time.monotonic() - started > TIME_LIMIT else 0, 20000)
    try:
        if match.startswith('siren:'):  # every line of one organisation (the SIREN is not in the full-text index)
            who_ids = [r[0] for r in db.execute('SELECT id FROM who WHERE siren = ?', (match[6:],))]
            if COLS is not None:
                ids = np.nonzero(np.isin(COLS['who'], who_ids))[0].astype(np.int64) if who_ids else np.zeros(0, np.int64)
                lines = len(ids)
                stats, who_rows, extra_rows, dept_rows, top_ids = aggregate_numpy(ids)
            else:
                db.execute('CREATE TEMP TABLE IF NOT EXISTS m (id INTEGER PRIMARY KEY)')
                db.execute('DELETE FROM m')
                db.execute(f'INSERT INTO m SELECT id FROM agg WHERE who IN ({",".join(map(str, who_ids)) or "NULL"})')
                lines = db.execute('SELECT count(*) FROM m').fetchone()[0]
                stats, who_rows, extra_rows, dept_rows, top_ids = aggregate_sql(db)
        elif COLS is not None:
            ids = np.fromiter((r[0] for r in db.execute('SELECT rowid FROM fts WHERE fts MATCH ?', (match,))), dtype=np.int64)
            lines = len(ids)
            stats, who_rows, extra_rows, dept_rows, top_ids = aggregate_numpy(ids)
        else:
            db.execute('CREATE TEMP TABLE IF NOT EXISTS m (id INTEGER PRIMARY KEY)')
            db.execute('DELETE FROM m')
            db.execute('INSERT INTO m SELECT rowid FROM fts WHERE fts MATCH ?', (match,))
            lines = db.execute('SELECT count(*) FROM m').fetchone()[0]
            stats, who_rows, extra_rows, dept_rows, top_ids = aggregate_sql(db)
        names = {i: (n, s) for i, n, s in db.execute(
            f'SELECT id, name, siren FROM who WHERE id IN ({",".join(str(r[0]) for r in who_rows) or "NULL"})')}
        labels = dict(db.execute(
            f'SELECT id, label FROM extra WHERE id IN ({",".join(str(r[0]) for r in extra_rows) or "NULL"})'))
        who = [dict(key=k, label=names[k][0] or names[k][1], siren=names[k][1], src=s, n=n, value=v or 0)
               for k, s, n, v in who_rows if k in names]
        extra = [dict(key=k, label=labels[k], src=s, n=n, value=v or 0) for k, s, n, v in extra_rows if k in labels]
        depts = [dict(key=k, src=s, n=n, value=v or 0) for k, s, n, v in dept_rows]
        top = [dict(id=i, src=s, year=y, amount=a, fw=f, dept=d, title=t, who=w, siren=sn, extra=e) for i, s, y, a, f, d, t, w, sn, e in db.execute(
            f'SELECT id, src, year, amount, fw, dept, title, who, siren, extra FROM doc WHERE id IN ({",".join(map(str, top_ids)) or "NULL"}) '
            'ORDER BY amount DESC')]
        return dict(lines=lines, stats=stats, who=who, extra=extra, depts=depts, top=top, topSize=TOP)
    finally:
        db.set_progress_handler(None, 0)


class Handler(BaseHTTPRequestHandler):
    server_version = 'frl-search'

    def send(self, status, body, cache=True):
        data = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'public, max-age=600' if cache and status == 200 else 'no-store')
        if isinstance(body.get('lines'), int):
            self.send_header('X-Lines', str(body['lines']))  # for the journal of searched words (nginx)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        params = parse_qs(url.query)
        if url.path == '/api/health':
            with LOCK:
                lines = connection().execute('SELECT max(id) FROM agg').fetchone()[0]
            return self.send(200, {'ok': True, 'lines': lines}, cache=False)
        if url.path == '/api/lieux':
            q = (params.get('q') or [''])[0][:100]
            try:
                places.load(DATA_DIR / 'web' / 'communes-lookup.json')
                return self.send(200, places.find(q))
            except (OSError, ValueError, RuntimeError) as error:
                return self.send(503, {'error': f'lieux indisponibles ({type(error).__name__})'}, cache=False)
        if url.path == '/api/personne':
            q = (params.get('q') or [''])[0][:120]
            try:
                return self.send(200, {'personnes': personnes.cards(q)})
            except (OSError, ValueError, RuntimeError, KeyError) as error:
                return self.send(503, {'error': f'personnes indisponibles ({type(error).__name__})'}, cache=False)
        if url.path != '/api/search':
            return self.send(404, {'error': 'not found'})
        maybe_sweep()
        q = (params.get('q') or [''])[0][:MAX_QUERY]
        digits = re.sub(r'[\s.]', '', q)
        match = f'siren:{digits}' if re.fullmatch(r'\d{9}', digits) else \
            fts_query(q, (params.get('prefix') or ['0'])[0] == '1' or q.rstrip().endswith('*'))
        if not match:
            return self.send(400, {'error': 'empty query'})
        started = time.monotonic()
        with RESULTS_LOCK:
            cached = RESULTS.get(match)
            if cached is not None:
                RESULTS.move_to_end(match)
        if cached is not None:
            return self.send(200, dict(cached, ms=round(1000 * (time.monotonic() - started))))
        with RESULTS_LOCK:
            if WAITING[0] >= MAX_WAITING:
                return self.send(503, {'error': 'busy'}, cache=False)
            WAITING[0] += 1
        try:
            if not LOCK.acquire(timeout=WAIT):
                return self.send(503, {'error': 'busy'}, cache=False)
            try:
                result = dict(search(match))
            finally:
                LOCK.release()
        except sqlite3.OperationalError as error:
            interrupted = 'interrupt' in str(error)
            return self.send(503 if interrupted else 400, {'error': 'too slow' if interrupted else 'bad query'}, cache=False)
        finally:
            with RESULTS_LOCK:
                WAITING[0] -= 1
        with RESULTS_LOCK:
            RESULTS[match] = result
            while len(RESULTS) > RESULTS_MAX:
                RESULTS.popitem(last=False)
        result = dict(result, ms=round(1000 * (time.monotonic() - started)))
        self.send(200, result)

    def log_message(self, *args):  # nginx logs the requests (and the searched words, see the module's docstring)
        pass


def main():
    global DB_PATH
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    parser.add_argument('--port', type=int, default=8017)
    parser.add_argument('--journal', help='folder of the searched words written by nginx, swept once a day')
    parser.add_argument('--data', help='the published data folder (dist/data), for /api/lieux')
    args = parser.parse_args()
    DB_PATH = args.db
    global DATA_DIR
    if args.data:
        DATA_DIR = Path(args.data)
    global JOURNAL
    JOURNAL = args.journal
    global COLS
    if np is not None:
        started = time.monotonic()
        COLS = load_columns(connection())
        print(f'columns in memory: {len(COLS["src"]) - 1} lines in {time.monotonic() - started:.1f} s', flush=True)
    else:
        print('NumPy not installed: aggregations run in SQLite', flush=True)
    ThreadingHTTPServer.daemon_threads = True
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
