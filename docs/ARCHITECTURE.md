# Application architecture

ReformANY is a Windows-first desktop application using **Tauri 2 / Rust** with **React / TypeScript**. Conversion and file operations run locally.

## Entry points

- `src/main.tsx` initializes the frontend and identifies native windows.
- `src/App.tsx` routes the main workspace, **ReformANY Orbit**, HoveR preview and native tool panels.
- `src/zip/shell/` implements the active workspace; `src/zip/orbit/` implements the circular Orbit UI. Despite its legacy directory name, **src/zip is live source, not a disposable archive**.
- `src/HoveRView.tsx` and `src/native/OrbitPanelWindow.tsx` implement preview and tool windows.
- `src/zip/lib/bridge.ts` and `src/native/bridge.ts` connect frontend actions to Tauri IPC.
- `src-tauri/src/main.rs`, `src-tauri/src/lib.rs` and Rust modules implement native behavior and conversion.

## Processing and packaging

Native modules validate input, bound resource consumption, preserve originals by default, and handle supported PDF, image, media, archive and local conversion routes. Some Office, e-book and archive routes use optional locally installed tools. Unsupported combinations must fail clearly; conversions are not simulated.

- `src-tauri/tauri.conf.json` configures the Windows app and NSIS backend.
- `installer/setup-shell/` implements the premium installer UI.
- `scripts/prepare-media-bundle.ps1` retrieves pinned checksum-verified FFmpeg tools.
- `.github/workflows/checks.yml` verifies frontend, offline boundaries, Rust tests and linting.
- `.github/workflows/windows-release.yml` tests Windows builds, Orbit, HoveR, installers and media.
- `.github/workflows/publish-versioned-release.yml` publishes assets from an already passing Windows run.

See [formats](FORMAT_SUPPORT.md), [privacy](PRIVACY.md) and [development](DEVELOPMENT.md).
