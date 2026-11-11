<p align="center">
  <img src="public/brand/reformany-banner.gif" alt="ReformANY animated conversion banner" width="720">
</p>

<h1 align="center">ReformANY</h1>

<p align="center">
  <strong>File conversion, PDF tools, and quick actions for Windows.</strong>
</p>

<p align="center">
  <a href="https://github.com/p4yy/ReformANY/actions/workflows/checks.yml"><img src="https://github.com/p4yy/ReformANY/actions/workflows/checks.yml/badge.svg?branch=main" alt="Source verification"></a>
  <a href="https://github.com/p4yy/ReformANY/actions/workflows/windows-release.yml"><img src="https://github.com/p4yy/ReformANY/actions/workflows/windows-release.yml/badge.svg?branch=main" alt="Windows build"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Acev%20Dev%20Co%20%E2%80%A2%20proprietary-829773?style=flat" alt="Acev Dev Co proprietary source-available license"></a>
  <a href="https://github.com/p4yy/ReformANY/stargazers"><img src="https://img.shields.io/github/stars/p4yy/ReformANY?style=flat" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="src-tauri/Cargo.toml"><img src="https://img.shields.io/badge/Core-Rust%20%2B%20Tauri-c2410c?style=flat" alt="Core: Rust and Tauri"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/UI-React%20%2B%20TypeScript-007acc?style=flat" alt="User interface: React and TypeScript"></a>
  <a href="#installation"><img src="https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-2ea043?style=flat" alt="Platform: Windows 10 and 11"></a>
  <a href="docs/PRIVACY.md"><img src="https://img.shields.io/badge/Processing-Local%20%26%20offline-477e66?style=flat" alt="Local and offline file processing"></a>
  <a href="https://github.com/p4yy/ReformANY/releases/tag/v0.3.0"><img src="https://img.shields.io/badge/Release-v0.3.0-2497bd?style=flat" alt="Latest official release: v0.3.0"></a>
</p>

ReformANY brings file conversion and document utilities into one Windows desktop app. Work in the main interface or open **ReformANY Orbit** from File Explorer for quick, file-specific actions. Supported conversions run locally, without an account or cloud upload.

> **Latest Windows release:** [ReformANY v0.3.0](https://github.com/p4yy/ReformANY/releases/tag/v0.3.0) · portable app and premium installer · [SHA-256 checksums](https://github.com/p4yy/ReformANY/releases/download/v0.3.0/SHA256SUMS.txt). Windows 10/11 (64-bit); binaries are currently unsigned.

## Features

- **ReformANY Orbit** — a compact circular menu in File Explorer with conversion, tool, and file actions.
- **Shake to Orbit** — an optional file-or-folder drag gesture to open Orbit. Configurable in settings; availability depends on Windows Explorer behavior.
- **HoveR** — preview supported files and access relevant actions without opening the full workspace.
- **Image tools** — batch conversion, resize, rotation, grayscale, quality, and transparency options.
- **PDF tools** — page arrangement and extraction, page-image export, watermarking, visible signatures, and password-protected copies.
- **Audio and video** — local FFmpeg-based conversion, compression, trimming, and selected media tools.
- **Documents and data** — supported Office, e-book, spreadsheet, table, text, and subtitle conversion routes.
- **Archives and files** — ZIP creation/extraction, encrypted ZIP, supported external archive formats, and file split/join tools.

## Formats

| Category | Formats |
| --- | --- |
| Images | PNG, JPG/JPEG, WebP, BMP, GIF (static), TIFF (single-page), TGA, QOI, ICO; SVG rasterization |
| PDF | PDF, PNG/JPG page images, TXT, Markdown, HTML |
| Audio | MP3, M4A, WAV, FLAC, OGG, Opus |
| Video | MP4, WebM, MKV, MOV, AVI |
| Archives | ZIP, 7z, RAR, TAR, GZip, BZip2, XZ, WIM |
| Tables | CSV, TSV, JSON, XLSX; selected XLS/ODS imports |
| Subtitles | SRT, WebVTT |
| Documents and e-books | Selected DOC, DOCX, PPT, PPTX, EPUB, MOBI, FB2, AZW3 routes |

Support is **operation-specific**; not every listed input converts to every listed output. Optional routes may require LibreOffice, Calibre, 7-Zip, or WinRAR. Media conversion requires FFmpeg/FFprobe, which are included in verified Windows test packages. See the [full format matrix](docs/FORMAT_SUPPORT.md) for directions, limits, and exclusions.

## Installation

Download the official [ReformANY v0.3.0 release](https://github.com/p4yy/ReformANY/releases/tag/v0.3.0). Each executable is offered as a **direct download**; no GitHub Actions ZIP is required.

| Package | Direct download | How to use it |
| --- | --- | --- |
| **Portable app** | [`ReformANY-Portable.exe`](https://github.com/p4yy/ReformANY/releases/download/v0.3.0/ReformANY-Portable.exe) | Launch the standalone application; no setup wizard required. |
| **Premium installer** | [`reformany-setup.exe`](https://github.com/p4yy/ReformANY/releases/download/v0.3.0/reformany-setup.exe) | Run the Windows setup wizard. |

Both executables were published from the same verified Windows CI run and have an accompanying [`SHA256SUMS.txt`](https://github.com/p4yy/ReformANY/releases/download/v0.3.0/SHA256SUMS.txt). Future versions use their own `vMAJOR.MINOR.PATCH` release tags.

**Requirements:** Windows 10 or 11 (64-bit), WebView2, and adequate disk space. Optional tools require their respective local engines. The executables are unsigned; Windows SmartScreen may show a warning.

## Orbit in File Explorer

1. Right-click a supported file or folder and choose **ReformANY Orbit**. On Windows 11, use **Show more options** if needed.
2. Choose an action from **Convert**, **Tools**, or **Actions**.
3. Adjust settings in the tool panel, then save the output.

The optional **Shake to Orbit** gesture provides another way to open the menu while dragging a file or folder. The right-click menu remains available without the gesture.

[More about Orbit](docs/ORBIT.md)

## Build from source

ReformANY uses **Tauri 2, Rust, React, and TypeScript**. Install Node.js 22+, stable Rust, and the [Tauri prerequisites for Windows](https://v2.tauri.app/start/prerequisites/).

```powershell
npm install
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

See the [development guide](docs/DEVELOPMENT.md) for packaging, tests, and optional engines.

## Project

[Roadmap](docs/ROADMAP.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Security](SECURITY.md)

Conversion happens locally. As with any conversion tool, check output files before discarding originals. The [privacy policy](docs/PRIVACY.md) explains local settings and processing behavior.

## Support

<p align="center">
  <a href="https://www.paypal.com/paypalme/aceevisuals"><img src="https://img.shields.io/badge/PayPal-Support-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Support on PayPal" height="32"></a>
  &nbsp;
  <a href="https://ko-fi.com/acevisualsco"><img src="https://img.shields.io/badge/Ko--fi-Support-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi" height="32"></a>
</p>

## License

© 2026 Acev Dev Co. All rights reserved. ReformANY is **proprietary, source-available software**. Viewing the source does not grant permission to redistribute or relicense it. See [LICENSE](LICENSE) for the applicable terms.
