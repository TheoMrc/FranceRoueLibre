"""Watches the UGAP crawl and stops both workers once N lab products are done (lab = 82 % of refs, rarely comparable)."""
import json, glob, sys, time
from pathlib import Path
D = Path(__file__).resolve().parent / "data"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 15000
lab = {json.loads(l)["id"] for l in open(D / "ugap_urls.jsonl", encoding="utf-8") if '"path": "laboratoire-1' in l}
while True:
    done = 0
    for f in glob.glob(str(D / "ugap_products" / "*.jsonl")):
        for l in open(f, encoding="utf-8"):
            i = l.find('"id": "')
            if i >= 0 and l[i + 7:l.find('"', i + 7)] in lab:
                done += 1
    print(time.strftime("%H:%M"), "lab done", done, flush=True)
    if done >= N:
        for w in (0, 1):
            (D / f"STOP_ugap_w{w}").touch()
        print("stop files written"); break
    time.sleep(600)
