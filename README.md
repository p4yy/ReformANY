<p align="center">
  <img src="public/brand/reformany-icon.png" alt="ReformANY application icon" width="112" />
</p>

<h1 align="center">ReformANY</h1>
<p align="center">Local file conversion and document tools for Windows.</p>
<p align="center">
  <a href="https://github.com/p4yy/ReformANY/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/p4yy/ReformANY?label=release" /></a>
  <a href="LICENSE"><img alt="Source-available proprietary license" src="https://img.shields.io/badge/license-source--available-6a8062" /></a>
  <a href="https://github.com/p4yy/ReformANY/releases"><img alt="Release downloads" src="https://img.shields.io/github/downloads/p4yy/ReformANY/total" /></a>
  <a href="https://github.com/p4yy/ReformANY/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/p4yy/ReformANY" /></a>
</p>

ReformANY converts supported files and provides quick desktop tools for PDFs, images, media and archives. Processing happens locally. It does not require a ReformANY account or upload your files to a conversion service.

**Release status:** The current validated Windows binaries are **private test builds**, not a published stable release. Supported conversions depend on the input format and installed or bundled engines. Consult the [format matrix](docs/FORMAT_SUPPORT.md) before relying on a route.

## Highlights

- **Orbit:** Right-click a supported file in Windows File Explorer to open a circular menu for conversion, PDF tools, and file actions. Windows 11 may place the entry under **Show more options**.
- **Images:** Convert supported raster images with quality, size, rotation, grayscale and transparency-handling options.
- **PDFs and documents:** Preview PDFs; reorder and extract pages, apply watermarks, add a visual signature or protect a copy. Selected office and ebook routes require local third-party software.
- **Audio and video:** Convert supported media formats, trim, compress and inspect files with FFmpeg. Availability depends on codecs and the installed or packaged engine.
- **Archives and files:** Create or extract ZIP files, split and rejoin numbered file parts, and use supported external archive utilities when present.
- **Local by design:** No app account, cloud conversion service or first-party telemetry. Outputs are written separately from source files.

## Interface previews

Reference screenshots and videos from private design discussions are not stored in this source repository. Future release images, if any, must use non-sensitive test fixtures and be approved for public use.

## Download and install

An official stable download will be available under [GitHub Releases](https://github.com/p4yy/ReformANY/releases) after the release checks have been completed. Until then, [GitHub Actions](https://github.com/p4yy/ReformANY/actions/workflows/windows-release.yml) contains **test artifacts only**.

**Installer (test builds):** Download the matching premium setup ZIP from a successful workflow, extract it and run `reformany-setup.exe`. The setup UI runs offline; follow the on-screen steps. The test executable is not a signed public release.

**Portable (test builds):** Download the separate **Portable-EXE-test** artifact, extract the ZIP, and run `ReformANY.exe`. Portable means it does not require running the setup wizard; it does **not** mean every feature is fully self-contained or that the app leaves no local settings behind. Do not confuse this executable with `reformany-setup.exe`.

**Integrity:** Check the SHA-256 digest published alongside an eventual release asset before running it. A hash detects unexpected changes; it is not a digital signature.

### Requirements

- Windows 10/11, 64-bit, with WebView2 available. The installer includes an offline WebView2 setup path where supported; the portable binary may rely on an existing runtime.
- Enough disk space for the application, conversion outputs and temporary media data.
- Additional applications such as LibreOffice, Calibre, 7-Zip or WinRAR for routes that explicitly require them. See [format support](docs/FORMAT_SUPPORT.md).
- Unsigned builds can trigger Windows SmartScreen warnings. Verify the download source rather than bypassing unexpected warnings.

## Basic usage

1. Open ReformANY and choose the appropriate workspace (Images, Documents, Media, Archives, or another supported tool).
2. Add files or choose them through the file picker.
3. Pick a supported target format and review the available options.
4. Convert, then open the resulting file or its output folder. Keep your original file until you have checked fidelity.

For quicker actions, right-click a file in Explorer and choose **ReformANY Orbit** where installed. The Orbit tool panels also include PDF page previews and controls; some actions create a new copy rather than modifying the original.

## Build from source

Install Node.js 22+, Rust 1.90+, the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) and the required Windows build tools. From the repository root:

```powershell
npm install
npm run typecheck
npm run privacy:check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

For a Windows installer:

```powershell
npm run tauri build
```

Builds can download approved build-time dependencies. Running the app is intended to be offline. Consult [development notes](docs/DEVELOPMENT.md) and [dependency provenance](docs/PROVENANCE.md).

## Roadmap and project information

- [Format support and limitations](docs/FORMAT_SUPPORT.md)
- [Product roadmap](docs/ROADMAP.md)
- [Release readiness and acceptance checklist](docs/RELEASE_CHECKLIST.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md) and [Code of conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)

## Support

If ReformANY is useful, you can support development through [PayPal](https://www.paypal.com/paypalme/aceevisuals) or [Ko-fi](https://ko-fi.com/acevisualsco). Donations are optional and do not buy redistribution rights or preferential support.

## License

Copyright © 2026 Acev Dev Co. ReformANY is **source-available and proprietary, not open source**. Personal, noncommercial evaluation is permitted on the terms in [LICENSE](LICENSE). Commercial reuse, redistribution and modification rights are not granted by default. Third-party dependencies keep their own licenses.

[Publisher](https://github.com/p4yy) · [Reuse terms](docs/REUSE_AND_ATTRIBUTION.md) · [Privacy](docs/PRIVACY.md)
