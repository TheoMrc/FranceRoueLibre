import pandas as pd
import os
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
R=os.path.join(ROOT,'sources','raw','resultats')+os.sep        # raw files downloaded by fetch-sources.mjs (source « resultats »)
O=os.path.join(ROOT,'sources','resultats')+os.sep             # tidy CSVs, versioned
p=pd.read_csv(R+'raw/drees/sae_capact_pnm_01_24.csv.gz',sep=';',encoding='latin1',dtype={'fi':str,'stj':str,'dep':str,'grp':str,'cat':str})
m=pd.read_csv(R+'raw/drees/sae_capact_pm_01_24.csv.gz',sep=';',encoding='latin1',dtype={'fi':str,'stj':str,'dep':str,'grp':str,'cat':str})
def sect(s):
    if pd.isna(s): return None
    n=int(s)
    if n<40: return 'public'
    if n<70 or n==89: return 'prive_non_lucratif'
    return 'prive_lucratif'
for d in (p,m):
    print('rows without stj:',d.stj.isna().sum(), 'sum of their values:', d[d.stj.isna()].select_dtypes('number').drop(columns=['an'],errors='ignore').sum().sum())
    d['secteur']=d.stj.map(sect); d.dropna(subset=['an'],inplace=True); d['an']=d.an.astype(int)
cols=['ADMTO','CADRE','INF','REEDU','AIDES','ASHAU','PSYCH','SAGFE','EDUTO','PHLAB','TECHN']
gp=p.dropna(subset=['secteur']).groupby(['an','secteur'])[cols].sum()
gm=m.dropna(subset=['secteur']).groupby(['an','secteur'])[['ETPSAL','EFFLIB']].sum()
g=gp.join(gm,how='outer')
ens=g.groupby(level='an').sum(); ens['secteur']='ensemble'; ens=ens.reset_index().set_index(['an','secteur'])
priv=g[g.index.get_level_values(1)!='public'].groupby(level='an').sum(); priv['secteur']='prive'; priv=priv.reset_index().set_index(['an','secteur'])
g=pd.concat([g,priv,ens]).sort_index()
o=pd.DataFrame(index=g.index)
o['medecins_salaries_etp']=g.ETPSAL
o['medecins_liberaux_effectif']=g.EFFLIB
o['administratifs_etp']=g.ADMTO
o['soignants_etp']=g[['CADRE','INF','REEDU','AIDES','ASHAU','PSYCH','SAGFE']].sum(axis=1)
o['dont_cadres_soins_etp']=g.CADRE; o['dont_infirmiers_etp']=g.INF; o['dont_reeducation_etp']=g.REEDU
o['dont_aides_soignants_etp']=g.AIDES; o['dont_ash_autres_soins_etp']=g.ASHAU; o['dont_psychologues_etp']=g.PSYCH; o['dont_sages_femmes_etp']=g.SAGFE
o['educatifs_sociaux_etp']=g.EDUTO; o['medico_techniques_etp']=g.PHLAB; o['techniques_ouvriers_etp']=g.TECHN
o['total_non_medical_etp']=g[cols].sum(axis=1)
o['total_salaries_etp']=o.total_non_medical_etp+o.medecins_salaries_etp
o['part_administratifs_dans_total_salaries_pct']=o.administratifs_etp/o.total_salaries_etp*100
o['part_soignants_et_medecins_dans_total_salaries_pct']=(o.soignants_etp+o.medecins_salaries_etp)/o.total_salaries_etp*100
o['part_technique_medicotech_educ_dans_total_salaries_pct']=(o.educatifs_sociaux_etp+o.medico_techniques_etp+o.techniques_ouvriers_etp)/o.total_salaries_etp*100
o=o.round(1).reset_index().rename(columns={'an':'annee'})
o.to_csv(O+'drees_sae_etp_hopitaux_2001_2024.csv',index=False)
print(o[o.secteur=='ensemble'][['annee','total_salaries_etp','administratifs_etp','part_administratifs_dans_total_salaries_pct','part_soignants_et_medecins_dans_total_salaries_pct']].to_string())
print(o[o.annee==2024].T.to_string())
