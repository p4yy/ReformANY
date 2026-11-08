# Supported formats — ReformANY 0.3.0 preview

ReformANY is a local Windows converter with **specific, bounded routes**, not a universal file-format decoder. The table below describes what's implemented in the current source, not guaranteed fidelity for every file. Some routes need software installed separately.

## Images — built-in Rust engine

| Format | Read | Write | Important limit |
|---|---|---|---|
| PNG | Yes | Yes | Animated PNG rejected |
| JPEG / JPG | Yes | Yes | Lossy; transparency flattened |
| WebP | Yes | Yes | Animated WebP rejected; current encoder uses lossless output |
| BMP | Yes | Yes | Transparency flattened |
| GIF | Static only | Static only | Palette reduction; animated GIF rejected |
| TIFF / TIF | Single page | Single page | Multipage TIFF rejected |
| ICO | Single-image icons | Yes | Multi-resolution ICO inputs rejected; output max 256 × 256 |
| TGA | Yes | Yes | No dependable file signature; extension is checked |
| QOI | Yes | Yes | Basic raster route |
| SVG | Self-contained only | No | Rasterized to a supported image output; 5 MB input cap |
| AVIF | No | Preview output | AVIF output header verified; independent pixel-decoding verification not bundled |

Image conversions support downscaling without upscaling, 90°/180°/270° clockwise rotation, grayscale, and adjustable JPEG quality. Maximum **150 MiB per ordinary input**, **40 megapixels decoded**, 300 entries per batch and two conversion workers. SVG has a stricter 5 MiB input limit and blocks external references/active content.

The engine rejects animation, multiple TIFF pages and multiple ICO images instead of silently dropping them. It does **not** guarantee preservation of EXIF, ICC profiles, embedded color metadata, text layers, DPI, animation or editing history. Avoid relying on it for archival master files without checking results.

## Media — locally installed FFmpeg and FFprobe required

| Source | Output | Notes |
|---|---|---|
| FFmpeg-readable audio/video with supported audio stream | MP3, M4A, WAV, FLAC, OGG, Opus | The selected codec must exist in the installed FFmpeg build |
| FFmpeg-readable video with supported video stream | MP4, WebM, MKV, MOV, AVI | Output codecs and optional audio stream depend on the selected profile |
| Same media sources | Selected trim start and duration | Supports real timestamp-based progress when duration is known, plus cancellation |

The app passes **explicit codec/preset arguments**, not arbitrary user-provided FFmpeg commands. The separate Media tools workspace supports selected video/audio compression, audio normalization, video rotation/flips, compatible merges and metadata stripping. Media merging has format and stream constraints; it does not join arbitrary clips without re-encoding.

ReformANY **does not bundle FFmpeg**, promise a particular codec license, preserve all streams/metadata, or guarantee lossless video/audio conversion.

## Archives and file parts

| Operation | Engine | Scope |
|---|---|---|
| Create/extract ZIP, including password-protected AES ZIP | Built-in Rust ZIP engine | No separate 7-Zip installation required for regular ZIP |
| Create 7z, TAR, GZip, BZip2, XZ, WIM and eligible split archives | Installed 7-Zip CLI | Some archive types require a single source file; passwords and volumes have format restrictions |
| Create RAR | Installed WinRAR / Rar.exe | Proprietary third-party engine required |
| Extract supported other archive formats | Installed 7-Zip | Actual support follows the installed 7-Zip build |
| Split one file into `.001`, `.002` … plus JSON manifest | Built-in Rust file-parts engine | 1–4096 MiB parts, 999-part maximum, 16 GiB source cap |
| Join ReformANY numbered parts | Built-in Rust file-parts engine | Requires its JSON manifest; checks part size and SHA-256 before publication |

Archive extraction has bounded counts/sizes and traversal checks. **File parts are not compressed, encrypted, or interchangeable with arbitrary WinRAR/7-Zip volumes.** The checksum catches accidental damage, but is not a signed authenticity guarantee.

See [File splitting and joining](FILE_PARTS.md).

## Documents, e-books and data

| Route | Engine or requirement | Important limitations |
|---|---|---|
| Images → PDF | Built-in | Up to 200 pages; originals remain |
| Text-based PDF → TXT, Markdown, HTML | Built-in PDF parser | No OCR for scanned PDFs; complex page layout not preserved |
| Office documents → PDF | Local LibreOffice | Availability and rendering fidelity depend on installed LibreOffice |
| EPUB, MOBI, FB2, AZW3 and other selected book/document routes | Local Calibre `ebook-convert` | Not all format pairs work; DRM unsupported |
| SRT ↔ WebVTT | Built-in | Preserves supported timings and cue text; rejects unsupported styling, regions and positioning |
| CSV, TSV, JSON, XLSX → CSV, TSV, JSON, XLSX | Built-in | XLS/ODS can be imported; values only, first worksheet, no formulas, charts or formatting |
| PDF, TXT, Markdown reading | In-app document preview | Local preview only; specialized file formats are not generally previewable |

Spreadsheet source files are capped at **24 MiB**, **50,000 rows**, **128 columns** and **32,000 characters per cell**. Leading-zero text identifiers are preserved in supported routes. Spreadsheet values resembling executable formulas are guarded when written into CSV/TSV. Existing spreadsheets with important formulas, formatting or multiple sheets should be handled as **data extraction**, not an equivalent workbook conversion.

For plain text extracted from PDFs, scanned pages require separate OCR software; ReformANY does not silently claim to read images as text.

## Safety and release status

- Conversion and previews are local; there are no first-party file uploads or account requirements.
- Original files are preserved, and outputs are staged and saved with collision protection rather than overwriting existing files.
- Password-protected media and archive support varies by format and engine. Archive encryption does not apply to raw file parts.
- Windows 11 currently has a tested **classic** file/folder context-menu entry; it may appear under **Show more options**. Native top-level integration requires a trusted signed Windows package and remains unshipped.
- Automated Windows/Linux unit tests and Windows installer tests are not substitutes for real-user tests on actual files, peripherals and Explorer.

**Not yet general-purpose:** HEIC/HEIF, PSD, RAW photo files, animated or multipage image conversion, PDF OCR, professional metadata fidelity, arbitrary compressed file types, DRM removal, and a promise of converting any source into any output.

See the [engineering roadmap](ROADMAP.md), [privacy policy](PRIVACY.md) and [development verification](DEVELOPMENT.md) for future work and testing boundaries.
