# ReformANY — November 10 redesign defect audit (P0–P5)

**Authoritative screenshot-matched source:** draft PR #19; branch `fix/restore-green-orbit-media-and-installer-20261110`. **NOT a public release. Do not merge without desktop acceptance.**

> Important lineage correction: PR #16 (`fix/orbit-runtime-and-sage-20261108`) is the earlier UI and is **not the source of the screenshots**. This audit applies to the ZIP-UI redesign in PR #19.

## Evidence and diagnosis

Eight screenshots and the `Desktop 2026.11.10 - 21.48.59.02.mp4` screen recording show: displaced Orbit hub, dropdown text/chevron misalignment, setting-row baseline alignment, unreadable disabled/active light-sage text, native PDF Page range input overflowing its wrapper, Orbit panel scrolling, titlebar wordmark collision and panel window controls.

The actual source has **two CSS generations loaded into the same DOM**: `src/index.css` defines unlayered generic selectors `.field`, `.brand`, `.orbit-hub`, `.orbit-disc`; the redesigned ZIP UI components in `src/zip-ui.css` live under `@layer components`. By CSS cascade design, the unlayered earlier selectors can override later layered rules regardless of source order. This explains the apparent unrelated failures and the detached second circle: `src/index.css`'s absolutely positioned `.orbit-hub` targets the new inline **SVG `<g class="orbit-hub">`** instead of just the legacy HTML hub.

P0/P2 changes establish a **specificity-scoped, unlayered compatibility boundary** at the end of `src/zip-ui.css` for redesigned form controls, active/disabled text colors, ZIP titlebar brand, new SVG Orbit disc/hub, and native PDF page-control heights/scroll. No arbitrary screen-specific margin offsets were introduced.

## P1 — Source-traced action routing table

Line numbers are approximate to the amended PR #19 branch; exact lines may shift after documentation edits. **“Route” means static source and Rust command match; it does NOT mean tested in a running installed EXE.**

| Label and scope | Source/line anchor | Handler / actual native operation | Change or current disposition |
|---|---|---|---|
| Images — Add files / folder | `src/zip/components/DropZone.tsx` | `pickPaths` / native file picker, `inputsOf` | Existing |
| Images — Convert | `src/zip/modules/Images.tsx:46,239` | `convert` → `runJob(image.convert)` → `convert_batch` | Existing dedicated route |
| Images — Target format chips | `src/zip/modules/Images.tsx:140` | `onChange(setTarget)` | Existing state-only |
| Images — JPEG quality | `src/zip/modules/Images.tsx:164` | `setQuality` | Existing state-only |
| Images — Background swatches | `src/zip/modules/Images.tsx:169` | `setBg` | Existing state-only |
| Images — Max edge presets | `src/zip/modules/Images.tsx:204` | `setMaxEdge` | Existing state-only |
| Images — Rotate / grayscale | `src/zip/modules/Images.tsx:210-230` | `setRotate` / `setGrayscale` | Existing state-only |
| Images — Save outputs | `src/zip/modules/Images.tsx:106` | `saveAll` | Existing |
| Audio & Video — Convert media | `src/zip/modules/AudioVideo.tsx:82,188` | `runJob(media.convert)` → `media_convert` | Existing |
| Media Tools — Apply selected tool | `src/zip/modules/MediaTools.tsx:64,127` | `runJob` → configured media handler | Existing; tool state only selects operation |
| Archives — Create | `src/zip/modules/Archives.tsx:50` | `runJob(archive.create)` → `archive_create` | Existing |
| Archives — Extract | `src/zip/modules/Archives.tsx:83` | `runJob(archive.extract)` → `archive_extract` | Existing |
| Archives — Split file | `src/zip/modules/Archives.tsx:135` | `runJob(archive.split)` → `file_split` | Existing |
| Archives — Join and verify | `src/zip/modules/Archives.tsx:187` | `runJob(archive.join)` → `file_join` | Existing |
| Documents — Build PDF | `src/zip/modules/Documents.tsx:42,46` | `runJob(doc.images_to_pdf)` → `images_to_pdf` | Correct PDF creation; distinct from page export |
| Documents — Extract text | `src/zip/modules/Documents.tsx:71,75` | `runJob(doc.pdf_to_text)` → `pdf_to_text` | Correct text extraction |
| Documents — Convert TXT | `src/zip/modules/Documents.tsx:122,127` | `runJob(doc.text_to)` → `text_convert` | Existing |
| Documents — Convert to PDF | `src/zip/modules/Documents.tsx:163,167` | `runJob(doc.office_to_pdf)` → `office_to_pdf` | Existing; LibreOffice required |
| Documents — Split PDF | `src/zip/modules/Documents.tsx:210,214` | `runJob(doc.split_pdf)` → `pdf_split` | Existing |
| Subtitles — Convert | `src/zip/modules/Subtitles.tsx:17,96` | `runJob(subtitle.convert)` → `subtitle_convert` | Existing |
| Spreadsheets — Convert | `src/zip/modules/Spreadsheets.tsx:49,160` | `runJob(sheet.convert)` → `spreadsheet_convert` | Existing |
| E-books — Convert to EPUB | `src/zip/modules/Ebooks.tsx:66,75` | `runJob(ebook.to_epub)` → `ebook_convert_file` | Existing, Calibre dependency |
| Preview — Previous / Next | `src/zip/modules/Preview.tsx:171-182` | `setPage` | Existing, state-only |
| Preview — Zoom in/out | `src/zip/modules/Preview.tsx:189-195` | `step` / zoom state | Existing, state-only |
| Preview — Close file | `src/zip/modules/Preview.tsx:203` | `close` | Existing, state-only |
| Activity — Convert some images | `src/zip/modules/Activity.tsx:37` | `navigate("images")` | Existing; disabled/active contrast corrected in CSS |
| Activity — History filter | `src/zip/modules/Activity.tsx:45` | `setFilter` | Existing |
| Settings — Theme | `src/zip/modules/PrefsAppearance.tsx:49-52` | `update({theme})` | Existing; contrast corrected |
| Settings — Language | `src/zip/modules/PrefsAppearance.tsx:67` | `update({language})` | Existing; select aligned |
| Settings — Orbit section shortcut keys | `src/zip/modules/PrefsAppearance.tsx:157` | `setKey` | Existing; aligned select and label |
| Settings — Close to tray | `src/zip/modules/PrefsAppearance.tsx:79` | `update({closeToTray})` → native preference | Existing |
| Settings — Orbit scroll control | `src/zip/modules/PrefsAppearance.tsx:146` | `update({orbitScrollSections})` | Existing |
| Settings — Test Orbit / reset controls | `src/zip/modules/PrefsAppearance.tsx:130,194` | `resetOrbit` / `openOrbit` | Existing |
| Settings — Output folder picker | `src/zip/modules/PrefsFiles.tsx:61` | `browse` and `update(outputPath)` | Existing |
| Settings — Add/delete watch rule | `src/zip/modules/PrefsFiles.tsx:118,140` | `addRule` / `update(watchRules)` | Existing |
| Settings — Recheck engines | `src/zip/modules/PrefsEngines.tsx:27` | `check` | Existing |
| Topbar — Search | `src/zip/shell/TitleBar.tsx:54` | `onPalette` | Existing |
| Topbar — Orbit | `src/zip/shell/TitleBar.tsx:60` | `onOrbit` | Existing |
| Topbar — Theme icon | `src/zip/shell/TitleBar.tsx:65` | `update(theme)` | Existing |
| Topbar — Minimize | `src/zip/shell/TitleBar.tsx:70` | `win.minimize()` | Existing native |
| Topbar — Maximize / Restore | `src/zip/shell/TitleBar.tsx:74-79` | `win.toggleMaximize()` | **Fixed** icon state from native `isMaximized` and resize events, not browser fullscreen |
| Topbar — Close | `src/zip/shell/TitleBar.tsx:82` | `onClose` from shell | Existing; app close-to-tray setting applies |
| Orbit — Convert to PNG/JPG from PDF | `src/zip/orbit/data.ts:63-69`, `src/zip/lib/bridge.ts:~198` | `to-png`/`to-jpg` → `renderPdfPageImages` (PDF.js) → native `pdf_save_rendered_pages` | **Fixed wrong routing**: previously called text export for image targets |
| Orbit — PDF to DOCX (layout) | `src/zip/lib/bridge.ts:~198` | `to-docx-layout` → `renderPdfPageImages(...,"png")` → native `pdf_docx_layout` | **Fixed invalid `images:false` payload**, supplies the required PNG pages |
| Orbit — PDF to DOCX (editable) | `src/zip/lib/bridge.ts:~198` | `to-docx-edit` → native `pdf_docx_editable` | Existing; separate editable output |
| Orbit — PDF to TXT/MD/HTML | `src/zip/lib/bridge.ts:~208` | `pdf_to_text_format` | **Guarded** to text targets only |
| Orbit — Image to PDF | `src/zip/lib/bridge.ts:~187` | `images_to_pdf` | Existing; not page extraction |
| Orbit — Image format conversion | `src/zip/lib/bridge.ts:~187` | `nativeConvertImages` → `convert_batch` | Existing |
| Orbit — Media conversion | `src/zip/lib/bridge.ts:~193` | `media_convert` | Existing |
| Orbit — PDF Extract pages | `src/zip/orbit/data.ts:81`, `src/zip/lib/bridge.ts:~165` | `orbit_open_panel("extract-pages")` → `pdf_extract_pages` | Existing; label revised |
| Orbit — PDF Split | `src/zip/orbit/data.ts:80` | native `orbit_open_panel("split-pdf")` → `pdf_split` | Existing; **Split Pages → Split PDF** |
| Orbit — Rotate 90° | `src/zip/orbit/data.ts:82`, `src/zip/lib/bridge.ts:181` | `pdf_rotate_pages(degrees:90)` | Existing; label retained because angle is truly 90° |
| Orbit — Extract embedded images | `src/zip/orbit/data.ts:83`, `src/zip/lib/bridge.ts:182` | native `pdf_extract_images` | Existing; distinct from full-page PNG/JPG |
| Orbit — Arrange pages | `src/zip/orbit/data.ts:85` | `orbit_open_panel("arrange")` → native PDF arranger | Existing; label revised |
| Orbit — Sign/Watermark | `src/zip/orbit/data.ts:79-86` | native `orbit_open_panel` with distinct panel kind | Existing |
| Orbit — Rename | `src/zip/orbit/data.ts:95` | native panel → `rename_file` | Existing |
| Orbit — Copy path | `src/zip/orbit/OrbitStage.tsx:71` | `copyText(context.path)` | Existing; does not copy file |
| Orbit — Copy file | `src/zip/lib/bridge.ts:172` | folder picker → `copy_file_to` | Existing |
| Orbit — Show file / Open folder | `src/zip/lib/bridge.ts:169` | `reveal_output` | Existing |
| Orbit — Terminal | `src/zip/lib/bridge.ts:170` | `open_terminal` | Existing |
| Orbit — Bluetooth | `src/zip/lib/bridge.ts:171` | `send_bluetooth` | Existing |
| Orbit — More tools | `src/zip/orbit/OrbitStage.tsx:60-70` | native `orbit_open_panel("more-tools")` | **Fixed** double routing: no simultaneous media-page navigation on Windows |
| Orbit — Shred | `src/orbit/OrbitDialogs.tsx:87+` | explicit confirmation + `shred_confirm` | Existing; require disposable fixture test |
| Orbit — Close PDF panel | `src/native/OrbitPanelWindow.tsx:26` | Tauri `getCurrentWindow().close()` | **Fixed** swallowed rejection; user-readable error fallback |
| Orbit — Fullscreen PDF panel | `src/orbit/OrbitDialogs.tsx:25-80` | `getCurrentWindow().setFullscreen` + `onResized` | **Fixed** icon synced to native state |

**Not found in the checked redesign:** a UI action literally labeled “Feature cover”. No fabricated route was assigned. The complete “every button is live” claim requires interaction-based, per-button acceptance on the **installed** Windows build with PDF, image, Office, archives, media and destructive-action test fixtures.

## P0, P2, P3, P4 — file-by-file fixes

| File | Change and root cause |
|---|---|
| `src/zip-ui.css` | Last unlayered scoped contract overrides legacy unlayered `.field`, `.brand`, `.orbit-hub` and `.orbit-disc` leaking into redesigned ZIP UI; select alignment, high-contrast active/disabled controls, wordmark spacing, intrinsic PDF form layout, tall panel scroll and SVG hub centering. Additional native Orbit titlebar styling removes the last circular CSS frame around the shared mark. |
| `src/zip/lib/pdf.ts` | New bounded PDF.js page rasterizer; ≤60 pages, ≤16 million pixels per rendered page and ≤20MB encoded image, clears canvas resources and destroys document |
| `src/zip/lib/bridge.ts` | PDF conversion dispatch no longer aliases JPG/PNG page rendering to text conversion, or sends invalid boolean to layout-DOCX; calls dedicated Rust publishers with validated base64 page images |
| `src/zip/orbit/OrbitStage.tsx` | More tools now opens one native panel or navigates in browser preview; never both, errors surfaced |
| `src/zip/shell/TitleBar.tsx` | Native `isMaximized` and `onResized` instead of mismatched `document.fullscreenElement` |
| `src/native/OrbitPanelWindow.tsx` | Native close rejection surfaced rather than dropped |
| `src/orbit/OrbitDialogs.tsx` | Native tool fullscreen state observes resize; Page range instructions corrected; frame-free shared titlebar mark |
| `src/components/ReformanyMark.tsx` | Shared transparent circular SVG icon, matched to existing ZIP `LogoMark` paths, no tile by default |
| `src/zip/components/ui.tsx` | Delegates `LogoMark` to shared mark; transparent by default |
| `src/orbit/OrbitHUD.tsx` | Replaces framed 512px PNG in native radial hub with shared SVG |
| `src/zip/orbit/data.ts` | Labels standardized, original action IDs preserved |

**Remaining brand gap:** `public/brand/reformany-icon.png` and `src-tauri/icons/icon.png` are still the existing green glow/square **raster** (not the transparent SVG mark). The main desktop/taskbar/installer packaging icon is not yet replaced with a verified officially supplied transparent asset. Do not claim P4 complete.

## P5 — string diff (exact changed text)

| File | Before | After | Reason |
|---|---|---|---|
| `src/orbit/OrbitDialogs.tsx` | `Range Pages` | `Page range` | Correct English field wording |
| `src/orbit/OrbitDialogs.tsx` | `Pages to extract` (aria-label) | `Page range` | Accessibility naming matches visual label |
| `src/orbit/OrbitDialogs.tsx` | `Use an ascending range, such as 1,3-5,9.` | `Use an ascending page range, such as 1, 3-5, 9.` | Clarifies example |
| `src/zip/orbit/data.ts` | `Split Pages` | `Split PDF` | Describes output |
| `src/zip/orbit/data.ts` | `Extract Pages` | `Extract pages` | Consistent sentence case |
| `src/zip/orbit/data.ts` | `Extract Images` | `Extract images` | Consistent sentence case |
| `src/zip/orbit/data.ts` | `Arrange Pages` | `Arrange pages` | Consistent sentence case |
| `src/zip/orbit/OrbitHUD.tsx` | `Pdf` (extension title case) | `PDF` | Correct acronym in redesigned Orbit status |
| `src/orbit/OrbitHUD.tsx` | `Pdf` (detected file kind) | `PDF` | Correct acronym in native Orbit status |

No claim is made that all strings across translations have been audited to completion.

## Verification — actual CI commands

The PR workflow `.github/workflows/checks.yml` runs:

```sh
npm install --no-audit --no-fund
npm run build                      # prebuild: node scripts/prepare-pdf-assets.mjs
                                   # build: tsc --noEmit && vite build
node scripts/audit-offline.mjs
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

The Windows PR workflow `.github/workflows/windows-release.yml` additionally builds native Windows tests, `npm run tauri build`, HoveR smoke test, the actual five-step `reformany-setup.exe` premium installer and its offline UI tests, plus installer/Orbit/FFmpeg/portable regression tests. CI produces **private PR artifacts only**, not a public GitHub Release.

- Source CI: https://github.com/p4yy/ReformANY/actions/runs/42917421679 (note: report commit may cause this run to be superseded by a new run)
- Windows CI: https://github.com/p4yy/ReformANY/actions/runs/42917421676 (same caveat)

**No local installed-Windows output is available in this environment.** Cite completed GitHub Actions steps and their actual logs, not promises. A later audit commit can supersede the workflow IDs above. The exact latest workflow result must be checked on the final branch SHA.

## Acceptance matrix

| Requirement | Status |
|---|---|
| P0 controls centered, uniform height, dark foreground on pale sage | Source corrected; Windows screenshot comparison pending |
| P0 all pages A–Z at min/default/max sizes with zero clipping | Not yet proven; needs automated/window resize visual tests |
| P1 feature-to-handler correspondence | Static routes traced; PDF image and DOCX crosswires fixed; end-to-end matrix not complete |
| P2 second hub circle | Root-cause SVG selector conflict corrected; Windows pixel verification pending |
| P2 tall native PDF tool editors scroll to footer | Source corrected; actual scroll-end tests pending |
| P3 close/maximize and icons | Source corrected; native runtime verification pending |
| P4 on-screen logo without box | Shared vector implemented in ZIP header, native wheel, PDF panel; **installer/taskbar PNG not replaced** |
| P5 label/casing examples | Seven precise string changes; exhaustive locale/text audit pending |
| Frontend build/typecheck | GitHub Actions exact SHA must be completed and checked |
| Rust/Windows installer tests | GitHub Actions exact SHA must be completed and checked |
| No public release | **Satisfied** — PR #19 is draft and unmerged, no release published by this work |

### Sign-off policy

No public release, no merge to main, no completion claim until CI succeeds on the latest branch SHA and the user confirms the *actual installed* Windows app's layout, conversion routing and Orbit behavior.
