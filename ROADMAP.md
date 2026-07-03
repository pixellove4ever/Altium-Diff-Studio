# Roadmap — Altium Diff Studio

Cette liste est la source de vérité pour les travaux restants. Elle est organisée
par priorité plutôt que par date.

Légende :

- `[ ]` à faire ;
- `[x]` livré et validé.

## P0 — Fiabilité et performances — développement terminé

- [x] **Créer un jeu de régression représentatif**
  - [x] ajouter une petite paire A/B versionnée pour PCB, schématique et BOM ;
  - [x] couvrir composants, routage, plans, vias, nets, TP et changements de valeur ;
  - [x] permettre de reproduire rapidement un défaut d’affichage ou de comparaison.
- [x] **Ajouter des tests de performance reproductibles**
  - [x] générer des PCB synthétiques de 10k, 50k et 100k primitives ;
  - [x] mesurer diff, index spatial et préparation géométrique du rendu ;
  - [x] fixer des seuils suffisamment stables pour détecter une régression.
- [x] **Intégrer le profilage du rendu d’un grand PCB réel**
  - [x] mesurer les frames pendant zoom, pan, survol, sélection de net et slider ;
  - [x] afficher moyenne, maximum, dernière frame et nombre d’échantillons ;
  - [x] permettre la remise à zéro entre deux scénarios ;
  - validation terrain : consigner une mesure sur un grand export non confidentiel.
- [ ] **Durcir l’import des très gros projets** _(partiellement couvert)_
  - [x] parser le JSON dans un Worker ;
  - [x] afficher la progression et ignorer les imports obsolètes ;
  - [x] sérialiser les lectures natives et supprimer les copies explicites de buffers ;
  - [x] permettre l’annulation explicite d’un import en cours.
- [x] **Ajouter un test d’intégration “chargement A puis B”**
  - [x] vérifier la transition du workspace A seul vers A+B comparable ;
  - [x] vérifier que le diff devient immédiatement exploitable ;
  - [x] préserver le workspace lorsque B est incompatible ;
  - le remplacement rapide de B reste couvert par l’annulation et le compteur d’import.

## P1 — Revue et comparaison

- [x] **Ajouter des instantanés aux commentaires**
  - [x] capturer et compresser la zone PCB ou schématique actuellement visible ;
  - [x] associer, remplacer ou supprimer l’image d’un composant ou d’un net ;
  - [x] inclure l’instantané dans la sauvegarde locale, la session et le rapport ;
  - [x] migrer les sessions v1 et filtrer les sources d’image non sûres.
- [x] **Rendre la comparaison DXF sémantique**
  - [x] apparier lignes, arcs, cercles et textes après résolution des blocs ;
  - [x] neutraliser les primitives communes ;
  - [x] colorer uniquement les ajouts, modifications et suppressions ;
  - [x] conserver le slider actuel comme mode visuel.
- [ ] **Enrichir le rapport de revue**
  - ajouter les noms complets des fichiers et métadonnées d’export ;
  - proposer un rapport filtré ou complet ;
  - afficher les diagnostics importants et la couverture de revue ;
  - ajouter une page de garde compacte pour le PDF.
- [ ] **Améliorer la gestion des sessions**
  - proposer fusion ou remplacement lors de l’import ;
  - afficher l’auteur et la date de dernière modification ;
  - signaler précisément les entrées ignorées ;
  - prévoir une migration de format au-delà de la version 1.
- [ ] **Persister les préférences d’affichage par projet**
  - couches visibles et opacité ;
  - mode Diff / A|B / Slider ;
  - options plans, textes, designators et pin 1.

## P1 — Qualité des données Altium

- [ ] **Stabiliser le contrat ADS**
  - documenter les champs obligatoires et optionnels ;
  - ajouter des exemples JSON minimaux valides ;
  - définir la stratégie de compatibilité entre versions de schéma.
- [ ] **Valider les exports avant comparaison**
  - contrôler les types et unités des coordonnées ;
  - détecter les identifiants, designators ou nets dupliqués ;
  - distinguer avertissement récupérable et erreur bloquante.
- [ ] **Améliorer la fidélité de la vue logique**
  - tester les composants multi-parties et les pins cachées ;
  - vérifier les ports hiérarchiques et connecteurs hors feuille ;
  - renforcer l’association TP ↔ net quand les données sont ambiguës.

## P2 — Distribution et maintenance

- [x] **Mettre en place l’intégration continue**
  - [x] lancer formatage, ESLint, Svelte Check, tests, benchmark et build ;
  - [x] publier les résultats sur chaque pull request ;
  - [x] conserver un artefact de build pour les versions taguées.
- [ ] **Préparer les paquets d’installation**
  - produire un installateur Windows signé ou clairement identifié non signé ;
  - définir icône, nom de produit, version et métadonnées ;
  - tester installation, mise à jour et désinstallation.
- [ ] **Définir une politique de version**
  - synchroniser application, exporteur et schémas ADS ;
  - maintenir un changelog ;
  - afficher les versions utiles dans les diagnostics et rapports.
- [ ] **Compléter l’accessibilité**
  - vérifier navigation clavier et focus des dialogues ;
  - vérifier contrastes des états de diff ;
  - ajouter les libellés manquants sur les commandes Canvas.
- [ ] **Préparer la localisation**
  - sortir les textes anglais/français des composants ;
  - choisir une langue par défaut ;
  - éviter les chaînes dupliquées dans les rapports et menus.

## Livré récemment

- [x] comparaison PCB partagée et mémoïsée ;
- [x] appariement linéaire des primitives et normalisation des polygones ;
- [x] plans communs neutralisés et sélections adaptées aux couches ;
- [x] slider PCB mis en cache hors écran ;
- [x] survol PCB limité à une frame ;
- [x] limites géométriques et tris par couche mis en cache ;
- [x] index spatial pour pads, pistes et composants ;
- [x] parsing JSON hors du thread d’interface ;
- [x] progression et protection contre les imports concurrents ;
- [x] comparaison logique et DXF synchronisée ;
- [x] revue globale avec commentaires, filtres et statistiques ;
- [x] sessions de revue JSON portables ;
- [x] rapports HTML/PDF avec captures et échappement sécurisé ;
- [x] documentation générale et diagrammes Mermaid ;
- [x] benchmark synthétique 10k/50k/100k et baseline documentée ;
- [x] workflow CI complet avec artefact pour les tags ;
- [x] paire de régression A/B transversale ;
- [x] comparaison DXF sémantique linéaire ;
- [x] profileur Canvas utilisable sur un PCB réel ;
- [x] réduction du pic mémoire de l’import natif ;
- [x] test d’intégration A→B et incompatibilité ;
- [x] instantanés de revue et sessions v2 rétrocompatibles ;
- [x] 32 tests unitaires validés.

## Règle de mise à jour

Lorsqu’une tâche est terminée :

1. cocher ses critères réellement livrés ;
2. déplacer l’élément dans « Livré récemment » si toute la tâche est terminée ;
3. mettre à jour le README si la fonction est visible par l’utilisateur ;
4. ajouter ou adapter les tests associés ;
5. exécuter `npm run check`, `npm run lint`, `npm test` et `npm run build`.
