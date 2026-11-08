# ReformANY delivery roadmap

This is an engineering plan, not a promise that every listed format works. Every adapter must have a tested conversion matrix and release notes.

## Current release — 0.3.0 preview

**Implemented in code:** Static PNG / JPEG / WebP / BMP / GIF / single-page TIFF, image downscaling, rotation, grayscale, batch conversion, no-overwrite saving, folder import, local history, and Windows right-click Orbit.

**Validation:** CI covers build, format test matrix and safety cases. Real Windows desktop user acceptance still pending; Orbit layout, shell integration, and media fidelity need real-world QA.

## Next format engines, in priority order

| Workstream | Deliverable | Quality / licensing gates |
|---|---|---|
| Images II | AVIF, ICO, SVG→raster, TGA, QOI, selected metadata policies | Color profiles, transparency, no silent animation/frame loss, real sample corpus |
| Archives | ZIP creation/extraction, TAR, 7Z; folder packaging | Zip-slip, symlink policy, decompression-bomb limits, archive entry limits |
| PDF | PDF→images/text, images→PDF, merge/split, rotation | Font embedding, layout fidelity, encrypted PDFs, security sandbox |
| Video | MP4/WebM/MKV/MOV with codec-specific presets | FFmpeg capability/license audit, hardware encoding fallback, process isolation, test media |
| Audio | MP3/WAV/FLAC/Opus/AAC/OGG transcoding and trimming | Codec availability, sample accuracy, loudness tests, metadata |
| Documents | DOCX/ODT/RTF/HTML/Markdown to PDF/text and supported reverse routes | LibreOffice/other engine isolation, fidelity corpus, preserve originals |
| Slides | PPTX/ODP to PDF/images; editable import where feasible | Rendering differences and Office dependencies explicitly exposed |
| Spreadsheets | XLSX/CSV/TSV/ODS/JSON with typed data handling | Formulas, leading zeros, date parsing, encodings, sheets |
| Subtitles | SRT/VTT/ASS/TXT conversions with timing retention | Timestamp precision, encoding and styling differences |
| E-books/comics | EPUB/MOBI/CBZ/CBR/XPS, route dependent | DRM restrictions, supported decoder availability, page fidelity |
| Folders | ZIP/TAR/7Z export, safe restore | Permissions and traversal limits |

Implement in vertical slices, only adding a format to the application UI once the engine reports a tested route. Never advertise "100+ formats" until independently verified.

## Core engineering backlog

- Improve accessibility: focus order, keyboard-only Orbit, screen-reader status, high-contrast and DPI tests.
- Add in-app auto-update (only after signing and release provenance).
- Introduce versioned conversion history database with deletion/export controls.
- Thumbnail previews and per-file settings in batch queue.
- Actual progress percentages for engines reporting byte/frame progress; keep indeterminate otherwise.
- Improve color management and EXIF orientation before claiming archival fidelity.
- Add per-engine process sandbox/resource policies for untrusted PDF/media documents.
- Add code-signing, SBOM, dependency vulnerability scans, Windows clean-machine integration tests.

## Release criteria

- Green TypeScript and Rust compilation/tests on Windows and Linux
- Reproducible Windows NSIS output with artifact digest
- Manual explorer context menu installation/uninstall check
- Correct file outputs verified by independent readers
- No silent overwrite or invalid-success status
- Clear capability matrix and visible limitations
