<p align="center"><img src="docs/logo.svg" width="72" alt=""></p>

<h1 align="center">FranceRoueLibre</h1>

<p align="center"><strong>Ouvrir le capot des comptes publics.</strong></p>

**Les services de l’État eux-mêmes sont dans l’incapacité de dire où part l’argent des Français. L’argent des Français est flambé à la légère, sans études d’impact a priori ni évaluation a posteriori des politiques financées, car les politiques ne sont pas armés intellectuellement : ils font des paris à l’aveugle et des politiques de communication avec de l’argent qui ne sort pas de leurs poches, mais des nôtres.**

**FranceRoueLibre est une énième initiative visant à ouvrir le capot des comptes publics.**

## Ce que montre le site

| Page | Contenu |
|---|---|
| **Carte** | Comptes des 34 875 communes, des intercommunalités, départements et régions (2012–2025) : dépenses, recettes, impôts, dotations, dette, épargne. En total, par habitant ou en part nationale, année par année. |
| **Circuit** | D’où vient chaque euro et où il va : recettes → dépenses → déficit → dette, de 1960 à 2025 (Insee), ou pour chaque niveau local (OFGL). Un clic sur un pôle de dépense détaille l’argent par fonction (retraites, santé, enseignement…) et par nature (salaires, achats, prestations). |
| **Comptes** | Comptes nationaux en Md€, % du PIB ou € par habitant : recettes, dépenses, comptes par administration, passage du déficit à la dette, impôts. |
| **Impôts** | Les 292 impôts, taxes et prélèvements en vigueur sur les mêmes graphiques, des grands impôts (Insee, documents budgétaires) aux 243 petites taxes de l’inventaire de la Cour des comptes : ce que chacun rapporte, ce qu’il taxe, qui le paie, qui le reçoit, qui le collecte, l’avis de la Cour ; trente ans d’impôts (Insee 1995–2025) ; ce que coûte la collecte, impôt par impôt quand un document l’a publié un jour ; fraude et écart de TVA ; ce que le gouvernement devrait publier. |
| **Niches fiscales** | Les 458 réductions et crédits d’impôt (dépenses fiscales) : coût 2024–2026 mesure par mesure, par impôt et par mission ; les 136 mesures sans montant pour 2026 ; ce qui n’est pas publié (bénéficiaires, évaluations). |
| **Budget de l’État** | Crédits du PLF 2025 par mission, programme et action (AE et CP), par nature ; recettes et comptes spéciaux ; exécution mois par mois 2024–2026 ; indicateurs des rapports de performance 2025 ; budget vert 2026 ; aide publique au développement 2018–2024 ; bilan de l’État 2016–2025. |
| **Opérateurs** | Les 431 opérateurs de l’État (liste PLF 2026) par mission, ministère, statut et réseau ; subventions pour charges de service public par programme ; taxes affectées et plafonds. |
| **Sécurité sociale** | Dépenses et solde des administrations de sécurité sociale (Insee, 1978–2025) ; comptes par branche (2009–2010, derniers publiés en données ouvertes) ; dépenses d’assurance maladie par région (2012) ; ce qui n’est pas publié. |
| **Aides** | Subventions de l’État aux associations (2010–2023), aides aux entreprises, Fonds vert, plan de relance (tableau de bord France Relance, lauréats), bénéficiaire par bénéficiaire. |
| **Marchés** | 1,4 million de marchés publics (2014–2026) : acheteurs, concurrence, achats par type de produit, zoom énergies renouvelables. |
| **UGAP** | Étude en cours : prix du catalogue de la centrale d’achat public comparés à ceux du commerce (933 produits), et place de l’UGAP dans les marchés publics (dossier `ugap/`). |
| **Recherche** | N’importe quel mot (« discrimination », « LGBT », « photovoltaïque »…) cherché dans 1,9 million de lignes de dépenses publiées, avec synthèse, montants, bénéficiaires et lignes surlignées. |
| **Signaux** | Règles simples appliquées à toutes les données : marchés à offre unique, sans mise en concurrence, avenants qui font exploser les prix, montants calés sous les seuils, subventions à des structures fermées, communes en difficulté, retards de paiement… |
| **Probité** | Atteintes à la probité jugées 2021–2025 (corruption, favoritisme, prise illégale d’intérêts, détournements) : affaires par infraction, condamnations et relaxes, peines ; ce qui n’est pas publié. |
| **La Loupe** | Agent IA, bouton « Poser une question » sur chaque page : Gemini ou Claude cherche dans les données du site et sur le web, puis répond avec ses sources. |
| **Données** | Les 59 sources utilisées, et surtout ce qui n’est **pas** publié (hôpitaux, ARS, établissements scolaires, bénéficiaires des niches fiscales, prix unitaires des achats…). |

**Un signal n’est ni une preuve ni une accusation** : c’est une question à poser à l’organisme concerné, avec la source pour la vérifier. Les données publiques contiennent des erreurs de saisie et des changements de périmètre ; chaque chiffre renvoie à sa source.

## Principes

- **Seulement des données ouvertes** (Insee, Eurostat, OFGL, DGFiP, data.gouv.fr, data.economie.gouv.fr…), téléchargées par script avec leur URL, leur date et leur empreinte SHA-256.
- **Des chiffres reproductibles** : chaque total affiché est recalculé à partir des postes publiés et l’écart est montré (0,000 quand tout concorde).
- **Pas d’addition trompeuse** : plafonds d’accords-cadres, montants aberrants et périmètres différents sont séparés, jamais additionnés en silence.
- **Indépendant** : ce site n’est ni édité ni cautionné par l’État ou une administration.

## Lancer le site

```
node serve.mjs          # puis http://127.0.0.1:4173
```

Avec la Loupe (agent IA) : `assistant.bat` (double-clic) lance l’API de recherche, l’API de l’assistant et l’aperçu, avec les clés du `.env` à la racine (celui de RevoFlow, ignoré par git).

Le site est statique (`dist/`). Un serveur HTTP qui gère les requêtes partielles (`Range`) suffit : la recherche lit sa base SQLite par petits morceaux, sans la télécharger en entier.

## Mettre à jour les données

```
node scripts/fetch-sources.mjs     # télécharge ≈ 50 jeux ouverts dans sources/raw/ (Node 18+)
pip install duckdb                 # une fois
python scripts/build_all.py        # recalcule tout dist/data, dont l’index de recherche
```

## Menu et liens entre pages

Le menu (trois accès directs, puis Recettes, Dépenses, Contrôle) et les blocs « Pour aller plus loin » en bas de page sont définis à un seul endroit, `scripts/sync_nav.py`. Après avoir ajouté une page : ajouter sa ligne dans `NAV` et `RELATED`, puis `python scripts/sync_nav.py`.

## Référencement (SEO et moteurs de réponse IA)

`python scripts/sync_seo.py` réécrit, dans le `<head>` de chaque page uniquement, les données structurées schema.org (nom du site écrit FranceRoueLibre et « France Roue Libre », logo, profils X, GitHub et Tipeee, fil d’Ariane, recherche interne) et régénère `dist/sitemap.xml`. À relancer après avoir ajouté une page. `dist/robots.txt` autorise moteurs et robots des IA, `dist/llms.txt` résume le site pour les assistants IA (à tenir à jour avec les pages).

## Contribuer

Une source manquante, un chiffre qui ne colle pas, un signal mal calibré : ouvrez une *issue* avec le lien vers la source. Les angles morts listés sur la page Données sont autant de demandes d’ouverture à adresser aux administrations (et à la CADA).

Soutenir le site : [fr.tipeee.com/francerouelibre](https://fr.tipeee.com/francerouelibre/) (les dons paient le serveur et la Loupe). Sur X : [@FranceRoueLibre](https://x.com/FranceRoueLibre).

Contact : stonks@francerouelibre.fr (corrections, droit de réponse, données personnelles). Site en ligne : https://francerouelibre.fr

## Licence

Code sous licence MIT (voir `LICENSE`). Les données restent sous la licence de leur producteur, le plus souvent la Licence Ouverte 2.0 d’Etalab. Mentions légales et confidentialité : `dist/mentions.html`.

---

## Documentation technique

### Pages en détail

- **Accueil** (`index.html`) : carte des projets aidés et des comptes locaux (communes, intercommunalités, départements, régions) avec les 54 à 68 agrégats OFGL par niveau (dépenses, recettes, impôts, dotations, dette, épargne), années 2012–2025 animables, unités total / par habitant / part nationale ; « Le circuit de l’argent public », diagramme animé des recettes → dépenses → déficit → dette pour toutes les administrations (Insee, 1960–2025) ou pour chaque niveau local (OFGL), avec contrôles de cohérence ; un clic sur un pôle de dépense (fonctionnement, prestations, investissement, intérêts) détaille où va l’argent par fonction et sous-fonction (Eurostat/Insee COFOG, 1995–2024) ; comptes nationaux détaillés en Md€, % du PIB ou € par habitant.
- **Impôts** (`impots.html`) : une seule liste de tous les prélèvements et un seul choix de couleur (ce qui est taxé, qui reçoit, qui collecte, qui paie, avis de la Cour des comptes) pour tous les graphiques globaux : carte proportionnelle, échelle logarithmique avec le seuil des taxes à faible rendement, part cumulée, part en nombre et en argent, une case par prélèvement (case vide si le produit est inconnu), quinze plus gros et quinze plus petits ; fiche de chaque prélèvement ; huit catégories Insee 1995–2025 ; coût de collecte (administrations, taxe par taxe de 2002 à 2024, frais de gestion des impôts locaux et frais retenus sur les taxes collectées pour d’autres, CGI art. 1641 et 1647) ; écart de TVA et contrôle fiscal ; « Ce que le gouvernement devrait publier » (coût et rendement de chaque prélèvement, frais facturés face au coût réel, coût de conformité) ; tableau complet triable et filtrable, prélèvements supprimés depuis 2019 compris.
- **Aides** (`aides.html`) : subventions de l’État aux associations (annexes « jaunes » 2010–2023), aides de minimis aux entreprises, Fonds vert.
- **Marchés** (`marches.html`) : données essentielles de la commande publique (DECP), concurrence, acheteurs ; achats par type de produit (codes CPV) avec les plus gros contrats de chaque sous-famille ; zoom énergies renouvelables (soutien de l’État, programme 345 du budget vert ; achats publics par technologie ; Fonds vert). Les accords-cadres (plafonds) et les montants aberrants sont séparés des dépenses. Dans le format DECP 2022, les accords-cadres sont repérés par le champ « techniques ».
- **Signaux** (`signaux.html`) : règles de détection transparentes (offre unique, marchés sans publicité, avenants, seuils, fractionnement, concentration, établissements fermés subventionnés, épargne négative, désendettement > 12 ans, frais de personnel hors norme, retards de paiement). Un signal est une question à poser, jamais une preuve.
- **Recherche** (`recherche.html`, et la barre de recherche de l’en-tête) : n’importe quel mot ou expression cherché sans accents dans 1,9 million de lignes de dépenses publiées (objet des subventions aux associations 2010–2023, objet des marchés publics 2014–2026, projets DGCL 2018–2025, Fonds vert, aides de minimis, intitulés du budget vert 2026), avec suggestions, synthèse rédigée automatiquement, montants par source, année, bénéficiaire, programme et département, et la liste des lignes surlignées.
- **Données** (`donnees.html`) : inventaire des sources et angles morts (hôpitaux, ARS, CPTS, établissements scolaires, aides fiscales…).

### Détails des traitements

```
node scripts/fetch-sources.mjs     # télécharge ≈ 50 jeux ouverts dans sources/raw/ (Node 18+, reprise automatique)
pip install duckdb                 # une fois
python scripts/build_all.py        # recalcule dist/data/local, aides, marches, catalog
```

`fetch-sources.mjs` découpe les très gros exports par année, vérifie chaque fichier contre le nombre de lignes annoncé par l’API et recommence s’il est incomplet ; `sources/raw/manifest.json` conserve l’URL, la date, la taille et l’empreinte SHA-256 de chaque fichier. `sources/raw/` n’est pas versionné. Les traitements (`scripts/process_*.py`) utilisent DuckDB et lisent directement les fichiers compressés.

La recherche repose sur une base SQLite plein texte (FTS5) d’environ 550 Mo, `dist/data/search/frl-search.sqlite3`, construite par `python scripts/process_search.py` (ou `--dgcl-only` pour ne remplacer que les projets DGCL dans l’index existant, sans les fichiers bruts des autres sources) (inclus dans `build_all.py`, après les autres traitements dont il réutilise les tables de `sources/derived/`). Le navigateur la lit par petits morceaux grâce aux requêtes HTTP partielles (`Range`, gérées par `serve.mjs`) et à [sql.js-httpvfs](https://github.com/phiresky/sql.js-httpvfs) (licence Apache 2.0, dans `dist/vendor/sqljs-httpvfs`) : une recherche télécharge quelques centaines de kilo-octets, pas la base entière. La base est découpée en fichiers de 45 Mo dans `dist/data/search/db/` (mode « chunked » de sql.js-httpvfs) : elle tient dans Git (limite GitHub de 100 Mo par fichier) et fonctionne sur n’importe quel hébergement statique. Le fichier entier `frl-search.sqlite3` n’est pas versionné.

Deux fichiers de référence sont versionnés dans `sources/` : `eurostat-cofog-fr.json` (dépenses par fonction et par nature, [Eurostat gov_10a_exp](https://ec.europa.eu/eurostat/databrowser/view/gov_10a_exp/default/table?lang=fr), extrait via l’API Eurostat pour la France, secteur S13, 1995–2024) et `cpv-2008-fr.json` (libellés français des 9 454 codes CPV, point SPARQL de l’Office des publications de l’UE).

### Données

- Projets : [DGCL sur data.gouv.fr](https://www.data.gouv.fr/datasets/projets-finances-par-les-dotations-de-soutien-a-linvestissement-des-collectivites-territoriales), un fichier par année de 2018 à 2025 (2025 téléchargé le 15 septembre 2026, 2018–2024 le 2 novembre 2026), Licence Ouverte 2.0. Les anciens codes de communes fusionnées sont rattachés à la commune de 2025 qui leur succède ; les quelques lignes sans département (moins de 0,1 %) sont écartées.
- Budgets communaux : [OFGL, comptes consolidés des communes 2018–2025](https://data.ofgl.fr/explore/dataset/ofgl-base-communes-consolidee/), export filtré sur « Dépenses totales », téléchargé le 27 octobre 2026. Les budgets principaux et annexes sont consolidés au sein de chaque commune.
- Budgets départementaux et régionaux : jeux cartographiques OFGL via [l’API ouverte](https://data.ofgl.fr/api/explore/v2.1/catalog/datasets), mêmes filtres et millésime.
- Coordonnées communales : [API Découpage administratif](https://geo.api.gouv.fr/communes?fields=nom,code,centre&format=json), centre géographique officiel.
- Contours administratifs : [Etalab, contours 2025](https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025/geojson/), simplifiés à 1 km pour la vue initiale, puis à 50 m pour les communes visibles et à 100 m pour les départements et régions au zoom.

Les fichiers sources sont conservés dans `sources/`. La commande `node build-data.mjs` produit `dist/data/departments.geojson`, `dist/data/budgets-2025.json`, les millésimes annuels et, via `scripts/web-data.mjs`, les fichiers compacts chargés par le site dans `dist/data/web/` (projets, métadonnées communales et contours encodés en entiers différentiels, environ trois fois plus légers que le GeoJSON). Le regroupement des lignes OFGL est dédoublonné par code INSEE communal.

### Développement local

Le site est statique et peut être servi avec `node serve.mjs` ou tout serveur HTTP statique. Il faut passer par un serveur HTTP pour que les fichiers JSON soient chargés correctement ; ouvrir `dist/index.html` en `file://` peut bloquer les requêtes locales.

La charte reprend celle du site BioDevs : typographies Sora et Inter, thème clair par défaut avec thème sombre, dégradé sarcelle → bleu, sections pleine largeur séparées par leur fond plutôt que par des cadres, et le bouton de thème soleil/lune morphé.

La carte est rendue par MapLibre GL (copie locale dans `dist/vendor/`, licence BSD) : les contours sont découpés en tuiles dans un worker et affichés par le GPU, ce qui rend le zoom (molette, pavé tactile, pincement, boutons + et −) et le déplacement fluides. Les couleurs sont appliquées par état d’entité, sans créer un nœud par commune. Les contours à 50 m des communes sont chargés par département visible à partir du zoom 7, ceux à 100 m des départements et régions au besoin. Ils décrivent des limites administratives, pas un fond de carte routier ou des images aériennes. La carte ouvre sur la France métropolitaine ; les territoires ultramarins restent accessibles par recherche, filtre et sélection dans les listes.

### La Loupe (agent IA)

`server/assistant_api.py` (port 8018, derrière nginx sous `/api/assistant/`) répond aux questions des lecteurs avec Gemini (Vertex AI, crédits Google Cloud) ou Claude (API Anthropic). Le panneau `dist/assistant.js` n’apparaît que si l’API répond qu’un modèle est disponible ; sur un hébergement statique, rien ne change.

**Cloisonnement.** Le modèle n’a que des outils en lecture seule (`server/assistant/tools.py`) : la recherche plein texte du site, une requête SQL `SELECT` sur l’index de recherche (ouvert en lecture seule et immuable, autorisateur SQLite qui refuse tout sauf la lecture, 5 s et 100 lignes au plus), les comptes d’une collectivité, la lecture d’une liste fermée de fichiers JSON de `dist/data`, et une recherche web exécutée par le fournisseur du modèle lui-même (Google Search pour Gemini, outil `web_search` pour Claude) : le serveur ne télécharge aucune page, n’exécute aucun code, n’écrit aucun fichier en dehors de son registre de dépenses et ne lit pas sa configuration. Sur le VPS, le service tourne sous un utilisateur jetable de systemd, système en lecture seule, sans dossier personnel, 256 Mo et une demi-core au plus ; les clés sont dans `/etc/francerouelibre/assistant.env` (root seulement) et la clé du compte de service Vertex AI est transmise par systemd (`LoadCredential`). Voir `deploy/assistant.env.example`.

**Plafonds de dépense** (`server/assistant/budget.py`). Claude : 50 € au total. Gemini : 100 € au total et rien après le 17 novembre 2026 (inclus, heure de Paris). Les deux ensemble : 10 € par jour. Avant chaque appel, le pire cas (toute la requête au prix plein, toute la réponse autorisée, le maximum de recherches web) est réservé ; l’appel est refusé s’il pouvait dépasser un plafond, même avec d’autres questions en cours. Le coût réel, calculé à partir des jetons facturés et des prix publiés (1 $ compté pour 1 €, par prudence), est ensuite inscrit dans `spend.jsonl` (heure, modèle, jetons, coût ; jamais la question). Gemini répond en premier tant que ses crédits sont valables, Claude prend le relais. Le verrou de facturation de RevoFlow est repris : aucun appel Vertex AI si le projet n’est pas rattaché au compte de facturation d’essai. Dépenses : `python server/assistant_api.py --usage`.

**Limites pour le public** : 15 questions par heure et 40 par jour et par adresse IP, 500 par jour en tout, 4 en même temps, 1 500 caractères par question, 8 appels au modèle par question ; nginx limite aussi le débit. Les questions ne sont pas enregistrées par le serveur ; les discussions sont gardées dans le navigateur du lecteur (historique, 30 au plus). Tests : `python -m unittest tests/test_assistant.py`.

**Tester l’interface sans dépenser** : `assistant_demo.bat` (ou `python server/assistant_api.py --fake`) remplace Gemini et Claude par de faux modèles (`server/assistant/fake.py`) qui passent par la vraie boucle et les vrais outils locaux, avec des délais réalistes, sans aucun appel réseau. Des mots dans la question choisissent un scénario : « erreur » (Gemini échoue, Claude prend le relais), « panne », « long », « commune » ou « ville » suivi d’un nom, « web ». Le panneau affiche alors un badge « Démo ».

**Choix du modèle** : un petit bouton à gauche de la zone de saisie passe d’Auto (logo de la Loupe : le premier modèle disponible répond, l’autre prend le relais) à Gemini puis à Claude, avec leurs logos (`dist/img/ai/`, icône de Claude d’Icons8, créditée dans les mentions légales).

### Comptes publics nationaux

La section « Comptes publics » présente les ratios de recettes, dépenses, solde et dette brute des administrations publiques pour 1960–2025, en pourcentage du PIB ; la dette commence en 1978. Les valeurs proviennent du tableau [Insee, Dépenses et recettes publiques](https://www.insee.fr/fr/statistiques/2381414), publié le 28 août 2026 (comptes nationaux, base 2020). Les données 2024 sont semi-définitives et celles de 2025 provisoires. L'extrait versionné `sources/national-ratios-insee.json` est recopié lors du build ; il ne se met pas à jour automatiquement. Les valeurs sont arrondies à un dixième de point : leur différence peut ne pas reproduire exactement le solde publié.

Le solde annuel est un flux et la dette en fin d'année un stock ; la variation de la dette n'est pas nécessairement égale au déficit. Les comptes nationaux sont consolidés entre administrations. Les budgets locaux et les subventions de la carte sont d'autres périmètres : ils ne doivent pas être additionnés aux totaux nationaux. L'OFGL signale que certains comptes communaux 2025 manquent encore. Les séries territoriales antérieures et les détails sur la fiscalité, l'État, la sécurité sociale et les marchés publics ne sont pas encore intégrés.

### Millésimes communaux

Le build transforme les extraits versionnés OFGL de 2012 à 2025 en quatorze fichiers chargés à la demande. Les archives 2012–2017 ont été filtrées par `scripts/extract-ofgl-archive.py` ; les fichiers manifestes conservent les URL et empreintes SHA-256 des archives sources. La carte joint les comptes à la géographie de 2025 par code INSEE historique exact. Les lignes sans code correspondant à un contour et aux métadonnées de 2025 sont exclues et leur nombre est indiqué dans la vue ; les fusions et modifications de limites ne sont pas retraitées même lorsqu’un code a été conservé. Les comparaisons dans le temps sont donc à interpréter avec prudence. La population et le montant par habitant proviennent directement de l’OFGL pour chaque exercice. Les comptes indisponibles ne sont pas remplacés par zéro. En 2025, l’extrait contient 34 778 comptes et l’OFGL indique 97 comptes manquants. La consolidation à l’intérieur de chaque commune ne supprime pas les flux entre collectivités ; le total affiché ne représente pas les dépenses locales consolidées en comptabilité nationale.

Vérifier le build avec `node build-data.mjs` puis `node --test tests/commune-history.test.mjs`.

### Fiscalité nationale

Le graphique fiscal reprend les huit catégories du tableau [Insee « Impôts »](https://www.insee.fr/fr/statistiques/2381408), publiées le 28 août 2026 en milliards d’euros courants, pour les années 1995 à 2025. Certains impôts sont présentés séparément comme détails déjà inclus dans leur catégorie. Le [taux de prélèvements obligatoires](https://www.insee.fr/fr/statistiques/2381412), du même millésime de publication, inclut aussi les cotisations sociales effectives et certains impôts au profit de l’Union européenne ; il est net des crédits d’impôt et hors cotisations sociales imputées. Il ne correspond donc ni à la somme des seuls impôts, ni à l’ensemble des recettes publiques. Les données 2024 sont semi-définitives et celles de 2025 provisoires. L’extrait `sources/national-taxes-insee.json` est versionné ; il ne s’actualise pas automatiquement.

### Rapprochement des recettes et des dépenses

Le tableau [Insee 3.201](https://www.insee.fr/fr/statistiques/8988845) présente les recettes et dépenses consolidées de l'ensemble des administrations publiques. Pour 1960–2025, l’interface additionne ses quatre sous-totaux de recettes et ses quatre sous-totaux de dépenses et compare leur différence au solde publié. Le fichier source original est conservé dans `sources/insee-apu-3201-2026-08.xlsx` ; `scripts/extract-national-accounts.py` (Python et openpyxl) produit l’extrait versionné `sources/national-accounts-3201.json`, ensuite copié par le build. Les contrôles de l’extracteur vérifient les deux décompositions et le solde à 0,001 Md€ près avant arrondi d’affichage. Les comptes 2025 restent provisoires et les valeurs peuvent différer des publications antérieures, notamment après révision.

Cette présentation simplifiée élimine la plupart des flux imputés de production tout en conservant certaines imputations, notamment des cotisations sociales et crédits d’impôt. Elle conserve le solde de la comptabilité nationale ; les montants ne sont donc pas un relevé exhaustif des paiements individuels. Les transferts entre administrations sont consolidés : les comptes des sous-secteurs ne peuvent pas être simplement additionnés.

### Comptes par sous-secteur et écarts

Les recettes et dépenses de l’État, des ODAC, des administrations publiques locales et de la sécurité sociale proviennent du tableau [Insee 3.215](https://www.insee.fr/fr/statistiques/8988845), publié le 28 août 2026. Le fichier original `sources/insee-apu-3215-2026-08.xlsx` et l’extracteur `scripts/extract-national-sectors.py` permettent de reproduire l’extrait versionné. Les soldes affichés sont calculés comme recettes moins dépenses. Les transferts entre sous-secteurs apparaissent dans leurs comptes respectifs et sont éliminés dans le total consolidé ; il est donc incorrect d’additionner directement leurs dépenses pour obtenir le total APU.

Pour 2024, le total des dépenses publié dans le tableau 3.215 est supérieur de 0,119 Md€ à celui du tableau 3.201, tandis que les recettes totales correspondent. La somme des soldes sectoriels correspond au solde de 3.201 et diffère de celui calculé à partir des totaux 3.215 du même montant. L’interface montre cet écart de sources sans lui attribuer de cause : il ne démontre pas une dépense manquante.

### Du déficit à la variation de dette

Les tableaux [Insee 3.101 et 3.105](https://www.insee.fr/fr/statistiques/8988843) fournissent la dette brute de Maastricht et la contribution de chaque sous-secteur pour 1978–2025, ainsi que le passage du déficit à la variation de dette pour 2009–2025. Les cinq ajustements signés publiés incluent les acquisitions nettes d’actifs, les passifs hors dette de Maastricht, les changements de volume, les comptes à recevoir ou à payer et l’écart statistique. Le déficit est affiché comme montant positif à financer. Les valeurs du tableau 3.105 sont arrondies au dixième de milliard ; les sommes peuvent différer après arrondi. La dette de Maastricht est brute, consolidée et évaluée en valeur nominale : elle ne comprend pas tous les passifs des administrations.

Les classeurs `sources/insee-dette-3101-2026-08.xlsx` et `sources/insee-dette-3105-2026-08.xlsx` sont les sources figées. `scripts/extract-national-debt.py` (Python et openpyxl) crée `sources/national-debt.json` et vérifie le pont, les stocks et les contributions avec une tolérance de 0,11 Md€ liée aux arrondis. Le build recopie l’extrait dans `dist/data/`.


Les contours de 2025 sans compte apparié au millésime choisi sont affichés dans une couleur distincte et restent recherchables et sélectionnables. Une absence de correspondance peut provenir d’un compte indisponible ou, pour les exercices antérieurs, de changements de codes et de contours ; elle ne vaut pas zéro. Ces contours sont exclus des sommes et le nombre de comptes appariés reste distinct du nombre de contours sans compte. La couche de ces contours est regroupée en un seul tracé SVG pour préserver les performances de la carte.

### Millésimes départementaux et régionaux

Les tableaux annuels 2012–2025 proviennent des comptes consolidés OFGL des [départements](https://data.ofgl.fr/explore/dataset/ofgl-base-departements-consolidee/) et [régions](https://data.ofgl.fr/explore/dataset/ofgl-base-regions-consolidee/), extraits le 27 octobre 2026. Le build versionne et transforme les exports filtrés sur « Dépenses totales » et charge les années à la demande. Les montants sont consolidés au sein de chaque collectivité mais pas entre collectivités ; leur somme n’est pas le total national des dépenses publiques locales.

Sur le contour du Rhône, la carte regroupe les comptes du département et de la Métropole de Lyon, et leur ratio par habitant utilise la somme des populations. Depuis 2021, le compte unique de la Collectivité européenne d’Alsace est coloré sur les deux contours 67 et 68 sans être compté deux fois dans les totaux. Pour 2012–2020, les comptes du Bas-Rhin et du Haut-Rhin sont identifiés par SIREN. Le compte de Paris devient celui de la Ville de Paris en 2019 ; les collectivités territoriales uniques de Corse, Guyane et Martinique figurent dans la vue régionale et exercent des compétences élargies. Ces changements limitent les comparaisons entre années et territoires.

### Historique et visualisation

L’histogramme national permet de sélectionner une année de 1960 à 2025 et de comparer dépenses, recettes ou dette en pourcentage du PIB ; les barres sont accessibles au clavier et les valeurs manquantes restent indisponibles. Les comptes nationaux détaillés remontent à 1960, les comptes par sous-secteur et la dette brute à 1978, le pont entre déficit et variation de dette à 2009 et les catégories fiscales à 1995. Le taux de prélèvements obligatoires est disponible à partir de 1959 dans la source. Les classeurs Insee de référence sont conservés et `scripts/extract-national-history.py` régénère les ratios et les impôts. Les séries sont exprimées en euros courants ou en points de PIB, selon le graphique : les euros courants ne corrigent pas l’inflation.

Avant 2016, l’OFGL rattache les anciennes régions aux codes des régions actuelles ; leurs comptes sont additionnés sur les contours de 2025, sans consolidation des transferts entre ces anciennes collectivités. Il s’agit d’une reconstitution géographique, non du budget d’une région qui existait alors. Les comparaisons doivent tenir compte des changements de périmètre. Pour 2014, le changement entre les stocks de dette du tableau 3.101 diffère de 0,634 Md€ de la variation publiée dans le tableau 3.105 ; le site conserve et signale cet écart sans lui attribuer une cause.

Certains comptes historiques portent le même code INSEE pour deux entités distinctes lors d’une fusion. Pour éviter un double compte ou un choix arbitraire, les deux lignes sont exclues : deux lignes en 2015 et quatre en 2016. Leur nombre est indiqué à côté des lignes exclues faute de contour correspondant.

### Impôts et coût de collecte

`scripts/extract-taxes-detail.py` lit les 23 lignes du classeur Insee « Impôts » (`sources/insee-impots-2026-08.xlsx` : huit catégories et leurs lignes « dont », 1995–2025) et écrit `sources/taxes-insee-detail.json` ; chaque ligne est contrôlée par un mot de son libellé et les lignes « dont » ne dépassent jamais leur catégorie. `scripts/taxes-data.mjs` (appelé par `node build-data.mjs`, ou seul) assemble `dist/data/impots.json` : lignes Insee, PIB et population par année (comme sur l’accueil), coûts de collecte `sources/impots-couts.json`, et **une seule liste** `all` qui fusionne la liste des grands impôts `sources/impots-liste.json` et l’inventaire de la Cour des comptes `sources/taxes-faible-rendement.json`. Une taxe présente dans les deux n’apparaît qu’une fois (champ `courId`, montant de la Cour quand `amountFrom: "cour"`) ; une ligne de la Cour qui est une fraction d’un grand impôt (accise sur les tabacs perçue en Corse, composantes de l’IFER ou de la TGAP…) est rattachée par `courPartOf` et n’est jamais additionnée. Chaque ligne est classée selon ce qu’elle taxe (consommation, revenus des ménages, production, salaires, patrimoine, bénéfices des sociétés, d’après l’assiette de la Cour pour son inventaire), son bénéficiaire, son collecteur et son payeur. Le script refuse un montant sans source, un identifiant en double, une catégorie inconnue ou un rattachement qui ne pointe vers aucune ligne. Tests : `node --test tests/taxes-page.test.mjs`.

Les deux fichiers `sources/impots-*.json` sont des relevés manuels. Les 16 grands impôts (TVA, CSG, IR, IS, taxe foncière, accises énergie et tabacs, successions, taxe sur les salaires, CRDS, CFE, C3S, CVAE, droits de douane, taxe d’habitation, IFI) prennent la valeur 2025 des comptes nationaux, lue dans le classeur Insee versionné (`check: "source"`). Les autres lignes (taxes affectées, fiscalité locale, Sécurité sociale, CNC, agences de l’eau…) et les coûts de collecte ont été relevés dans des extraits des documents cités (lois de finances, Cour des comptes, Parlement, OFGL/DGCL, rapports de performance) sans que le document complet ait pu être ouvert (`check: "extrait"`) : la page les marque d’un astérisque et ils sont à confirmer sur le document. Les reprises par la presse ou des think tanks ne sont pas retenues. Les fractions d’un impôt reversées à un autre bénéficiaire (`partOf`) ne sont jamais additionnées. Le total affiché est celui des comptes nationaux, pas la somme des lignes, dont les années et définitions diffèrent.

`scripts/extract-low-yield-taxes.py` lit l’annexe du rapport de la Cour des comptes « Les taxes à faible rendement » (avril 2025), versionnée dans `sources/ccomptes-taxes-faible-rendement-2025.xlsx` (empreinte SHA-256 `96c65cd1…8b26ee2`), et écrit `sources/taxes-faible-rendement.json` : les 319 taxes de l’inventaire 2019–2024 (243 en vigueur en 2024, dont 126 au rendement connu pour 5 978 M€), avec objectif, redevable, assiette, collecteur, affectataire et rendement 2019 et 2024 ; un rendement absent reste inconnu, jamais zéro. Les taxes nommées dans l’onglet « Scénarios » y sont rattachées par leur libellé (correspondance exacte, approchée, ou table de correspondance vérifiée à la main) ; l’annexe ne nomme qu’une partie des 44, 30 et 99 taxes des trois scénarios, et les six libellés sans ligne dans l’inventaire sont listés sur la page. L’extracteur vérifie les totaux publiés par la Cour.

Il n’existe pas de coût de collecte publié pour chaque grand impôt : la DGFiP publie un taux global (taux d’intervention sur l’impôt, programme 156), la douane et l’Urssaf le leur. Le rapport de la Cour des comptes de 2025 donne en plus, d’après l’enquête de la DGFiP, 0,37 à 0,38 % pour la TVA, 0,51 à 0,57 % pour l’IS et 0,10 à 0,28 % pour les « impôts divers » (2021–2023), et constate qu’aucune petite taxe n’affiche a priori un coût de collecte supérieur à son rendement (p. 47). La page montre ces taux, les frais de gestion de l’article 1641 du CGI, et les seuls coûts par taxe chiffrés par un rapport public ; aucun coût n’est estimé par règle de trois. La série DGFiP comporte des ruptures de méthode (1999, 2018, 2024) signalées sous le graphique.
