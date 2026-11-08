// Build-time only. The installed application never downloads assets.
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { statSync } from "node:fs";
import { join } from "node:path";
if (platform() === "win32") {
  const result = spawnSync("powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/prepare-installer.ps1"],
    { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Unable to generate Windows installer artwork");
  // Windows CI staged and SHA-256-verified the binaries before compilation.
  // Never silently re-download a 109 MB archive during bundling.
  const bundle = "src-tauri/installer/media-bundle";
  for (const file of ["ffmpeg.exe", "ffprobe.exe", "LICENSE", "SOURCE.txt"]) {
    let size = 0;
    try { size = statSync(join(bundle, file)).size; } catch { /* missing */ }
    if (size < (file.endsWith(".exe") ? 1024 * 1024 : 1)) {
      throw new Error(`Missing verified offline media payload: ${file}. Run scripts/prepare-media-bundle.ps1 before building on Windows.`);
    }
  }
}
