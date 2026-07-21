# Exporting From Altium Designer To Altium Diff Studio

> Validated compatibility: this exporter has currently been tested with Altium
> Designer 26.7.1 only. Other versions are not guaranteed yet.

This folder contains the DelphiScript exporter used to write Altium Designer
project data to the lightweight JSON format supported by Altium Diff Studio.

## Canonical Exporter

The maintained entry point is `ExportDesignData_ADS.pas`.

It derives from the clean/stable V71 exporter, but now uses stable naming and
versioning. Older exporters are archived in `old ADV export v1` and should not
be used as the reference for evolving the JSON schema.

The shared contract, compatibility rules and minimal examples are documented in
`ADS_SCHEMA.md`. Extended details are documented in `PCB_SCHEMA_V2.md` and
`SCHEMATIC_SCHEMA_V2.md`.

## Contents

- `ExportDesignData_ADS.pas`: canonical exporter for schematic, PCB, BOM and
  ADS manifest data.

## Installing The Script In Altium Designer

### Step 1: Add The Script

1. Open **Altium Designer**.
2. Go to **File > Open...** and select `ExportDesignData_ADS.pas`.
3. For easier execution, create a script project (`.PrjScr`) in Altium:
   - Go to **File > New > Project > Script Project**.
   - Right-click the new script project and select **Add Existing to Project...**.
   - Add `ExportDesignData_ADS.pas`.

### Step 2: Run The Script Manually

1. Open the document you want to export in Altium (`.SchDoc` or `.PcbDoc`).
2. Go to **File > Run Script...**, or double-click the procedure in the script
   panel.
3. Select the script project and choose one of these macros:
   - `ExportActiveSchToJson`: exports the active schematic sheet to
     `[Name]_sch.json`.
   - `ExportActivePcbToJson`: exports the active PCB to `[Name]_pcb.json`,
     including components, pads, tracks and related data.
   - `ExportProjectBomToJson`: scans all schematic sheets in the project,
     aggregates components, extracts custom parameters such as manufacturer and
     MPN, and writes `[Name]_bom.json`.

JSON files are written next to the Altium project (`.PrjPcb`).

## ADS Package, Smart PDF And Schematic DXF

The full export also writes `<Project>_ads_manifest.json`. This manifest
declares BOM, PCB, schematic and the expected visual reference file:
`<Project>_smart.pdf`. Since ADS-1.12, it also declares the
`<Project>_schematic_dxf` folder containing one DXF per sheet.

For a no-manual-selection workflow, configure an Altium OutJob with:

1. a **Schematic Prints** output connected to a PDF container
2. the output name `<Project>_smart.pdf`
3. the same output folder as `ExportDesignData_ADS.pas`

Altium Diff Studio automatically detects this PDF when one of the neighboring
JSON files is loaded. Manual PDF loading remains available as a fallback.

To test vector rendering, add an **AutoCAD dwg/dxf Schematic** output to the
same OutJob:

1. choose **DXF ASCII**, preferably AutoCAD 2013 or 2018
2. enable **Include Template** if the title block should be visible
3. select every sheet in the project
4. write files to `<Project>_schematic_dxf`, next to the JSON files

Each DXF should ideally be named after its `.SchDoc`. The application detects
neighboring DXF files, matches them to sheets by name and renders them locally.
Manually dropped DXF files are also accepted alongside the JSON files.

## Recommended OutJob

The most reliable workflow is to generate one export folder per project version
and keep every ADS-related file in that folder. The script provides the OutJob
entry points expected by Altium: `Configure`, `PredictOutputFileName`,
`PredictOutputFileNames`, `Generate`, `RunScript` and `Run`.

Expected folder layout:

```text
<Project>_bom.json
<Project>_pcb.json
<Project>_schematic.json
<Project>_ads_manifest.json
export_design_data_debug.txt
<Project>_smart.pdf
<Project>_schematic_dxf/
  <SheetName>.dxf
Gerber/drill outputs, for example GTL, GBL, GTS, GBS, GM1, GD1, G1...
Optional ODB++ package
```

Recommended OutJob entries:

1. **ADS JSON script output**
   - Add `ExportDesignData_ADS.pas` to a Script Project (`.PrjScr`).
   - Add a script output to the OutJob.
   - Select the ADS script and call `Generate` or `Run`.
   - Leave parameters empty to export the full JSON package.
   - Use `PCB`, `SCH` or `BOM` only when you intentionally want a partial export.
2. **Smart PDF**
   - Add **Schematic Prints**.
   - Connect it to a PDF output container.
   - Name the file `<Project>_smart.pdf`.
   - Output it next to the JSON files.
3. **Schematic DXF**
   - Add **AutoCAD dwg/dxf Schematic**.
   - Select all schematic sheets.
   - Prefer ASCII DXF, AutoCAD 2013 or 2018.
   - Output into `<Project>_schematic_dxf`.
   - Use sheet-based filenames when possible, for example `TOP.dxf` for
     `TOP.SchDoc`.
4. **Gerber and drill**
   - Add **Gerber Files** and **NC Drill Files**.
   - Output them next to the JSON files or in a fabrication subfolder that is
     loaded with the project.
   - ADS accepts common Altium names and numeric layers such as `GTL`, `GBL`,
     `GTS`, `GBS`, `GTP`, `GBP`, `GTO`, `GBO`, `GM1..GM16`, `G1..G16`, `GD1`,
     `GG1` and `APR`.
5. **ODB++ optional**
   - Add an ODB++ output if you want viewer-side package inspection.
   - ODB++ comparison is intentionally not part of the V1 workflow because large
     packages are memory-heavy.

For comparison, export version A and version B with the same OutJob settings.
The application can tolerate missing optional files, but matching folder
structure and file naming make automatic pairing much more reliable.

## Automation And OutJob/Menu Integration

### Option A: Attach The Script To A Menu Or Toolbar Button

1. Right-click Altium's top toolbar and select **Customize...**.
2. Click **New** to create a new command.
3. In the command properties:
   - **Caption**: `Export Schematic JSON`, `Export PCB JSON`, etc.
   - **Process**: `ScriptingSystem:RunScript`
   - **Parameters**:
     `ProjectName=Path_To_Your_Script_Project.PrjScr|ProcName=ExportDesignData_ADS.pas>ExportActiveSchToJson`
4. Drag the custom command into the toolbar.

### Option B: Command-Line Launch

You can run scripts in the background or from a Windows command, for example
after OutJob generation, with Altium's `DXP.EXE`:

```cmd
"C:\Program Files\Altium\AD24\DXP.EXE" -RScriptingSystem:RunScript(ProjectName="Path_To_Script_Project.PrjScr",ProcName="ExportDesignData_ADS.pas>ExportProjectBomToJson")
```

## Generated Output

The script generates structured files that can be loaded directly by the
viewer/comparator:

- Schematics include components, positions, pins and connectivity.
- PCBs include absolute coordinates in millimetres, converted from Altium
  internal units, for tracks, vias, pads and components.
- BOM data is grouped by unique designator and includes all custom schematic
  parameter columns available to the exporter.
