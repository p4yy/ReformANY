# Release readiness and security audit — 2026-11-11

**Scope:** Inspection of draft PR #19, branch/release state and GitHub Actions dependency audits. A dedicated Gitleaks 8.24.3 scan traversed 773 commits on all fetched refs with no detected leaks. This remains a pattern-based audit, not a penetration test or guarantee against previously exposed credentials.

## Current status — security remediation complete on development commit

The dependency fixes were applied to public `main` with a fast-forward to [`1da3e05`](https://github.com/p4yy/ReformANY/commit/1da3e05411c99ce0eb2726a2adcaaf8989c4e477). **Both dependency audits passed** ([npm and RustSec](https://github.com/p4yy/ReformANY/actions/runs/42970136280)). [Source verification](https://github.com/p4yy/ReformANY/actions/runs/42970136235) and [Windows build](https://github.com/p4yy/ReformANY/actions/runs/42970136279), including real 269-page Orbit scrolling, HoveR, premium setup and portable EXE smoke tests, all passed on this exact application commit.

Remediation: `xlsx` now uses the maintainer-published 0.20.3 distribution; `pdfjs-dist` is 6.5.438; Rust ZIP, PDF and workbook libraries were updated with necessary API migration. This supersedes the **historical failures below**. Independent clean-Windows QA, signing, final v1.0.0 versioning and publication acceptance remain open.

## Historical repository and build observations (before remediation)

- The public default `main` branch remains on `0.3.0`; PR #19 has a separate, green Windows test build and remains unmerged/draft.
- Source verification and the Windows build both passed on PR #19 commit `cc28a3553277c34dbbdc089b57349987ef657ae1`.
- The native Windows smoke test actually scrolled a 269-page generated PDF via mouse wheel, scrollbar track and draggable thumb, and reached the final page.
- The premium setup's offline UI smoke test passed. The separately distributed portable ZIP contains `ReformANY.exe`.
- A successful private build does not approve a public stable release; manual Windows visual and file-fidelity testing is pending.
- The repository has multiple long-lived draft PR branches. No branch deletion or history rewriting was performed.
- No committed `node_modules/`, application build `target/`, temporary `.log`, `.env`, `.DS_Store` or `.exe` file paths were seen in the **current PR tree**. The tracked premium installer **reference ZIP** is a build input, not junk.

## Historical security findings (resolved on 1da3e05)

1. **Historical high-severity npm audit failures (fixed on main).** GitHub Actions Dependency audit run `42960934395` reported two high-severity production packages:
   - `xlsx@0.18.5`: CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (regular-expression denial of service). The old frontend helper in `src/lib/files.ts` parses workbook files through this package. The npm registry has no fixed published version. Remove unreachable unsafe code or adopt a verified maintained replacement, then retest spreadsheet imports and exports. References: https://github.com/advisories/GHSA-4r6h-8v6p-xvw6 and https://github.com/advisories/GHSA-5pgg-2g8v-p4x9.
   - `pdfjs-dist@5.6.x`: malicious-PDF arbitrary JavaScript execution advisory GHSA-hq66-cqwq-w95j. Audit recommends `6.5.438`, a breaking major upgrade; validate PDF.js API and worker settings and rerun real PDF rendering/navigation, Orbit and preview tests before accepting. Reference: https://github.com/advisories/GHSA-hq66-cqwq-w95j.
2. **Historical dependency audit status — FAILED (superseded by green audit).** `npm audit --omit=dev --audit-level=high` failed with two high-severity packages described above. The RustSec `cargo audit` also **failed with 16 vulnerability findings and four warnings** on the resolved graph. Notable affected crates: `calamine@0.31.0` (RUSTSEC-2026-0436, high), `lopdf@0.39.0` (RUSTSEC-2026-0187, high), `quick-xml@0.38.4` (RUSTSEC-2026-0194 and -0195, high), plus `zip` 4.6.1/7.4.0/8.6.0 (RUSTSEC-2026-0367/0368/0369/0429, some critical). Patched crate families require major upgrades and regression tests; warnings include unmaintained or unsound transitive dependencies. See https://github.com/p4yy/ReformANY/actions/runs/42960934395. Do not mark the candidate stable while these findings remain open.
3. **Git history secrets scan — PASS (limited assurance).** GitHub Actions ran `gitleaks git --redact --log-opts="--all" .` on a full-depth checkout. The scanner reported **773 commits scanned; no detected leaks**. The earlier PR-delta-only scan of six commits was intentionally superseded. This does not prove every possible credential is absent; GitHub secret scanning/push protection still needs an owner setting change, and any newly discovered credential must be revoked/rotated. Evidence: https://github.com/p4yy/ReformANY/actions/runs/42961408949.
4. **Publishing and license:** `LICENSE` already contains proprietary source-available terms. Confirm these terms with the publisher (and counsel if needed) before shipping a public stable binary; do not replace them with MIT or GPL without explicit approval.
5. **Windows and supply chain:** Code signing, provenance/SBOM, downloaded third-party runtimes/codecs and clean Windows VM tests still require verification. No guarantee of zero vulnerabilities is made.

## Artifacts checked

- PR #19 source: https://github.com/p4yy/ReformANY/pull/19
- Source verification: https://github.com/p4yy/ReformANY/actions/runs/42954690732
- Windows build and UI smoke tests: https://github.com/p4yy/ReformANY/actions/runs/42954690762
- Verified screenshot artifact: https://github.com/p4yy/ReformANY/actions/runs/42954690762/artifacts/13826344734

See [the release checklist](RELEASE_CHECKLIST.md) for acceptance gates and deletion protections.

## Public media privacy cleanup

The release-preparation PR removes four documentation screenshot JPEGs and their README references; no standalone video file was found in its tracked tree. The working application brand PNG/ICO files remain because its UI and Windows packaging require them. The premium installer reference ZIP also remains because the Windows build workflow extracts it. That archive must be migrated to a verified replacement before it can safely be removed.

This is a normal, reversible commit, **not** Git history erasure: old commits and GitHub-hosted workflow artifacts may still contain earlier media. Any history rewrite or permanent removal needs a separate inventory, backup, assessment of open PRs, and explicit owner approval. Do not publish unreviewed chat-sourced photos, screenshots or videos.

## Public documentation images

The unapproved Windows CI screenshot gallery previously tracked under `docs/product/` was removed from the current `main` tree. No application icon, runtime asset, code, or installer input was removed. README presentation remains text-first until a curated, owner-approved product gallery is available.

Deleting tracked JPEG files on the branch does not erase copies in existing Git history, workflow artifacts, or third-party caches. Any irreversible history rewrite requires a separate backup and explicit approval.
