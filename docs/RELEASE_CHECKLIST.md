# Release quality checklist

**[ReformANY v0.3.0](https://github.com/p4yy/ReformANY/releases/tag/v0.3.0)** was published on 2026-11-11. Automated checks do not certify every Windows system or source file.

## Verified for v0.3.0

- [x] Source checks, Rust tests, frontend build and security scans passed for the release source.
- [x] Windows UI, installer, Orbit, HoveR and offline media smoke tests passed.
- [x] The release provides `ReformANY-Portable.exe`, `reformany-setup.exe` and `SHA256SUMS.txt`.
- [x] The Acev Dev Co proprietary, source-available license remains unchanged.

## Remaining independent checks

- [ ] Manually test both EXEs on clean Windows 10/11 machines, including permissions, WebView2 and SmartScreen.
- [ ] Test representative invalid, encrypted, large and normal inputs; verify file fidelity.
- [ ] Verify Orbit scrolling across all panels and DPI settings.
- [ ] Review accessibility, privacy and uninstallation behavior.
- [ ] Review dependencies, fonts, media codecs, licensing and commercial release obligations.
- [ ] Configure branch protection, secret scanning, advisories, push protection and code signing as appropriate.
- [ ] Ensure public artwork contains no private data or identifying metadata.

## Publishing future versions

1. Update app version in package, Tauri, and premium installer metadata.
2. Run the full Windows build, source verification, audits and independent acceptance tests on the exact intended source commit.
3. Run `.github/workflows/publish-versioned-release.yml` with the new `vMAJOR.MINOR.PATCH` version, successful Windows run ID and exact source SHA.
4. Check downloaded assets, checksums, file names, version metadata and clean-machine behavior.
5. Never mark unperformed QA as completed or substitute an unrelated build.

## Source-history archive

Before the 2026-11-11 one-commit consolidation, the previous `main` head was preserved at `backup/main-before-one-commit-20261111`. The published `v0.3.0` tag remains intact. Open PRs from the previous history may require rebase or recreation; their branches are preserved.
