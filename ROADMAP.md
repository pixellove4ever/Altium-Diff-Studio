# Roadmap

This file is the source of truth for remaining work. It is organized by
priority rather than by date.

Legend:

- `[ ]` to do
- `[x]` delivered and validated

## P0 - Reliability And Performance - Mostly Complete

- [x] **Create a representative regression set**
  - [x] add a small versioned A/B pair for PCB, schematic and BOM
  - [x] cover common, added, removed and modified objects
  - [x] make display and comparison defects easy to reproduce
- [x] **Add large-board synthetic benchmarks**
  - [x] generate 10k, 50k and 100k primitive PCB pairs
  - [x] measure diff, spatial index and render-preparation costs
  - [x] set thresholds wide enough to detect real regressions
- [x] **Profile rendering on a large real PCB**
  - [x] measure zoom, pan, hover, net selection and slider scenarios
  - [x] display average, maximum, last frame and sample count
  - [x] allow counters to be reset between scenarios
- [ ] **Harden very large project imports**
  - [x] show import progress and ignore stale import results
  - [x] serialize native file reads and avoid explicit buffer copies
  - [ ] stream or chunk very large JSON/fabrication files when useful
- [x] **Add an A-then-B loading integration test**
  - [x] verify the transition from A-only workspace to comparable A/B workspace
  - [x] verify that the diff is immediately usable
  - [x] preserve the workspace when B is incompatible
- [x] **Close first audit reliability quick fixes**
  - [x] use consistent `$lib` imports in PCB geometry helpers
  - [x] replace fragile schematic pin `JSON.stringify` comparison with a stable semantic signature
  - [x] index PCB pads by component and pin when building the project index
  - [x] tighten signed power-net detection so signal names like `+IN` stay visible
  - [x] share closed-shape minimal-rotation logic between PCB and DXF diffing
  - [x] add a spatial segment index for schematic labels and pins placed on wires
  - [x] expand report CSS into a maintainable stylesheet template
  - [x] add regression tests for schematic pin comparison and project pin connections

## P1 - Viewer-First Product Direction

- [x] **Make the application primarily a project viewer**
- [x] **Clean up the application architecture before larger features**
- [x] **Separate simple and advanced modes**
- [x] **Turn comparison into a secondary action**

## P1 - Fabrication Viewer

- [x] **Build the Gerber + ODB++ fabrication workflow**
  - [x] import Gerber and drill files by layer
  - [x] import ODB++ packages alongside Gerber
  - [x] open the FAB tab automatically when fabrication data is the only loaded input
  - [x] compare Gerber layers through normalized line content
  - [x] render Gerber visually by layer
  - [x] parse ODB++ packages to extract layers, drills, components, placements and nets
  - [x] use ODB++ as the preferred source when it provides enough coverage
  - [x] keep Gerber as a fallback while ODB++ coverage is being validated
  - [x] evolve toward visual/structural comparison by apertures, draws, flashes, drills and outline

## P1 - Review And Comparison

- [x] **Add snapshots to review comments**
  - [x] capture and compress the visible PCB or schematic area
  - [x] attach, replace or remove an image from a component or net comment
  - [x] include snapshots in local storage, review sessions and reports
  - [x] migrate v1 sessions and filter unsafe image sources
- [x] **Make DXF comparison semantic**
  - [x] match lines, arcs, circles and texts after block resolution
  - [x] neutralize common primitives in gray and color actual changes
  - [x] synchronize logical and DXF schematic selection
- [x] **Improve reports**
  - [x] add full file names and exporter metadata
  - [x] include diagnostics and review coverage
  - [x] offer filtered and complete reports
- [x] **Export BOM differences as a table**
  - [x] include status, designator, A/B values and changed fields
  - [x] support complete export or export limited to active filters
- [x] **Improve review sessions**
  - [x] show author and last modification date
  - [x] report ignored entries precisely
  - [x] provide migration beyond format version 1
- [x] **Persist PCB display preferences per project**
  - [x] visible layers and opacity
  - [x] comparison mode
  - [x] rendering options

## P1 - Altium Data Quality

- [ ] **Use the reference parser work to improve native import**
  - [ ] convert native records into typed schematic objects without relying only on the `.pas` script
  - [ ] preserve `OWNERINDEX`, `OWNERPARTID`, `CURRENTPARTID` and `DISPLAYMODE` for multi-part components
  - [ ] keep ADS JSON as the canonical path until native import is validated on real projects
- [ ] **Strengthen the schematic netlist compiler**
  - [ ] handle buses, bus entries, ports, off-sheet connectors, sheet symbols and sheet entries
  - [ ] better resolve parameters, hidden labels and invisible pins
  - [ ] document diagnostics when native connectivity remains ambiguous
- [ ] **Add faithful schematic rendering alongside the logical view**
  - [ ] preserve enough geometry to render Altium-like sheets
  - [ ] keep the logical graph for navigation and semantic comparison
  - [x] add fast previous/next navigation across schematic sheets in viewer and compare modes
- [ ] **Prepare a future ADS schema split**
  - [ ] separate design data, netlist data and graphical enrichment contracts
  - [ ] provide migration from the current ADS contract
- [x] **Validate exports before comparison**
  - [x] check coordinate types and units
  - [x] detect duplicated identifiers, designators and nets
  - [x] distinguish recoverable warnings from blocking errors
- [x] **Improve logical-view fidelity**
  - [x] cover multi-part components and hidden pins
  - [x] verify hierarchical ports and off-sheet connectors
  - [x] strengthen ambiguous testpoint/net association

## P2 - Packaging, CI And Accessibility

- [x] **Set up continuous integration**
  - [x] run formatting, lint, check, tests and build
  - [x] publish results on pull requests
  - [x] keep a build artifact for tagged versions
- [x] **Prepare install packages**
  - [x] produce a clearly identified unsigned Windows installer
  - [x] define icon, product name, version and metadata
  - [x] test install, update and uninstall flows
- [x] **Define a version policy**
  - [x] synchronize application, exporter and ADS schemas
  - [x] document release steps
- [x] **Complete baseline accessibility**
  - [x] verify keyboard navigation and dialog focus
  - [x] verify diff-state contrast
  - [x] add missing labels on Canvas controls
- [ ] **Prepare localization**
  - [ ] extract English/French UI strings from components
  - [ ] switch repository documentation to English
  - [x] avoid duplicated strings in reports and menus

## P3 - 3D Mechanical View

- [ ] **Add a STEP viewer**
  - [ ] load `.step` and `.stp` files locally
  - [ ] convert geometry off the main thread with OpenCascade WASM
  - [ ] synchronize BOM/PCB selection with solids when names allow it
  - [ ] later add A/B mechanical comparison through overlay or slider

## Recently Delivered

- [x] viewer-first workspace with BOM rail and SCH/PCB/FAB/3D/BOM tabs
- [x] load-screen accepted-format guidance for ADS JSON, Smart PDF, DXF, Gerber, ODB++ and archives
- [x] project-viewer architecture split into `ProjectShell`, `ViewerHost`, `importStore` and `viewerStore`
- [x] simple/advanced mode split with advanced controls hidden by default
- [x] minimal PCB mode limited to Top/Bottom side inspection while advanced mode keeps layer browsing
- [x] comparison moved behind a secondary project-viewer action
- [x] shared and memoized PCB comparison
- [x] linear primitive matching and polygon normalization
- [x] common plane neutralization and layer-aware selections
- [x] cached offscreen PCB slider rendering
- [x] hover hit-testing limited to one frame
- [x] cached geometry bounds and layer sorting
- [x] synchronized logical and DXF comparison
- [x] HTML/PDF reports with snapshots and safe escaping
- [x] general documentation and Mermaid diagrams
- [x] 10k/50k/100k synthetic benchmark with documented baseline
- [x] cross-domain A/B regression pair
- [x] semantic DXF comparison
- [x] usable Canvas profiler for large real PCBs
- [x] reduced native-import memory peak
- [x] A-to-B integration test and incompatible-B handling
- [x] review snapshots and backward-compatible v2 sessions
- [x] richer reports, v3 sessions and per-project display preferences
- [x] ADS contract, pre-comparison validation and improved logical fidelity
- [x] unsigned NSIS Windows installer with smoke test
- [x] complete or filtered BOM diff CSV export
- [x] version policy, synchronized matrix and changelog
- [x] Altium Designer 26.7.1 compatibility disclaimer
- [x] default vias restored with very subtle light-gray rendering
- [x] initial Gerber diff and ODB++ package intake
- [x] direct PCB All/Top/Bottom layer controls with project preference persistence
- [x] per-project viewer tab persistence across PCB/SCH/FAB/BOM
- [x] `GerberViewer` renamed to `FabricationViewer` for the Gerber + ODB++ workflow
- [x] fast schematic sheet previous/next navigation for review and comparison
- [x] audit quick fixes for schematic pin diffing, project pin indexing and PCB geometry imports
- [x] clean `svelte-check` warnings and confirm simple/advanced preference persistence
- [x] viewer-to-compare transition now preserves loaded A and prompts only for candidate B
- [x] tightened power-net heuristics and shared minimal-rotation geometry helper
- [x] faster schematic wire point resolution and maintainable review report styles
- [x] first visual Gerber layer preview from apertures, draws and flashes
- [x] ODB++ zip/tar/tgz entry inventory surfaced in the FAB tab
- [x] first ODB++ tar/tgz text extraction for feature, component and net summaries
- [x] ODB++ zip text extraction for feature, component and net summaries
- [x] ODB++ deflated zip text extraction covered by regression tests
- [x] ODB++ layer family classification for fabrication summaries
- [x] Gerber circular interpolation approximated in visual layer previews
- [x] Gerber full-circle interpolation covered in visual layer previews
- [x] ODB++ feature files summarized by primitive type per fabrication layer
- [x] ODB++ structural layer browser with placement/net extraction and Gerber fallback
- [x] first ODB++ structural A/B diff for layers, components, placements and nets
- [x] first visual ODB++ layer preview with colored layer-family rendering
- [x] visual ODB++ primitive diff counts surfaced by fabrication layer
- [x] minimal ODB++ board view focused on signal layers, outline, drills and components
- [x] ODB++ preview primitives classified as pads, tracks, arcs, surfaces, drills and outline
- [x] first visual ODB++ board diff overlay for added and removed primitives
- [x] ODB++ component placement diff overlay for added, changed and removed components
- [x] logical schematic net merging for same-name labels, off-sheet connectors and hidden pins
- [x] project net index now includes sheet entries and schematic hidden-pin nets
- [x] shared schematic connectivity helper for active pins, explicit anchors and net cataloging
- [x] schematic connectivity diagnostics for ambiguous names, unresolved buses and sheet-entry ownership
- [x] viewer BOM hides non-mounted and mechanical items while preserving them in comparison

## Update Rule

When a task is completed:

1. Check only the criteria that are actually delivered.
2. Move the item to Recently Delivered if the full task is complete.
3. Update the README if the feature is user-visible.
4. Add or adapt the related tests.
5. Run `npm run check`, `npm run lint`, `npm test` and `npm run build`.
