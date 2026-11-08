# Windows 11 native Orbit menu

ReformANY currently installs a **classic** `ReformANY Orbit` right-click action for files and folders. On Windows 11, classic actions may appear only under **Show more options**.

This integration branch adds the native Windows 11 mechanism, but **does not silently install it on end-user computers yet**. The preview installer is unsigned; Windows requires a trusted signed identity package for native top-level context-menu registration.

## Components

- `src-tauri/windows/orbit/OrbitExplorerCommand.cpp`: a minimal COM `IExplorerCommand` DLL. Explorer receives an item, then the DLL launches `ReformANY.exe orbit "<path>"` without using a shell, avoiding expensive conversion work in Explorer.
- `src-tauri/windows/orbit/AppxManifest.xml`: sparse external-location identity package declaring the COM class and file/folder commands.
- `scripts/build-orbit-context.ps1`: compiles the DLL and packs an **unsigned validation-only** MSIX on Windows.
- `.github/workflows/orbit-context.yml`: validates the x64 DLL and MSIX layout in CI.

## Build validation

On an x64 MSVC developer shell with the Windows SDK:

```powershell
./scripts/build-orbit-context.ps1
```

The output is explicitly labelled `UNSIGNED-TEST-ONLY`. **Do not distribute it as an installable package.** It is for checking the native code and MSIX schema.

## Production requirements (still pending)

1. Obtain a trusted signing certificate matching the Package Identity Publisher (`CN=Acev Dev Co` is an example and may need to change to match the real signing identity).
2. Build, sign, and verify an x64 identity MSIX using the Windows SDK's MakeAppx and SignTool. The COM DLL must be copied next to `ReformANY.exe` and registered with that exact external install location.
3. During NSIS installation, register the signed MSIX with `Add-AppxPackage -Path "<signed package>" -ExternalLocation "<installed app directory>"`. On uninstall, remove the exact package identity; maintain the legacy file/folder verbs as a safe fallback if registration is unavailable.
4. Test installation, right-clicking a file and a folder, full removal, updates, and Explorer responsiveness on a real Windows 11 machine. Signing validation and registration failures must be surfaced without claiming Orbit is installed.

We will **not** silently add a developer/self-signed certificate to users' Trusted Root store or weaken the Windows package signature policy. Classic Orbit remains available until the signed native integration is verified.

Official references:
- https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/integrate-packaged-app-with-file-explorer
- https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps
