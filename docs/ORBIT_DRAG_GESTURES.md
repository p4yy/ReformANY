# Experimental Windows Orbit drag gestures

This is an **opt-in desktop prototype**. It is disabled by default and must not be described as shipping or fully reliable until direct Windows Explorer drag-and-drop testing has passed.

## What exists

While ReformANY is running, you can enable **Mouse shake** and/or **Drag scroll** under **Appearance → Orbit mouse control**.

- **Mouse shake:** Hold the left button, move by at least 22 physical pixels, then make three deliberate horizontal reversals inside approximately 1.3 seconds.
- **Drag scroll:** Hold the left button, move at least 22 physical pixels and scroll one wheel notch (120 Windows wheel units). Fine-resolution wheel increments accumulate.
- If detected, the separate 400-pixel circular Orbit opens near the pointer as a **file-drop target**. Move the dragged file over Orbit, then release it. The app receives its path only from the drop event.
- The new Orbit shows Convert, Tools and Actions as usual after a path is accepted. The real converter and archive commands are reused.
- The small pointer loading ring and in-Orbit scroll controls are independent features.

## Privacy / lifecycle

- No global hook is installed until the user explicitly enables one of the two experimental toggles.
- The hook is a local low-level **mouse-only** hook. It does not inspect keyboard input, read Explorer's drag data, read the clipboard, consume mouse events, or upload files.
- Disabling both options unhooks the monitor; exiting ReformANY stops it. It does **not** run while the application is closed, and it is not installed as a startup service.
- This detector sees mouse drags, not the identity of a dragged file. Shaking or scrolling while dragging a non-file object may also open Orbit; simply close it.
- The detector ignores injected mouse events and applies a single-activation-per-drag limit.

## Real Windows acceptance plan

1. With both options off, verify no gesture activation while dragging in Explorer or ordinary apps.
2. Enable shake; drag a PNG from File Explorer and shake without releasing. Check whether Orbit appears near the pointer.
3. Move over the actual circular window, drop the file and verify the correct filename, thumbnail and conversion options.
4. Repeat for a folder, ZIP archive, PDF, spaces/unicode filenames and a long path.
5. Test 120-unit wheels, fine wheel events, trackpads, DPI scaling, multiple displays and mixed input devices.
6. Verify no accidental activation during common UI drags and confirm global mouse input remains unaffected.
7. Disable the toggles and verify the hook no longer activates; exit the app and ensure no resident process remains.
8. Test repeated enabling/disabling and simultaneous older classic context-menu Orbit launch.
9. Verify loading ring, cancellation, file integrity and no source overwrite.

Native Windows hooks must not ship enabled by default. If Windows fails to transfer a drag that started before Orbit opened, the solution must be revised to use a reliable drop target rather than silently selecting a different path.

Microsoft documentation:
- https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc
- https://learn.microsoft.com/en-us/windows/win32/shell/dragdrop
