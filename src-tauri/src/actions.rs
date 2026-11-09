use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use std::fs;
use std::path::Path;

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

fn rename_file_on_disk(old: &Path, new_name: &str) -> Result<RenameResult, String> {
    if !valid_filename(new_name) {
        return Err("Invalid Windows filename".into());
    }
    // Explorer's folder Orbit uses this action too. Symlinks remain blocked.
    crate::external::verify_input(old, true)?;
    let parent = old.parent().ok_or("Cannot determine parent folder")?;
    let new = parent.join(new_name);
    let existing_name = old.file_name().and_then(|part| part.to_str()).unwrap_or("");
    if old == new {
        return Ok(RenameResult {
            path: old.to_string_lossy().into_owned(),
            name: new_name.to_owned(),
        });
    }
    // NTFS paths are normally case-insensitive: changing photo.PNG to photo.png
    // is not a collision with a different file.
    let case_only = cfg!(windows) && existing_name.eq_ignore_ascii_case(new_name);
    if new.exists() && !case_only {
        return Err("A file with that name already exists".into());
    }
    fs::rename(old, &new).map_err(|e| format!("Rename failed: {e}"))?;
    Ok(RenameResult {
        path: new.to_string_lossy().into_owned(),
        name: new_name.to_owned(),
    })
}

#[tauri::command]
pub async fn rename_file(path: String, new_name: String) -> Result<RenameResult, String> {
    // Disk work runs outside WebView's event loop, keeping Orbit responsive.
    tauri::async_runtime::spawn_blocking(move ||
        rename_file_on_disk(Path::new(&path), &new_name)
    ).await.map_err(|_| "Rename worker failed".to_owned())?
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

// A synchronous Tauri command runs on the WebView event loop. Creating a
// second native WebView from that loop can block the invoke promise and leave
// an empty white Float window. Run window construction off the UI thread.
#[tauri::command]
pub async fn float_file(app: AppHandle, state: State<'_, FloatRegistry>, path: String) -> Result<(), String> {
    let input = Path::new(&path);
    crate::external::verify_input(input, false)?;
    // Grant the asset protocol access only to this explicitly selected file.
    // Never expose arbitrary disk directories to the embedded browser.
    app.asset_protocol_scope().allow_file(input)
        .map_err(|e| format!("Cannot authorize floating media preview: {e}"))?;
    {
        let mut current = state.0.lock().map_err(|_| "Preview state is unavailable")?;
        *current = Some(path);
    }
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(existing) = app.get_webview_window("float") {
            // Never close/recreate a native WebView with the same label in
            // one operation: Windows WebView2 can release that label later
            // than close() returns, causing "label float already exists".
            // Keep the existing view alive and notify it to load the latest
            // validated file context (saved above).
            existing.show().map_err(|e| format!("Cannot show Float: {e}"))?;
            existing.set_focus().map_err(|e| format!("Cannot focus Float: {e}"))?;
            existing.emit("reformany:float-file-changed", ())
                .map_err(|e| format!("Cannot update Float preview: {e}"))?;
            return Ok::<(), String>(());
        }
        WebviewWindowBuilder::new(&app, "float", WebviewUrl::App("index.html".into()))
            .title("ReformANY Float")
            .inner_size(390.0, 530.0)
            .min_inner_size(320.0, 390.0)
            .resizable(true)
            .decorations(false)
            .shadow(true)
            .always_on_top(true)
            .center()
            .focused(true)
            .build()
            .map_err(|e| format!("Cannot open floating preview: {e}"))?;
        Ok::<(), String>(())
    }).await.map_err(|e| format!("Float window task failed: {e}"))?
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

    #[test]
    fn rename_changes_disk_name_and_rejects_collisions_without_touching_source() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("old name.txt");
        fs::write(&old, b"original").unwrap();
        let renamed = rename_file_on_disk(&old, "new name.txt").unwrap();
        assert_eq!(renamed.name, "new name.txt");
        assert!(!old.exists());
        assert_eq!(fs::read(renamed.path).unwrap(), b"original");
        let second = root.path().join("another.txt");
        fs::write(&second, b"second").unwrap();
        let existing = root.path().join("new name.txt");
        assert!(rename_file_on_disk(&second, "new name.txt").is_err());
        assert_eq!(fs::read(&second).unwrap(), b"second");
        assert_eq!(fs::read(&existing).unwrap(), b"original");
    }

    #[test]
    fn rename_to_same_name_is_noop_not_a_collision() {
        let root = tempfile::tempdir().unwrap();
        let input = root.path().join("stays.txt");
        fs::write(&input, b"same").unwrap();
        assert!(rename_file_on_disk(&input, "stays.txt").is_ok());
        assert_eq!(fs::read(input).unwrap(), b"same");
    }
}
