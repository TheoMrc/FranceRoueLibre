import httpx, re
UA={"User-Agent":"FranceRoueLibre-research (stonks@francerouelibre.fr)"}
sites=["https://www.ldlc.com","https://www.bruneau.fr","https://www.manutan.fr","https://www.jpg.fr","https://www.lyreco.com","https://www.topoffice.fr","https://www.materiel.net","https://www.rueducommerce.fr","https://www.cdiscount.com","https://www.fnac.com","https://www.boulanger.com","https://www.conforama.fr","https://www.ikea.com","https://www.bureau-vallee.fr","https://www.raja.fr","https://www.vwr.com","https://www.fishersci.fr","https://www.hellopro.fr","https://www.amazon.fr","https://www.ledenicheur.fr","https://www.idealo.fr"]
with httpx.Client(headers=UA,follow_redirects=True,timeout=20,http2=True) as c:
    for s in sites:
        try:
            r=c.get(s+"/robots.txt")
            t=r.text
            sm=re.findall(r'(?im)^sitemap:\s*(\S+)',t)
            gen=re.split(r'(?im)^user-agent:',t)
            star=[g for g in gen if g.strip().startswith('*')]
            dis=re.findall(r'(?im)^disallow:\s*(\S*)',star[0]) if star else []
            print(f"## {s} [{r.status_code}] sitemaps={sm[:4]} n_disallow_star={len(dis)} disallow_all={'/' in dis} search_blocked={[d for d in dis if 'search' in d.lower() or 'recherche' in d.lower()][:4]}")
        except Exception as e:
            print(f"## {s} ERROR {e}")
