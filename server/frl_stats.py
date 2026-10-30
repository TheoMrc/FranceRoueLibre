#!/usr/bin/env python3
"""Visit statistics of francerouelibre.fr, computed from the nginx access log (no cookie, no tracker in the pages).

  frl-stats                 last 14 days: page views, visitors, searches per day + top pages and referrers (7 days)
  frl-stats --days 30       a longer table
  frl-stats --save          adds the finished days to the history (systemd timer, every night): the access logs are
                            deleted after 14 days, the history keeps only daily counts (no IP address, no user agent)

Log format written by deploy/vps.sh (log_format frl): IP [time] "METHOD /path PROTOCOL" status bytes "referer" "agent".
The path and the referer are logged without their query string, so searched words are never written to disk.
A visitor is one (IP address, browser) pair on one day; it is hashed in memory to be counted, and never stored.
"""
import argparse, collections, datetime as dt, glob, gzip, hashlib, json, os, re, sys

LOGS = '/var/log/nginx/francerouelibre.access.log*'
HISTORY = '/var/lib/francerouelibre/stats/daily.json'
LINE = re.compile(r'^(\S+) \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) \S+ "([^"]*)" "([^"]*)"')
BOT = re.compile(r'bot|crawl|spider|slurp|curl|wget|python|httpx|go-http|java/|okhttp|headless|preview|monitor|uptime|'
                 r'facebookexternalhit|embedly|whatsapp|telegram|discord|scan|lighthouse|feed|axios|node-fetch', re.I)
SELF = ('francerouelibre.fr', 'www.francerouelibre.fr')


def read_logs():
    for path in sorted(glob.glob(LOGS)):
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


def compute():
    """Daily counts from the access logs still on disk (about 14 days)."""
    days = collections.defaultdict(lambda: {'views': 0, 'visitors': set(), 'searches': 0, 'pages': collections.Counter(),
                                            'refs': collections.Counter()})
    for line in read_logs():
        m = LINE.match(line)
        if not m:
            continue
        ip, when, method, path, status, ref, agent = m.groups()
        if method != 'GET' or BOT.search(agent) or not agent:
            continue
        day = dt.datetime.strptime(when.split(':', 1)[0], '%d/%b/%Y').date().isoformat()
        d = days[day]
        if path.startswith('/api/search') and status == '200':
            d['searches'] += 1
            continue
        page = page_of(path)
        if page is None or status not in ('200', '304'):
            continue
        d['views'] += 1
        d['visitors'].add(hashlib.blake2b(f'{ip}|{agent}'.encode(), digest_size=8).digest())
        d['pages'][page] += 1
        host = re.sub(r'^https?://([^/]+).*$', r'\1', ref) if ref not in ('', '-') else ''
        if host and host not in SELF:
            d['refs'][host] += 1
    return {day: {'views': d['views'], 'visitors': len(d['visitors']), 'searches': d['searches'],
                  'pages': dict(d['pages'].most_common(30)), 'refs': dict(d['refs'].most_common(30))}
            for day, d in days.items()}


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
    live = compute()
    if args.save:
        return save(live)
    data = {**load_history(), **live}
    if args.json:
        return print(json.dumps(data, ensure_ascii=False, indent=1))
    show(data, args.days, args.top)


if __name__ == '__main__':
    main()
