# Version Policy

`versions.json` is the reference matrix for versions that are distributed
together. A test verifies that it stays consistent with the application, the
exporter, ADS schemas and review-session format.

## Application

Altium Diff Studio follows Semantic Versioning:

- `MAJOR`: user-visible compatibility break or major removal
- `MINOR`: backward-compatible feature
- `PATCH`: backward-compatible fix

A Git tag named `vX.Y.Z` must match the `package.json` version exactly. The tag
triggers Windows installer creation.

## Exporter

The exporter uses `ADS-MAJOR.MINOR.PATCH`. Its version may evolve independently
from the application, but every application release explicitly references the
tested exporter version in `versions.json`.

## ADS Schemas

Schemas use `ads-json-<type>-v<major>`.

- The same major version may add optional fields or optional containers.
- Removing, renaming or changing the unit/meaning of a field requires a new
  major version and an application-side migration.
- Older exports remain accepted as long as a documented migration exists.

## Review Sessions

The review-session format is an integer. Each new version must read and migrate
still-supported older versions. A session from a future version is rejected with
an explicit diagnostic.

## Release Procedure

1. Update `versions.json` and the matching source files.
2. Move entries from `Unreleased` to a dated version in `CHANGELOG.md`.
3. Run formatting, lint, check, tests, benchmark and build.
4. Test the Windows installer.
5. Create the `vX.Y.Z` tag.
