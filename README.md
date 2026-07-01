# ADS — Altium Design Suite Viewer & Comparator

ADS est une application locale permettant de visualiser et de comparer deux projets Altium à partir des fichiers JSON produits par l’exporteur DelphiScript.

L’application ne communique jamais directement avec Altium. Elle exploite uniquement les exports BOM, schématiques et PCB.

## Développement

```sh
npm install
npm run dev
```

Commandes disponibles :

```sh
npm run check
npm run lint
npm run build
```

## Spécification fonctionnelle

Version 1.0

### 1. Objectif

ADS permet de comparer :

- la BOM ;
- le schématique ;
- le PCB ;
- et de naviguer entre ces trois représentations.

### 2. Architecture générale

```text
                 Altium
                    │
         Exporteur DelphiScript
                    │
      ┌─────────────┼─────────────┐
      │             │             │
  BOM.json      SCH.json      PCB.json
      │             │             │
      └─────────────┼─────────────┘
                    │
              ADS Viewer
                    │
           Comparateur IA
```

Le Viewer ne connaît que les fichiers JSON.

### 3. Principe général

Chaque projet possède une BOM, un schématique et un PCB. Le lien principal entre ces données est le `Designator`.

```text
R125
  ├── BOM
  ├── SCH
  └── PCB
```

### 4. Structure interne

Le Viewer charge les trois fichiers puis construit :

```text
Project
  ├── Sheets
  ├── Components
  ├── Nets
  ├── PCB
  └── BOM
```

### 5. Données BOM

Chaque entrée contient au minimum :

- `Designator`
- `Value`
- `Comment`
- `Footprint`
- `Manufacturer`
- `PartNumber`
- `Supplier`
- `Description`

La BOM ne contient aucune information graphique.

### 6. Données schématiques

Une feuille contient :

- `Components`
- `Pins`
- `Wires`
- `Ports`
- `PowerPorts`
- `NetLabels`
- `SheetSymbols`
- `SheetEntries`

### 7. Composant schématique

Le composant est l’objet principal. Il contient :

- `Designator`
- `Comment`
- `Value`
- `BoundingBox`
- `Pins[]`
- `Parameters[]`
- `Rotation`
- `Mirror`
- `UniqueID`

Le `BoundingBox` est calculé par le fallback et n’est pas dessiné par Altium.

### 8. Pin

Chaque pin possède :

- un propriétaire ;
- un numéro ;
- un nom ;
- une position ;
- une orientation ;
- une longueur.

Les positions des pins sont considérées comme exactes.

### 9. Wire

Un wire possède un point de départ et un point d’arrivée. Le Viewer l’affiche sous forme de ligne.

### 10. NetLabel

Un `NetLabel` possède un texte et une position. Le Viewer affiche ce texte à la position exportée.

### 11. Port

Un port possède un nom, une position et une orientation.

### 12. PowerPort

Un `PowerPort` possède un type et une position.

### 13. SheetSymbol

Un `SheetSymbol` est représenté par un rectangle et contient des entrées.

### 14. SheetEntry

Une `SheetEntry` possède un nom et une position.

### 15. PCB

Le PCB contient :

- les composants ;
- les pads ;
- les pistes ;
- les vias ;
- les polygones ;
- les textes ;
- les rooms.

### 16. Relations

Toutes les relations BOM/SCH/PCB sont basées sur le `Designator`.

### 17. Navigation

Cliquer sur un composant le sélectionne dans les vues schématique, PCB et BOM.

### 18. Sélection

Une sélection entraîne :

- la mise en évidence du composant ;
- le zoom vers le composant ;
- l’affichage de ses informations ;
- l’affichage de sa comparaison.

### 19. Comparaison

Lorsque deux projets A et B sont chargés, le Viewer construit l’union de leurs designators puis détermine les ajouts, suppressions et modifications.

### 20. Comparaison BOM

Les champs comparés sont :

- `Value`
- `Comment`
- `Footprint`
- `Manufacturer`
- `PartNumber`

### 21. Comparaison schématique

Les éléments comparés sont :

- la position ;
- les pins ;
- les nets ;
- la rotation ;
- le miroir ;
- les ports ;
- les labels.

### 22. Comparaison PCB

Les éléments comparés sont :

- la position ;
- la rotation ;
- la couche ;
- les pads ;
- les pistes ;
- les vias.

### 23. Couleurs

| Couleur | Signification |
| --- | --- |
| Vert | Ajout |
| Rouge | Suppression |
| Orange | Modification |
| Bleu | Sélection |
| Gris | Identique |

### 24. Recherche

La recherche instantanée porte sur :

- le designator ;
- la valeur ;
- le commentaire ;
- le net ;
- l’empreinte ;
- le fabricant.

### 25. Filtrage

Les filtres couvrent :

- les résistances ;
- les condensateurs ;
- les circuits intégrés ;
- les connecteurs ;
- les composants de puissance ;
- les points de test ;
- les nets ;
- le PCB.

### 26. Vue schématique

Ordre de rendu :

1. wires ;
2. composants ;
3. pins ;
4. labels ;
5. ports ;
6. sélection.

### 27. Vue PCB

Ordre de rendu :

1. cuivre ;
2. pads ;
3. pistes ;
4. textes ;
5. sélection.

### 28. Vue BOM

La BOM est affichée dans une table triable avec des colonnes configurables et une recherche instantanée.

### 29. Performance

Objectifs pour un projet de 700 composants :

- chargement inférieur à une seconde ;
- navigation à 60 FPS ;
- zoom fluide.

### 30. Historique COM

Le Viewer ne doit pas tenter de reconstruire les symboles Altium.

Les essais menés entre les versions V40 et V71 ont démontré que l’API DelphiScript de la version d’Altium ciblée ne fournit pas de géométrie exploitable pour les primitives graphiques (`ISch_Line`, `ISch_Rectangle`, `ISch_Arc`, etc.). Les propriétés telles que `Location`, `Corner`, `BoundingRectangle`, `StartLocation`, `EndLocation`, `Radius` ou `Vertex` ont échoué à la compilation ou renvoyé des données inutilisables.

Le symbole schématique doit donc être représenté par un rectangle calculé à partir des pins (`pinBoundsFallback`). Ce choix est volontaire, documenté et constitue la référence pour l’application.

### 31. Architecture logicielle

L’architecture recommandée sépare les responsabilités :

```text
                 UI
                  │
          ViewModels / Store
                  │
       Domain (Project, Sheet, Net…)
                  │
      JSON Import / Export Layer
                  │
           Fichiers JSON
```

Le domaine métier ne doit jamais dépendre du framework graphique.

### 32. Modèle de données interne

Le cœur de l’application manipule des objets typés plutôt que les JSON bruts :

```text
Project
  ├── Sheet[]
  ├── Component[]
  ├── Net[]
  ├── BomItem[]
  └── PcbBoard
```

Chaque objet possède un identifiant stable, tel que le `Designator` ou le `UniqueID`, utilisé pour les liens et les comparaisons.
