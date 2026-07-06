# Exporter Altium Designer vers Altium Diff Studio

> **Compatibilité validée :** cet exporteur a été testé uniquement avec Altium
> Designer 26.7.1. Les autres versions ne sont pas encore garanties.

Ce dossier contient le script DelphiScript permettant d'exporter les données de conception d'Altium Designer dans le format JSON léger pris en charge par **Altium Diff Studio**.

## Exporteur canonique

La base officielle du projet est désormais `ExportDesignData_ADS.pas`.
Elle dérive de la V71 clean/stable, mais utilise maintenant un nom et un
versionnement stables. Les anciens exporteurs sont archivés dans
`old ADV export v1` et ne doivent plus servir de référence pour faire évoluer le
schéma JSON.

Le contrat commun, ses règles de compatibilité et ses exemples minimaux sont
décrits dans `ADS_SCHEMA.md`. Les extensions détaillées sont documentées dans
`PCB_SCHEMA_V2.md` et `SCHEMATIC_SCHEMA_V2.md`.

## Contenu

- **`ExportDesignData_ADS.pas`** : exporteur canonique du schéma, du PCB, de la
  nomenclature et du manifeste ADS.

---

## Guide d'installation dans Altium Designer

### Étape 1 : Ajouter le script dans Altium

1. Ouvrez **Altium Designer**.
2. Allez dans **File ➜ Open...** et sélectionnez le fichier `ExportDesignData.pas`.
3. Pour l'exécuter facilement, vous pouvez créer un projet de script (`.PrjScr`) dans Altium :
   - Allez dans **File ➜ New ➜ Project ➜ Script Project**.
   - Faites un clic droit sur le nouveau projet de script et sélectionnez **Add Existing to Project...**.
   - Ajoutez le fichier `ExportDesignData.pas`.

### Étape 2 : Exécuter le script manuellement

1. Ouvrez le document que vous souhaitez exporter dans Altium (un `.SchDoc` ou un `.PcbDoc`).
2. Allez dans le menu **File ➜ Run Script...** (ou double-cliquez sur la procédure dans le panneau de script).
3. Sélectionnez le projet de script et choisissez l'une des macros suivantes :
   - **`ExportActiveSchToJson`** : Exporte la feuille de schéma active vers un fichier `[Nom]_sch.json`.
   - **`ExportActivePcbToJson`** : Exporte le PCB actif vers un fichier `[Nom]_pcb.json` (avec composants, pastilles, pistes, etc.).
   - **`ExportProjectBomToJson`** : Scanne toutes les feuilles de schéma du projet, agrège les composants, extrait tous les paramètres personnalisés (Fabricant, MPN, etc.) et génère `[Nom]_bom.json`.

Les fichiers JSON seront automatiquement enregistrés **dans le même dossier** que votre projet Altium (`.PrjPcb`).

### Paquet ADS, Smart PDF et DXF schématique

L'export complet génère également `<Projet>_ads_manifest.json`. Ce manifeste
déclare les ressources BOM, PCB, schématique et le fichier visuel attendu :
`<Projet>_smart.pdf`. Depuis ADS-1.12, il déclare aussi le dossier
`<Projet>_schematic_dxf` contenant un DXF par feuille.

Pour un flux sans sélection manuelle, configurez un OutJob Altium avec :

1. une sortie **Schematic Prints** reliée à un conteneur PDF ;
2. un nom de sortie `<Projet>_smart.pdf` ;
3. le même dossier de sortie que `ExportDesignData_ADS.pas`.

Altium Diff Studio détecte automatiquement ce PDF lorsqu'un des JSON voisins
est chargé. Le bouton de chargement manuel reste uniquement un fallback.

Pour tester le rendu vectoriel, ajoutez au même OutJob une sortie
**AutoCAD dwg/dxf Schematic** :

1. choisissez **DXF ASCII**, de préférence AutoCAD 2013 ou 2018 ;
2. activez **Include Template** si le cartouche doit être visible ;
3. sélectionnez toutes les feuilles du projet ;
4. dirigez les fichiers vers `<Projet>_schematic_dxf`, à côté des JSON.

Le nom de chaque DXF doit idéalement reprendre celui du `.SchDoc`. L'application
détecte automatiquement les DXF voisins, les associe aux feuilles par leur nom,
puis les dessine localement. Elle accepte aussi les DXF déposés manuellement
avec les JSON.

---

## Automatisation et liaison (OutJob / Menus)

Pour automatiser l'export ou l'appeler en un clic :

### Option A : Lier le script à un bouton de menu / barre d'outils

1. Faites un clic droit sur la barre d'outils supérieure d'Altium et cliquez sur **Customize...**.
2. Cliquez sur **New** pour créer une nouvelle commande.
3. Dans les propriétés de la commande :
   - **Caption** : `Export Schématique JSON` (ou `Export PCB`, etc.).
   - **Process** : `ScriptingSystem:RunScript`
   - **Parameters** : `ProjectName=Chemin_Vers_Votre_Projet_Script.PrjScr|ProcName=ExportDesignData.pas>ExportActiveSchToJson`
4. Glissez-déposez cette commande personnalisée dans votre barre d'outils. Elle sera maintenant accessible en un clic !

### Option B : Lancement en ligne de commande (compatible batch post-OutJob)

Vous pouvez lancer les scripts en arrière-plan ou via une commande Windows (par exemple, appelée après la génération d'un OutJob) avec l'utilitaire d'Altium `DXP.EXE` :

```cmd
"C:\Program Files\Altium\AD24\DXP.EXE" -RScriptingSystem:RunScript(ProjectName="Chemin_Vers_Projet_Script.PrjScr",ProcName="ExportDesignData.pas>ExportProjectBomToJson")
```

---

## Format de sortie généré

Le script génère des fichiers structurés qui s'intègrent directement dans le comparateur :

- Les schémas incluent les composants, positions, broches et liaisons.
- Les PCB incluent les coordonnées absolues en millimètres (converties depuis les unités internes d'Altium) des pistes, vias, pads et composants.
- Les BOM regroupent automatiquement les composants par désignateur unique et exportent toutes les colonnes personnalisées de paramètres de votre schéma.
