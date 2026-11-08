<img src="public/brand/reformany-mark.jpg" alt="ReformANY mark" width="72" height="72">

# ReformANY

**Convert anything. Effortlessly.**

A focused, privacy-first file conversion workspace for Windows.  
**Designed and developed by Acev Dev Co.**

ReformANY brings useful conversion, preview and file actions into one restrained desktop experience. Work stays on your computer—no account, cloud upload or telemetry required.

## What it does

**Convert**  
Transform supported images, audio and video files. Process supported Office documents, PDFs and e-books using local engines where required.

**Preview**  
Read PDFs as rendered pages—including embedded imagery—and view TXT and Markdown files in a clean document reader.

**Archive**  
Create and extract ZIP files, including encrypted ZIP. Use supported locally installed 7-Zip and WinRAR tools for additional archive formats.

**Orbit**  
Right-click a file in Windows Explorer to open a compact circular shortcut with three sections: **Convert · Tools · Actions**. Orbit also offers optional navigation sounds.

The exact routes depend on the file and the local engines available. [See supported formats and limitations](docs/FORMAT_SUPPORT.md).

## Built to stay local

- **No account.** No login, subscription connection or cloud workspace.
- **No uploads or app telemetry.** First-party conversion commands are local, not API-backed.
- **Original files preserved.** Results are written separately, with output collision protection.
- **Source visible.** This repository is public for independent inspection and accountability.

Some features require locally installed FFmpeg, 7-Zip, WinRAR, LibreOffice or Calibre. The current preview does **not** bundle every engine. We are still completing end-to-end Windows and security testing; publishing source code alone is not a security certification.

Read the [offline and privacy contract](docs/PRIVACY.md), [dependency provenance](docs/PROVENANCE.md) and [development verification notes](docs/DEVELOPMENT.md).

## Try the Windows preview

Open [Windows builds on GitHub Actions](https://github.com/p4yy/ReformANY/actions/workflows/windows-release.yml), choose a **successful** build and download its installer artifact.

The current build is a **preview (0.3.0)** and is **not code-signed**. Windows may display a security warning. Download only from this repository, and inspect the workflow and source before installing. Windows 11 may show the Orbit right-click option under **Show more options**.

ReformANY uses a dark branded installer, with an installation progress indicator and a launch option upon completion.

## Build from source

Requires Node.js 22+, a stable Rust toolchain and the [Tauri 2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run privacy:check
npm run tauri dev
```

Build the installer on Windows:

```sh
npm run tauri build
```

For details, see [architecture](docs/ARCHITECTURE.md), [QA guidance](docs/DEVELOPMENT.md) and [the roadmap](docs/ROADMAP.md).

## Ownership and license

**© 2026 Acev Dev Co. All rights reserved.**

The original ReformANY source, interface design and first-party brand materials are **publicly viewable but proprietary**. You may inspect the code and independently learn from its ideas, but commercial resale, repackaging and redistribution of protected ReformANY material require written permission. Authorized reuse must give prominent credit and the official project link, plus the official website and donation link once published. GitHub's platform permissions and third-party dependency licenses still apply.

Read [LICENSE](LICENSE), [reuse and attribution rules](docs/REUSE_AND_ATTRIBUTION.md), and [brand principles](docs/BRAND.md) for the product identity. Public visibility is intentional; the repository will remain public.

---

<small>ReformANY is under active development. Features are described according to their current implementation—not promises of universal conversion or guaranteed compatibility.</small>
