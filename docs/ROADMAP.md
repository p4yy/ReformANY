# ReformANY delivery roadmap

This is an engineering plan, not a promise that every listed format works. Every adapter must have a tested conversion matrix and release notes.

## Current development snapshot — v1.0.0 release candidate (not published)

**Implemented in code:** Windows right-click Orbit (classic Explorer context menu), first-run welcome, native image conversions and basic image edits, native ZIP creation/extraction (including encrypted ZIP), native file split/join with SHA-256 verification, subtitle SRT↔WebVTT conversion, spreadsheet CSV/TSV/JSON/XLSX conversions with XLS/ODS import, and FFmpeg-based audio/video conversion with a bundled or installed local engine, depending on the build. Other archive, document, PDF and ebook routes have varying external-engine requirements. See [the format support matrix](FORMAT_SUPPORT.md) for exact supported directions, limits and dependencies.

**Automated validation:** Linux source verification, Rust tests, Windows build and installer smoke tests, including registration and removal of classic Explorer Orbit menu entries, passed on draft PR #19 (`cc28a355`) and must be rerun after any release merge to `main`. This does **not** prove real-world Windows GUI behavior, media fidelity, or native Windows 11 top-level menu support. The Windows installer is a preview and is not presented as signed.

## Remaining format and quality work

| Workstream | Current boundary | Next verification gate |
|---|---|---|
| Images | ICO/TGA/QOI and SVG→raster implemented; AVIF is **output only** | Independent decoder corpus, color profiles, transparency, animation/frame-loss and metadata policies |
| Archives | Native ZIP and split/join implemented; other routes depend on external tools | TAR/7Z coverage, archive bomb/symlink/traversal testing and independent readers |
| PDF and documents | Selected routes rely on installed external engines | Fidelity corpus, encrypted documents, font/layout checks and process isolation |
| Video and audio | A local FFmpeg is required (bundled in verified Windows test packages); progress and cancellation implemented | Real media corpus, codec/license review, timing, metadata and resource limits |
| Spreadsheets | CSV/TSV/JSON/XLSX and XLS/ODS import implemented with bounded first-sheet value handling | Formulas, multi-sheet fidelity, types, dates, encodings and large-file limits |
| Subtitles | SRT↔WebVTT implemented | Styling/positioning, alternate formats and timestamp fidelity |
| E-books and slides | Route-dependent external-engine support | DRM boundaries, renderer availability, page/layout fidelity |
| Windows shell | Classic Explorer menu installed and smoke-tested | Manual Explorer QA; modern Windows 11 native integration and mouse hooks remain **draft** until desktop QA and signing |
| Accessibility | Basic app interactions present | Keyboard-only Orbit, screen-reader announcements, focus order, high-contrast and DPI testing |

Implement further formats in tested vertical slices; do not claim universal conversion or archival fidelity until independently verified.

## Core engineering backlog

- Improve accessibility: focus order, keyboard-only Orbit, screen-reader status, high-contrast and DPI tests.
- Add in-app auto-update (only after signing and release provenance).
- Introduce versioned conversion history database with deletion/export controls.
- Thumbnail previews and per-file settings in batch queue.
- Expand measured progress beyond FFmpeg media jobs; keep indeterminate status when an engine cannot report progress.
- Improve color management and EXIF orientation before claiming archival fidelity.
- Add per-engine process sandbox/resource policies for untrusted PDF/media documents.
- Add code-signing, SBOM, dependency vulnerability scans, Windows clean-machine integration tests.

## Release criteria

- Green TypeScript and Rust compilation/tests on Windows and Linux
- Reproducible Windows NSIS output with artifact digest
- Manual Explorer context-menu installation/uninstall and drag-and-drop checks (automated registry smoke test already passes)
- Correct file outputs verified by independent readers
- No silent overwrite or invalid-success status
- Clear capability matrix and visible limitations
