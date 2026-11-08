# Format support matrix

Status **Implemented, awaiting Windows CI and manual QA** describes code currently present, not proven successful conversions.

| Input | Output | Status | Notes |
|---|---|---|---|
| PNG | PNG, JPEG, WebP, BMP | Implemented, unverified | PNG/WebP retain alpha; JPEG/BMP composite on selected white/black background |
| JPEG | PNG, JPEG, WebP, BMP | Implemented, unverified | JPEG quality applies only to JPEG output |
| WebP | PNG, JPEG, WebP, BMP | Implemented, unverified | Static images; animated WebP needs separate policy and tests |
| BMP | PNG, JPEG, WebP, BMP | Implemented, unverified | Static raster only |
| PDF, Office, text | Other document formats | Not implemented | Requires format-specific engines and fidelity policy |
| Audio, video | Any | Not implemented | Requires codec, container, patent and redistribution review |
| Archives | Any | Not implemented | Requires independent safe extraction/repacking design |
| GIF, TIFF, AVIF, SVG, HEIC | Any | Not implemented | Individual feasibility/security review required |

## Limitations

- Individual source files must be no larger than 150 MB and 40 megapixels.
- 300 items maximum per submitted batch; two processing workers.
- Image processing may discard metadata, ICC profiles, and EXIF orientation semantics. Do not rely on metadata fidelity until explicitly implemented and tested.
- WebP encoding currently uses the image library's lossless behavior.
- BMP/JPEG do not retain alpha.
- Conversion of animated images is not supported as a fidelity-preserving operation.
- The existing output is never overwritten; suffixes are added as necessary.
- Cancellation is best effort at safe checkpoints, not necessarily during a codec call.
- Non-image formats do not appear in output selectors.

## Validation before promoting status to Verified

Run Rust unit tests, frontend typecheck/build, Windows Tauri launch, sample image matrix, corrupted file cases, alpha checks, collisions, Unicode paths, and cancellation QA. Record specific outputs and dates.
