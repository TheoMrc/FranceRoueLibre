"""Crawls the public UGAP catalogue (ugap.fr) politely and stores one compact JSON record per product.

  python ugap/ugap_crawl.py urls            # product URLs from the sitemaps -> data/ugap_urls.jsonl (random order)
  python ugap/ugap_crawl.py crawl [--limit N] [--delay 0.7]
                                            # fetches product pages in that random order, resumable,
                                            # -> data/ugap_products/part-*.jsonl (no HTML kept)

Random order means that whatever has been crawled at any time is a uniform random sample of the catalogue.
Only pages allowed by robots.txt are fetched; the internal API (/bff/) is never used.
"""
from __future__ import annotations
import argparse, json, random, re, sys, time
from datetime import datetime, timezone
from common import DATA, Polite, Shards, setup_log, sitemap_locs, stop_requested

URLS = DATA / "ugap_urls.jsonl"
OUT = DATA / "ugap_products"
HYPERNOVA = re.compile(r'data-hypernova-key="ProductPage"[^>]*><!--(.*?)--></script>', re.S)
KEEP_FEATURES = {"Marque", "Référence fabricant", "Type de produit", "Libellé produit fabricant", "Gamme", "Quantité",
                 "Code EAN", "EAN", "GTIN", "Lieu de fabrication", "Fournisseur"}


def harvest_urls():
    c = Polite(min_delay=1.0)
    rows = []
    for i in range(1, 60):
        locs = sitemap_locs(c, f"https://www.ugap.fr/sitemap-produits-{i}.xml")
        if not locs and i > 20:
            break
        for loc, lm in locs:
            m = re.search(r"-p(\d+)$", loc)
            if m:
                rows.append({"id": m.group(1), "url": loc, "lastmod": lm,
                             "path": loc.split("ugap.fr/")[1].rsplit("/", 1)[0]})
        print(f"sitemap {i}: {len(locs)} urls (total {len(rows)})", flush=True)
    uniq = {r["id"]: r for r in rows}
    rows = list(uniq.values())
    random.Random(20261029).shuffle(rows)
    with URLS.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"{len(rows)} unique products -> {URLS}")


def parse(html: str, row: dict) -> dict | None:
    m = HYPERNOVA.search(html)
    if not m:
        return None
    pd = json.loads(m.group(1))["data"]["productData"]
    market = pd.get("market") or {}
    disp = pd.get("displayPriceByReference") or {}
    feats = {}
    for grp in pd.get("features") or []:
        for f in grp.get("features") or []:
            lab = (f.get("label") or "").strip()
            if lab in KEEP_FEATURES and lab not in feats:
                feats[lab] = f.get("value")
    sup = pd.get("supplier") or {}
    refs = pd.get("references") or {}
    return {
        "id": str(pd.get("id") or row["id"]),
        "url": row["url"],
        "path": row["path"],
        "title": pd.get("title"),
        "description": (pd.get("description") or "")[:500],
        "price_ht": pd.get("exclTaxesPrice"),
        "price_ttc": pd.get("inclTaxesPrice"),
        "start_price_ht": pd.get("startPrice"),
        "pricing_plans": pd.get("pricingPlans") or [],
        "eco_contribution": pd.get("ecoContribution"),
        "price_public": bool(market.get("displayPrice")) and bool(disp.get("showPriceAnonymousByReference")),
        "is_sold": pd.get("isSold"),
        "is_vehicle": pd.get("isVehicule"),
        "has_variants": bool(pd.get("productSons")),
        "brand": feats.get("Marque"),
        "ref_manufacturer": refs.get("manufacturer") or feats.get("Référence fabricant"),
        "ref_supplier": refs.get("supplier"),
        "ean": feats.get("Code EAN") or feats.get("EAN") or feats.get("GTIN"),
        "features": feats,
        "supplier": sup.get("name"),
        "supplier_id": sup.get("fullId"),
        "market_number": market.get("marketNumber"),
        "market_name": market.get("name"),
        "market_start": market.get("startDate"),
        "market_end": market.get("expiryDate"),
        "warranty": pd.get("warranty"),
        "delivery_days": pd.get("deliveryTime"),
        "theme_id": pd.get("themeId"),
        "subtheme_id": pd.get("subThemeId"),
        "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def crawl(limit: int | None, delay: float, worker: int = 0, workers: int = 1):
    rows = [json.loads(l) for l in URLS.open(encoding="utf-8")]
    pre = f"w{worker}-" if workers > 1 else ""
    out = Shards(OUT, "id", prefix=pre)
    errs = Shards(DATA / "ugap_errors", "id", prefix=pre)
    todo = [r for r in rows if r["id"] not in out.done and r["id"] not in errs.done]
    todo.sort(key=lambda r: r["path"].startswith("laboratoire-1"))  # lab reagents (82 %) last, order random within
    todo = todo[worker::workers]
    if limit:
        todo = todo[:limit]
    print(f"worker {worker}/{workers}: ", end="")
    print(f"{len(rows)} products, {len(out.done)} done, {len(todo)} to fetch now", flush=True)
    c = Polite(min_delay=delay)
    t0 = time.time()
    for i, row in enumerate(todo, 1):
        if stop_requested("ugap") or stop_requested(f"ugap_w{worker}"):
            print("STOP file found, stopping (resumable)")
            break
        r = c.get(row["url"])
        if r is None:
            errs.write({"id": row["id"], "error": "robots_or_network"})
        elif r.status_code != 200:
            errs.write({"id": row["id"], "error": f"http_{r.status_code}"})
        else:
            try:
                rec = parse(r.text, row)
            except Exception as e:  # noqa: BLE001
                rec, err = None, repr(e)[:200]
            else:
                err = "no_product_json"
            if rec:
                out.write(rec)
            else:
                errs.write({"id": row["id"], "error": err})
        if i % 100 == 0:
            rate = i / (time.time() - t0)
            st = c.stats
            print(f"  http: {st['requests']} req, {st['throttled']} throttled, {st['net_errors']} net errors, "
                  f"avg response {st['server_time'] / max(1, st['requests']):.2f}s", flush=True)
            print(f"{i}/{len(todo)} fetched, {rate:.2f}/s, total ok {out.n}, errors {errs.n}, "
                  f"ETA {(len(todo) - i) / rate / 3600:.1f} h", flush=True)
    print(f"done: total ok {out.n}, errors {errs.n}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["urls", "crawl"])
    ap.add_argument("--limit", type=int)
    ap.add_argument("--delay", type=float, default=0.7)
    ap.add_argument("--worker", type=int, default=0)
    ap.add_argument("--workers", type=int, default=1)
    a = ap.parse_args()
    setup_log("crawl_ugap" + (f"_w{a.worker}" if a.workers > 1 else ""))
    harvest_urls() if a.cmd == "urls" else crawl(a.limit, a.delay, a.worker, a.workers)
