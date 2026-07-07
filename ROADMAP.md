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

- [ ] **Recentrer l'application sur une visionneuse de projet**
  - [x] faire du mode par défaut une visionneuse simple de projet : schématique, PCB top/bottom 2D, Gerber, 3D et BOM ;
  - [x] remplacer l'écran principal par une disposition en deux zones : BOM minimaliste à gauche, visionneuse à droite ;
  - [x] limiter la BOM principale aux références/designators et à un état de sélection lisible ;
  - [x] synchroniser sélection BOM ↔ visionneuse : cliquer un composant dans la BOM centre/surligne la vue, cliquer dans la vue sélectionne la ligne BOM ;
  - [x] ajouter des onglets de vue inspirés de la simplicité tracespace/Altium Online Viewer : SCH, PCB, GERBER, 3D, BOM ;
  - [ ] prévoir top/bottom view 2D comme contrôles directs de la vue PCB.
- [ ] **Séparer le mode simple et le mode avancé**
  - [x] ajouter une coche ou un toggle `Mode avancé` ;
  - [ ] masquer par défaut les panneaux de diff, filtres, diagnostics, calques détaillés, review notes et options de rendu ;
  - [ ] conserver toutes les fonctions existantes derrière le mode avancé ;
  - [ ] persister le choix simple/avancé localement.
- [ ] **Transformer la comparaison en action secondaire**
  - [x] ajouter un bouton `Comparaison` visible depuis le viewer projet ;
  - [ ] permettre de charger une version B uniquement après activation de la comparaison ;
  - [ ] réutiliser le moteur actuel de comparaison PCB/SCH/BOM/DXF dans cette vue ;
  - [ ] garder un mode comparaison simple et un mode comparaison avancé.
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
- [x] **Enrichir le rapport de revue**
  - [x] ajouter les noms complets des fichiers et métadonnées d’export ;
  - [x] proposer un rapport filtré ou complet ;
  - [x] afficher les diagnostics importants et la couverture de revue ;
  - [x] ajouter une page de garde compacte pour le PDF.
- [x] **Exporter les différences de BOM sous forme de tableau**
  - [x] produire un CSV propre, directement exploitable dans Excel ou LibreOffice ;
  - [x] inclure statut, designator, valeurs A/B et liste des champs modifiés ;
  - [x] proposer l’export complet ou limité aux filtres actifs ;
  - [x] inclure les noms des projets, versions ADS et date d’export.
- [x] **Améliorer la gestion des sessions**
  - [x] proposer fusion ou remplacement lors de l’import ;
  - [x] afficher l’auteur et la date de dernière modification ;
  - [x] signaler précisément les entrées ignorées ;
  - [x] prévoir une migration de format au-delà de la version 1.
- [x] **Persister les préférences d’affichage par projet**
  - [x] couches visibles et opacité ;
  - [x] mode Diff / A|B / Slider ;
  - [x] options plans, textes, designators et pin 1.

## P1 — Qualité des données Altium

- [ ] **Ajouter une voie d'import native Altium**
  - [ ] lire directement les conteneurs OLE `.SchDoc` et extraire les streams `FileHeader` / `Additional` ;
  - [ ] convertir les records natifs en objets schématiques typés sans passer par le script `.pas` ;
  - [ ] préserver `OWNERINDEX`, `OWNERPARTID`, `CURRENTPARTID` et `DISPLAYMODE` pour les composants multi-parties ;
  - [ ] garder l'import JSON ADS comme chemin canonique tant que l'import natif n'est pas validé sur corpus réel.
- [ ] **Renforcer le compilateur de netlist schématique**
  - [ ] distinguer jonctions explicites, croisements visuels et connexions sur segment ;
  - [ ] gérer bus, bus entries, ports, off-sheet connectors, sheet symbols et sheet entries ;
  - [ ] mieux résoudre les paramètres, labels cachés et pins invisibles ;
  - [ ] documenter les diagnostics quand la connectivité native reste ambiguë.
- [ ] **Ajouter un rendu schématique fidèle en complément de la vue logique**
  - [ ] rendre grille, couleurs Altium, textes, pins, wires, power ports et primitives de symbole ;
  - [ ] comparer ce rendu avec DXF/PDF comme oracle visuel ;
  - [ ] conserver la vue logique pour l'analyse et la revue.
- [ ] **Versionner un contrat de design plus complet**
  - [ ] ajouter un champ `schema` explicite pour les futurs payloads de design/netlist ;
  - [ ] séparer les contrats `design`, `netlist` et enrichissements graphiques ;
  - [ ] prévoir une migration depuis le contrat ADS actuel.
- [ ] **Construire la visionneuse fabrication Gerber + ODB++**
  - [x] importer les fichiers Gerber/Drill par couche ;
  - [x] importer les packages ODB++ en parallèle de Gerber ;
  - [x] comparer d'abord les couches Gerber et lignes normalisées ;
  - [ ] parser ODB++ pour récupérer couches, perçages, composants, placements et nets ;
  - [ ] choisir ODB++ comme source prioritaire si sa couverture est suffisante ;
  - [ ] conserver Gerber comme fallback, puis supprimer la partie Gerber si ODB++ couvre totalement le besoin ;
  - [ ] évoluer ensuite vers une comparaison visuelle/structurelle par apertures, draws, flashes, drills et outline.
- [x] **Stabiliser le contrat ADS**
  - [x] documenter les champs obligatoires et optionnels ;
  - [x] ajouter des exemples JSON minimaux valides ;
  - [x] définir la stratégie de compatibilité entre versions de schéma.
- [x] **Valider les exports avant comparaison**
  - [x] contrôler les types et unités des coordonnées ;
  - [x] détecter les identifiants, designators ou nets dupliqués ;
  - [x] distinguer avertissement récupérable et erreur bloquante.
- [x] **Améliorer la fidélité de la vue logique**
  - [x] tester les composants multi-parties et les pins cachées ;
  - [x] vérifier les ports hiérarchiques et connecteurs hors feuille ;
  - [x] renforcer l’association TP ↔ net quand les données sont ambiguës.

## P2 — Distribution et maintenance

- [x] **Mettre en place l’intégration continue**
  - [x] lancer formatage, ESLint, Svelte Check, tests, benchmark et build ;
  - [x] publier les résultats sur chaque pull request ;
  - [x] conserver un artefact de build pour les versions taguées.
- [x] **Préparer les paquets d’installation**
  - [x] produire un installateur Windows signé ou clairement identifié non signé ;
  - [x] définir icône, nom de produit, version et métadonnées ;
  - [x] tester installation, mise à jour et désinstallation.
- [x] **Définir une politique de version**
  - [x] synchroniser application, exporteur et schémas ADS ;
  - [x] maintenir un changelog ;
  - [x] afficher les versions utiles dans les diagnostics et rapports.
- [x] **Compléter l’accessibilité**
  - [x] vérifier navigation clavier et focus des dialogues ;
  - [x] vérifier contrastes des états de diff ;
  - [x] ajouter les libellés manquants sur les commandes Canvas.
- [ ] **Préparer la localisation** _(infrastructure et écrans principaux couverts)_
  - [ ] sortir les textes anglais/français de tous les composants ;
  - [x] choisir le français comme langue par défaut ;
  - [x] éviter les chaînes dupliquées dans les rapports et menus.

## P3 — Visualisation mécanique 3D

- [ ] **Ajouter une visionneuse STEP**
  - charger localement les fichiers `.step` et `.stp` ;
  - convertir la géométrie hors du thread principal avec OpenCascade WASM ;
  - afficher, orienter, zoomer, couper et rendre les solides transparents ;
  - synchroniser la sélection BOM / PCB avec les solides lorsque les noms le permettent ;
  - proposer ensuite une comparaison mécanique A/B par superposition ou slider.

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
- [x] rapport enrichi, sessions v3 et préférences d’affichage par projet ;
- [x] contrat ADS, validation pré-comparaison et fidélité logique renforcée ;
- [x] installateur Windows NSIS non signé avec smoke test complet ;
- [x] export CSV complet ou filtré des différences BOM ;
- [x] politique de version, matrice synchronisée et changelog ;
- [x] navigation clavier, focus des dialogues et contrastes AA ;
- [x] disclaimer de compatibilité Altium Designer 26.7.1 ;
- [x] 53 tests unitaires validés.

## Règle de mise à jour

Lorsqu’une tâche est terminée :

1. cocher ses critères réellement livrés ;
2. déplacer l’élément dans « Livré récemment » si toute la tâche est terminée ;
3. mettre à jour le README si la fonction est visible par l’utilisateur ;
4. ajouter ou adapter les tests associés ;
5. exécuter `npm run check`, `npm run lint`, `npm test` et `npm run build`.
