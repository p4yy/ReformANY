//! Per-user Explorer context menu support for the single portable EXE.
//! Unlike the NSIS install hooks, this uses HKCU only (no elevation).
use std::{env, path::PathBuf, process::Command};

#[cfg(all(windows, feature = "portable-media"))]
fn registry_tool() -> Result<PathBuf, String> {
    let root = env::var_os("SystemRoot").ok_or("Windows SystemRoot is missing")?;
    let tool = PathBuf::from(root).join("System32").join("reg.exe");
    if !tool.is_file() { return Err("Windows registry tool not found".into()); }
    Ok(tool)
}

#[cfg(all(windows, feature = "portable-media"))]
fn reg(tool: &PathBuf, args: &[&str]) -> Result<(), String> {
    let mut cmd = Command::new(tool);
    crate::external::hide_subprocess_window(&mut cmd);
    let status = cmd.args(args).status().map_err(|e| format!("Cannot update Explorer menu: {e}"))?;
    if !status.success() {
        return Err(format!("Explorer menu registry operation failed ({status})"));
    }
    Ok(())
}

/// Matches the native NSIS shell command and invocation semantics exactly.
pub fn update(enabled: bool) -> Result<(), String> {
    #[cfg(all(windows, feature = "portable-media"))]
    {
        let tool = registry_tool()?;
        let executable = env::current_exe().map_err(|e| format!("Executable path unavailable: {e}"))?;
        let command = format!("\"{}\" orbit \"%1\"", executable.display());
        let icon = format!("{},0", executable.display());
        for path in [
            r"HKCU\Software\Classes\*\shell\ReformANYOrbit",
            r"HKCU\Software\Classes\Directory\shell\ReformANYOrbit",
        ] {
            if !enabled {
                // A missing key is already disabled. Reg.exe uses exit 1 in that case.
                let mut cmd = Command::new(&tool);
                crate::external::hide_subprocess_window(&mut cmd);
                let _ = cmd.args(["delete", path, "/f"]).status();
                continue;
            }
            reg(&tool, &["add", path, "/v", "MUIVerb", "/t", "REG_SZ",
                "/d", "ReformANY Orbit", "/f"])?;
            reg(&tool, &["add", path, "/v", "Icon", "/t", "REG_SZ",
                "/d", &icon, "/f"])?;
            let cmd_path = format!("{path}\\command");
            reg(&tool, &["add", &cmd_path, "/ve", "/t", "REG_SZ",
                "/d", &command, "/f"])?;
        }
        Ok(())
    }
    #[cfg(not(all(windows, feature = "portable-media")))]
    {
        let _ = enabled;
        Ok(())
    }
}

#[tauri::command]
pub fn portable_context_supported() -> bool {
    cfg!(all(windows, feature = "portable-media"))
}

#[tauri::command]
pub async fn set_portable_orbit_context(enabled: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || update(enabled))
        .await.map_err(|e| format!("Explorer menu operation stopped: {e}"))?
}
