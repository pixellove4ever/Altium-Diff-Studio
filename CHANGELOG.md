# Changelog

Notable changes are tracked here according to
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic
Versioning.

## Unreleased

### Added

- V1 release-candidate documentation snapshot covering installation, Altium
  OutJob setup, current workflows, known limitations and release health checks.
- Viewer-first workspace with compact source chips for LOGIC, BOM, PCB, DXF,
  PDF and ODB/fabrication views.
- Compare action that starts loading a second project version from the viewer.
- Gerber and drill file intake with normalized layer comparison.
- ODB++ package intake as the future preferred fabrication data source.
- Complete or filtered CSV export for BOM differences.
- Richer reports with metadata, diagnostics and review coverage.
- Review sessions v3 with merge, author metadata and migration.
- Per-project PCB display preferences.
- ADS schema contract and validation.
- Unsigned NSIS Windows installer and automated smoke test.

### Changed

- UI direction consolidated around the cleaner ODB++ light visual language for
  PCB, BOM, schematic, PDF and fabrication pages.
- V1 comparison scope clarified: PCB, logical/DXF schematic, BOM and
  layer-by-layer Gerber are in; PDF and full ODB++ comparison are out.
- Vias are visible by default again, rendered in a very subtle light gray.
- BOM-to-schematic navigation now includes zoom and selection halo.
- Logical-view fidelity improved for multi-part components and hidden pins.
- PCB component outlines are visible by default.
- The application icon now focuses on electronic-design comparison.

### Fixed

- Removed stale generated Electron Vite timestamp config from the tracked tree.
- Cleaned unused imports, dead assignments and misleading unused-variable
  comments found during the V1 pre-release pass.

## 0.0.1 - 2026-07-06

### Added

- First development version of Altium Diff Studio.
