# ADS PCB JSON V2

The canonical exporter is:

`ExportDesignData_ADS.pas`

Its exporter metadata identifies the extended format as `ads-json-pcb-v2`. Older
ADS JSON files remain accepted by the viewer; every V2 field added to the
TypeScript model is optional during import.

## Coordinate convention

- Coordinates and dimensions are JSON numbers expressed in millimetres.
- Coordinates are absolute Altium PCB document coordinates.
- Angles are expressed in degrees.
- The renderer owns the screen Y-axis inversion. Exported coordinates must not
  be inverted by individual primitive exporters.
- Layer names come from `Layer2String` and must be used consistently by every
  primitive.

## Stable relations

- BOM, schematic and PCB components join on case-insensitive `designator`.
- A PCB pad joins its component through `component` and its schematic pin
  through `designator` (the pad/pin number).
- Copper connectivity joins through the case-insensitive `net` name shared by
  pads, tracks, arcs, vias and polygons.
- Array indexes and Altium COM addresses are not cross-export identities.

## PCB document

Required legacy containers:

- `components`
- `tracks`
- `pads`
- `vias`
- `layers`

V2 geometry containers:

- `arcs`
- `polygons`
- `texts`
- `boardOutlineEdges`
- `boardOutlineRenderBounds`
- `nets` (optional explicit catalog; the viewer also derives it)

PCB texts may expose `role` as `designator`, `comment` or `text`, allowing the
viewer to control reference designators independently from other annotations.

V2 component additions:

- `baseDesignator`
- `bounds: { x1, y1, x2, y2 }`

V2 pad additions:

- `rotation`
- `pin1`
- `holeSizeX`
- `holeSizeY`
- `holeShape`
- `cornerRadius`

Supported pad shapes are `round`, `oval`, `rectangular`,
`rounded-rectangular` and `octagonal`. Supported drill shapes are `round`,
`rectangular` and `oblong`.

## Extraction status

The canonical exporter currently exports native components, component bounds,
tracks, arcs, pads, vias, visible PCB text, keepout-based outline diagnostics,
standalone copper regions and the rendered child regions of polygon pours.
Regions are flattened into the common `polygons` viewer container.

Fills, split planes and cutouts remain explicit empty containers until their
Altium API paths are validated on the target Altium version.
