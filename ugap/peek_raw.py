import sys
sys.path.insert(0, "ugap")
from common import Polite
c = Polite(min_delay=0.5)
for u in sys.argv[1:]:
    r = c.get(u, check_robots=False)
    print("##", u, r.status_code, r.headers.get("content-type"), r.headers.get("server"), len(r.content))
    print("  ", r.text[:400].replace("\n", " "))
