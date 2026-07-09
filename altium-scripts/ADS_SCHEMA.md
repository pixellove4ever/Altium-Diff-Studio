# ADS JSON Contract

The canonical exporter has been validated against this contract with Altium
Designer 26.7.1. Exports from other Altium versions are acceptable when they
respect the contract, but they are not yet validated on a broad real-world
corpus.

This document is the public contract between `ExportDesignData_ADS.pas` and
Altium Diff Studio.

Current document versions:

| Document  | `schemaVersion`   |
| --------- | ----------------- |
| PCB       | `ads-json-pcb-v2` |
| Schematic | `ads-json-sch-v2` |
| BOM       | `ads-json-bom-v1` |

## Common Envelope

Required:

- `type`: `pcb`, `schematic` or `bom`
- the required containers for the document type

Recommended:

- `exporter.scriptName`
- `exporter.scriptVersion`
- `exporter.schemaVersion`, the global exporter schema version
- `schemaVersion`, the document schema version
- `exporter.generatedAt` or `generatedAt`, as an ISO 8601 date

Unknown fields must be ignored. JSON property order has no meaning.

## PCB

Required containers: `components`, `tracks`, `pads`, `vias`, `layers`.

All required containers are arrays. Coordinates and dimensions are numbers in
millimetres, angles are degrees and layer names are Altium layer names.

Required primitive fields:

- component: `designator`, `comment`, `footprint`, `layer`, `x`, `y`,
  `rotation`
- track: `layer`, `start{x,y}`, `end{x,y}`, `width`
- pad: `designator`, `x`, `y`, `size{x,y}`, `shape`, `holeSize`, `layer`
- via: `x`, `y`, `diameter`, `holeSize`, `startLayer`, `endLayer`

Optional data includes stable identifiers, nets, component bounds, board
outline, arcs, polygons, texts, explicit net catalog and geometry extensions.
The legacy `pcbSchemaVersion` field remains accepted as an alias.

## Schematic

Project-level schematic exports require `sheets`. Each sheet requires
`components`, `wires` and `netLabels`. The historical single-sheet format
remains accepted with these three arrays at the document root.

Required fields:

- component: `designator`, `comment`, `libRef`, `x`, `y`, `pins`
- pin: `name`, `num`, `x`, `y`, `orientation`
- wire: `points`, or the `start` / `end` pair
- net label: `text`, `x`, `y`

Annotations, hierarchy, ports, buses, graphical items, parameters, multi-part
properties and stable identifiers are optional.

## BOM

The `items` array is required. Each item requires `designator`, `comment` and
`footprint`. Description, library reference, quantity and custom parameters are
optional.

## Relations And Identity

- PCB, schematic and BOM components are joined by case-insensitive
  `designator`.
- A pad joins its component through `component` and its schematic pin through
  `designator`.
- Copper objects are joined through case-insensitive `net` names.
- Array indexes and COM addresses must never be used as cross-export
  identities.

## Compatibility

Versions use the `ads-json-<type>-v<major>` form.

- Same major: optional fields or optional containers may be added; readers must
  ignore unknown data.
- New major: allowed for removals, renames or unit/semantic changes; the
  application must add a migration or reject with an explicit diagnostic.
- Exports without metadata: accepted in legacy mode with a warning.
- Missing optional arrays are normalized to empty arrays.
- `examples/minimal-*.json` are the smallest valid canonical documents and are
  checked by tests.

The application mirrors the current contract in `src/lib/domain/adsContract.ts`.
That helper classifies each document by the roles it currently carries:
design data, netlist data and graphical enrichment. These roles remain bundled
in the current document schemas, but they define the compatibility boundary for
a future split into separate contracts.

Extended details remain documented in `PCB_SCHEMA_V2.md` and
`SCHEMATIC_SCHEMA_V2.md`.
