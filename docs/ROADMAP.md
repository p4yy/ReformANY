# ReformANY roadmap

Current published Windows release: **[v0.3.0](https://github.com/p4yy/ReformANY/releases/tag/v0.3.0)**. This roadmap is not a promise that arbitrary file formats can convert into each other.

## Available

- Main workspace, classic File Explorer **ReformANY Orbit**, HoveR and native tools.
- Supported image, PDF, media, archive, document, data and subtitle routes.
- Two direct-download Windows EXEs: portable application and premium installer.
- Local processing with automated build, native Rust and Windows checks.

Precise routes and limits: [FORMAT_SUPPORT.md](FORMAT_SUPPORT.md).

## Next priorities

1. Independently test published EXEs on clean Windows 10/11 computers, at varied DPI settings and screen sizes.
2. Test real-world large, malformed, encrypted and valid files; verify results in independent viewers.
3. Review accessibility, keyboard-only operation, focus, screen readers and high-contrast themes.
4. Improve cancellation, progress feedback, metadata and color fidelity.
5. Review code signing, third-party media/font licenses and security configuration.

## Longer term

- Add formats in small, tested routes with precise capability documentation.
- Explore native Windows 11 top-level Explorer menu integration when packaging and signing allow.
- Improve history management and cross-version compatibility.
- Publish future versions through the version-tag workflow.

See [release quality checks](RELEASE_CHECKLIST.md) for remaining independent QA.
