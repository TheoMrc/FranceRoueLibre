import re, csv
import os
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
R=os.path.join(ROOT,'sources','raw','resultats')+os.sep        # raw files downloaded by fetch-sources.mjs (source « resultats »)
O=os.path.join(ROOT,'sources','resultats')+os.sep             # tidy CSVs, versioned
def load(i):
    t=open(R+f'raw/insee/bdm_{i}.xml').read()
    return {int(y):float(v) for y,v in re.findall(r'TIME_PERIOD="(\d{4})" OBS_VALUE="([^"]*)"',t) if v!='NaN'}
b80=load('000008965'); b15=load('001765177'); b25=load('011814653')
gi=load('011779990'); vol=load('011779991'); cur=load('011779992')
# Spliced CPI expressed in base 2025=100: base 2025 for 1996+, earlier years chained backward with yearly ratios
spl={}; seg={}
for y in range(1996,2026): spl[y]=b25[y]; seg[y]='base2025 (011814653)'
for y in range(1995,1989,-1): spl[y]=spl[y+1]*b15[y]/b15[y+1]; seg[y]='chained on base2015 (001765177)'
for y in range(1989,1959,-1): spl[y]=spl[y+1]*b80[y]/b80[y+1]; seg[y]='chained on base1980 (000008965)'
with open(O+'insee_ipc_annuel_1960_2025.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['annee','ipc_chaine_base2025_100','inflation_pct','segment_source','ipc_base2025_011814653','ipc_base2015_001765177','ipc_base1980_000008965'])
    for y in range(1960,2026):
        inf='' if y==1960 else round((spl[y]/spl[y-1]-1)*100,2)
        w.writerow([y,round(spl[y],3),inf,seg[y],b25.get(y,''),b15.get(y,''),b80.get(y,'')])
with open(O+'insee_deflateur_pib_1949_2025.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['annee','deflateur_pib_2020_100','deflateur_pib_variation_pct','indice_prix_pib_insee_011779990','pib_valeur_Md_eur_courants_011779992','pib_volume_Md_eur_chaines_2020_011779991'])
    for y in sorted(cur):
        d=cur[y]/vol[y]*100; dv='' if y-1 not in cur else round((d/(cur[y-1]/vol[y-1]*100)-1)*100,2)
        w.writerow([y,round(d,3),dv,gi.get(y,''),round(cur[y]/1000,3),round(vol[y]/1000,3)])
# checks
print('2020 deflator',cur[2020]/vol[2020]*100)
for y in (1991,1996,1997,2010,2024,2025): print(y,'b15 yoy',round((b15[y]/b15[y-1]-1)*100,2),'b25 yoy', round((b25[y]/b25[y-1]-1)*100,2) if y-1 in b25 else '')
for y in (1991,1992): print(y,'b80 yoy',round((b80[y]/b80[y-1]-1)*100,2),'b15',round((b15[y]/b15[y-1]-1)*100,2))
