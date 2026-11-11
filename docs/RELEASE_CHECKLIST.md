# v1.0.0 release checklist

This checklist protects the first official release from being confused with a successful **private test** build. Complete it on the intended **main** commit, not on an unmerged PR SHA.

## Release blockers

- [ ] **Confirm license:** keep the current proprietary source-available license, or approve a replacement and legal review. Do not add an MIT/GPL badge without actually changing the terms.
- [ ] **Resolve high-severity dependencies before stable:** npm `xlsx@0.18.5` (CVE-2023-30533, CVE-2024-22363) and `pdfjs-dist@5.6.x` (malicious-PDF arbitrary JavaScript advisory GHSA-hq66-cqwq-w95j). Upgrading PDF.js to 6.x is potentially breaking: update import/worker behavior and rerun all PDF rendering, Orbit and 269-page tests. Confirm spreadsheet parser exposure and a verified upgrade or migration for SheetJS.
- [ ] Run `npm audit --omit=dev --audit-level=high` and a Rust advisory audit on actual resolved dependency locks; record outputs and fixes.
- [ ] Review all reachable Git history for secrets (`gitleaks git --redact .` or an equivalent tool) and enable GitHub secret scanning/push protection. Rotate exposed keys; deleting history is not sufficient.
- [ ] Manually test installer and **portable** binary on clean Windows 10/11 environments, including WebView2, file permissions, offline startup and antivirus/SmartScreen behavior.
- [ ] Verify Orbit's right-edge scrollbar in all native tool panels, including normal/maximized windows, and compare against current screenshots.
- [ ] Validate key conversions on a real fixture corpus (large PDFs, SVG/raster images, archives, media with and without optional engines, invalid/encrypted files).
- [ ] Check app version **consistently** in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, premium shell metadata and any displayed About/version fields. Current source still states `0.3.0`.
- [ ] Reconcile preview-era documentation and legal notices; check font and third-party media licenses.
- [ ] Apply branch protections and rulesets, enable vulnerability reporting/Dependabot and verify code owners.
- [ ] Confirm full-size, cropped, privacy-reviewed screenshots and social preview image.

## Prepare release commit and assets

1. Merge and retest the reviewed application PR and this documentation PR into `main`. **Do not force-push** or rewrite history as a substitute for ordinary review.
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
