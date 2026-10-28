"""Rebuild every derived file of the site from sources/raw/ (run from the project root).

  node scripts/fetch-sources.mjs     # 1. download / update the open data (Node 18+)
  pip install duckdb                 # 2. once
  python scripts/build_all.py        # 3. process everything into dist/data/
"""
import runpy
import sys
import time
from pathlib import Path

STEPS = ['process_spending.py', 'process_local.py', 'process_subsidies.py', 'process_procurement.py', 'process_search.py', 'build_catalog.py']

sys.path.insert(0, str(Path(__file__).parent))
for step in STEPS:
    started = time.time()
    print(f'— {step}')
    runpy.run_path(str(Path(__file__).parent / step), run_name='__main__')
    print(f'  {time.time() - started:.1f} s')
