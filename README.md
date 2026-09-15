# FranceRoueLibre

FranceRoueLibre est une cartographie interactive des dépenses publiques. La première version documente le millésime 2025 et permet de descendre de la région au département, puis à la commune.

## Ce que l’interface montre

- **Projets aidés** : engagements de subventions d’investissement de l’État (DETR, DSIL, DPV et DSID) publiés par la DGCL.
- **Budgets communaux** : dépenses totales 2025 de chaque commune publiée par l’OFGL, avec une vue par habitant et un point positionné au centre officiel de la commune.
- **Budgets départementaux** et **budgets régionaux** : mêmes indicateurs OFGL à l’échelon correspondant.
- Chaque vue possède un bouton **Total / Par habitant**. La sélection d’un département ou d’une commune déclenche un zoom animé ; la carte affiche les points communaux quand le niveau le permet.

Les engagements de subvention DGCL et les dépenses exécutées des comptes OFGL mesurent des réalités différentes. Ils restent séparés dans l’interface afin de ne pas présenter une subvention comme une dépense exécutée.

## Données

- Projets : [DGCL sur data.gouv.fr](https://www.data.gouv.fr/datasets/projets-finances-par-les-dotations-de-soutien-a-linvestissement-des-collectivites-territoriales), fichier 2025 téléchargé le 15 septembre 2026, Licence Ouverte 2.0.
- Budgets communaux : [OFGL, comptes des communes 2018–2025](https://www.data.gouv.fr/datasets/comptes-des-communes-2018-2025), export 2025 filtré sur « Dépenses totales » et « Budget consolidé ».
- Budgets départementaux et régionaux : jeux cartographiques OFGL via [l’API ouverte](https://data.ofgl.fr/api/explore/v2.1/catalog/datasets), mêmes filtres et millésime.
- Coordonnées communales : [API Découpage administratif](https://geo.api.gouv.fr/communes?fields=nom,code,centre&format=json), centre géographique officiel.
- Contours départementaux : [Etalab, contours administratifs 2025](https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025/geojson/), simplification 1000 m.

Les fichiers sources sont conservés dans `sources/`. La commande `node build-data.mjs` produit `dist/data/projects-2025.json`, `dist/data/departments.geojson` et `dist/data/budgets-2025.json`. Le regroupement des lignes OFGL est dédoublonné par code INSEE communal.

## Développement local

Le site est statique et peut être servi avec `node serve.mjs` ou tout serveur HTTP statique. Il faut passer par un serveur HTTP pour que les fichiers JSON soient chargés correctement ; ouvrir `dist/index.html` en `file://` peut bloquer les requêtes locales.

La charte reprend les typographies Space Grotesk, Plus Jakarta Sans et Unica One, les surfaces translucides et les dégradés cobalt/vert du site de référence `C:\GitHub\TheFishWebsite\the_fish_website`. Le bouton de thème reprend également son animation SVG soleil/lune morphée, sans élément animalier.

La carte ouvre une vue métropolitaine lisible et garde les territoires ultramarins accessibles par recherche, filtre et sélection dans les listes. Une vue communale nationale est limitée aux points les plus significatifs pour préserver la fluidité ; le choix d’un département affiche ses communes disponibles.
