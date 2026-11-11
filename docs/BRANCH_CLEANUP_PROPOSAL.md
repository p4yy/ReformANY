# Branch cleanup proposal — 11 November 2026

**Proposal only. No remote branches were deleted, rebased or force-pushed.**

The snapshot has **24 remote branches**: the protected-intent default `main`, eight branches attached to open pull requests (including the new documentation PR), and 15 additional branches with commits that have not been proven redundant. Numbers below are `main...branch` comparisons when this inventory was generated, not proof that features were not already squash-merged.

## Preserve now: default branch and open PRs

Keep `main` intact until the complete application/security review and release. These open pull-request branch references remain needed:

| Branch | Open PR |
| --- | ---: |
| `chore/v1-release-readiness-20261111` | [#20](https://github.com/p4yy/ReformANY/pull/20) |
| `design/desktop-orbit-ui-refinement` | [#15](https://github.com/p4yy/ReformANY/pull/15) |
| `feat/experimental-explorer-drag-gestures` | [#9](https://github.com/p4yy/ReformANY/pull/9) |
| `feat/format-accessibility-security` | [#2](https://github.com/p4yy/ReformANY/pull/2) |
| `feat/redesign-integration-2026-11-10` | [#18](https://github.com/p4yy/ReformANY/pull/18) |
| `feat/windows11-orbit-native-context` | [#7](https://github.com/p4yy/ReformANY/pull/7) |
| `fix/orbit-runtime-and-sage-20261108` | [#16](https://github.com/p4yy/ReformANY/pull/16) |
| `fix/restore-green-orbit-media-and-installer-20261110` | [#19](https://github.com/p4yy/ReformANY/pull/19) |

## Candidates to review after full backup and final merge

Every branch below **diverges from main**, including at least one commit not reachable from current main; a direct automated delete would be premature. Some old work may already have been **squash-merged**. Review exact content, provenance and open dependencies before proposing individual deletion.

| Branch | Ahead of main | Behind main |
| --- | ---: | ---: |
| `docs/current-format-support` | 1 | 3 |
| `docs/refresh-roadmap-after-engines` | 1 | 2 |
| `feat/first-run-welcome-orbit` | 8 | 9 |
| `feat/native-file-split-join` | 9 | 9 |
| `feat/native-java-zip-extraction` | 1 | 4 |
| `feat/orbit-mouse-navigation` | 6 | 7 |
| `feat/orbit-slices-controls` | 1 | 9 |
| `fix/orbit-installer-context-smoke` | 4 | 7 |
| `fix/orbit-native-zip-folders` | 7 | 13 |
| `fix/retry-nsis-504-installer` | 1 | 1 |
| `fix/use-official-reformany-logo` | 2 | 6 |
| `work/accessibility-release-hardening` | 2 | 23 |
| `work/format-engines-qa` | 16 | 4 |
| `work/offline-media-protocols` | 2 | 24 |
| `work/orbit-hover-audio` | 1 | 24 |

## Safe cleanup sequence

1. Wait until PR #19 application review and its required fixes, plus PR #20 release documentation/security requirements, are resolved on `main`. Re-fetch the full branch list and their open PR references.
2. Preserve a complete independent backup outside GitHub before deleting refs. Example on a trusted full clone:
   ```sh
   git fetch --all --tags --prune
   git bundle create ReformANY-pre-v1-branch-cleanup.bundle --all
   git bundle verify ReformANY-pre-v1-branch-cleanup.bundle
   ```
   Keep this bundle securely and verify it can be read; do not commit the backup binary to the public repository. If preserving server-side, create private backup tags/refs for the precise head SHA of each candidate.
3. Compare each candidate's exact tree against the merged `main`, including any squash-merges. Confirm it contains no required work, references from active PRs or historical evidence worth keeping.
4. Show the owner a per-branch **delete / keep** table with exact head SHA, evidence of merger/redundancy and backup location. **Obtain explicit approval before any deletion.**
5. Only then remove individually approved refs with `git push origin --delete <branch>`; never delete `main`, live PR branches, or a branch with unreviewed unique commits.
6. Avoid history rewriting and force pushes entirely. Git tags are permanent user-visible anchors once published; create the v1.0.0 tag only from the validated main commit and after the version/security/license gates.

**No branch deletion has been authorized or performed.** This inventory is intentionally conservative.
