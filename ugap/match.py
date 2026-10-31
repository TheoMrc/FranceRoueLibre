"""Joins UGAP products with retailer offers and computes price ratios.

  python ugap/match.py      -> data/matches.csv, data/matches_review.csv, data/summary.json

Join: EAN when both sides have one, else normalised manufacturer reference (+ brand check).
Same tax basis on both sides: UGAP HT vs B2B HT, UGAP TTC vs retail TTC.
Rows with a pack-size mismatch or a ratio outside [0.2, 10] go to the review file, not the headline numbers.
"""
from __future__ import annotations
import json, re, statistics
from collections import defaultdict
from common import DATA, norm_brand, norm_ref, read_jsonl

try:
    from rapidfuzz import fuzz
except ImportError:  # pragma: no cover
    fuzz = None

PACK = re.compile(r"(?:\bx\s?|lot de |pack de |paquet de |bo[iî]te de |carton de |sachet de |par )(\d{1,5})\b", re.I)


def pack_size(title: str) -> int:
    nums = [int(n) for n in PACK.findall(title or "")]
    return max(nums) if nums else 1


def brand_ok(ugap: dict, ret: dict) -> bool:
    ub, rb = norm_brand(ugap.get("brand")), norm_brand(ret.get("brand"))
    ut, rt = norm_brand(ugap.get("title")), norm_brand(ret.get("name"))
    if ub and rb:
        if ub in rb or rb in ub or (fuzz and fuzz.token_set_ratio(ub, rb) >= 80):
            return True
    if rb and rb.split()[0] in ut.split():
        return True
    if ub and ub.split()[0] in rt.split():
        return True
    return False


def universe(path: str) -> str:
    return re.sub(r"-\d+$", "", path.split("/")[0])


def main():
    ugap = [p for p in read_jsonl(DATA / "ugap_products") if p.get("price_ht")]
    offers = []
    for f in DATA.glob("retail_*"):
        if f.is_dir():
            offers += [o for o in read_jsonl(f) if o.get("price") and (o.get("mpn") or o.get("gtin"))]
    by_ref, by_ean = defaultdict(list), defaultdict(list)
    for o in offers:
        if o.get("gtin"):
            by_ean[re.sub(r"\D", "", o["gtin"]).lstrip("0")].append(o)
        r = norm_ref(o.get("mpn"))
        if len(r) >= 4:
            by_ref[r].append(o)

    rows = []
    for p in ugap:
        cands, how = [], None
        ean = re.sub(r"\D", "", str(p.get("ean") or "")).lstrip("0")
        if ean and by_ean.get(ean):
            cands, how = by_ean[ean], "ean"
        else:
            ref = norm_ref(p.get("ref_manufacturer"))
            strict = ref.isdigit() and len(ref) < 7
            if len(ref) >= 4:
                cands = [o for o in by_ref.get(ref, []) if brand_ok(p, o) or (not strict and len(ref) >= 7)]
                how = "mpn"
        for o in cands:
            u_price = p["price_ht"] if o["price_basis"] == "HT" else p.get("price_ttc")
            if not u_price:
                continue
            ratio = u_price / o["price"]
            pu, po = pack_size(p.get("title")), pack_size(o.get("name"))
            flag = []
            if pu != po:
                flag.append(f"pack {pu} vs {po}")
            if not 0.2 <= ratio <= 10:
                flag.append("ratio hors bornes")
            rows.append({
                "ugap_id": p["id"], "universe": universe(p["path"]), "category": p["path"].split("/")[1] if "/" in p["path"] else "",
                "title": p["title"], "brand": p.get("brand"), "ref": p.get("ref_manufacturer"),
                "ugap_supplier": p.get("supplier"), "market_number": p.get("market_number"),
                "market_name": p.get("market_name"), "price_public": p.get("price_public"),
                "ugap_price": round(u_price, 2), "basis": o["price_basis"], "retailer": o["retailer"],
                "retail_kind": o["kind"], "retail_name": o.get("name"), "retail_price": o["price"],
                "ratio": round(ratio, 3), "match": how, "flags": "; ".join(flag),
                "ugap_url": p["url"], "retail_url": o["url"],
            })

    clean = [r for r in rows if not r["flags"]]
    review = [r for r in rows if r["flags"]]
    import csv
    for name, data in (("matches.csv", clean), ("matches_review.csv", review)):
        with (DATA / name).open("w", newline="", encoding="utf-8-sig") as f:
            if data:
                w = csv.DictWriter(f, fieldnames=list(data[0]), delimiter=";")
                w.writeheader()
                w.writerows(data)

    def stats(rs):
        # one value per UGAP product: cheapest comparable offer
        best = {}
        for r in rs:
            if r["ugap_id"] not in best or r["retail_price"] < best[r["ugap_id"]]["retail_price"]:
                best[r["ugap_id"]] = r
        ratios = sorted(r["ratio"] for r in best.values())
        if not ratios:
            return {"n": 0}
        q = lambda x: ratios[min(len(ratios) - 1, int(x * len(ratios)))]
        return {"n": len(ratios), "median": round(statistics.median(ratios), 3), "p25": q(.25), "p75": q(.75),
                "share_more_expensive": round(sum(x > 1 for x in ratios) / len(ratios), 3),
                "share_2x_or_more": round(sum(x >= 2 for x in ratios) / len(ratios), 3),
                "basket_ratio": round(sum(r["ugap_price"] for r in best.values())
                                      / sum(r["retail_price"] for r in best.values()), 3)}

    summary = {"ugap_products": len(ugap), "ugap_public_price": sum(bool(p.get("price_public")) for p in ugap),
               "retail_offers": len(offers), "matches_clean": len(clean), "matches_review": len(review),
               "all": stats(clean), "public_price_only": stats([r for r in clean if r["price_public"]]),
               "by_basis": {b: stats([r for r in clean if r["basis"] == b and r["price_public"]]) for b in ("HT", "TTC")},
               "by_retailer": {k: stats([r for r in clean if r["retailer"] == k and r["price_public"]])
                               for k in sorted({r["retailer"] for r in clean})},
               "by_universe": {k: stats([r for r in clean if r["universe"] == k and r["price_public"]])
                               for k in sorted({r["universe"] for r in clean})}}
    (DATA / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
