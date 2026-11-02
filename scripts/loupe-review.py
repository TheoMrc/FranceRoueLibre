"""Review of the Loupe's journal (server/assistant/journal.py): what readers ask most, which answers they rated 👎, which
questions the site's data could not answer, and what it cost. To choose the next saved answers (scripts/loupe-faq.py)
and the sections or search words the site is missing.

  python3 scripts/loupe-review.py [journal folder] [--days 30] [--out rapport.md]

On the VPS the journal is in /var/lib/francerouelibre-assistant/journal (copy it, it is not public); locally in
.assistant/journal. Questions are grouped when they use the same meaningful words, whatever their order or accents."""
import argparse
import collections
import datetime as dt
import gzip
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STOP = set("""le la les l de des du d un une et en a au aux pour par sur dans est ce cet cette ces que qui quoi quel quelle quels
quelles combien pourquoi comment ou on il elle ils elles se sa son ses leur leurs plus moins y je j me m tu te nous vous ne pas
t s c qu est sont ete etre fait faire avoir a t il y a dit dire peux peut quand donc mais si tout tous toute toutes bien
france francais francaise francaises""".split())


def norm(text):
    s = unicodedata.normalize('NFD', str(text or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def key(question):
    """Same meaningful words (singular / plural folded), any order."""
    words = {w[:-1] if len(w) > 4 and w.endswith(('s', 'x')) else w for w in norm(question).split() if w not in STOP and len(w) > 1}
    return ' '.join(sorted(words))


def lines(folder, since):
    for path in sorted(folder.glob('*.jsonl*')):
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
                    yield json.loads(raw)
                except ValueError:
                    continue


def review(folder, days=30):
    since = dt.date.today() - dt.timedelta(days=days)
    answers, votes = [], {}
    for e in lines(folder, since):
        if e.get('type') == 'answer':
            answers.append(e)
        elif e.get('type') == 'vote':
            votes[e['id']] = e
    for a in answers:
        a['vote'] = votes.get(a['id'], {}).get('vote')
    first = [a for a in answers if not a.get('earlier')]   # follow-ups depend on their conversation
    groups = collections.defaultdict(list)
    for a in first:
        groups[key(a['question'])].append(a)
    per_day = collections.defaultdict(lambda: {'n': 0, 'readers': set(), 'eur': 0.0})
    for a in answers:
        d = per_day[a['t'][:10]]
        d['n'] += 1; d['readers'].add(a.get('reader')); d['eur'] += a.get('cost_eur') or 0
    nothing = [a for a in answers if a.get('tools') and not any(t.get('ok') and not re.match(r'^0 ', t.get('summary') or '') for t in a['tools'])]
    return {
        'since': since.isoformat(), 'answers': len(answers), 'first': len(first),
        'saved': sum(1 for a in answers if a.get('saved')), 'errors': [a for a in answers if a.get('error')],
        'eur': sum(a.get('cost_eur') or 0 for a in answers),
        'by_model': collections.Counter(a.get('model') or a.get('provider') or '?' for a in answers),
        'days': {k: {'n': v['n'], 'readers': len(v['readers']), 'eur': round(v['eur'], 3)} for k, v in sorted(per_day.items())},
        'top': sorted(groups.values(), key=len, reverse=True),
        'down': [a for a in answers if a.get('vote') == -1], 'up': sum(1 for a in answers if a.get('vote') == 1),
        'nothing': nothing,
        'costly': sorted(answers, key=lambda a: -(a.get('cost_eur') or 0))[:10],
    }


def report(r, top=25):
    eur = lambda v: f'{v:.3f} €'.replace('.', ',')
    out = [f'# La Loupe : relecture du journal depuis le {r["since"]}', '',
           f'{r["answers"]} réponses, dont {r["first"]} premières questions et {r["saved"]} réponses enregistrées (sans coût). '
           f'Coût total {eur(r["eur"])}. Avis : {r["up"]} 👍, {len(r["down"])} 👎. Erreurs : {len(r["errors"])}.', '',
           '## Par jour', '', '| Jour | Questions | Lecteurs distincts | Coût |', '|---|---:|---:|---:|']
    out += [f'| {d} | {v["n"]} | {v["readers"]} | {eur(v["eur"])} |' for d, v in r['days'].items()]
    out += ['', '## Modèles', ''] + [f'- {m} : {n}' for m, n in r['by_model'].most_common()]
    out += ['', '## Questions les plus posées (candidates à une réponse enregistrée)', '',
            '| Fois | Exemple | Déjà enregistrée | 👎 |', '|---:|---|---|---:|']
    for g in r['top'][:top]:
        ex = min((a['question'] for a in g), key=len).replace('|', '/')[:140]
        out.append(f'| {len(g)} | {ex} | {"oui" if any(a.get("saved") for a in g) else ""} | {sum(1 for a in g if a.get("vote") == -1) or ""} |')
    out += ['', '## Réponses notées 👎 (à relire)', '']
    for a in r['down'][:top]:
        tools = ', '.join(f'{t["name"]} ({t.get("summary") or "?"})' for t in a.get('tools') or []) or 'aucun outil'
        out += [f'- **{a["question"][:200]}** ({a["t"][:16]}, {a.get("model") or a.get("provider")}) · outils : {tools}',
                f'  > {a.get("reply", "")[:400].replace(chr(10), " ")}']
    out += ['', '## Questions sans donnée trouvée sur le site (sections ou mots de recherche à ajouter ?)', '']
    out += [f'- {a["question"][:200]} · ' + ', '.join(f'{t["name"]} : {t.get("summary") or "échec"}' for t in a['tools']) for a in r['nothing'][:top]]
    out += ['', '## Réponses les plus coûteuses', '']
    out += [f'- {eur(a.get("cost_eur") or 0)} · {a.get("calls") or "?"} appels · {len(a.get("tools") or [])} outils · {a["question"][:160]}' for a in r['costly']]
    if r['errors']:
        out += ['', '## Erreurs', ''] + [f'- {a["t"][:16]} · {a["error"]} · {a["question"][:120]}' for a in r['errors'][:top]]
    return '\n'.join(out) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('folder', nargs='?', default=str(ROOT / '.assistant' / 'journal'))
    ap.add_argument('--days', type=int, default=30)
    ap.add_argument('--out')
    a = ap.parse_args()
    text = report(review(Path(a.folder), a.days))
    if a.out:
        Path(a.out).write_text(text, encoding='utf-8')
        print(f'{a.out} écrit')
    else:
        print(text)


if __name__ == '__main__':
    main()
