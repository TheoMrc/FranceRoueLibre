import re, sys, collections
sys.path.insert(0, "ugap")
from common import Polite
c = Polite(min_delay=0.5)
for sm in sys.argv[1:]:
    r = c.get(sm, check_robots=False)
    t = r.text if r is not None else ""
    locs = re.findall(r"<loc>\s*(.*?)\s*</loc>", t)
    print(f"## {sm} [{r.status_code if r is not None else None}] index={'<sitemapindex' in t} n={len(locs)}")
    for l in locs[:6]: print("   ", l)
    if "<sitemapindex" in t:
        pats = collections.Counter(re.sub(r"\d+", "N", l.rsplit("/", 1)[-1]) for l in locs)
        print("   patterns:", pats.most_common(8))
        prod = [l for l in locs if re.search(r"prod|article|item|pdp|sku|ref", l, re.I)] or locs[:1]
        r2 = c.get(prod[0], check_robots=False)
        l2 = re.findall(r"<loc>\s*(.*?)\s*</loc>", r2.text if r2 is not None else "")
        print(f"   -> {prod[0]} n={len(l2)}"); [print("      ", x) for x in l2[:5]]
