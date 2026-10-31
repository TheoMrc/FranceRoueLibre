# Étude des prix UGAP

Compare les prix publics du catalogue de l'UGAP (centrale d'achat public) à ceux de revendeurs pour les **mêmes produits**
(même référence fabricant ou même EAN), puis estime l'écart par univers.

## Pipeline

| Étape | Commande | Sortie (`ugap/data/`, non versionné) |
|---|---|---|
| URL produits UGAP (sitemaps) | `python ugap/ugap_crawl.py urls` | `ugap_urls.jsonl` (474 812 produits, ordre aléatoire) |
| Fiches UGAP | `python ugap/ugap_crawl.py crawl --worker 0 --workers 2` (et worker 1) | `ugap_products/part-*.jsonl` |
| URL revendeur | `python ugap/retail_crawl.py urls <revendeur>` | `retail_urls_<revendeur>.jsonl` |
| Fiches revendeur | `python ugap/retail_crawl.py crawl <revendeur>` | `retail_<revendeur>/part-*.jsonl` |
| Appariement + stats | `python ugap/match.py` | `matches.csv`, `matches_review.csv`, `summary.json` |
| Marchés UGAP dans les DECP | `python ugap/decp_ugap2.py` | console |

Lancement détaché sur le PC : `powershell -File ugap\launch.ps1 <script> <args>`.
Arrêt propre (reprise possible) : créer `ugap/data/STOP_ugap_w0`, `STOP_ugap_w1`, `STOP_<revendeur>`.

## Règles de collecte

- `robots.txt` respecté URL par URL (matcher conforme RFC 9309 : jokers `*`, ancre `$`, règle la plus longue).
- UGAP : fiches produits publiques uniquement, jamais l'API interne `/bff/`, pas de connexion. 2 connexions max, pause ≥ 0,3 s.
- Revendeurs : une connexion par site, ≥ 1 s entre requêtes. User-Agent identifié avec adresse de contact.
- Exclus : Conforama (robots.txt interdit tout), JPG/Mondoffice et Raja (CAPTCHA Radware), Manutan (page de challenge JS),
  Amazon (CGU), recherches interdites par robots.txt (Boulanger, Bureau Vallée, ledenicheur, Cdiscount).
- Aucun HTML conservé, seulement les champs utiles.

## Méthode de comparaison

- Jointure : EAN si présent des deux côtés, sinon référence fabricant normalisée (alphanumérique, majuscules) + contrôle de marque.
- Même base fiscale : UGAP HT vs revendeur B2B HT, UGAP TTC vs revendeur grand public TTC.
- Prix UGAP = prix unitaire pour 1 unité (hors paliers dégressifs, hors remises des conventions partenariales).
- Exclus des chiffres principaux, envoyés en revue manuelle : conditionnements différents (« x 6 », « lot de 10 »),
  ratios hors [0,2 ; 10].
- `price_public = false` : l'UGAP masque le prix aux visiteurs non connectés même s'il figure dans la page.
  Ces produits sont conservés mais **exclus par défaut** des statistiques publiées.
- Ordre de collecte aléatoire : à tout moment, les données collectées sont un échantillon uniforme du catalogue
  (labo en dernier : 82 % des références, rarement comparables).

## Limites connues

- Mobilier : presque jamais de référence fabricant (gammes propres aux titulaires) → pas de comparaison « produit identique ».
  Une comparaison « produit équivalent » est possible mais doit être présentée comme telle.
- Les collectivités sous convention UGAP paient parfois moins que le prix catalogue public.
- Frais de port : franco UGAP à 80 € HT ; non pris en compte côté revendeurs.
- Prix revendeur = un instantané (promotions possibles).
