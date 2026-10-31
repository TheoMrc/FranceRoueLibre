import sys
sys.path.insert(0, "scripts")
import duckdb
from rawfiles import csv as raw_csv
con = duckdb.connect()
for name in ("decp-v3", "decp-2022"):
    src = raw_csv(name, ", max_line_size=10000000")
    if not src:
        print(name, "absent"); continue
    cols = {r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()}
    print(name, "columns sample:", sorted(c for c in cols if 'achet' in c or 'titul' in c)[:12])
    print(name, "date range:", con.execute(f"SELECT min(left(datenotification,10)), max(left(datenotification,10)), count(*) FROM {src}").fetchall())
    r = con.execute(f"""SELECT left(datenotification,4) y, count(*), round(sum(TRY_CAST(montant AS DOUBLE))/1e9,2)
                        FROM {src} WHERE replace(acheteur_id,' ','') LIKE '776056467%' GROUP BY 1 ORDER BY 1""").fetchall()
    print(name, "UGAP as buyer by year:", r)
    r = con.execute(f"""SELECT count(*) FROM {src} WHERE replace(titulaire_id_1,' ','') LIKE '776056467%'""").fetchall()
    print(name, "UGAP as titulaire (contracts where a public buyer declared a purchase from UGAP):", r)
    r = con.execute(f"""SELECT left(datenotification,4), count(*), round(sum(TRY_CAST(montant AS DOUBLE))/1e6,1) FROM {src}
                        WHERE replace(titulaire_id_1,' ','') LIKE '776056467%' GROUP BY 1 ORDER BY 1""").fetchall()
    print(name, "  by year:", r)
    r = con.execute(f"""SELECT acheteur_id, left(objet,70), round(TRY_CAST(montant AS DOUBLE)/1e3) k FROM {src}
                        WHERE replace(titulaire_id_1,' ','') LIKE '776056467%' ORDER BY TRY_CAST(montant AS DOUBLE) DESC NULLS LAST LIMIT 8""").fetchall()
    for x in r: print("   ", x)
