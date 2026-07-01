# ADS Schematic JSON V2

The canonical exporter is `ExportDesignData_ADS.pas`. Project schematic exports
identify this extension as `ads-json-sch-v2`.

## Component data

Components include:

- stable `uniqueId`, designator, comment and library reference;
- source library, orientation, mirror state and part count;
- active component display mode;
- resolved `value` and `footprint`;
- every available custom parameter;
- location, text render hints, fallback bounds and pins.

## Pin data

Pins include:

- stable `uniqueId`, number, name and description;
- electrical connection location and orientation;
- native pin length and electrical type;
- owner part ID and owner display mode;
- hidden state and hidden net name;
- name/designator visibility flags.

The viewer uses `orientation` plus `length` to derive the symbol-side endpoint
of a pin and construct a tighter semantic fallback body.

## Connectivity objects

Wires preserve every vertex. Net labels preserve text, position, orientation,
justification and mirror state. Ports and power ports preserve their name and
position; their orientation is unavailable in the validated target scripting
interface. Junctions, buses, bus entries, No ERC markers,
directives, sheet symbols and sheet entries retain their stable containers.

## Sheet annotations

The optional `annotations` array contains non-electrical text placed directly
on a schematic sheet:

- `type: "text"` comes from native `eLabel / ISch_Label` objects and preserves
  source text, evaluated display text, position, orientation, justification,
  mirror state, font ID and color;
- `type: "textFrame"` comes from native `eTextFrame / ISch_TextFrame` objects
  and additionally preserves bounds, border, wrapping, clipping and alignment.

The viewer displays these objects in a separately switchable **Annotations**
layer. Annotation coordinates and frame bounds participate in automatic sheet
framing. Older exports without this array remain valid and normalize it to an
empty list.

## Hierarchy and repeated channels

Sheet symbols include their native `uniqueId`, `SheetName.Text` and
`SheetFileName.Text`. Sheet entries include their native name and the Unique ID
of their owning sheet symbol.

The viewer expands a sheet-symbol designator using the Altium syntax
`Repeat(Channel,First,Last)` into virtual instances such as `FR0`, `FR1`, `FR2`
and `FR3`. Every instance references the same child sheet definition; component
designators are resolved in the viewer as `<Designator>_<Channel>`.

## Known limitation

Native graphical primitives belonging to library symbols are still unavailable
in the validated target scripting environment. `symbolGraphics` therefore
remains a semantic fallback rather than an exact copy of the Altium symbol.

## Viewer-derived models

The viewer may reinterpret exported data instead of reproducing Altium pixels:

- duplicate pin numbers from alternate display modes are collapsed to the
  representation closest to the component anchor;
- passive symbols are generated from component family and semantic pins;
- Sheet Symbols are reconstructed from their anchor and owned Sheet Entries;
- a power graph is inferred from physical nets, pin names, component parameters
  and converter-family keywords.

Power-graph directions are heuristic and expose a confidence level. They are not
a replacement for electrical rule checking or explicit power-domain metadata.
