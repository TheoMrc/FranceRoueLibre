# Indemnités et frais des élus locaux réellement payés (comptes 653)

Comptes de gestion de la DGFiP (balances comptables définitives), sur data.economie.gouv.fr :
`node scripts/fetch-sources.mjs --only=balances-653-communes-2017,…,balances-653-communes-2025,balances-653-gfp,balances-653-dept,balances-653-reg,balances-653-synd,balances-653-pj`
(seules les lignes dont le compte commence par 653 sont exportées ; les années absentes des exports viennent des pièces jointes),
puis `python3 scripts/emplois-indemnites.py`, qui écrit les tables complètes dans `sources/raw/indemnites/` et ces fichiers compacts.

- Montant = `obnetdeb − obnetcre` (débit budgétaire net, comme dans les formules de l’OFGL) ; montants mandatés, budgets principaux et annexes.
- Les comptes se lisent avec la nomenclature (`nomen`) : en M14, M52, M71, 6531 = indemnités, 6532 = frais de mission, 6533 = retraite,
  6534 = sécurité sociale ; en M57, 65311 à 65318 pour les élus, et 6532*/6533* sont les membres des CESER (exclus des totaux des élus).
- Communes : code Insee reconstruit (`ndept` + `insee`, outre-mer `97` + `insee`), repris du budget principal du même SIREN.
- Ruptures : Ville de Paris commune à partir de 2019 (département avant), Corse collectivité unique à partir de 2018, Collectivité européenne
  d’Alsace en 2021 ; hausse des barèmes des petites communes en 2020 (loi Engagement et proximité).

| Fichier | Contenu |
|---|---|
| `totaux-par-niveau.csv` | par année et niveau (commune, gfp, departement, region, syndicat) : indemnités, indemnités et cotisations, total des comptes 653 des élus |
| `totaux-par-poste.csv` | par année, niveau et poste (indemnités, retraite, sécurité sociale, formation, mission…), y compris les postes hors élus (CESER) |
| `communes-2019-2025.csv` | par commune (code Insee) : indemnités et total 653 des élus, 2019 et 2025, en euros |
| `autres-collectivites-2025.csv` | intercommunalités, départements, régions, syndicats en 2025, par SIREN |
| `plan_comptes_653.csv` | libellés officiels des comptes 653 par nomenclature (plans de comptes TOTEM) |
