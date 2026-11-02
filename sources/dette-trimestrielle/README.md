# Dette publique trimestrielle (Insee)

Téléchargée par `node scripts/fetch-sources.mjs --only=dette-trimestrielle` dans `sources/raw/dette-trimestrielle/`,
puis lue par `python3 scripts/loupe-faq.py`.

| Fichier brut | Page de publication |
|---|---|
| `econ-gen-dette-trim-adm-pub-2.xlsx` | [Insee, dette des administrations publiques au sens de Maastricht, données trimestrielles](https://www.insee.fr/fr/statistiques/2830301) |

## CSV
| Fichier | Contenu | Unités |
|---|---|---|
| `dette-maastricht-trimestrielle.csv` | dette de Maastricht de l’ensemble des administrations publiques, fin de chaque trimestre depuis 1995 | Md€ courants ; % du PIB |

## Contrôles
- La dette de fin de 4e trimestre égale, à 1 Md€ près, la dette annuelle des comptes de la Nation (`sources/national-debt.json`) pour 2017, 2020 et 2024.

## Usage et limites
- Sert aux réponses enregistrées de la Loupe (`server/assistant/faq.json`), servies sans appel à un modèle.
- Insee publie la dette en fin de trimestre seulement : une période qui commence ou finit en cours de trimestre est
  approchée par la fin du trimestre précédent (début) et la fin du trimestre en cours (fin).
- Les deux derniers trimestres sont provisoires et révisés à chaque publication.
