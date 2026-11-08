# Application architecture

## Boundaries

- **React workspace:** file list, settings, format selection, visible state and accessibility. The browser preview cannot access native files and does not simulate conversion.
- **Tauri command boundary:** `inspect_files`, `convert_batch`, `cancel_batch`. The native dialog plugin handles file/folder selection.
- **Rust conversion engine:** file-signature identification, safe size/dimension limits, decoder, encoder, output verification, and no-clobber publication.
- **Batch scheduler:** at most two processing workers. Each per-file event has a stable frontend ID and truthful status.

The frontend never passes file bytes to a remote service. The Rust engine uses the selected local paths.

## Processing lifecycle

`selected -> inspected -> ready -> processing -> encoded to temp -> verified -> saved -> completed`

If a step fails, the temporary file is cleaned up. A retry can add the same file again by clearing it or removing the failed row. Cancellation is cooperative: files already encoding may complete their current operation before cancellation is observed. No fabricated percentages are shown.

## Security decisions

- Format recognition checks header signatures rather than trusting extensions.
- Unsupported formats and oversized files are rejected.
- Files are decoded by external, independently selected image library code; malicious files still require defense-in-depth and dependency maintenance.
- Output occurs in the destination folder through a temporary file with an exclusive final publish operation.
- Source files are never modified.
- The 150 MB file and 40-megapixel limits reduce unbounded memory risk.
- UI themes are stored in browser localStorage, not uploaded.

## Unfinished production work

Implement restart-safe history, better resource accounting, metadata/ICC handling, orientation policies, Windows Installer artifacts, security review, accessibility testing, and richer format adapters. The app is a functional first slice, not a universal converter yet.
