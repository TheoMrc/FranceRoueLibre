#!/usr/bin/env python3
"""Visit statistics of francerouelibre.fr, computed from the nginx access log (no cookie, no tracker in the pages).

  frl-stats                 last 14 days: page views, visitors, searches per day + top pages and referrers (7 days)
  frl-stats --days 30       a longer table
  frl-stats --save          adds the finished days to the history (systemd timer, every night): the access logs are
                            deleted after 14 days, the history keeps only daily counts (no IP address, no user agent)

Log format written by deploy/vps.sh (log_format frl): IP [time] "METHOD /path PROTOCOL" status bytes "referer" "agent".
The path and the referer are logged without their query string, so searched words are never written to disk.
A visitor is one (IP address, browser) pair on one day, counted by a hash of the pair. To answer in a fraction of a
second, the counts of today and yesterday are kept in STATE with the place reached in the log, so that each run reads
only the lines added since the last one; that file (root only) holds the hashes of those two days and nothing older,
less than the access log itself, which keeps the addresses for 14 days.
"""
import argparse, collections, datetime as dt, fcntl, glob, gzip, hashlib, json, os, re, sys

LOGS = '/var/log/nginx/francerouelibre.access.log*'
HISTORY = '/var/lib/francerouelibre/stats/daily.json'
STATE = '/var/lib/francerouelibre/stats/recent.json'
CURRENT = '/var/log/nginx/francerouelibre.access.log'
LINE = re.compile(r'^(\S+) \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) \S+ "([^"]*)" "([^"]*)"')
BOT = re.compile(r'bot|crawl|spider|slurp|curl|wget|python|httpx|go-http|java/|okhttp|headless|preview|monitor|uptime|'
                 r'facebookexternalhit|embedly|whatsapp|telegram|discord|scan|lighthouse|feed|axios|node-fetch', re.I)
SELF = ('francerouelibre.fr', 'www.francerouelibre.fr')


def read_logs(since=None):
    """since (a timestamp): only the files written since then; a rotated file is no longer written."""
    for path in sorted(glob.glob(LOGS)):
        if since and os.path.getmtime(path) < since:
            continue
        opener = gzip.open if path.endswith('.gz') else open
        try:
            with opener(path, 'rt', encoding='utf-8', errors='replace') as f:
                yield from f
        except PermissionError:
            sys.exit(f'Lecture impossible de {path} : lancez « sudo frl-stats ».')


def page_of(path):
    if path in ('/', '/index.html'):
        return '/'
    if path.endswith('.html'):
        return path
    return None


MONTHS = {m: f'{i:02d}' for i, m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(), 1)}


def _day(stamp):  # '04/Nov/2026' -> '2026-11-04' (strptime on every line was most of the time)
    return f'{stamp[7:11]}-{MONTHS[stamp[3:6]]}-{stamp[0:2]}'


def _new_day():
    return {'views': 0, 'visitors': set(), 'searches': 0, 'pages': collections.Counter(), 'refs': collections.Counter()}


def _add(days, line, stamps=None):
    """Counts one line of the access log into days."""
    if stamps:
        i = line.find('[')
        if line[i + 1:i + 12] not in stamps:  # a day not wanted: skipped before any parsing
            return
    m = LINE.match(line)
    if not m:
        return
    ip, when, method, path, status, ref, agent = m.groups()
    if method != 'GET' or BOT.search(agent) or not agent:
        return
    d = days[_day(when[:11])]
    if path.startswith('/api/search') and status == '200':
        d['searches'] += 1
        return
    page = page_of(path)
    if page is None or status not in ('200', '304'):
        return
    d['views'] += 1
    d['visitors'].add(hashlib.blake2b(f'{ip}|{agent}'.encode(), digest_size=8).hexdigest())
    d['pages'][page] += 1
    host = re.sub(r'^https?://([^/]+).*$', r'\1', ref) if ref not in ('', '-') else ''
    if host and host not in SELF:
        d['refs'][host] += 1


def _counts(days):
    return {day: {'views': d['views'], 'visitors': len(d['visitors']), 'searches': d['searches'],
                  'pages': dict(d['pages'].most_common(30)), 'refs': dict(d['refs'].most_common(30))}
            for day, d in days.items()}


def compute(since=None, only=None):
    """Daily counts from the access logs still on disk (about 14 days), or only from those written since `since`.
    only: the days wanted (ISO dates); the other lines are skipped on their date alone, before any parsing."""
    days = collections.defaultdict(_new_day)
    stamps = {dt.date.fromisoformat(d).strftime('%d/%b/%Y') for d in only} if only else None
    for line in read_logs(since):
        _add(days, line, stamps)
    return _counts(days)


def _read_from(path, offset, days, stamps=None):
    """Counts the complete lines of path after byte offset; returns the offset after the last complete line."""
    with open(path, 'rb') as f:
        f.seek(offset)
        for raw in f:
            if not raw.endswith(b'\n'):  # a line nginx is still writing: read next time
                break
            offset += len(raw)
            _add(days, raw.decode('utf-8', 'replace'), stamps)
    return offset


def recent():
    """Today and yesterday, reading only the lines added to the log since the last run (STATE keeps the counts and
    the byte reached). After a rotation the old file, now CURRENT.1 (same inode), is finished first."""
    today = dt.date.today()
    keep = {today.isoformat(), (today - dt.timedelta(days=1)).isoformat()}
    stamps = {dt.date.fromisoformat(d).strftime('%d/%b/%Y') for d in keep}
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE + '.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)  # two runs at once would count the same lines twice
        try:
            with open(STATE) as f:
                st = json.load(f)
        except (OSError, ValueError):
            st = None
        days = collections.defaultdict(_new_day)
        cur = os.stat(CURRENT)
        if st:
            for day, d in st['days'].items():
                if day in keep:
                    days[day] = {'views': d['views'], 'visitors': set(d['visitors']), 'searches': d['searches'],
                                 'pages': collections.Counter(d['pages']), 'refs': collections.Counter(d['refs'])}
            if st['ino'] == cur.st_ino and cur.st_size >= st['offset']:
                offset = _read_from(CURRENT, st['offset'], days, stamps)
            else:
                rotated = CURRENT + '.1'
                if os.path.exists(rotated) and os.stat(rotated).st_ino == st['ino']:
                    _read_from(rotated, st['offset'], days, stamps)
                    offset = _read_from(CURRENT, 0, days, stamps)
                else:
                    st = None
        if not st:  # first run, or the place in the log is lost: the two days again from the files, once
            days = collections.defaultdict(_new_day)
            for path in sorted(glob.glob(LOGS), reverse=True):
                if path != CURRENT and os.path.getmtime(path) >= dt.datetime.combine(today - dt.timedelta(days=1), dt.time()).timestamp():
                    opener = gzip.open if path.endswith('.gz') else open
                    with opener(path, 'rt', encoding='utf-8', errors='replace') as f:
                        for line in f:
                            _add(days, line, stamps)
            offset = _read_from(CURRENT, 0, days, stamps)
        state = {'ino': cur.st_ino, 'offset': offset,
                 'days': {day: {'views': d['views'], 'visitors': sorted(d['visitors']), 'searches': d['searches'],
                                'pages': dict(d['pages']), 'refs': dict(d['refs'])} for day, d in days.items() if day in keep}}
        tmp = STATE + '.tmp'
        with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
            json.dump(state, f, separators=(',', ':'))
        os.replace(tmp, STATE)
    return _counts({day: d for day, d in days.items() if day in keep})


def load_history():
    try:
        with open(HISTORY) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save(live):
    history = load_history()
    today = dt.date.today().isoformat()
    for day, counts in live.items():
        if day < today:  # finished days only
            history[day] = counts
    os.makedirs(os.path.dirname(HISTORY), exist_ok=True)
    tmp = HISTORY + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(dict(sorted(history.items())), f, separators=(',', ':'))
    os.replace(tmp, HISTORY)
    print(f'{len(history)} jours dans l’historique ({HISTORY})')


def show(data, ndays, top):
    today = dt.date.today()
    span = [(today - dt.timedelta(days=i)).isoformat() for i in range(ndays - 1, -1, -1)]
    print(f'francerouelibre.fr · {ndays} derniers jours (robots exclus)\n')
    print(f'{"jour":<12}{"pages vues":>11}{"visiteurs":>11}{"recherches":>12}')
    total = [0, 0, 0]
    for day in span:
        d = data.get(day)
        if not d:
            print(f'{day:<12}{"·":>11}{"·":>11}{"·":>12}')
            continue
        total = [total[0] + d['views'], total[1] + d['visitors'], total[2] + d['searches']]
        mark = '  (en cours)' if day == today.isoformat() else ''
        print(f'{day:<12}{d["views"]:>11,}{d["visitors"]:>11,}{d["searches"]:>12,}{mark}'.replace(',', ' '))
    print(f'{"total":<12}{total[0]:>11,}{total[1]:>11,}{total[2]:>12,}'.replace(',', ' '))
    print('  (visiteurs : somme des visiteurs de chaque jour)')
    week = [(today - dt.timedelta(days=i)).isoformat() for i in range(7)]
    for key, title in (('pages', 'Pages les plus vues'), ('refs', 'Sites qui envoient des visiteurs')):
        c = collections.Counter()
        for day in week:
            c.update(data.get(day, {}).get(key, {}))
        print(f'\n{title} (7 jours)')
        for name, n in c.most_common(top) or [('(aucun)', 0)]:
            print(f'  {n:>7,}  {name}'.replace(',', ' '))


def main():
    ap = argparse.ArgumentParser(description='Statistiques de visites de francerouelibre.fr')
    ap.add_argument('--days', type=int, default=14)
    ap.add_argument('--top', type=int, default=10)
    ap.add_argument('--save', action='store_true', help='ajoute les jours terminés à l’historique')
    ap.add_argument('--json', action='store_true', help='sortie JSON (historique + journaux)')
    args = ap.parse_args()
    if args.save:
        return save(compute())
    # finished days come from the history (saved every night); today and yesterday from recent(), which reads only
    # the lines added since the last run. A day missing from the history: all the logs are read again, once.
    history = load_history()
    today = dt.date.today()
    wanted = [(today - dt.timedelta(days=i)).isoformat() for i in range(2, min(args.days, 14))]
    if history and all(d in history for d in wanted if d >= min(history)):
        live = recent()
        data = {**history, **{d: v for d, v in live.items() if d not in history or d == today.isoformat()}}
    else:
        data = {**history, **compute()}
    if args.json:
        return print(json.dumps(data, ensure_ascii=False, indent=1))
    show(data, args.days, args.top)


if __name__ == '__main__':
    main()
