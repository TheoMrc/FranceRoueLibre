"""Crawls retailers' public product pages (from their sitemaps) and keeps brand, manufacturer ref, EAN and price.

  python ugap/retail_crawl.py urls <retailer>      # product URLs from the retailer's sitemap
  python ugap/retail_crawl.py test <retailer>      # parses 5 product pages and prints the result
  python ugap/retail_crawl.py crawl <retailer> [--only-ugap-refs] [--limit N] [--delay 1.0]

--only-ugap-refs fetches first the pages whose URL contains a manufacturer reference seen in the UGAP crawl
(high match yield), so the comparison grows quickly before the full catalogue is done.
Only pages allowed by the retailer's robots.txt are fetched (checked per URL); Conforama forbids all crawling.
"""
from __future__ import annotations
import argparse, html as htmlmod, json, random, re
from datetime import datetime, timezone
from common import DATA, Polite, Shards, norm_ref, read_jsonl, setup_log, sitemap_locs, stop_requested

# price_basis: what the displayed price includes. kind: b2b (pro catalogue, HT) or b2c (retail, TTC).
RETAILERS = {
    "bureauvallee": {"sitemaps": ["https://www.bureau-vallee.fr/pub/media/sitemap_fr_FR_product.xml",
                                  "https://www.bureau-vallee.fr/pub/media/sitemap_fr_FR_cartridge_cartridge.xml"],
                     "product_re": r"\.html$", "price_basis": "TTC", "kind": "b2c"},
    # ldlc refuses connections after ~400 requests (IP blocked): not crawled.
    "_ldlc": {"sitemaps": ["https://www.ldlc.com/sitemap_index.xml"], "product_re": r"/fiche/PB\d+\.html$",
             "price_basis": "TTC", "kind": "b2c"},
    # jpg (mondoffice) and raja sit behind a Radware bot CAPTCHA: not crawled.
    "_jpg": {"sitemaps": ["https://www.mondoffice.fr/sitemap/SITEMAP_JPG"], "product_re": r"/p/|/produit|-\d{5,}",
            "price_basis": "HT", "kind": "b2b"},
    "_raja": {"sitemaps": ["https://www.raja.fr/sitemap/FR_SITEMAP_HTTPS"], "product_re": r"_p_|/p/|\d{5,}",
             "price_basis": "HT", "kind": "b2b"},
    # manutan answers crawlers with a JS challenge page: not crawled.
    "_manutan": {"sitemaps": ["https://www.manutan.fr/sitemap_11701.xml"], "child_re": r"\d-products\.xml",
                "product_re": r".", "price_basis": "HT", "kind": "b2b"},
    "boulanger": {"sitemaps": ["https://www.boulanger.com/sitemap_index.xml"], "child_re": r"sitemap_produit\d+",
                  "product_re": r".", "price_basis": "TTC", "kind": "b2c"},
    "vwr": {"sitemaps": ["https://www.vwr.com/sitemap.xml"], "product_re": r"/store/product/",
            "price_basis": "HT", "kind": "b2b"},
}

LDJSON = re.compile(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S | re.I)


def _products(obj):
    if isinstance(obj, list):
        for x in obj:
            yield from _products(x)
    elif isinstance(obj, dict):
        t = obj.get("@type")
        if t == "Product" or (isinstance(t, list) and "Product" in t):
            yield obj
        for k in ("@graph", "mainEntity", "itemListElement", "item"):
            if k in obj:
                yield from _products(obj[k])


def _num(x):
    try:
        return float(str(x).replace(",", ".").replace("\u202f", "").replace(" ", ""))
    except (TypeError, ValueError):
        return None


SPEC_PAIRS = [re.compile(r"<th[^>]*>(.{1,80}?)</th>\s*<td[^>]*>(.{1,300}?)</td>", re.S | re.I),
              re.compile(r"<dt[^>]*>(.{1,80}?)</dt>\s*<dd[^>]*>(.{1,300}?)</dd>", re.S | re.I)]
TAG = re.compile(r"<[^>]+>")


def spec_table(html: str) -> dict:
    """Label -> value pairs from spec tables (th/td, dt/dd): EAN, brand, manufacturer reference."""
    out = {}
    for rx in SPEC_PAIRS:
        for lab, val in rx.findall(html):
            lab = htmlmod.unescape(TAG.sub("", lab)).strip().lower()
            val = htmlmod.unescape(TAG.sub(" ", val)).strip()
            if not val or len(val) > 120:
                continue
            if re.search(r"code.?barre|\bean\b|gtin", lab):
                out.setdefault("gtin", re.sub(r"\D", "", val) or None)
            elif re.search(r"r[ée]f(?:[ée]rence)?\.?\s*(?:produit\s*)?(?:fabricant|constructeur)|\bmpn\b|part.?number", lab):
                out.setdefault("mpn", val.split()[0])
            elif lab in ("marque", "brand", "fabricant"):
                out.setdefault("brand", val)
    return out


def parse(html: str, url: str, retailer: str) -> dict | None:
    for block in LDJSON.findall(html):
        try:
            data = json.loads(htmlmod.unescape(block.strip()))
        except Exception:
            continue
        for p in _products(data):
            offers = p.get("offers") or {}
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            price = _num(offers.get("price") or offers.get("lowPrice"))
            if price is None and isinstance(offers.get("priceSpecification"), dict):
                price = _num(offers["priceSpecification"].get("price"))
            brand = p.get("brand")
            if isinstance(brand, dict):
                brand = brand.get("name")
            if isinstance(brand, list):
                brand = brand[0].get("name") if brand and isinstance(brand[0], dict) else None
            gtin = p.get("gtin13") or p.get("gtin") or p.get("gtin14") or p.get("gtin12") or p.get("gtin8")
            mpn = p.get("mpn")
            if not mpn:
                m = re.search(r'(?:R[ée]f(?:[ée]rence)?\.?\s*(?:fabricant|constructeur|fournisseur|mfr)\s*:?\s*'
                              r'(?:</[^>]+>\s*<[^>]+>\s*)*)([A-Za-z0-9][A-Za-z0-9\-./]{2,30})', html, re.I)
                mpn = m.group(1) if m else None
            spec = spec_table(html)
            brand = brand or spec.get("brand")
            mpn = spec.get("mpn") or mpn  # spec tables are more reliable than JSON-LD "mpn" (often a name)
            gtin = gtin or spec.get("gtin")
            return {"retailer": retailer, "url": url, "name": p.get("name"), "brand": brand, "mpn": mpn,
                    "gtin": str(gtin) if gtin else None, "sku": p.get("sku"), "price": price,
                    "currency": offers.get("priceCurrency"), "availability": offers.get("availability"),
                    "price_basis": RETAILERS[retailer]["price_basis"], "kind": RETAILERS[retailer]["kind"],
                    "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    return None


def urls_file(retailer):
    return DATA / f"retail_urls_{retailer}.jsonl"


def harvest(retailer):
    cfg = RETAILERS[retailer]
    c = Polite(min_delay=1.0)
    rows = []
    for sm in cfg["sitemaps"]:
        rows += [{"url": u, "lastmod": lm} for u, lm in sitemap_locs(c, sm, cfg.get("child_re"))
                 if re.search(cfg["product_re"], u)]
    uniq = list({r["url"]: r for r in rows}.values())
    random.Random(7).shuffle(uniq)
    with urls_file(retailer).open("w", encoding="utf-8") as f:
        for r in uniq:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"{retailer}: {len(uniq)} product urls")


def crawl(retailer, limit=None, delay=1.0, only_ugap_refs=False, test=False):
    rows = [json.loads(l) for l in urls_file(retailer).open(encoding="utf-8")]
    out = Shards(DATA / f"retail_{retailer}", "url")
    todo = [r for r in rows if r["url"] not in out.done]
    if only_ugap_refs:
        refs = {norm_ref(p.get("ref_manufacturer")) for p in read_jsonl(DATA / "ugap_products")}
        refs = {r for r in refs if len(r) >= 5 and not r.isdigit() or len(r) >= 7}
        todo = [r for r in todo if any(ref in norm_ref(r["url"]) for ref in refs)]
        print(f"{len(todo)} urls contain a UGAP manufacturer ref ({len(refs)} refs)")
    if test:
        todo = todo[:5]
    elif limit:
        todo = todo[:limit]
    c = Polite(min_delay=delay)
    ok = 0
    for i, r in enumerate(todo, 1):
        if not test and stop_requested(retailer):
            print("STOP file found, stopping (resumable)")
            break
        resp = c.get(r["url"])
        rec = parse(resp.text, str(resp.url), retailer) if resp is not None and resp.status_code == 200 else None
        if test:
            print(resp.status_code if resp is not None else "robots/none", json.dumps(rec, ensure_ascii=False)[:400])
            continue
        out.write(rec | {"url": r["url"]} if rec else {"url": r["url"], "retailer": retailer, "error":
                  "no_product" if resp is not None else "robots_or_network"})
        ok += bool(rec)
        if i % 200 == 0:
            print(f"{retailer}: {i}/{len(todo)} fetched, {ok} parsed", flush=True)
    print(f"{retailer}: done, {ok} parsed in this run")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["urls", "test", "crawl"])
    ap.add_argument("retailer", choices=sorted(RETAILERS))
    ap.add_argument("--limit", type=int)
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--only-ugap-refs", action="store_true")
    a = ap.parse_args()
    setup_log(f"crawl_retail_{a.retailer}")
    if a.cmd == "urls":
        harvest(a.retailer)
    else:
        crawl(a.retailer, a.limit, a.delay, a.only_ugap_refs, test=a.cmd == "test")
