"""UGAP's own contracts in the DECP (it is the buyer): totals per year, largest ones, and the market numbers seen on ugap.fr."""
import json, sys, glob
sys.path.insert(0, "scripts")
import duckdb
from rawfiles import csv as raw_csv
con = duckdb.connect()
src = raw_csv("decp-v3", ", max_line_size=10000000")
q = f"""SELECT id, acheteur_id, acheteur_nom, titulaire_id_1, titulaire_id_1 AS tit, TRY_CAST(montant AS DOUBLE) m,
        left(datenotification,10) d, objet, procedure, offresrecues FROM {src}
        WHERE acheteur_nom ILIKE '%groupement%achat%public%' OR acheteur_nom ILIKE 'UGAP%'"""
con.execute(f"CREATE TABLE u AS {q}")
print(con.execute("SELECT acheteur_id, acheteur_nom, count(*), round(sum(m)/1e9,2) FROM u GROUP BY 1,2 ORDER BY 3 DESC LIMIT 5").fetchall())
print(con.execute("SELECT left(d,4) y, count(*), round(sum(m)/1e9,2) md FROM u GROUP BY 1 ORDER BY 1").fetchall())
print(con.execute("SELECT procedure, count(*), round(avg(TRY_CAST(offresrecues AS DOUBLE)),1) FROM u GROUP BY 1 ORDER BY 2 DESC").fetchall())
for row in con.execute("SELECT id, d, round(m/1e6,1), tit, left(objet,90), offresrecues FROM u ORDER BY m DESC NULLS LAST LIMIT 15").fetchall():
    print(row)
markets = set()
for f in glob.glob("ugap/data/ugap_products/*.jsonl"):
    for l in open(f, encoding="utf-8"):
        mn = json.loads(l).get("market_number")
        if mn: markets.add(str(mn))
print(len(markets), "distinct UGAP market numbers in crawl")
hits = con.execute("SELECT id, d, round(m/1e6,1), tit, left(objet,80) FROM u").fetchall()
found = [h for h in hits if any(mk in str(h[0]) for mk in markets)]
print(len(found), "DECP rows whose id contains a ugap.fr market number"); [print(" ", h) for h in found[:15]]
print("ids sample:", [h[0] for h in hits[:10]])
