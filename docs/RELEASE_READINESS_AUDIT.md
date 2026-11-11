# Release readiness and security audit — 2026-11-11

**Scope:** Read-only inspection of the current PR #19 source snapshot, available GitHub branch/release information and published dependency advisories. This is a partial audit, not a penetration test or full-history secret-scanning certificate.

## Repository and build observations

- The public default `main` branch remains on `0.3.0`; PR #19 has a separate, green Windows test build and remains unmerged/draft.
- Source verification and the Windows build both passed on PR #19 commit `cc28a3553277c34dbbdc089b57349987ef657ae1`.
- The native Windows smoke test actually scrolled a 269-page generated PDF via mouse wheel, scrollbar track and draggable thumb, and reached the final page.
- The premium setup's offline UI smoke test passed. The separately distributed portable ZIP contains `ReformANY.exe`.
- A successful private build does not approve a public stable release; manual Windows visual and file-fidelity testing is pending.
- The repository has multiple long-lived draft PR branches. No branch deletion or history rewriting was performed.
- No committed `node_modules/`, application build `target/`, temporary `.log`, `.env`, `.DS_Store` or `.exe` file paths were seen in the **current PR tree**. The tracked premium installer **reference ZIP** is a build input, not junk.

## Security findings and required verification

1. **High priority: confirmed npm audit failures.** GitHub Actions Dependency audit run `42960934395` reported two high-severity production packages:
   - `xlsx@0.18.5`: CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (regular-expression denial of service). The old frontend helper in `src/lib/files.ts` parses workbook files through this package. The npm registry has no fixed published version. Remove unreachable unsafe code or adopt a verified maintained replacement, then retest spreadsheet imports and exports. References: https://github.com/advisories/GHSA-4r6h-8v6p-xvw6 and https://github.com/advisories/GHSA-5pgg-2g8v-p4x9.
   - `pdfjs-dist@5.6.x`: malicious-PDF arbitrary JavaScript execution advisory GHSA-hq66-cqwq-w95j. Audit recommends `6.5.438`, a breaking major upgrade; validate PDF.js API and worker settings and rerun real PDF rendering/navigation, Orbit and preview tests before accepting. Reference: https://github.com/advisories/GHSA-hq66-cqwq-w95j.
2. **Dependency audit status.** `npm audit --omit=dev --audit-level=high` ran on CI and **failed** with the two advisories above; do not waive that gate without documented remediation. A separate RustSec/Cargo advisory audit was initiated; review its final result before proceeding. The repository has no tracked production dependency lockfiles yet, so preserve and audit resolved locks at the final main commit.
3. **Incomplete secret-history audit.** Git history has not been exhaustively fetched/scanned for credentials or personal data; the GitHub connector does not expose secret scanning settings or every historic blob as one audited archive. Run `gitleaks git --redact .` on a full clone and enable GitHub's secret scanning and push protection. Rotate any real key/token found. Current source tree file names did not reveal obvious secret files, but filename checks are not content scanning.
4. **Publishing and license:** `LICENSE` already contains proprietary source-available terms. Confirm these terms with the publisher (and counsel if needed) before shipping a public stable binary; do not replace them with MIT or GPL without explicit approval.
5. **Windows and supply chain:** Code signing, provenance/SBOM, downloaded third-party runtimes/codecs and clean Windows VM tests still require verification. No guarantee of zero vulnerabilities is made.

## Artifacts checked

- PR #19 source: https://github.com/p4yy/ReformANY/pull/19
- Source verification: https://github.com/p4yy/ReformANY/actions/runs/42954690732
- Windows build and UI smoke tests: https://github.com/p4yy/ReformANY/actions/runs/42954690762
- Verified screenshot artifact: https://github.com/p4yy/ReformANY/actions/runs/42954690762/artifacts/13826344734

See [the release checklist](RELEASE_CHECKLIST.md) for acceptance gates and deletion protections.
