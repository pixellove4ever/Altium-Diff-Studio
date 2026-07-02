# Altium Diff Studio

Application Electron locale pour inspecter et comparer des projets Altium
Designer.

## Pipeline

L'exporteur canonique
[`altium-scripts/ExportDesignData_ADS.pas`](altium-scripts/ExportDesignData_ADS.pas)
produit les données structurées :

- BOM JSON ;
- PCB JSON ;
- schématique JSON ;
- manifeste ADS.

Un OutJob Altium peut compléter ce paquet avec :

- un Smart PDF ;
- un DXF par feuille schématique.

Le JSON porte les relations électriques et les liens BOM/SCH/PCB. Les DXF
fournissent la représentation schématique fidèle. Le Smart PDF reste une vue de
référence optionnelle.

## Fonctions principales

- visualisation ou comparaison de deux versions ;
- navigation BOM, PCB et schématique ;
- recherche par designator, valeur, empreinte ou net ;
- liaison des composants et nets entre les trois vues ;
- rendu PCB multicouche avec transparence ;
- rendu schématique logique, DXF, JSON source ou Smart PDF ;
- détection automatique des artefacts placés près des JSON.

## Développement

```sh
npm install
npm run dev
```

Vérifications :

```sh
npm run check
npm run lint
npm run build
```

## Organisation

```text
altium-scripts/       exporteur DelphiScript et contrats JSON
electron/             processus principal et passerelle locale
src/lib/components/   vues BOM, PCB et schématique
src/lib/domain/       index projet et graphes logiques
src/lib/state/        chargement et état du workspace
src/lib/types/        modèle de données Altium
```

Les anciens exporteurs sont conservés uniquement dans
`altium-scripts/old ADV export v1`.
