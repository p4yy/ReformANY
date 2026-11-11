# Original installer UI reference

The file `reference/premium-installer-ui-prompt.zip` is the owner's **unchanged**
React + Tailwind + Framer Motion reference. Do not replace it with a new design.

Visual fidelity: 640 × 480 sage/olive glass installer with five steps (welcome,
location, integration, progress, complete), animations, controls and typography.
The original ZIP is a *prototype*: it simulates file operations, progress,
install paths and several controls. None of those simulations may be presented
to end users as a functioning installer.

The actual shipping Windows installer currently uses Tauri NSIS. An exact
React UI installer needs a real setup bootstrapper that uses this source
and drives real NSIS installation, verifies exit codes and FFmpeg/FFprobe,
and propagates real errors and progress. Do not ship the mock ZIP by itself
or claim that the NSIS-themed wizard is pixel-identical to it.

Apply the owner's official brand from `src-tauri/icons/icon.png`
without redrawing the reference layout. Keep Windows launcher/icon,
context menu and uninstall integration functional.
