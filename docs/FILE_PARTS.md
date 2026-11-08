# Native file splitting and joining

ReformANY can divide an ordinary file into numbered parts and rejoin it later without installing 7-Zip or WinRAR.

## Split

Open **Archives → Split file**, select one regular file, choose a part size (1 MB–1 GB in the current interface), and optionally choose a destination folder.

The app creates:

- `example.bin.001`, `example.bin.002`, …
- `example.bin.reformany.parts.json` (the manifest)

Each displayed MB is 1,048,576 bytes (MiB). The Rust engine accepts 1–4,096 MiB, but limits output to 999 numbered parts and inputs to 16 GiB. Existing files are never overwritten. Splitting runs entirely locally.

## Join

Choose **Archives → Join parts** and select the matching `.reformany.parts.json` manifest. Keep the manifest and all numbered parts together in the same folder.

ReformANY checks the manifest schema, the expected filenames, the size of each part and the SHA-256 checksum of the combined bytes *before* publishing the restored file. A missing, modified or out-of-order part causes the operation to fail without publishing a result. The source and parts remain untouched. When the original filename is taken, the restored file receives a new suffix rather than overwriting it.

## Important limitations

- These are **raw file parts**, not ZIP/7z/RAR archives or multi-volume compressed archives.
- Parts are **not compressed or encrypted**. Use encrypted ZIP/7z for confidentiality; choosing a split size alone does not provide encryption.
- The JSON manifest is required for this verified join mode. ReformANY does not claim compatibility with third-party `.001` join conventions or WinRAR `.partN.rar` volume handling.
- SHA-256 detects accidental modification against the manifest, but a malicious actor who replaces both parts and the manifest could forge a matching checksum. It is not a digital signature.
- Do not rename the parts or manifest after splitting.
- Real Windows Explorer and removable-drive QA is pending; CI Rust tests cover successful round-trip, missing parts, tampering and unsafe manifest names.
