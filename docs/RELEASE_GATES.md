# Windows release integrity and signing

The current ReformANY Windows installer is a preview. Installer signing must not be claimed until a valid Authenticode certificate is supplied and the signed build is verified.

## Implemented pipeline
- Windows CI builds the NSIS installer from the source repository.
- The release-integrity script emits a SHA-256 sidecar and a machine-readable signature status record.
- If signing credentials exist, Windows SDK signtool signs with SHA-256 and a trusted timestamp, then verifies Authenticode before uploading artifacts.
- Partial signing configuration or failed verification causes a build error.
- Without a certificate, the build is explicitly marked UNSIGNED.
- Signing runs on GitHub Actions and does not add application network activity.

## Owner-only GitHub Actions secrets (not configured)
- `REFORMANY_CERT_BASE64`: a base64-encoded legitimate PFX/P12 code-signing certificate.
- `REFORMANY_CERT_PASSWORD`: its encryption password.
- Store credentials in repository Actions secrets, never in code, app settings or the installer.

## Remaining release gates
- [ ] Obtain code signing identity and configure owner-held secrets.
- [ ] Verify certificate subject, timestamp, expiration and installed binary on Windows.
- [ ] Test installation and uninstallation on a clean Windows 10/11 VM without internet.
- [ ] Validate Explorer integration, no clobber, uninstall cleanup and all image/media engines.
- [ ] Publish a versioned release with installer, hash and SBOM.
- [ ] Run security and dependency audit including bundled external tools and license restrictions.
- [ ] Test High Contrast, RTL, keyboard and 200% DPI.

**No animated logo is bundled.** The animation waits for the new official artwork.
