# FranceRoueLibre

Cartographie interactive des projets d'investissement des collectivités soutenus par l'État en 2025. Ce premier périmètre comprend les dotations DETR, DSIL, DPV et DSID publiées par la Direction générale des collectivités locales (DGCL). Il ne représente pas l'ensemble des dépenses publiques.

## Données

- Projets : [DGCL sur data.gouv.fr](https://www.data.gouv.fr/datasets/projets-finances-par-les-dotations-de-soutien-a-linvestissement-des-collectivites-territoriales), fichier 2025 téléchargé le 15 septembre 2026, Licence Ouverte 2.0.
- Contours départementaux : [Etalab, contours administratifs 2025](https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025/geojson/), simplification 1000 m.
- Charte graphique : couleurs, typographies, fonds en dégradé, surfaces translucides et bouton de thème adaptés depuis `C:\GitHub\TheFishWebsite\the_fish_website` ; les éléments animaliers et les fonctions sans rapport avec le projet ne sont pas repris.

`sources/` conserve les fichiers téléchargés. `node build-data.mjs` prépare les fichiers compacts dans `dist/data/`. Le site est statique et peut être servi avec `npx serve dist` ou tout serveur HTTP statique. Ouvrir `dist/index.html` directement avec `file://` ne permet pas de charger les fichiers JSON dans certains navigateurs.

La carte agrège les **montants de subvention accordés** par département du bénéficiaire, sans les assimiler à des paiements effectivement réalisés ni à la totalité du coût des projets. Les régions sont des filtres territoriaux et les bénéficiaires peuvent être des communes, EPCI, départements ou régions. Les projets sont localisés au département du bénéficiaire, pas à une adresse de réalisation. Les codes source particuliers `67A` (Alsace) et `691` (Métropole de Lyon) restent en catégories distinctes lorsque le département ne peut pas être déduit du code INSEE communal.
