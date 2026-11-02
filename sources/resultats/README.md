# Séries « coût et résultats »

Fichiers bruts téléchargés par `node scripts/fetch-sources.mjs --only=resultats` dans `sources/raw/resultats/raw/`,
CSV produits par les scripts de `scripts/emplois-resultats/`. Aucun chiffre saisi à la main ; les ratios calculés sont signalés.

| CSV | Source | Remarques |
|---|---|---|
| `insee_ipc_annuel_1960_2025.csv` | Insee BDM 011814653 (IPC base 2025, 1996–2025), 001765177 (base 2015), 000008965 (base 1980, 1949–1992) | `ipc_chaine_base2025_100` est un raccord calculé (évolutions annuelles des anciennes bases) ; les trois séries brutes sont gardées |
| `insee_deflateur_pib_1949_2025.csv` | Insee, comptes nationaux base 2020 (011779992, 011779991, 011779990) | déflateur = PIB courant / volume, égal à l’indice publié |
| `drees_sae_etp_hopitaux_2001_2024.csv` | DREES, SAE, bases statistiques (archive `capact_pm_pnm.7z` ; extraire `capact_pnm` et `capact_pm` en `raw/drees/sae_capact_pnm_01_24.csv.gz` et `sae_capact_pm_01_24.csv.gz`) | ETP moyens annuels rémunérés par filière ; public / privé non lucratif / lucratif déduit du statut Finess ; **2020 absent** ; refonte SAE en 2013 ; totaux 2024 identiques à la table Q23 publiée |
| `drees_effectifs_salaries_hospitaliers_2003_2024.csv` | DREES, effectifs salariés hospitaliers, séries longues | personnes physiques ; série rétropolée ; détail par profession depuis 2010 |
| `eurostat_gov_remuneration_salaries_ue.csv` | Eurostat `gov_10a_main` (S13, D1PAY, TE), 1995–2025 | `D1PAY_pct_TE` calculé |
| `eurostat_cofog_remuneration_salaries_ue.csv` | Eurostat `gov_10a_exp` (S13, D1 par fonction), 2015–2024 | |
| `ocde_emploi_apu_pct_emploi_total.csv` | OCDE, Government at a Glance (emploi des APU en % de l’emploi total) | pays de l’OCDE seulement |
| `eurostat_emploi_OQ_ue.csv` | Eurostat `nama_10_a10_e` sections O-Q | approximation : comprend le privé (santé, enseignement) |
| `france_solde_commercial_1949_2025.csv` | Eurostat `nama_10_gdp` (biens, 1975–2025) ; Insee ERE (biens et services, 1949–2025) | comptabilité nationale, pas le solde douanier |
| `pisa_france_scores_moyens_2000_2018.csv` | Banque mondiale EdStats (reprise OCDE PISA) | PISA 2022 absent de cette source |
