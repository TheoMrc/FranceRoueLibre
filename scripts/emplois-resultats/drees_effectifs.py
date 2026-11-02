import json, re, pandas as pd, openpyxl
import os
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
R=os.path.join(ROOT,'sources','raw','resultats')+os.sep        # raw files downloaded by fetch-sources.mjs (source « resultats »)
O=os.path.join(ROOT,'sources','resultats')+os.sep             # tidy CSVs, versioned
# --- DREES effectifs salariés hospitaliers (xlsx, includes totals) ---
wb=openpyxl.load_workbook(R+'raw/drees/Effectifs_salaries_hospitaliers_Prod2026_DSN.xlsx',data_only=True); ws=wb['Données']
rows=[r for r in ws.iter_rows(values_only=True)]
out=[]; sect=None; years=None
secmap={'Secteur Public':'public','Secteur Privé':'prive','Ensemble (Public+Privé)':'ensemble'}
catmap={'Médecins et assimilés':'medecins','Internes':'internes','Sages-femmes':'sages_femmes','Infirmiers':'infirmiers','Aides-soignants':'aides_soignants','Filière administrative':'administratifs','Autre Personnel':'autres_total','dont Autres soignants':'autres_soignants','dont Autres non soignants':'autres_non_soignants'}
for r in rows:
    if r[0] in secmap: sect=secmap[r[0]]; years=[int(y) for y in r[1:] if y is not None]; continue
    if sect and r[0] in catmap or (r[0] or '').startswith('Total'):
        key=catmap.get(r[0],'total')
        for y,v in zip(years,r[1:]):
            out.append(dict(secteur=sect,annee=y,categorie=key,effectifs=None if v in ('nd',None) else float(v)))
df=pd.DataFrame(out)
w=df.pivot_table(index=['secteur','annee'],columns='categorie',values='effectifs').reset_index()
cols=['secteur','annee','medecins','internes','sages_femmes','infirmiers','aides_soignants','administratifs','autres_soignants','autres_non_soignants','autres_total','total']
w=w.reindex(columns=cols)
w['part_administratifs_pct']=(w.administratifs/w.total*100).round(2)
w['part_soignants_inf_as_sf_pct']=((w.infirmiers+w.aides_soignants+w.sages_femmes)/w.total*100).round(2)
for c in cols[2:]: w[c]=w[c].round(1)
w.sort_values(['secteur','annee']).to_csv(O+'drees_effectifs_salaries_hospitaliers_2003_2024.csv',index=False)
# checks
w2=w.set_index(['secteur','annee'])
parts=['medecins','internes','sages_femmes','infirmiers','aides_soignants','administratifs','autres_total']
print('max |sum parts - total|', (w2[parts].sum(axis=1)-w2.total).abs().max())
print('max |autres split - autres_total|', (w2.autres_soignants+w2.autres_non_soignants-w2.autres_total).abs().max())
print('max |pub+priv-ens|', (w2.loc['public'][parts+['total']]+w2.loc['prive'][parts+['total']]-w2.loc['ensemble'][parts+['total']]).abs().max().max())
c=pd.read_csv(R+'raw/drees/drees_effectifs_salaries_hospitaliers_series_longues.csv',sep=';')
c['k']=c.professions_detaillees.fillna(c.professions).str.split(' - ').str[1]
m={'Médecins et assimilés':'medecins','Internes':'internes','Sages-femmes':'sages_femmes','Infirmiers':'infirmiers','Aides-soignants':'aides_soignants','Filière administrative':'administratifs','Autres soignants':'autres_soignants','Autres non soignants':'autres_non_soignants','Autre personnel (soignants et non soignants)':'autres_total'}
c['catg']=c.k.map(m); c['sect']=c.secteur.map({'Public':'public','Privé':'prive'})
mx=0
for _,r in c.iterrows():
    v=w2.loc[(r.sect,r.annee),r.catg]
    if pd.notna(v): mx=max(mx,abs(v-r.effectifs))
print('max |xlsx - ODS csv| (CSV rounded to unit):',mx, 'csv rows',len(c))
print(w[w.secteur=='ensemble'][['annee','total','administratifs','part_administratifs_pct','part_soignants_inf_as_sf_pct']].to_string())
