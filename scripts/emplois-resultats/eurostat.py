import json, itertools, csv, re
import pandas as pd
import os
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
R=os.path.join(ROOT,'sources','raw','resultats')+os.sep        # raw files downloaded by fetch-sources.mjs (source « resultats »)
O=os.path.join(ROOT,'sources','resultats')+os.sep             # tidy CSVs, versioned
def jsonstat(path):
    d=json.load(open(path)); ids=d['id']; size=d['size']
    cats=[]
    for k in ids:
        idx=d['dimension'][k]['category']['index']
        order=sorted(idx,key=lambda c: idx[c]) if isinstance(idx,dict) else idx
        cats.append(order)
    rows=[]
    st=d.get('status',{})
    for flat,v in d['value'].items():
        flat=int(flat); coords=[]; rem=flat
        for s in reversed(size): coords.append(rem%s); rem//=s
        coords=coords[::-1]
        r={k:cats[i][coords[i]] for i,k in enumerate(ids)}; r['value']=v; r['flag']=st.get(str(flat),'')
        rows.append(r)
    df=pd.DataFrame(rows); labels={k:d['dimension'][k]['category']['label'] for k in ids}
    return df,labels,d['updated']
EU27=['BE','BG','CZ','DK','DE','EE','IE','EL','ES','FR','HR','IT','CY','LV','LT','LU','HU','MT','NL','AT','PL','PT','RO','SI','SK','FI','SE']
# 1) gov_10a_main D1PAY, D11PAY, TE
df,lab,upd=jsonstat(R+'raw/eurostat/gov_10a_main_S13_D1PAY_D11PAY_TE.json')
df['col']=df.na_item+'_'+df.unit
w=df.pivot_table(index=['geo','time'],columns='col',values='value').reset_index()
fl=df.pivot_table(index=['geo','time'],columns='col',values='flag',aggfunc='first').reset_index()
w['D1PAY_pct_TE']=(w.D1PAY_MIO_EUR/w.TE_MIO_EUR*100).round(2)
w['flags_D1PAY_PC_GDP']=fl['D1PAY_PC_GDP'].fillna('')
w['geo_label']=w.geo.map(lab['geo'])
w=w.rename(columns={'time':'annee'})
cols=['geo','geo_label','annee','D1PAY_PC_GDP','D1PAY_MIO_EUR','D11PAY_PC_GDP','D11PAY_MIO_EUR','TE_PC_GDP','TE_MIO_EUR','D1PAY_pct_TE','flags_D1PAY_PC_GDP']
w[cols].sort_values(['geo','annee']).to_csv(O+'eurostat_gov_remuneration_salaries_ue.csv',index=False)
print('main',upd,w.shape, w[(w.geo=='FR')&(w.annee.isin(['2023','2024','2025']))][cols].to_string())
print(w[w.annee=='2024'].sort_values('D1PAY_PC_GDP',ascending=False)[['geo','D1PAY_PC_GDP','D1PAY_pct_TE']].head(8).to_string())
# 2) COFOG
df,lab,upd2=jsonstat(R+'raw/eurostat/gov_10a_exp_S13_D1_cofog.json')
df['col']=df.unit
w2=df.pivot_table(index=['geo','cofog99','time'],columns='col',values='value').reset_index()
w2['cofog_label']=w2.cofog99.map(lab['cofog99']); w2['geo_label']=w2.geo.map(lab['geo'])
w2=w2.rename(columns={'time':'annee','MIO_EUR':'D1_MIO_EUR','PC_GDP':'D1_PC_GDP','PC_TOT':'D1_PC_TOT'})
w2[['geo','geo_label','annee','cofog99','cofog_label','D1_PC_GDP','D1_MIO_EUR','D1_PC_TOT']].sort_values(['geo','annee','cofog99']).to_csv(O+'eurostat_cofog_remuneration_salaries_ue.csv',index=False)
fr=w2[(w2.geo=='FR')&(w2.annee=='2024')]
print('cofog',upd2,w2.shape); print(fr[['cofog99','D1_PC_GDP','D1_MIO_EUR','D1_PC_TOT']].to_string()); print('sum GF', fr[fr.cofog99!='TOTAL'].D1_MIO_EUR.sum())
print('max year with FR cofog', w2[(w2.geo=='FR')].annee.max(), 'countries with 2024:', w2[(w2.annee=='2024')&(w2.cofog99=='TOTAL')].geo.nunique())
# 3) employment O-Q
df,lab,upd3=jsonstat(R+'raw/eurostat/nama_10_a10_e_EMP_DC_O-Q.json')
df['col']=df.nace_r2+'_'+df.unit
w3=df.pivot_table(index=['geo','time'],columns='col',values='value').reset_index()
w3['geo_label']=w3.geo.map(lab['geo']); w3=w3.rename(columns={'time':'annee','TOTAL_THS_PER':'emploi_total_milliers','O-Q_THS_PER':'emploi_OQ_milliers','O-Q_PC_TOT_PER':'emploi_OQ_pct_total'})
w3[['geo','geo_label','annee','emploi_OQ_milliers','emploi_total_milliers','emploi_OQ_pct_total']].sort_values(['geo','annee']).to_csv(O+'eurostat_emploi_OQ_ue.csv',index=False)
print('emp',upd3); print(w3[w3.geo=='FR'].tail(3).to_string())
chk=w3.dropna(); print('max abs diff pct check', ((chk.emploi_OQ_milliers/chk.emploi_total_milliers*100)-chk.emploi_OQ_pct_total).abs().max())
