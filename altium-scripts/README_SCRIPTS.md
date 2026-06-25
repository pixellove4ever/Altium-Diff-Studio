# Exporter Altium Designer vers Altium Diff Studio

Ce dossier contient le script DelphiScript permettant d'exporter les données de conception d'Altium Designer dans le format JSON léger pris en charge par **Altium Diff Studio**.

## Contenu

- **[ExportDesignData.pas](file:///c:/Users/Thomas%20LALLIER/Documents/%21Perso/Github/Altium-Diff-Studio/altium-scripts/ExportDesignData.pas)** : Le script principal contenant les procédures d'exportation pour le schéma actif, le PCB actif, et la nomenclature (BOM) du projet.

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
