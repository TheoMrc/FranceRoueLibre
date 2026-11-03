"""Review of the searched words (journal written by nginx, see deploy/vps.sh and server/search_api.py): what readers
look for most, which searches find nothing (words or data to add), per day. No IP address is journaled.

  python3 scripts/search-review.py [folder] [--days 30] [--out rapport.md]

On the VPS the journal is in /var/lib/francerouelibre/recherches (copy it, it is not public). The search page asks the
API while the reader types: a search followed within 20 seconds by a longer one that starts with it is not counted."""
import argparse
import collections
import datetime as dt
import gzip
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import unquote_plus

ROOT = Path(__file__).resolve().parent.parent


def norm(text):
    s = unicodedata.normalize('NFD', str(text or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9*]+', ' ', s).strip()


def lines(folder, since):
    for path in sorted(Path(folder).glob('*.jsonl*')):
        try:
            day = dt.date.fromisoformat(path.name[:10])
        except ValueError:
            continue
        if day < since:
            continue
        opener = gzip.open if path.suffix == '.gz' else open
        with opener(path, 'rt', encoding='utf-8') as h:
            for raw in h:
                try:
                    e = json.loads(raw)
                except ValueError:
                    continue
                e['q'] = unquote_plus(e.get('q') or '')
                e['key'] = norm(e['q'])
                try:
                    e['when'] = dt.datetime.fromisoformat(e['t'])
                except (KeyError, ValueError):
                    continue
                if e['key']:
                    yield e


def typed(entries):
    """Drops the searches made while typing: followed within 20 s by a longer search that starts with them."""
    entries = sorted(entries, key=lambda e: e['when'])
    keep = []
    for i, e in enumerate(entries):
        later = (f for f in entries[i + 1:i + 30] if (f['when'] - e['when']).total_seconds() <= 20)
        if not any(f['key'] != e['key'] and f['key'].startswith(e['key']) for f in later):
            keep.append(e)
    return keep


def review(folder, days=30):
    since = dt.date.today() - dt.timedelta(days=days)
    raw = list(lines(folder, since))
    kept = typed(raw)
    groups = collections.defaultdict(list)
    for e in kept:
        groups[e['key']].append(e)
    per_day = collections.Counter(e['t'][:10] for e in kept)
    empty = collections.Counter(e['key'] for e in kept if str(e.get('lines')) == '0')
    return {'since': since.isoformat(), 'raw': len(raw), 'searches': len(kept), 'distinct': len(groups),
            'cached': sum(1 for e in kept if e.get('cache') == 'HIT'), 'days': dict(sorted(per_day.items())),
            'top': sorted(groups.values(), key=len, reverse=True), 'empty': empty.most_common(),
            'errors': collections.Counter(str(e.get('status')) for e in kept if str(e.get('status')) != '200')}


def report(r, top=40):
    out = [f'# Recherches depuis le {r["since"]}', '',
           f'{r["searches"]} recherches ({r["raw"]} requêtes, frappe en cours comprise), {r["distinct"]} distinctes, '
           f'{r["cached"]} servies par le cache de nginx.', '', '## Par jour', '', '| Jour | Recherches |', '|---|---:|']
    out += [f'| {d} | {n} |' for d, n in r['days'].items()]
    out += ['', '## Les plus cherchées', '', '| Fois | Recherche | Lignes trouvées |', '|---:|---|---:|']
    for g in r['top'][:top]:
        ex = collections.Counter(e['q'].strip() for e in g).most_common(1)[0][0].replace('|', '/')[:100]
        out.append(f'| {len(g)} | {ex} | {g[-1].get("lines") or "?"} |')
    out += ['', '## Sans résultat (mots ou données à ajouter ?)', '']
    out += [f'- {k} ({n} fois)' for k, n in r['empty'][:top]] or ['- aucune']
    if r['errors']:
        out += ['', '## Réponses en erreur', ''] + [f'- HTTP {s} : {n}' for s, n in r['errors'].most_common()]
    return '\n'.join(out) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('folder', nargs='?', default='/var/lib/francerouelibre/recherches')
    ap.add_argument('--days', type=int, default=30)
    ap.add_argument('--out')
    a = ap.parse_args()
    text = report(review(a.folder, a.days))
    if a.out:
        Path(a.out).write_text(text, encoding='utf-8')
        print(f'{a.out} écrit')
    else:
        print(text)


if __name__ == '__main__':
    main()
