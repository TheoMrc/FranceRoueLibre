"""Où part l’argent de la Loupe : le registre des dépenses du VPS (spend.jsonl), par jour et par type d’appel
(chat = la boucle de l’agent, web_search = recherche_web, read_page = page web lue par le fournisseur, read_pdf =
rapport PDF officiel découpé chez nous), avec les appels les plus chers et ceux qui passent les 100 000 jetons
(tarif Haiku multiplié par cinq). Aucun jeton dépensé.

    C:\\Python\\Python310\\python.exe scripts\\loupe-cout.py [--jours 3] [--fichier _journal\\spend_vps.jsonl]
"""
import argparse
import collections
import json
import subprocess
import sys
from pathlib import Path

REMOTE = 'sudo -n cat /var/lib/francerouelibre-assistant/spend.jsonl'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jours', type=int, default=3)
    ap.add_argument('--fichier', help='registre déjà téléchargé (sinon lu sur le VPS par ssh)')
    a = ap.parse_args()
    if a.fichier:
        text = Path(a.fichier).read_text(encoding='utf-8')
    else:
        r = subprocess.run(['ssh', '-o', 'BatchMode=yes', 'biodevs-vps', REMOTE], capture_output=True, timeout=120)
        if r.returncode:
            sys.exit(f'Lecture impossible sur le VPS : {r.stderr.decode("utf-8", "replace")[:300]}')
        text = r.stdout.decode('utf-8', 'replace')
    rows = []
    for line in text.splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    days = sorted({r['day'] for r in rows})[-a.jours:]
    rows = [r for r in rows if r['day'] in days and r.get('status') == 200]
    size = lambda r: r.get('prompt', 0) + r.get('cached', 0) + r.get('cache_write', 0)  # noqa: E731
    for day in days:
        by = collections.defaultdict(list)
        for r in rows:
            if r['day'] == day:
                by[(r['provider'], r.get('kind', '?'))].append(r)
        print(f'\n{day} : {sum(r["eur"] for v in by.values() for r in v):.2f} €')
        print(f'  {"fournisseur":<8}{"appel":<12}{"nombre":>7}{"total €":>9}{"moyen €":>9}{"max €":>8}{"jetons moy.":>12}{"> 100 k":>8}')
        for (prov, kind), v in sorted(by.items(), key=lambda kv: -sum(r['eur'] for r in kv[1])):
            tot = sum(r['eur'] for r in v)
            print(f'  {prov:<8}{kind:<12}{len(v):>7}{tot:>9.2f}{tot / len(v):>9.4f}{max(r["eur"] for r in v):>8.3f}'
                  f'{sum(map(size, v)) // len(v):>12}{sum(1 for r in v if size(r) > 100_000):>8}')
    print('\nLes 10 appels les plus chers :')
    for r in sorted(rows, key=lambda r: -r['eur'])[:10]:
        print(f'  {r["day"]} {r["time"]}  {r["eur"]:.3f} €  {r["provider"]} {r.get("kind")}  {size(r)} jetons lus, '
              f'{r.get("out", 0)} écrits, {r.get("searches", 0)} recherche(s), {r.get("s")} s')


if __name__ == '__main__':
    main()
