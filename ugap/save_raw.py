import sys
sys.path.insert(0, "ugap")
from common import Polite
c = Polite(min_delay=0.5)
url, out = sys.argv[1], sys.argv[2]
r = c.get(url)
print(r.status_code if r is not None else "blocked by robots", r.url if r is not None else "")
if r is not None:
    open(out, "w", encoding="utf-8").write(r.text)
