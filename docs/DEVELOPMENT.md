# Development and verification

## Prerequisites

- Node.js 22 or later
- Rust stable (1.90 or later for recent Tauri dialog plugin builds)
- Tauri 2 native prerequisites for your host system
- Windows 10/11 recommended for initial desktop QA

## Commands

```sh
npm install
npm run typecheck
npm run build
npm run tauri dev
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

Note: `npm run tauri build` is configured to produce a Windows NSIS installer. Automated Windows CI exercises the installer and portable app. Clean-machine testing and signing review remain separate quality checks.

## Manual QA checklist

- [ ] Import each supported raster type (PNG, JPEG, WebP, BMP, static GIF, single-page TIFF).
- [ ] Convert each input type into each available output type, then open output in another viewer.
- [ ] Verify alpha compositing to selected matte when encoding JPEG/BMP.
- [ ] Verify original is not modified when output format matches input format.
- [ ] Convert duplicate basenames without overwriting earlier output.
- [ ] Test corrupt images, animated GIF/WebP/APNG rejection, multipage TIFF rejection, folder scanning cap, permission failures, nonexistent output directory, and 150 MB limit.
- [ ] Run multiple conversions and cancel while queued.
- [ ] Inspect DPI scaling, keyboard interactions, dark theme and focus states.

## Runtime constraints

Static web preview intentionally cannot call native file conversions. No mock conversion functionality is provided. Files are processed on-device; no analytics or upload endpoint is part of the code.
