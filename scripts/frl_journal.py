"""Questions asked to the Loupe and searches made on francerouelibre.fr, read on the VPS (journals without IP address,
kept 90 days there: server/assistant/journal.py, and the nginx journal of the search API): count per day, the last
ones, and everything kept on this PC in _journal/loupe.csv and _journal/recherches.csv (ignored by git), new lines
added at each run so that nothing is lost after the 90 days. Launched by frl_journal.bat.

  python scripts/frl_journal.py [--days 14] [--last 15] [--no-save]"""
import argparse
import collections
import csv
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote_plus

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '_journal'
SEP = '@@RECHERCHES@@'
LOUPE_DIR, SEARCH_DIR = '/var/lib/francerouelibre-assistant/journal', '/var/lib/francerouelibre/recherches'
STATE = OUT / 'journal-etat.json'   # the day of the last full read: the next ones read only the files changed since
# no keyboard for ssh: several of them at once from the panel's console window waited on it (timeouts after 60 s)
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'biodevs-vps']


def remote(since: str = '') -> str:
    """The VPS command: every journal file, or only those modified since that day (a day's file is written all day
    and compressed after midnight, so the files of `since` and later are all read)."""
    pick = (lambda d: f"find {d} -maxdepth 1 -name '*.jsonl*' -newermt {since} -exec zcat -f {{}} + 2>/dev/null") if since \
        else (lambda d: f'zcat -f {d}/*.jsonl* 2>/dev/null')
    return f"sudo -n sh -c \"{pick(LOUPE_DIR)}; echo {SEP}; {pick(SEARCH_DIR)}\""
LOUPE_COLS = ['t', 'heure_paris', 'id', 'reader', 'question', 'earlier', 'model', 'provider', 'saved', 'cost_eur', 'calls', 's', 'tools',
              'demande', 'error', 'vote', 'reply', 'sources']
SEARCH_COLS = ['t', 'heure_paris', 'q', 'lines', 'cache', 'status', 's', 'prefix']


def local(t):
    """The VPS writes in UTC (the Loupe without offset, nginx with +00:00): shown in the PC's time (Paris)."""
    try:
        d = dt.datetime.fromisoformat(str(t))
    except ValueError:
        return str(t or '')
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone().strftime('%Y-%m-%d %H:%M:%S')


def since_day() -> str:
    """The day before the last successful read (one day of overlap: rows already kept are not doubled), or '' for all."""
    try:
        last = dt.date.fromisoformat(json.loads(STATE.read_text(encoding='utf-8'))['jour'])
    except (OSError, ValueError, KeyError):
        return ''
    if not (OUT / 'loupe.csv').is_file() or not (OUT / 'recherches.csv').is_file():
        return ''
    return (last - dt.timedelta(days=1)).isoformat()


def fetch(since: str = '', votes_out: dict = None):
    """(questions, searches) from the VPS journals; since: only the files changed from that day. votes_out receives
    every vote read, also those on answers of earlier days (save_all puts them on the rows already kept)."""
    r = subprocess.run(SSH + [remote(since)], capture_output=True, stdin=subprocess.DEVNULL, timeout=120)
    if r.returncode not in (0, 1) or SEP.encode() not in r.stdout:
        sys.exit(f'Lecture impossible sur le VPS : {r.stderr.decode("utf-8", "replace")[:300]}')
    text = r.stdout.decode('utf-8', 'replace')
    loupe_raw, search_raw = text.split(SEP, 1)

    def rows(raw):
        for line in raw.splitlines():
            try:
                yield json.loads(line)
            except ValueError:
                continue
    answers, votes = [], {}
    for e in rows(loupe_raw):
        if e.get('type') == 'answer':
            answers.append(e)
        elif e.get('type') == 'vote':
            votes[e.get('id')] = e.get('vote')
    if votes_out is not None:
        votes_out.update(votes)
    loupe = [{'t': a.get('t'), 'heure_paris': local(a.get('t')), 'id': a.get('id'), 'reader': a.get('reader'), 'question': a.get('question'),
              'earlier': a.get('earlier'), 'model': a.get('model'), 'provider': a.get('provider'), 'saved': a.get('saved') or '',
              'cost_eur': a.get('cost_eur'), 'calls': a.get('calls'), 's': a.get('s'),
              'tools': ' | '.join(f'{t.get("name")} ({t.get("summary") or ""})' for t in a.get('tools') or []),
              'demande': a.get('demande') or '', 'error': a.get('error') or '', 'vote': votes.get(a.get('id'), ''),
              'reply': a.get('reply'), 'sources': ' '.join(a.get('sources') or [])} for a in answers]
    searches = [{'t': e.get('t'), 'heure_paris': local(e.get('t')), 'q': unquote_plus(e.get('q') or ''), 'lines': e.get('lines'), 'cache': e.get('cache'),
                 'status': e.get('status'), 's': e.get('s'), 'prefix': e.get('prefix')} for e in rows(search_raw)
                if not deploy_test(e)]
    return sorted(loupe, key=lambda r: r['t'] or ''), sorted(searches, key=lambda r: r['t'] or '')


def save_all(loupe: list, searches: list, votes: dict = None, full: bool = True) -> tuple:
    """Adds the new rows to the two CSV; a vote read now on an answer kept earlier updates that answer."""
    if votes:
        seen = {r['id'] for r in loupe}
        late = {k: v for k, v in votes.items() if k not in seen}
        if late and (OUT / 'loupe.csv').is_file():
            with open(OUT / 'loupe.csv', newline='', encoding='utf-8-sig') as h:
                loupe = loupe + [{**r, 'vote': late[r['id']]} for r in csv.DictReader(h) if r.get('id') in late]
    n1, t1 = save(OUT / 'loupe.csv', LOUPE_COLS, loupe, lambda r: r['id'])
    n2, t2 = save(OUT / 'recherches.csv', SEARCH_COLS, searches, lambda r: f'{r["t"]}|{r["q"]}|{r["cache"]}')
    STATE.write_text(json.dumps({'jour': dt.date.today().isoformat(), 'complet': full}), encoding='utf-8')
    return n1, t1, n2, t2


def deploy_test(e) -> bool:
    """The search made by deploy/vps.sh to check the site after each deployment (« mise en place »), not a reader's.
    Tagged check=deploy and left out of the journal by nginx since 4 Nov 2026; the older ones are dropped here."""
    return unquote_plus(e.get('q') or '').strip().lower() == 'mise en place' and (e.get('t') or '') < '2026-11-05'


def save(path, cols, rows, key):
    """Adds to the CSV the rows it does not hold yet (a vote given after the last run updates its row)."""
    old = {}
    if path.is_file():
        with open(path, newline='', encoding='utf-8-sig') as h:
            old = {key(r): r for r in csv.DictReader(h) if not ('q' in r and deploy_test(r))}  # earlier runs kept them
        for r in old.values():   # rows saved before the Paris time column
            r.setdefault('heure_paris', local(r.get('t')))
            if not r['heure_paris']:
                r['heure_paris'] = local(r.get('t'))
    before = len(old)
    for r in rows:
        old[key(r)] = {c: '' if r.get(c) is None else r.get(c) for c in cols}
    path.parent.mkdir(exist_ok=True)
    with open(path, 'w', newline='', encoding='utf-8-sig') as h:  # BOM: Excel reads the accents
        w = csv.DictWriter(h, fieldnames=cols)
        w.writeheader()
        w.writerows(sorted(old.values(), key=lambda r: r['t'] or ''))
    return len(old) - before, len(old)


def main():
    for stream in (sys.stdout, sys.stderr):  # a Windows console without UTF-8 must not stop the run before the CSV
        try:
            stream.reconfigure(errors='replace')
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--days', type=int, default=14)
    ap.add_argument('--last', type=int, default=15)
    ap.add_argument('--no-save', action='store_true')
    ap.add_argument('--tout', action='store_true', help='relire tous les journaux du VPS, pas seulement les jours récents')
    a = ap.parse_args()
    votes = {}
    since = '' if a.tout or a.no_save else since_day()
    loupe, searches = fetch(since, votes)
    if since:
        print(f'Journaux du VPS lus depuis le {since} (--tout pour tout relire)')
    since = (dt.date.today() - dt.timedelta(days=a.days - 1)).isoformat()
    days = collections.defaultdict(lambda: {'q': 0, 'readers': set(), 'eur': 0.0, 'saved': 0, 'r': 0, 'empty': 0})
    for r in loupe:
        d = days[r['heure_paris'][:10]]
        d['q'] += 1; d['readers'].add(r['reader']); d['eur'] += float(r['cost_eur'] or 0); d['saved'] += bool(r['saved'])
    for r in searches:
        d = days[r['heure_paris'][:10]]
        d['r'] += 1; d['empty'] += str(r['lines']) == '0'
    print(f'\n=== Par jour (depuis le {since})\n')
    print(f'{"Jour":10}  {"Questions":>9}  {"Lecteurs":>8}  {"Enregistrées":>12}  {"Coût":>8}  {"Recherches":>10}  {"Sans résultat":>13}')
    for k in sorted(k for k in days if k >= since):
        d = days[k]
        print(f'{k:10}  {d["q"]:9}  {len(d["readers"]):8}  {d["saved"]:12}  {d["eur"]:7.3f}€  {d["r"]:10}  {d["empty"]:13}')
    print(f'\n=== Les {a.last} dernières questions à la Loupe\n')
    for r in loupe[-a.last:]:
        who = 'réponse enregistrée' if r['saved'] else f'{r["model"] or r["provider"]}, {r["s"]} s, {float(r["cost_eur"] or 0):.4f} €'
        vote = {1: ' 👍', -1: ' 👎'}.get(r['vote'], '')
        print(f'{r["heure_paris"][5:16]}  {r["question"][:150]}  [{who}]{vote}{"  DEMANDE: " + r["demande"] if r["demande"] else ""}')
        if r['tools']:
            print(f'      outils : {r["tools"][:220]}')
        print(f'      → {(r["error"] or r["reply"] or "").replace(chr(10), " ")[:220]}')
    print(f'\n=== Les {a.last} dernières recherches\n')
    for r in searches[-a.last:]:
        print(f'{r["heure_paris"][5:16]}  {r["q"][:80]:80}  {r["lines"] or "?":>8} lignes  {r["cache"] or ""}')
    if not a.no_save:
        n1, t1, n2, t2 = save_all(loupe, searches, votes, full=not since)
        print(f'\n{OUT / "loupe.csv"} : {n1} nouvelle(s) question(s), {t1} en tout')
        print(f'{OUT / "recherches.csv"} : {n2} nouvelle(s) recherche(s), {t2} en tout')


if __name__ == '__main__':
    main()
