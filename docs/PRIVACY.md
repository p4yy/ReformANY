# ReformANY: offline and privacy contract

ReformANY conversions run on the user's own PC. The application does not require accounts, cloud conversion, telemetry, or automatic update checks. There is no app-initiated web request in first-party runtime code.

**Built in and offline:** static image conversion, PDF tools, local PDF.js document preview, ZIP creation and extraction, and local file actions.

**Other offline engines:** The published v0.3.0 Windows installer and portable EXE bundle FFmpeg/FFprobe. Developer or customized builds can use a locally installed engine. Other optional routes may need 7-Zip, WinRAR, LibreOffice, or Calibre installed separately. Conversion commands do not upload files for remote processing.

**PDF and Markdown previews:** PDF.js parses a local in-memory byte array with bundled CMaps/fonts/decoders; Markdown cannot navigate to external links or load remote images.

**Windows setup:** the NSIS installer includes an offline WebView2 installer, instead of downloading a runtime on the destination PC. Packaging may need to download the vendor runtime on the build server, not the installed user's machine.

**Updates:** No background update checks. No automatic downloading. The **Check for updates** button in Engines only opens the official GitHub release page in an external browser after a user click; it does not automatically download software. Windows Defender, certificate verification, and operating-system services are outside the application's network boundary.

**Local security limitation:** external 7-Zip and WinRAR processes can expose password arguments to other sufficiently privileged local processes. Built-in encrypted ZIP avoids this CLI exposure. Passwords are not saved to settings.

**Storage:** recent conversion history and appearance/language settings are stored in the local WebView profile and are not synced to a cloud.

**Verification:** scripts/audit-offline.mjs scans authored code for accidental networking APIs and ensures PDF.js assets are bundled. This is not proof of zero packets across every Windows service; independent offline VM and firewall testing remains recommended.

All file originals are preserved by default. Processing may discard format metadata; retain source copies.
