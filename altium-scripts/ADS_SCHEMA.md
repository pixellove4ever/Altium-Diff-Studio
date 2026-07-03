# Contrat JSON ADS

Ce document est le contrat public entre `ExportDesignData_ADS.pas` et Altium
Diff Studio. Les versions courantes sont :

| Document    | `schemaVersion`   |
| ----------- | ----------------- |
| PCB         | `ads-json-pcb-v2` |
| Schématique | `ads-json-sch-v2` |
| BOM         | `ads-json-bom-v1` |

## Enveloppe commune

Obligatoire :

- `type` : `pcb`, `schematic` ou `bom` ;
- les conteneurs obligatoires du type de document.

Recommandé :

- `exporter.scriptName` ;
- `exporter.scriptVersion` ;
- `exporter.schemaVersion`, version générale de l’exporteur ;
- `schemaVersion`, version du document ;
- `exporter.generatedAt` ou `generatedAt`, date ISO 8601.

Les champs inconnus doivent être ignorés. L’ordre des propriétés JSON n’a aucune
signification.

## PCB

Conteneurs obligatoires : `components`, `tracks`, `pads`, `vias`, `layers`.
Tous sont des tableaux. Les coordonnées et dimensions sont des nombres en
millimètres, les angles sont en degrés et les noms de couches sont ceux
d’Altium.

Champs obligatoires des primitives :

- composant : `designator`, `comment`, `footprint`, `layer`, `x`, `y`,
  `rotation` ;
- piste : `layer`, `start{x,y}`, `end{x,y}`, `width` ;
- pad : `designator`, `x`, `y`, `size{x,y}`, `shape`, `holeSize`, `layer` ;
- via : `x`, `y`, `diameter`, `holeSize`, `startLayer`, `endLayer`.

Sont optionnels : identifiants, nets, limites de composants, contour de carte,
arcs, polygones, textes, catalogue de nets et extensions géométriques. Le champ
historique `pcbSchemaVersion` reste accepté comme alias.

## Schématique

Le format projet requiert `sheets`. Chaque feuille requiert `components`,
`wires` et `netLabels`. Le format historique à feuille unique reste accepté
avec ces trois tableaux à la racine.

Champs obligatoires :

- composant : `designator`, `comment`, `libRef`, `x`, `y`, `pins` ;
- pin : `name`, `num`, `x`, `y`, `orientation` ;
- fil : `points`, ou la paire `start` / `end` ;
- label de net : `text`, `x`, `y`.

Annotations, hiérarchie, ports, bus, graphiques, paramètres, propriétés
multi-parties et identifiants stables sont optionnels.

## BOM

Le tableau `items` est obligatoire. Chaque entrée requiert `designator`,
`comment` et `footprint`. Description, référence de bibliothèque, quantité et
paramètres personnalisés sont optionnels.

## Relations et identité

- les composants PCB, schématique et BOM sont reliés par `designator`, sans
  tenir compte de la casse ;
- un pad rejoint son composant via `component` et sa pin via `designator` ;
- les objets cuivre sont reliés par `net`, sans tenir compte de la casse ;
- les index de tableaux et adresses COM ne sont jamais des identifiants.

## Compatibilité

Les versions suivent la forme `ads-json-<type>-v<major>`.

- même major : ajout uniquement de champs ou conteneurs optionnels ; un lecteur
  doit ignorer ce qu’il ne connaît pas ;
- nouveau major : autorisé pour une suppression, un renommage ou un changement
  d’unité/sémantique ; l’application doit ajouter une migration ou refuser avec
  un diagnostic explicite ;
- exports sans métadonnées : acceptés en mode historique, avec avertissement ;
- les tableaux optionnels absents sont normalisés en tableaux vides ;
- les exemples `examples/minimal-*.json` constituent les plus petits documents
  canoniques valides et sont vérifiés par les tests.

Les détails étendus restent documentés dans `PCB_SCHEMA_V2.md` et
`SCHEMATIC_SCHEMA_V2.md`.
