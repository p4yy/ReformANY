# v1.0.0 release checklist

This checklist protects the first official release from being confused with a successful **private test** build. Complete it on the intended **main** commit, not on an unmerged PR SHA.

## Release blockers

- [x] **License decision confirmed by project owner (2026-11-11):** retain the existing Acev Dev Co proprietary, source-available `LICENSE`. **Do not** relicense under MIT/GPL. Before commercial/public distribution, independently confirm the legal copyright holder and have the custom terms reviewed; no change was made to `LICENSE`.
- [x] **Remediated the reported npm advisories:** replaced vulnerable npm SheetJS with maintainer-published `xlsx@0.20.3` and upgraded `pdfjs-dist` to `6.5.438`. Updated PDF.js 6 loading-task cleanup; frontend and native Orbit/PDF acceptance checks passed on [Windows CI](https://github.com/p4yy/ReformANY/actions/runs/42970136279).
- [x] **Remediated reported RustSec vulnerabilities:** updated `zip` to 9.0.0, `lopdf` to 0.42.0, `calamine` to 0.38.0 and `rust_xlsxwriter` to 0.102.0; patched ZIP 9 API call sites. Rust tests, lint and Windows tests passed.
- [x] **Dependency audits passed** on code commit `1da3e05`: [npm + RustSec](https://github.com/p4yy/ReformANY/actions/runs/42970136280). Re-audit any future dependency update and before a stable release; an audit pass does not imply zero vulnerabilities.
- [x] Run the Git history secret scanner across **all fetched refs**: Gitleaks v8.24.3 scanned 773 commits and reported no detected leaks (https://github.com/p4yy/ReformANY/actions/runs/42961408949). This is a pattern-based audit, not proof that no secrets ever existed.
- [ ] Enable GitHub secret scanning and push protection in repository settings. Independently review sensitive historical content and rotate any credentials discovered later; deleting history is not sufficient.
- [ ] Manually test installer and **portable** binary on clean Windows 10/11 environments, including WebView2, file permissions, offline startup and antivirus/SmartScreen behavior.
- [ ] Verify Orbit's right-edge scrollbar in all native tool panels, including normal/maximized windows, using non-sensitive test PDFs and direct interaction tests.
- [ ] Validate key conversions on a real fixture corpus (large PDFs, SVG/raster images, archives, media with and without optional engines, invalid/encrypted files).
- [ ] Check app version **consistently** in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, premium shell metadata and any displayed About/version fields. Current source still states `0.3.0`.
- [ ] Reconcile preview-era documentation and legal notices; check font and third-party media licenses.
- [ ] Apply branch protections and rulesets, enable vulnerability reporting/Dependabot and verify code owners.
- [ ] Before any public screenshots, videos or social preview are added, verify that they contain no private chat references, personal desktops, real documents or identifying metadata. Prefer the approved first-party icon alone for the social preview.

## Prepare release commit and assets

1. The reviewed source and security fixes were fast-forwarded to `main` without a force push at `1da3e05`; ensure future release updates are reviewed and retested on `main`.
2. Build from the exact final `main` commit. Do not reuse an EXE built from an unrelated draft PR SHA as a stable release binary.
3. Export a dedicated portable ZIP containing `ReformANY.exe` with the expected local runtime requirements documented. Do not call the premium setup EXE portable.
4. Create `SHA256SUMS.txt` using a trusted machine, for example in PowerShell:

   ```powershell
   (Get-FileHash .\ReformANY-v1.0.0-windows-portable.zip -Algorithm SHA256).Hash.ToLower()
   ```

   Format the checksum file as `<SHA256>  <asset filename>` and check the digest again after upload.
5. After authorization and final acceptance, create the annotated tag on the final `main` commit:

   ```sh
   git checkout main
   git pull --ff-only
   git tag -a v1.0.0 -m "First official release"
   git push origin v1.0.0
   ```

6. Publish the GitHub Release from **that tag**, attach the portable ZIP and `SHA256SUMS.txt`, and use the reviewed notes in `docs/releases/v1.0.0-draft.md` after removing all pending-language and unresolved release blockers.
7. Verify GitHub's downloaded release asset checksum and the version of the binary by executing it on Windows.

## Branch cleanup — requires a separate approval

- [ ] Inventory all branches, their open PRs and any commits missing from `main`.
- [ ] Create a backup tag/branch (and preferably a separate clone/archive) **before deletion**.
- [ ] Show the owner a per-branch deletion proposal and obtain approval. Keep work referenced by open PRs, especially drafts.
- [ ] Do not rewrite published history or force-push without an exact before/after commit plan and explicit approval.

## Repository settings — GitHub UI

- Set description: **Local Windows file conversion, PDF tools and File Explorer Orbit shortcuts.**
- Suggested topics: `windows`, `tauri`, `rust`, `react`, `file-converter`, `pdf-tools`, `desktop-app`, `offline-first`.
- Website: `https://github.com/p4yy` until the publisher provides a separate verified site.
- Upload the approved ReformANY app logo as the GitHub social preview under **Settings → General / Social preview** (GitHub layout varies).
- Enable required checks, signed commits or release signatures as appropriate, branch protection, Dependabot alerts, secret scanning/push protection, private vulnerability reporting.
