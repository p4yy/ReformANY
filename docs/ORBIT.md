# ReformANY Orbit

Orbit is ReformANY's circular Windows file shortcut. It opens from the classic File Explorer context menu and provides **Convert**, **Tools** and **Actions** for the selected file or folder. Some operations open a separate native tool window for longer forms, PDF page previews and output settings.

## Open Orbit

1. Select a file or folder in File Explorer.
2. Right-click and choose **ReformANY Orbit**. On Windows 11, the classic command may be under **Show more options**.
3. Choose the action available for that source type.
4. Review the result in its destination folder. Source files are preserved for normal conversion operations.

The installed build registers Explorer integration. A source-development session does not necessarily install it. The official portable EXE has an optional per-user context-menu registration flow; portable operation itself does not require registration.

## File and folder Shake gesture

The development build includes an optional native Windows **hold-and-shake** gesture for an Explorer drag selection. The gesture detector uses the Windows shell's drag information to identify a single file or folder before asking Orbit to open; it does not intentionally copy or move the selection.

- Enable or disable the gesture in settings and choose a sensitivity.
- The native listener depends on a real Explorer drag and Windows desktop interaction, so gesture behavior can vary by environment.
- File and folder support is implemented in the listener, but **manual verification remains required** across Windows versions, DPI settings, mouse devices and Explorer views.

Shaking is not required to use Orbit. The right-click command is the supported fallback.

## Available tools

Orbit adapts its choices to the selected source. Supported panels and actions include:

- Quick image conversion for available JPEG, PNG, WebP, BMP and other supported raster targets.
- PDF page preview, ordering, extraction and page-image export, plus watermark, visible signature and protection tools.
- File and folder actions such as rename, copy and supported archive/file utilities.
- Local previews and selected actions through **HoveR**.

Unsupported file/format combinations should be disabled or explained rather than presented as successful conversions.

## Longer PDF panels

Orbit tool windows have a **scrollable outer-right panel area**, with a separate visible footer where the action has Save/Cancel controls. The verified Windows build scrolled a synthetic 269-page PDF using the mouse wheel, scrollbar track click, thumb drag and navigation to its last page.

The automated test checks the specific Arrange PDF pages workflow. Other panels and real-world documents still need manual Windows visual and interaction tests during release acceptance.

## Safety

- The normal conversion pipeline writes separate output files instead of silently overwriting the input.
- Deletion and shred actions are **destructive**. SSDs, backups and cloud-sync systems may retain data despite an overwrite attempt; use appropriate device-level secure deletion procedures for sensitive media.
- A visible PDF signature is not a certificate-based digital signature.
- Password protection requires a valid password and does not recover forgotten owner credentials.
- Actual supported formats and engine requirements are documented in [FORMAT_SUPPORT.md](FORMAT_SUPPORT.md).

## Development checks

- Test the classic Explorer menu on Windows 10 and Windows 11, including **Show more options**.
- Test file/folder selection and the optional shake gesture with a real mouse on the desktop.
- Verify correct previews, keyboard operation, Escape/Close, and output collision handling.
- Test a large PDF in both normal and maximized windows and reach the last page by wheel and scrollbar drag.
- Verify cancellation leaves no false success notification or unrequested changes to originals.

See the [release checklist](RELEASE_CHECKLIST.md) and [development guide](DEVELOPMENT.md) for broader acceptance requirements.
