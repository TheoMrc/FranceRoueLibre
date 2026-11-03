"""Runs the Loupe on its reference questions (tests/loupe-eval.json) with a real model and checks, for each one, that
the expected figure is in the answer, that the expected tools were called, and how many calls and euros it took.
Run after every change of the prompt or of the tools, where the model keys are (the PC's .env):

  python scripts/loupe-eval.py [--provider gemini|claude] [--only 3]"""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'server'))
from assistant import agent  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--provider', default=None)
    ap.add_argument('--only', type=int, default=0)
    a = ap.parse_args()
    cases = json.loads((ROOT / 'tests' / 'loupe-eval.json').read_text(encoding='utf-8'))['questions']
    if a.only:
        cases = cases[:a.only]
    ok_all, eur, rows = 0, 0.0, []
    for c in cases:
        events = []
        t0 = time.time()
        res = agent.answer([{'role': 'user', 'text': c['q']}], a.provider, on_event=events.append)
        tools = [e['name'] for e in events if e.get('type') == 'tool_done']
        reply = res.get('reply') or res.get('error') or ''
        figure = any(x in reply.replace(' ', ' ').replace(' ', ' ') for x in c['attendu'])
        used = all(t in tools for t in c['outils'])
        fast = len(tools) <= c['appels_max']
        good = figure and used and fast
        ok_all += good
        eur += res.get('cost_eur') or 0
        rows.append((good, c['q'], figure, used, len(tools), c['appels_max'], round(time.time() - t0), res.get('cost_eur'), tools))
        print(f'{"OK " if good else "NON"} {c["q"][:60]:60s} chiffre={"oui" if figure else "non"} outils={"oui" if used else "non"} '
              f'appels={len(tools)}/{c["appels_max"]} {round(time.time() - t0)} s {res.get("cost_eur")} € {res.get("model")}', flush=True)
        if not good:
            print('    outils :', ', '.join(tools), '\n    réponse :', reply[:500].replace('\n', ' '))
    print(f'\n{ok_all}/{len(cases)} réussies, {eur:.3f} € au total')


if __name__ == '__main__':
    main()
