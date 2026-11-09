# Audit « version finale » (branche `claude/version-finale`, 10 novembre 2026)

Relevé de ce qui n’est pas fini dans le dépôt, des données déjà téléchargées mais pas montrées, et des données
publiques (France, Union européenne, FMI, OCDE) qui restent à brancher. Fait sans accès réseau aux sites de données :
tout ce qui demande un téléchargement est préparé dans le pipeline mais **pas exécuté**.

## 1. Fait dans cette branche

| Quoi | Où | État |
|---|---|---|
| Page **La France et ses voisins** : dépenses publiques et rémunération des agents publics des 27 pays de l’UE, 1995–2025, classement année par année, évolution, rang de la France, écart avec l’Union en points, en Md€ et par habitant | `dist/europe.html`, `europe.js`, `europe.css`, `scripts/europe-data.py`, `dist/data/europe.json` | Vérifié : données Eurostat déjà versionnées (`sources/resultats/`), 6 tests, ouvert à 390 et 1366 px, clair et sombre, sans erreur ni défilement horizontal |
| Source `international` : recettes, solde et dette notifiés, intérêts, taux à dix ans, dépenses par fonction (Eurostat) ; dette, solde, croissance, inflation avec prévisions (FMI) | `scripts/fetch-sources.mjs`, étage « extraction » de `scripts/europe-data.py` | **Écrit, pas exécuté sur les vrais fichiers.** Le décodage a été essayé sur des fichiers de même forme à valeurs aléatoires, supprimés ensuite. Les sections de la page restent masquées tant que les fichiers ne sont pas là |
| Menu « Notre argent », liens « Pour aller plus loin », plan du site, index de recherche, `llms.txt`, catalogue des sources, pages et fichier connus de la Loupe, étape de `build_all.py` | `scripts/sync_nav.py`, `nav-icons.json` (icône `mdiPodium`), `sync_seo.py`, `site-index.py`, `build_catalog.py`, `server/assistant/` | Fait, tests existants au vert (88 tests Node, 85 tests Python) |
| README : phrase périmée « ne sont pas encore intégrés » retirée, page ajoutée | `README.md` | Fait |

Pour finir la page sur le PC :

```
node scripts/fetch-sources.mjs --only=international
python scripts/europe-data.py        # écrit sources/international/*.csv (à versionner) et dist/data/europe.json
node --test tests/europe.test.mjs
```

`europe-data.py` écrit ce qu’il n’a pas pu lire (code de série refusé, fichier absent) et continue. Points à regarder
au premier passage : le code `D41PAY` dans `gov_10a_main`, les dimensions de `irt_lt_mcby_a`, et le FMI, qui refuse
parfois les requêtes sans navigateur (les quatre fichiers `fmi/` seraient alors en échec, sans gêner le reste).

## 2. Pas fini dans le site

| Sujet | Constat | Ce qu’il faut |
|---|---|---|
| Sécurité sociale, soins de ville et cliniques | `secu.html` annonce « les séries existent, les montants ne sont pas encore ici » : les liens data.gouv.fr des jeux `datagouv-cnam-ville` et `datagouv-cnam-cliniques` renvoient une page à jeton | Trouver l’URL directe des fichiers sur assurance-maladie.ameli.fr, ou passer par Open Damir |
| Sécurité sociale, comptes par branche | Derniers comptes ouverts : 2009–2010 | Tableaux de la Commission des comptes de la Sécurité sociale (PDF, annexes tableur à vérifier), ou une demande via la page Demandes |
| Subventions aux associations 2022 | Annexe au PLF 2024 publiée sans noms : année manquante | Demande à la Direction du budget |
| PISA 2022 | La reprise Banque mondiale s’arrête à 2018 (`emplois.js` le dit) | Fichier OCDE PISA 2022 |
| Impôts | 34 des 53 lignes de `sources/impots-liste.json` et les coûts de collecte sont des relevés « extrait », marqués d’un astérisque | Ouvrir les documents complets et passer chaque ligne en `check: "source"` |
| UGAP | « Étude en cours » : une partie du catalogue n’est pas encore visitée | Finir le parcours (`ugap/`) |
| Demandes aux instances publiques | L’envoi par le site répond « pas encore ouvert » (`server/assistant/demandes.py`) | Décision d’ouverture, identifiants de la boîte déjà prévus chiffrés |
| Catalogue des sources | `dist/data/catalog.json` versionné ne contient que les sources fixes quand `sources/raw/manifest.json` est absent | Le reconstruire sur le PC après un téléchargement |
| `modernos.html` | Page présente dans `dist/`, absente du menu et du plan du site | À confirmer : volontaire ou non |

## 3. Données déjà téléchargées par le pipeline, pas encore montrées

| Source (`fetch-sources.mjs`) | Contenu | Idée d’usage |
|---|---|---|
| `ofgl-fiscalite` | Bases, taux et produits de la fiscalité locale par commune | Taux de taxe foncière sur la carte et dans « Ma commune » |
| `ofgl-flux-communes` | Flux financiers entre communes et groupements | La redondance entre échelons, question de départ du site |
| `ofgl-departements-fonctionnelle` | Dépenses des départements par fonction (social, routes, collèges) | Carte par fonction, coût par habitant |
| `decp-concessions` | Contrats de concession | Section de la page Marchés |
| `datagouv-criteres-dotations` | Critères de répartition des dotations de l’État | Explication des dotations sur la carte |
| `datagouv-ars-pdl-fir` | Subventions du FIR, ARS Pays de la Loire 2025 | Page Aides, avec l’angle mort des 17 autres ARS |
| `sources/dette-trimestrielle/` | Dette de Maastricht par trimestre depuis 1995 | Aujourd’hui seulement dans les réponses de la Loupe : courbe trimestrielle dans « Comptes de la Nation » |
| `sources/resultats/ocde_emploi_apu_pct_emploi_total.csv`, `eurostat_emploi_OQ_ue.csv` | Emploi public, OCDE et UE | Déjà sur la page Emplois ; à reprendre comme série de la page Europe |

## 4. Données publiques à brancher ensuite (adresses à vérifier avant d’écrire le téléchargement)

| Producteur | Jeu | Intérêt |
|---|---|---|
| Eurostat | `gov_10a_taxag` (impôts et cotisations par type), `gov_10q_ggdebt` (dette trimestrielle), `gov_10a_exp` au niveau des sous-fonctions | Prélèvements comparés ; détail retraites, hôpitaux, enseignement secondaire |
| Commission européenne | Recettes et dépenses du budget de l’UE par État membre (ce que la France verse et reçoit) ; Kohesio (projets financés par les fonds de cohésion) ; Système de transparence financière (bénéficiaires des fonds gérés par la Commission) | Contribution nette, bénéficiaires français des fonds européens dans la Recherche |
| FMI | Fiscal Monitor (recettes, dépenses, solde primaire), dépenses par fonction (GFS) | Comparaison hors Europe |
| OCDE | Dépenses sociales nettes (SOCX), Panorama des administrations publiques, PISA 2022 | Protection sociale privée obligatoire, résultats face aux coûts |
| BCE | Taux des emprunts d’État, détention de la dette | Coût de la dette, mois par mois |
| Agence France Trésor | Encours de la dette négociable, détention par les non-résidents | Qui prête à l’État |
| Cour des comptes, HATVP | Rapports en données ouvertes ; répertoire des représentants d’intérêts, déclarations | Pages Contrôle et Probité |
| DREES | Comptes de la santé, comptes de la protection sociale | Combler les comptes de la Sécurité sociale après 2010 |

## 5. Pourquoi les téléchargements n’ont pas été faits

L’espace de travail utilisé pour cette branche ne peut joindre ni data.gouv.fr, ni Eurostat, ni le FMI, ni l’Insee
(filtrage réseau), et le PC n’était pas joignable. La règle du site (« uniquement des données téléchargées par
script ») interdit de recopier des chiffres lus ailleurs : rien n’a donc été ajouté qui ne vienne d’un fichier déjà
versionné.
