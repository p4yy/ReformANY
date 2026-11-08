# ReformANY

**License:** Proprietary — All Rights Reserved. ReformANY's original application code and design assets are not released under an open-source license. Third-party libraries retain their own licenses; see [LICENSE](LICENSE) and [engineering provenance](docs/PROVENANCE.md).

A local-first Windows desktop converter written in **Rust + Tauri 2 + React + TypeScript**.

## Current capabilities (0.3.0 preview)

- Convert static PNG, JPEG, WebP, BMP, GIF and single-page TIFF images between each other (36 raster routes).
- Scale images down to 2,048 / 1,024 / 512 px maximum edge, rotate 90°/180°/270°, and produce grayscale copies.
- Keep original images untouched; avoid overwriting existing outputs.
- Import multiple files or folders (recursive image discovery with limits); drag-and-drop supported.
- Choose a destination directory or save beside originals.
- Local conversion history in the UI (last 100 entries); no server uploads or telemetry.
- **ReformANY Orbit**: right-click a file in Explorer, choose ReformANY Orbit, then convert from a compact circular floating panel.

This is still a **preview**, not a universal converter. The repository now includes additional dedicated workspaces:

- **Audio and video:** FFmpeg/FFprobe-based conversion, trimming, compression, normalization, video rotation/flipping, and joining clips when the installed codecs support them.
- **Archives:** built-in ZIP create/extract (including AES-256 encrypted ZIP), plus 7-Zip-driven 7z creation, split volumes, and broad extraction. RAR creation requires a locally installed WinRAR.
- **Documents and e-books:** images → PDF, PDF text export to TXT/Markdown/HTML, Office → PDF with LibreOffice, and e-book conversion with Calibre, including an imperfect PDF → DOCX route.
- **Preview:** local PDF page renderer displaying original page graphics/pictures, plus TXT and Markdown readers.
- **Windows utilities:** Orbit's three sections (Convert, Tools, Actions), rename, file copy, Terminal, Bluetooth wizard and always-on-top Float.
- **Preferences:** language selection (14 locales including Arabic/Persian/Urdu with initial RTL layout) and automatic system appearance.

Media, LibreOffice, Calibre, and 7-Zip engines are **not all bundled** in the current installer: local installation of the corresponding executable may be necessary. Availability is shown in the Engines tab. Optional speech-to-text, AI background removal, more robust PDF editing and additional archive formats remain unfinished. We do not claim unverified formats work.

All file conversion is local, with no account or telemetry. See [privacy and offline limitations](docs/PRIVACY.md).

## Windows download

Open [Actions → Windows build](https://github.com/p4yy/ReformANY/actions/workflows/windows-release.yml), select a **successful** run for the commit/version you want, and download its **ReformANY-0.3.0-Windows-preview** artifact. Unzip and run the black ReformANY NSIS installer. It carries an offline WebView2 runtime and offers **Launch ReformANY** when finished. This preview is not code-signed.

Windows 11 may display the classic **ReformANY Orbit** entry under **Show more options**.

## Local developer build

Requires Node.js 22+, Rust stable, and native [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev
```

For the Windows installer:

```sh
npm run privacy:check
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
