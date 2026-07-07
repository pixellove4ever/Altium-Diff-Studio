# Changelog

Notable changes are tracked here according to
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic
Versioning.

## Unreleased

### Added

- Viewer-first workspace with a compact BOM rail and SCH, PCB, FAB, 3D and BOM tabs.
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

- Vias are visible by default again, rendered in a very subtle light gray.
- BOM-to-schematic navigation now includes zoom and selection halo.
- Logical-view fidelity improved for multi-part components and hidden pins.
- PCB component outlines are visible by default.
- The application icon now focuses on electronic-design comparison.

## 0.0.1 - 2026-07-06

### Added

- First development version of Altium Diff Studio.
