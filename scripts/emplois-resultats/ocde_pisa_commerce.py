import json, re, pandas as pd
import os
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
R=os.path.join(ROOT,'sources','raw','resultats')+os.sep        # raw files downloaded by fetch-sources.mjs (source « resultats »)
O=os.path.join(ROOT,'sources','resultats')+os.sep             # tidy CSVs, versioned
# OECD Government at a Glance: employment in general government % of total employment
o=pd.read_csv(R+'raw/oecd/oecd_gov_glance_DF_GOV_EMPPS_REP_YU.csv')
e=o[(o.MEASURE=='EMPG')]
print(e[['UNIT_MEASURE','Unit of measure','SECTOR','Institutional sector','EDITION','CATEGORY','Category']].drop_duplicates().to_string())
e=e[(e.UNIT_MEASURE=='PT_EMP')&(e.SECTOR=='S13')]
print(e.CATEGORY.unique(), e.EDITION.unique())
keep=e[['REF_AREA','Reference area','TIME_PERIOD','OBS_VALUE','OBS_STATUS','EDITION','CATEGORY']].rename(columns={'REF_AREA':'pays_iso3','Reference area':'pays','TIME_PERIOD':'annee','OBS_VALUE':'emploi_apu_pct_emploi_total','OBS_STATUS':'statut_obs','EDITION':'edition','CATEGORY':'categorie'})
keep.sort_values(['pays_iso3','annee']).to_csv(O+'ocde_emploi_apu_pct_emploi_total.csv',index=False)
print(keep[keep.pays_iso3=='FRA'].to_string()); print(keep.groupby('annee').pays_iso3.nunique().to_string())
# PISA via World Bank EdStats
rows=[]
for code,dom in [('LO.PISA.MAT','mathematiques'),('LO.PISA.REA','comprehension_ecrit'),('LO.PISA.SCI','sciences')]:
    d=json.load(open(R+f'raw/worldbank/wb_edstats_FRA_{code}.json'))
    for x in d[1]:
        if x['value'] is not None: rows.append(dict(annee=int(x['date']),domaine=dom,score=x['value']))
pz=pd.DataFrame(rows).pivot(index='annee',columns='domaine',values='score').round(1).reset_index()
pz.to_csv(O+'pisa_france_scores_moyens_2000_2018.csv',index=False); print(pz)
# Trade
d=json.load(open(R+'raw/eurostat/nama_10_gdp_FR_trade.json'))
ids=d['id']; size=d['size']; cats=[sorted(d['dimension'][k]['category']['index'],key=lambda c:d['dimension'][k]['category']['index'][c]) for k in ids]
rec=[]
for f,v in d['value'].items():
    f=int(f); co=[]
    for s in reversed(size): co.append(f%s); f//=s
    co=co[::-1]; rec.append({**{k:cats[i][co[i]] for i,k in enumerate(ids)},'v':v})
t=pd.DataFrame(rec); t['c']=t.na_item+'_'+t.unit
w=t.pivot(index='time',columns='c',values='v')
def ins(i):
    x=open(R+f'raw/insee/bdm_{i}.xml').read(); return {int(a):float(b) for a,b in re.findall(r'TIME_PERIOD="(\d{4})" OBS_VALUE="([^"]*)"',x)}
X=ins('011791813'); M=ins('011792506')
out=pd.DataFrame({'annee':range(1949,2026)})
w.index=w.index.astype(int)
out['export_biens_Md_eur']=out.annee.map(w['P61_CP_MEUR']/1000)
out['import_biens_Md_eur']=out.annee.map(w['P71_CP_MEUR']/1000)
out['solde_biens_Md_eur']=out.export_biens_Md_eur-out.import_biens_Md_eur
out['solde_biens_pct_pib']=out.solde_biens_Md_eur/out.annee.map(w['B1GQ_CP_MEUR']/1000)*100
out['solde_services_Md_eur']=out.annee.map((w['P62_CP_MEUR']-w['P72_CP_MEUR'])/1000)
out['export_biens_services_insee_Md_eur']=out.annee.map(lambda y: X.get(y)/1000 if y in X else None)
out['import_biens_services_insee_Md_eur']=out.annee.map(lambda y: M.get(y)/1000 if y in M else None)
out['solde_biens_services_insee_Md_eur']=out.export_biens_services_insee_Md_eur-out.import_biens_services_insee_Md_eur
out=out.round(3)
out.to_csv(O+'france_solde_commercial_1949_2025.csv',index=False)
chk=out.dropna(); print('max |(Eurostat goods+services) - Insee B&S| Md€:', ((chk.solde_biens_Md_eur+chk.solde_services_Md_eur)-chk.solde_biens_services_insee_Md_eur).abs().max())
print(out[out.annee.isin([1975,1990,2000,2010,2019,2022,2023,2024,2025])].to_string())
