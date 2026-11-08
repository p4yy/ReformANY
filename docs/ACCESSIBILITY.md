# Accessibility and localization release checklist

The ReformANY core workspace includes 14 language choices, including Arabic, Persian and Urdu, with an initial RTL layout. This is **not yet** a WCAG certification or a claim that every settings and engine string has been translated.

## Automated checks

- Run `node scripts/audit-i18n.mjs` to assert all 14 core dictionaries have matching keys and no blank translations.
- Run `npm run build` and `cargo test --manifest-path src-tauri/Cargo.toml` for baseline regressions.
- The static CSS baseline includes focus-visible outlines, forced-colors support, logical layout, and reduced-motion behavior.

## Manual Windows acceptance criteria

- [ ] Traverse the full app and all Orbit sections using only Tab, Shift+Tab, Enter and Escape, at 100% and 200% DPI.
- [ ] Test keyboard focus order after adding files and after completing/cancelling a conversion.
- [ ] Verify Narrator announces file chooser buttons, conversion status and the Orbit sounds switch.
- [ ] Test Windows High Contrast and reduced-motion enabled, including visible focus indicators.
- [ ] Test English, French, Arabic, Persian and Urdu across 100%/150% DPI and narrow windows.
- [ ] Confirm filenames, measurements, paths, timestamps, file extensions and percentages remain legible in RTL, using mixed Unicode test data.
- [ ] Confirm system theme follows Windows switching and sound preference persists.
- [ ] Audit all engine screens for untranslated English strings before claiming full localization.
- [ ] Test document rendering with right-to-left PDFs and mixed Latin/Arabic text.
- [ ] Confirm sounds do not block navigation if no audio device is present.

## Known gaps

- Engine-specific screens still contain English literals: the 14-language dictionary currently covers the main shell and key Appearance controls.
- Full screen-reader audit and UI automation are pending.
- Every icon-only control needs a meaningful accessible name.
- Color contrast should meet WCAG AA targets, subject to actual Windows testing.
