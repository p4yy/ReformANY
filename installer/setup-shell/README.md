# ReformANY's owner-reference Windows setup shell

This folder is an adaptation of **the original owner-supplied 640 × 480 React,
Tailwind and Framer Motion installer**, stored without alteration in
`../reference/premium-installer-ui-prompt.zip`. The same five steps, layout,
animation primitives, typography and sage/olive theme are retained. The UI
uses the actual owner-supplied brand icon.

The reference is a demo and originally used a timer, random percentages, fake
file names, fake folder selection and fake installer options. Those have been
replaced in this copy with real Tauri commands, directory picker and an
*indeterminate* progress ring until the underlying NSIS installer exits. No
simulated operation can mark the setup complete.

## What is actually installed

The authoritative installer remains Tauri's NSIS installer. The React setup
shell embeds the actual **CI-built NSIS executable** at build time and executes
it silently. The checkbox for FFmpeg/FFprobe requests the already-implemented
checksum-pinned optional component. The desktop shortcut and classic Explorer
context-menu checkboxes map to `/NO_DESKTOP` and `/NO_CONTEXT` respectively.
Neither PATH nor Windows default file associations are changed.

The shell independently verifies the installed `ReformANY.exe`, plus media
engines when explicitly selected. Errors are visible and allow retry. The
Finish action launches the installed app if the option is selected.

## Building the two installers on Windows

1. Build the normal NSIS installer (`npm run tauri build` from the repo root).
2. In `frontend`, run `npm install`, `npx tsc --noEmit` and `npm run build`.
3. Set `REFORMANY_NSIS_PAYLOAD` to the absolute path of the built NSIS `.exe`.
4. Run `cargo build --release --manifest-path installer/setup-shell/src-tauri/Cargo.toml`
   from the repository root.
5. The resulting `reformany-setup.exe` is the *new React design* installer;
   the NSIS `.exe` remains the reliable native fallback.

The Windows CI workflow builds both on the same commit. No standalone React
mock installer is shipped as a release artifact.

## Open verification gates

The React bootstrapper itself relies on WebView2; clean machines without that
runtime may require the native NSIS installer to install WebView2 first.
A fully standalone bootstrapped WebView2 workflow or native renderer must be
verified on clean Windows 11 before setting this as the only distribution
option. Test all five screens, UAC/permissions, custom paths, 100%/125%/150%
DPI, keyboard navigation, offline installs, optional engine failure, reruns,
Explorer integration, and uninstall. Neither the presence of executable artifacts
nor passing source CI substitutes for physical Windows visual QA. Code signing
has not been completed.
