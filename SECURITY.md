# Security policy

ReformANY processes local files, including untrusted media, documents and archives. Please disclose security issues privately so maintainers can investigate before details become public.

## Supported versions

The repository currently has a **development/preview branch**, not a published stable version. Security support for v1.0.0 starts only after its official release. Older test artifacts and unsupported branches do not receive guaranteed fixes.

## Reporting a vulnerability

1. Use **Security → Advisories → Report a vulnerability** on [the official repository](https://github.com/p4yy/ReformANY/security/advisories) if private vulnerability reporting is enabled.
2. If the private form is unavailable, use the [owner profile](https://github.com/p4yy) to request a private reporting channel. Do **not** post exploit details, sensitive sample documents or credentials in a public issue.
3. Include the affected build SHA/version, Windows version, reproduction steps, expected impact and a minimal non-sensitive test file if possible.

Please allow time for triage and coordinated remediation. We will acknowledge verified findings through the reporting channel when practical; this is not a contractual response-time commitment. Avoid testing against others' computers or data.

## Security boundaries

- Files are processed locally, but external tools such as FFmpeg, LibreOffice and 7-Zip have their own security and update policies.
- An unsigned portable executable or installer is not equivalent to a verified publisher signature. Download only from official GitHub Releases after confirming checksums.
- If credentials have ever entered a commit or log, they must be **revoked or rotated** even if the file is later removed. History rewriting alone does not protect exposed credentials.
- See [privacy](docs/PRIVACY.md), [format limitations](docs/FORMAT_SUPPORT.md) and the [release-readiness audit](docs/RELEASE_READINESS_AUDIT.md).
