"""Shared helpers for the UGAP price study: polite HTTP client, robots.txt checks, JSONL shards."""
from __future__ import annotations
import gzip, json, random, re, time
from pathlib import Path
from urllib.parse import urlsplit
import httpx

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
UA = "FranceRoueLibre-research/1.0 (+https://francerouelibre.fr; stonks@francerouelibre.fr)"


class Robots:
    """robots.txt matcher following RFC 9309 / Google: group for '*', longest matching rule wins, Allow wins ties,
    '*' wildcards and '$' anchors supported (urllib.robotparser ignores wildcards)."""

    def __init__(self, text: str):
        self.rules: list[tuple[int, bool, re.Pattern]] = []
        groups, agents, rules, last_was_agent = [], [], [], False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            k, v = (x.strip() for x in line.split(":", 1))
            k = k.lower()
            if k == "user-agent":
                if not last_was_agent and agents:
                    groups.append((agents, rules))
                    agents, rules = [], []
                agents.append(v.lower())
                last_was_agent = True
            elif k in ("allow", "disallow"):
                last_was_agent = False
                if v:
                    rules.append((k == "allow", v))
        if agents:
            groups.append((agents, rules))
        mine = [r for a, r in groups if "*" in a]
        for allow, path in (mine[0] if mine else []):
            rx = "^" + re.escape(path).replace(r"\*", ".*")
            rx = rx[:-2] + "$" if rx.endswith(r"\$") else rx
            self.rules.append((len(path), allow, re.compile(rx)))

    def can_fetch(self, url: str) -> bool:
        parts = urlsplit(url)
        path = (parts.path or "/") + (("?" + parts.query) if parts.query else "")
        best = None
        for length, allow, rx in self.rules:
            if rx.match(path) and (best is None or length > best[0] or (length == best[0] and allow)):
                best = (length, allow)
        return True if best is None else best[1]


class Polite:
    """Single-connection client with a minimum delay between requests, backoff on 429/5xx and robots.txt checks."""

    def __init__(self, min_delay: float = 0.7, jitter: float = 0.3, timeout: float = 30):
        self.min_delay, self.jitter = min_delay, jitter
        self.c = httpx.Client(headers={"User-Agent": UA, "Accept-Encoding": "gzip, deflate"}, http2=True,
                              follow_redirects=True, timeout=timeout)
        self.last = 0.0
        self.robots: dict[str, Robots] = {}
        self.consecutive_errors = 0
        self.stats = {"requests": 0, "throttled": 0, "net_errors": 0, "server_time": 0.0}

    def allowed(self, url: str) -> bool:
        host = "{0.scheme}://{0.netloc}".format(urlsplit(url))
        if host not in self.robots:
            try:
                r = self.c.get(host + "/robots.txt")
                self.robots[host] = Robots(r.text if r.status_code == 200 else "")
            except Exception:
                self.robots[host] = Robots("")
        return self.robots[host].can_fetch(url)

    def get(self, url: str, check_robots: bool = True) -> httpx.Response | None:
        if check_robots and not self.allowed(url):
            return None
        for attempt in range(5):
            wait = self.last + self.min_delay + random.random() * self.jitter - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            t = time.monotonic()
            try:
                r = self.c.get(url)
            except httpx.HTTPError:
                self.stats["net_errors"] += 1
                time.sleep(5 * 2 ** attempt)
                continue
            self.stats["requests"] += 1
            self.stats["server_time"] += time.monotonic() - t
            if r.status_code in (429, 500, 502, 503, 504):
                self.stats["throttled"] += 1
                ra = r.headers.get("retry-after")
                time.sleep(int(ra) if ra and ra.isdigit() else 10 * 2 ** attempt)
                continue
            self.consecutive_errors = 0 if r.status_code < 400 or r.status_code == 404 else self.consecutive_errors + 1
            if self.consecutive_errors >= 20:
                raise SystemExit(f"Stopping: 20 consecutive HTTP errors (last {r.status_code} on {url})")
            return r
        self.consecutive_errors += 1
        return None


def sitemap_locs(client: Polite, url: str, child_re: str | None = None) -> list[tuple[str, str | None]]:
    """Returns (loc, lastmod) pairs from a sitemap or sitemap index (recursing into indexes)."""
    r = client.get(url, check_robots=False)
    if r is None or r.status_code != 200:
        return []
    body = r.content
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    text = body.decode("utf-8", "ignore")
    if "<sitemapindex" in text:
        out = []
        for loc in re.findall(r"<loc>\s*(.*?)\s*</loc>", text):
            if child_re and not re.search(child_re, loc):
                continue
            out += sitemap_locs(client, loc.replace("&amp;", "&"), child_re)
        return out
    pairs = []
    for block in re.findall(r"<url>(.*?)</url>", text, re.S):
        loc = re.search(r"<loc>\s*(.*?)\s*</loc>", block)
        lm = re.search(r"<lastmod>\s*(.*?)\s*</lastmod>", block)
        if loc:
            pairs.append((loc.group(1).replace("&amp;", "&"), lm.group(1) if lm else None))
    return pairs


class Shards:
    """Append-only JSONL output split in shards, with the set of keys already done (for resuming)."""

    def __init__(self, folder: Path, key: str, shard_size: int = 20000, prefix: str = ""):
        self.folder, self.key, self.shard_size, self.prefix = folder, key, shard_size, prefix
        folder.mkdir(parents=True, exist_ok=True)
        self.done: set[str] = set()
        for f in sorted(folder.glob("*.jsonl")):
            for line in f.open(encoding="utf-8"):
                try:
                    self.done.add(str(json.loads(line)[key]))
                except Exception:
                    pass
        self.n = len(self.done)
        self.mine = sum(1 for f in folder.glob(f"part-{prefix}*.jsonl") for _ in f.open(encoding="utf-8")) if prefix else self.n
        self._fh = None

    def write(self, rec: dict):
        shard = self.folder / f"part-{self.prefix}{self.mine // self.shard_size:04d}.jsonl"
        if self._fh is None or self._fh.name != str(shard):
            if self._fh:
                self._fh.close()
            self._fh = shard.open("a", encoding="utf-8")
        self._fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._fh.flush()
        self.done.add(str(rec[self.key]))
        self.n += 1
        self.mine += 1


def setup_log(name: str):
    """Duplicates print() output to data/<name>.log so background runs need no shell redirection."""
    import builtins
    fh = (DATA / f"{name}.log").open("a", encoding="utf-8")
    _print = builtins.print

    def p(*a, **k):
        _print(*a, **k)
        k.pop("file", None)
        _print(*a, **{**k, "file": fh, "flush": True})
    builtins.print = p


def stop_requested(name: str) -> bool:
    """Create data/STOP_<name> to stop a background crawl cleanly (it resumes later)."""
    f = DATA / f"STOP_{name}"
    if f.exists():
        f.unlink()
        return True
    return False


def read_jsonl(folder: Path) -> list[dict]:
    out = []
    for f in sorted(folder.glob("*.jsonl")):
        for line in f.open(encoding="utf-8"):
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def norm_ref(s) -> str:
    """Normalised manufacturer reference for joining: upper case, alphanumerics only."""
    return re.sub(r"[^A-Z0-9]", "", str(s or "").upper())


def norm_brand(s) -> str:
    s = re.sub(r"[^A-Z0-9 ]", " ", str(s or "").upper())
    s = re.sub(r"\b(SAS|SA|SARL|GMBH|INC|LTD|FRANCE|EUROPE|CORP|CORPORATION|CO)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()
