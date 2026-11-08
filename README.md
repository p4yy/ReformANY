# ReformANY

A local-first Windows desktop converter written in **Rust + Tauri 2 + React + TypeScript**.

## Current capabilities (0.3.0 preview)

- Convert static PNG, JPEG, WebP, BMP, GIF and single-page TIFF images between each other (36 raster routes).
- Scale images down to 2,048 / 1,024 / 512 px maximum edge, rotate 90°/180°/270°, and produce grayscale copies.
- Keep original images untouched; avoid overwriting existing outputs.
- Import multiple files or folders (recursive image discovery with limits); drag-and-drop supported.
- Choose a destination directory or save beside originals.
- Local conversion history in the UI (last 100 entries); no server uploads or telemetry.
- **ReformANY Orbit**: right-click a file in Explorer, choose ReformANY Orbit, then convert from a compact circular floating panel.

This is a **preview**, not an "any file" converter yet. Audio, video, PDF, Office, archives and other categories remain unimplemented. The UI only offers operations the engine can genuinely perform.

## Windows download

Open [Actions → Windows build](https://github.com/p4yy/ReformANY/actions/workflows/windows-release.yml), select a **successful** run for the commit/version you want, and download its **ReformANY-Windows-preview** artifact. Unzip and run the NSIS installer. This preview is not code-signed.

Windows 11 may display the classic **ReformANY Orbit** entry under **Show more options**.

## Local developer build

Requires Node.js 22+, Rust stable, and native [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev
```

For the Windows installer:

```sh
npm run tauri build
```

## Documentation

- [Format support and limitations](docs/FORMAT_SUPPORT.md)
- [Orbit usage / right-click menu](docs/ORBIT.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Development and QA](docs/DEVELOPMENT.md)
- [Dependency provenance and licensing](docs/PROVENANCE.md)

ReformANY is an independently built application and does not import previous file-conversion application source code.
