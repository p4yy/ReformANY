# Product specification (historical milestone 1)

This file records the original milestone-one scope; it is not the present release feature matrix. For current capabilities and limitations see [FORMAT_SUPPORT.md](FORMAT_SUPPORT.md).

## What ReformANY does

ReformANY turns supported file contents into other useful formats without uploading the source files. The first milestone is a desktop image converter, not a claim to convert arbitrary data into arbitrary output formats.

## Primary workflow

1. Import one or multiple supported images from a native picker or by dropping paths on the desktop window.
2. Identify the file using its content signature; show errors for unsupported/corrupt inputs.
3. Choose a target format for each file.
4. Optionally select an output folder; otherwise save beside the original.
5. Optionally choose JPEG quality or a transparency background for JPEG/BMP.
6. Convert in a bounded queue; show processing, completion, and failure.
7. Preserve the source file; ensure outputs don't overwrite existing files.

## Scope for milestone 1

- Windows-first Tauri shell with Rust processing engine.
- PNG, JPEG, WebP, BMP input/output.
- Actual local file processing, up to two workers at once.
- Per-file results and session activity, light/dark interface and accent selection.
- Safe staging and output collision protection.
- A documented format matrix and automated Rust regression tests.

## Explicitly out of scope in milestone 1

- PDF, Office, audio, video, archive conversions.
- GIF animation, SVG vectors, HEIC, RAW and AVIF.
- Resize and crop.
- Pausing an in-progress encoder.
- Full color-management and metadata preservation.
- Persistent conversion history across restarts.
- Installer/signing/release certification, until Windows smoke tests run.

## Acceptance evidence required

A release claim needs a successful Windows build, test logs, and manual verification of multiple real inputs and invalid files. Repository contents alone are not proof.
