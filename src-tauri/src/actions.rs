use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
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
        // Explorer's folder Orbit uses this action too. Symlinks remain blocked.
        crate::external::verify_input(&old, true)?;
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

/// At most one floating preview. Never expose file paths in a window URL.
#[derive(Default)]
pub struct FloatRegistry(pub Mutex<Option<String>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatInfo {
    path: String,
    name: String,
    bytes: u64,
}

#[tauri::command]
pub fn float_file_context(state: State<'_, FloatRegistry>) -> Result<Option<FloatInfo>, String> {
    let path = state.0.lock().map_err(|_| "Preview state is unavailable")?
        .clone();
    let Some(path) = path else { return Ok(None); };
    let file = Path::new(&path);
    let metadata = fs::metadata(file).map_err(|_| "Floating file no longer exists".to_owned())?;
    Ok(Some(FloatInfo {
        name: file.file_name().map(|v| v.to_string_lossy().into_owned())
            .unwrap_or("Selected file".into()),
        path, bytes: metadata.len(),
    }))
}

#[tauri::command]
pub fn float_file(app: AppHandle, state: State<'_, FloatRegistry>, path: String) -> Result<(), String> {
    let input = Path::new(&path);
    crate::external::verify_input(input, false)?;
    {
        let mut current = state.0.lock().map_err(|_| "Preview state is unavailable")?;
        *current = Some(path);
    }
    if let Some(existing) = app.get_webview_window("float") {
        existing.close().map_err(|e| e.to_string())?;
    }
    WebviewWindowBuilder::new(&app, "float", WebviewUrl::App("index.html".into()))
        .title("ReformANY Float")
        .inner_size(390.0, 530.0)
        .min_inner_size(320.0, 390.0)
        .resizable(true)
        .always_on_top(true)
        .center()
        .focused(true)
        .build()
        .map_err(|e| format!("Cannot open floating preview: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn copy_file_to(path: String, destination: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let input = Path::new(&path);
        crate::external::verify_input(input, false)?;
        let folder = Path::new(&destination);
        if !folder.is_dir() { return Err("Choose an existing destination folder".into()); }
        let stem = input.file_stem().and_then(|s| s.to_str())
            .ok_or("Filename cannot be copied")?;
        let extension = input.extension().and_then(|s| s.to_str()).unwrap_or("copy");
        crate::external::publish(input, folder, stem, extension)
            .map(|v| v.to_string_lossy().into_owned())
    }).await.map_err(|_| "File copy worker failed".to_owned())?
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
