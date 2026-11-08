# ReformANY Orbit — Windows Explorer quick conversion

Orbit is a small **400 × 400 pixel**, circular, undecorated Tauri window. It is a separate window mode of the same binary, not a second processing implementation.

## Launch contract

```powershell
& "C:\Path\To\ReformANY.exe" orbit "C:\Users\Someone\Desktop\photo with spaces.png"
```

The startup command accepts exactly two arguments: the literal `orbit` and one file path. On Windows, the panel appears near the mouse and stays within the monitor work area.

## Right-click integration

The **NSIS installer** registers the classic Explorer verb `ReformANY Orbit` for all files. It uses a fully quoted executable path and fully quoted `%1` file path, with the app icon. It unregisters the key during uninstall. Installation scope is inherited from the NSIS installer.

**Windows 11 note:** Classic verbs often appear in **Show more options**, rather than the primary compact context menu. Implementing a native first-level Windows 11 Explorer command requires a separate, tested COM shell extension and installer registration. Orbit does not pretend that is already present.

**Important:** Launching from a development command (`npm run tauri dev`) does not install or register the Explorer menu. Install the new NSIS installer to add the context action.

## Conversion behavior

- Quick-choice buttons: JPEG, PNG, WebP and BMP. The full workspace additionally supports static GIF and single-page TIFF.
- Uses the same verified Rust `convert_batch` pipeline as the main app.
- Source is never overwritten; conversion outputs are saved alongside originals with collision suffixes.
- Clicking a format starts conversion; hover merely highlights it.
- A compact indeterminate progress indicator is shown; no fake percentage.
- Success includes a real **Show file** action and an option to convert again.
- Unsupported files display a clear message, not a deceptive conversion button.
- Preview is generated in Rust from the selected image and sent as a small data URI.
- Press Escape or the X to close the panel.
- **Full app** opens the main workspace.

## QA

- [ ] Install NSIS build over previous preview.
- [ ] Right click a PNG on Desktop → Show more options (Win11) → ReformANY Orbit.
- [ ] Verify Orbit opens near cursor, is circular and stays on screen at 100% and 150% DPI.
- [ ] Choose WebP; verify output exists, opens and original remains.
- [ ] Repeat conversion; verify a suffix is used rather than overwrite.
- [ ] Convert file in a path with spaces / Unicode.
- [ ] Try JPEG, PNG, WebP, BMP and unsupported PDF.
- [ ] Verify progress does not claim fake percentages, and Show file works.
- [ ] Test close/Escape, and launch Full app.
- [ ] Uninstall, verify context-menu entry is removed.
- [ ] Check Windows and Linux CI before release.
