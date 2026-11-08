use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    path: String,
    name: String,
}

fn valid_filename(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 240 ||
        trimmed == "." || trimmed == ".." ||
        trimmed.ends_with('.') || trimmed.ends_with(' ') ||
        trimmed.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
    {
        return false;
    }
    let stem = trimmed.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    !matches!(stem.as_str(), "CON"|"PRN"|"AUX"|"NUL"|"COM1"|"COM2"|"COM3"|"COM4"|"COM5"|"COM6"|"COM7"|"COM8"|"COM9"|
        "LPT1"|"LPT2"|"LPT3"|"LPT4"|"LPT5"|"LPT6"|"LPT7"|"LPT8"|"LPT9")
}

#[tauri::command]
pub async fn rename_file(path: String, new_name: String) -> Result<RenameResult, String> {
    if !valid_filename(&new_name) { return Err("Invalid Windows filename".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let old = PathBuf::from(&path);
        crate::external::verify_input(&old, false)?;
        let parent = old.parent().ok_or("Cannot determine parent folder")?;
        let new = parent.join(&new_name);
        if new.exists() {
            return Err("A file with that name already exists".into());
        }
        // On Windows, rename across the same folder is atomic if no collision.
        fs::rename(&old, &new).map_err(|e| format!("Rename failed: {e}"))?;
        Ok(RenameResult {
            path: new.to_string_lossy().into_owned(),
            name: new_name,
        })
    }).await.map_err(|_| "Rename worker failed".to_owned())?
}

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    let folder = if path.is_dir() { path } else {
        path.parent().ok_or("Cannot determine the folder")?
    };
    if !folder.is_dir() { return Err("Selected folder does not exist".into()); }
    #[cfg(target_os = "windows")]
    {
        // No shell interpolation of filenames. Each parameter is a separate argv.
        let terminal = std::process::Command::new("wt.exe").arg("-d").arg(folder).spawn();
        if terminal.is_err() {
            std::process::Command::new("cmd.exe")
                .arg("/k").current_dir(folder).spawn()
                .map_err(|e| format!("Could not launch Terminal: {e}"))?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = folder;
        Err("Open in Terminal is currently supported on Windows".into())
    }
}

#[tauri::command]
pub fn send_bluetooth(path: String) -> Result<String, String> {
    let file = Path::new(&path);
    crate::external::verify_input(file, false)?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("fsquirt.exe")
            .spawn()
            .map_err(|e| format!("Bluetooth transfer wizard unavailable: {e}"))?;
        Ok("Bluetooth transfer opened. Choose Send files, pair/select your device and select the file in the wizard.".into())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = file;
        Err("Bluetooth transfer integration is available on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_reserved_or_unsafe_filenames() {
        for invalid in ["", "../folder", "bad\\name", "CON.txt", "LPT1", "photo?.png", "trailing.", "ok:stream"] {
            assert!(!valid_filename(invalid), "{invalid}");
        }
        assert!(valid_filename("Reformed photo.png"));
        assert!(valid_filename("échantillon.webp"));
    }
}
