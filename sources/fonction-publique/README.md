# Effectifs de la fonction publique (DGAFP, Insee)

Fichiers téléchargés par `node scripts/fetch-sources.mjs --only=fonction-publique` dans `sources/raw/fonction-publique/`,
puis extraits en CSV par `python3 scripts/extract-effectifs-fp.py`, qui vérifie 30 totaux publiés (`checks.json`).
Aucun chiffre saisi à la main ni estimé.

| Fichier brut | Page de publication |
|---|---|
| `dgafp-ra2026/ra_2026_postes.zip`, `ra_2026_effectifs.zip`, `ra_2026_remu_niveaux.zip` | [Rapport annuel sur l’état de la fonction publique, édition 2026](https://www.fonction-publique.gouv.fr/toutes-les-publications/rapport-annuel-sur-letat-de-la-fonction-publique-edition-2026) (15 octobre 2026, données au 31/12/2024, Siasp-Insee, traitement DGAFP-SDessi) |
| `insee/marc-empl-eff-fonc-pub.xlsx` | [Insee, effectifs par versant et ministère](https://www.insee.fr/fr/statistiques/2493501) (10 février 2026) |
| `data-economie/etpt-…-lfi-2023.csv` | [ETPT par ministère, mission et programme, LFI 2023](https://data.economie.gouv.fr/explore/dataset/etpt-par-ministere-mission-programme-pour-le-bg-et-les-ba-lfi-2023/) |

## CSV
| Fichier | Contenu | Unités |
|---|---|---|
| `effectifs-departements.csv` | 100 départements (hors Mayotte) : agents civils FPE / FPT / FPH, statuts, taux d’administration par versant, 2024 | agents ; ETP pour 1 000 hab. |
| `effectifs-regions.csv` | régions, total métropole, France | idem |
| `effectifs-departements-serie.csv` | zone × versant × indicateur × année, 2011–2024 | milliers ; ETP / 1 000 hab. |
| `effectifs-versants-serie.csv` | FP, FPE, FPT, FPH, contrats aidés, 2011–2024 | milliers |
| `effectifs-fpe-ministeres-serie.csv` | FPE par ministère × (ministères, EPA, total), 1998–2024 | milliers |
| `effectifs-fpt-employeurs-serie.csv` | communes par taille, CCAS, EPCI, syndicats, départements, SDIS, régions | milliers |
| `effectifs-fph-etablissements-serie.csv` | hôpitaux (médecins, non médical), Ehpa, autres médico-sociaux | milliers |
| `salaires-versants-2024.csv` | salaire brut et net mensuel moyen en EQTP par versant et population | € 2024 |
| `plafonds-emplois-lfi-2019-2026.csv` | plafonds d’emplois votés par ministère (nomenclature 2026) et mission | milliers d’ETPT |
| `consommation-emplois-ministeres-2025.csv` | emplois consommés en 2025 et écart au plafond | ETPT |
| `insee-effectifs-versant-ministere-serie.csv` | Insee : versant et ministère × statut, 2011–2024 (contrôle) | milliers |

## Précautions
- Départements : agents civils, emploi principal, département de fonction ; hors militaires, emplois non localisés, Mayotte et contrats aidés.
  La somme des départements (5 535 404) est inférieure au total national (5 848 291) : militaires et emplois non localisés.
- Taux d’administration : en ETP (pas en agents) pour 1 000 habitants ; la population n’est pas publiée avec.
- Ruptures de série en 2016, 2021, 2022 et 2023 (sources de paie, DSN) : la DGAFP publie deux valeurs, gardées dans les CSV longs.
  `emplois-data.py` retient la plus récente.
- Plafonds : ETPT votés en loi de finances initiale, pas des effectifs physiques.
- Insee et DGAFP diffèrent de 4 158 agents en 2024 (champs « postes principaux non annexes » et « emplois principaux ») :
  le site n’utilise que la DGAFP.
