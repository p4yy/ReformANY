# Format support — image milestone

The Rust engine implements conversion between six **single-image raster formats**. All 36 input/output routes have automated tests. This is not the full universal-conversion roadmap.

| Format | Input | Output | Limitations |
|---|---|---|---|
| PNG | Yes | Yes | Animated PNG rejected |
| JPEG | Yes | Yes | Lossy; transparency composited on selected matte |
| WebP | Yes | Yes | Animated WebP rejected; encoder currently lossless |
| BMP | Yes | Yes | Transparency composited on selected matte |
| GIF | Static only | Static only | Indexed palette/quality loss possible; animated input rejected |
| TIFF | Single page | Single page | Multipage input rejected; metadata and specialist color spaces may be lost |

Conversions also support optional **maximum-edge scaling (no upscaling), 90°/180°/270° clockwise rotation, and grayscale**. The main window exposes these under Conversion settings; Orbit uses original size by default.

## Security and quality policies

- Content-signature detection; unsupported formats are rejected.
- PNG/APNG, WebP animation, GIF multiframe, and multipage TIFF are checked to prevent silent frame/page loss.
- 150 MB source limit and 40-megapixel decoded image limit.
- Up to 300 files per batch, with two workers.
- Output staged in destination and verified before no-clobber publication. Original is unchanged.
- Existing outputs are never overwritten; a suffix is generated on collision.
- JPEG quality range 1–100; the main UI exposes 30–100. It does not control WebP, GIF, or TIFF.
- Cancellation is cooperative at safe checkpoints, not inside codec calls.
- Processing may discard EXIF, ICC profiles, DPI, GPS metadata, color depth, and orientation. Do not use the current release for metadata-preserving professional archives.

## Not implemented

- Video and audio, including MP3/MP4, FFmpeg-based processing
- PDF, Office documents, spreadsheets, presentations, e-books
- Archives and folders
- SVG, HEIC, AVIF, PSD, RAW, ICO, and other specialist image formats
- Animated output and multipage conversion
- Metadata fidelity guarantees, GPU processing, transparent background removal

## Verification

Automated Rust tests cover 36 raster routes, transparency matte, original-file preservation and no-overwrite, transformations, invalid input, and animated GIF rejection. Green Windows and Linux CI is needed before promoting this build to *verified*. Real desktop QA is still required for drag/drop, Orbit, Windows Explorer registration and installer.
