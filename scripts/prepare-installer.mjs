// Build-time only. The installed application never downloads assets.
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
if (platform() === "win32") {
  const result = spawnSync("powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/prepare-installer.ps1"],
    { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Unable to generate Windows installer artwork");
}
