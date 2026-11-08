# ReformANY

A focused desktop file converter, built independently with Rust, Tauri 2, React and TypeScript.

## Status

**In development.** The first vertical slice targets image conversion between PNG, JPEG, WebP and BMP. Other format families are not yet implemented.

## Start locally

Requirements: Node.js 20+, Rust stable, and the native [Tauri 2 development prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

For a production Windows installer:

```bash
npm run tauri build
```

Read [Format support](docs/FORMAT_SUPPORT.md), [Architecture](docs/ARCHITECTURE.md), and [Provenance](docs/PROVENANCE.md) before claiming any supported functionality.

ReformANY uses its own product design and application code. It is not based on, or derived from, other conversion application repositories.
