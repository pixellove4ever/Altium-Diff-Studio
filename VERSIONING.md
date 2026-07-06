# Politique de version

`versions.json` est la matrice de référence des versions distribuées ensemble.
Un test vérifie sa cohérence avec l’application, l’exporteur, les schémas ADS et
les sessions de revue.

## Application

Altium Diff Studio suit Semantic Versioning :

- `MAJOR` : rupture de compatibilité utilisateur ou suppression majeure ;
- `MINOR` : fonctionnalité rétrocompatible ;
- `PATCH` : correction rétrocompatible.

Un tag Git `vX.Y.Z` doit correspondre exactement à la version de
`package.json`. Il déclenche la création de l’installateur Windows.

## Exporteur

L’exporteur utilise `ADS-MAJOR.MINOR.PATCH`. Sa version peut évoluer
indépendamment de l’application, mais toute release de l’application référence
explicitement la version d’exporteur testée dans `versions.json`.

## Schémas ADS

Les schémas utilisent `ads-json-<type>-v<major>`.

- un même major accepte l’ajout de champs optionnels ;
- une suppression, un renommage ou un changement d’unité impose un nouveau
  major et une migration côté application ;
- les anciens exports restent acceptés tant qu’une migration documentée existe.

## Sessions de revue

Le numéro de format est entier. Chaque nouvelle version doit lire et migrer les
versions encore supportées. Une session d’une version future est refusée avec
un diagnostic explicite.

## Procédure de release

1. mettre à jour `versions.json` et les sources correspondantes ;
2. déplacer les changements de `Unreleased` vers une version datée dans
   `CHANGELOG.md` ;
3. exécuter formatage, lint, check, tests, benchmark et build ;
4. tester l’installateur Windows ;
5. créer le tag `vX.Y.Z`.
