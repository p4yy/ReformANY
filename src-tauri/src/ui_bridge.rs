//! Small, bounded bridge for the redesigned webview. Converters continue to use
//! their established streaming commands; this module only supplies the bytes
//! needed for client-side PDF/QR tools and safe, collision-free local export.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const MAX_UI_FILE: u64 = 48 * 1024 * 1024;
const MAX_UI_EXPORT: usize = 80 * 1024 * 1024;
const MAX_SHRED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_SHRED_FILES: usize = 500;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEntry {
    path: String,
    name: String,
    bytes: u64,
    directory: bool,
    can_read_bytes: bool,
}

fn checked_entry(path: &Path) -> Result<NativeEntry, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "Selected path is unavailable".to_owned())?;
    if meta.file_type().is_symlink() || (!meta.is_file() && !meta.is_dir()) {
        return Err("Linked and special filesystem entries are not supported".into());
    }
    let name = path.file_name().ok_or("Selected path has no file name")?
        .to_string_lossy().into_owned();
    Ok(NativeEntry {
        path: path.to_string_lossy().into_owned(),
        name,
        bytes: if meta.is_dir() { 0 } else { meta.len() },
        directory: meta.is_dir(),
        can_read_bytes: meta.is_file() && meta.len() <= MAX_UI_FILE,
    })
}

#[tauri::command]
pub async fn ui_file_stat(path: String) -> Result<NativeEntry, String> {
    tauri::async_runtime::spawn_blocking(move || checked_entry(Path::new(&path)))
        .await.map_err(|_| "File inspection failed".to_owned())?
}

#[tauri::command]
pub async fn ui_file_read(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let input = Path::new(&path);
        let entry = checked_entry(input)?;
        if entry.directory || !entry.can_read_bytes {
            return Err("This file is too large for an in-memory editor (48 MB limit); use the native converter instead".into());
        }
        fs::read(input).map(|bytes| STANDARD.encode(bytes))
            .map_err(|_| "Could not read selected file".to_owned())
    }).await.map_err(|_| "File reader failed".to_owned())?
}

fn valid_output_name(name: &str) -> bool {
    let first = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    !name.is_empty() && name.len() <= 200 && name != "." && name != ".." &&
    !name.ends_with(' ') && !name.ends_with('.') &&
    !name.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c)) &&
    !matches!(first.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9") &&
    Path::new(name).file_name().and_then(|x| x.to_str()) == Some(name)
}

#[tauri::command]
pub async fn ui_save_output(source_path: Option<String>, destination: Option<String>, file_name: String, base64: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !valid_output_name(&file_name) { return Err("Invalid output filename".into()); }
        if base64.len() > (MAX_UI_EXPORT * 4 / 3 + 16) {
            return Err("Output exceeds the 80 MB in-memory export limit".into());
        }
        let bytes = STANDARD.decode(&base64).map_err(|_| "Invalid output payload".to_owned())?;
        if bytes.len() > MAX_UI_EXPORT { return Err("Output exceeds the 80 MB export limit".into()); }
        let directory = match destination.as_deref() {
            Some("Desktop") | Some("Downloads") => {
                let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
                    .ok_or("Cannot locate your home directory")?;
                PathBuf::from(home).join(destination.as_deref().unwrap_or("Downloads"))
            }
            Some("Next to original") | None => {
                let path = if let Some(path) = source_path { PathBuf::from(path) }
                    else { return Err("Choose a source file or output directory".into()); };
                checked_entry(&path)?;
                if path.is_dir() { path } else { path.parent().ok_or("Cannot identify source directory")?.to_path_buf() }
            }
            Some(folder) => {
                let folder = PathBuf::from(folder);
                if !checked_entry(&folder)?.directory { return Err("Selected output must be a folder".into()); }
                folder
            }
        };
        if !directory.is_dir() { return Err("Output folder does not exist".into()); }
        let path = Path::new(&file_name);
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(&file_name);
        let ext = path.extension().and_then(|s| s.to_str());
        for suffix in 0..1000 {
            let candidate = if suffix == 0 { file_name.clone() } else if let Some(ext) = ext {
                format!("{stem} ({suffix}).{ext}")
            } else { format!("{stem} ({suffix})") };
            let target = directory.join(candidate);
            match OpenOptions::new().write(true).create_new(true).open(&target) {
                Ok(mut out) => {
                    let result = out.write_all(&bytes).and_then(|_| out.sync_all());
                    if result.is_err() { let _ = fs::remove_file(&target); return Err("Writing output failed".into()); }
                    return Ok(target.to_string_lossy().into_owned());
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err("Cannot create output in the selected folder".into()),
            }
        }
        Err("Too many files with the same output name".into())
    }).await.map_err(|_| "Output writer failed".to_owned())?
}

/// Best-effort single-pass overwrite and unlink, never guaranteed sanitization.
/// The UI explicitly warns about SSD remapping, backups and cloud copies.
fn remove_with_overwrite(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "File no longer exists".to_owned())?;
    if !meta.is_file() || meta.file_type().is_symlink() { return Err("Cannot overwrite a special file".into()); }
    let mut file = OpenOptions::new().write(true).open(path).map_err(|_| "File is not writable".to_owned())?;
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let zeros = [0u8; 64 * 1024];
    let mut remaining = meta.len();
    while remaining > 0 {
        let count = remaining.min(zeros.len() as u64) as usize;
        file.write_all(&zeros[..count]).map_err(|_| "Overwrite failed".to_owned())?;
        remaining -= count as u64;
    }
    file.sync_all().map_err(|_| "Could not synchronize overwrite".to_owned())?;
    drop(file);
    fs::remove_file(path).map_err(|_| "Could not remove overwritten file".to_owned())
}

#[tauri::command]
pub async fn ui_shred(path: String, confirmation: String) -> Result<(), String> {
    if confirmation != "SHRED" { return Err("Explicit SHRED confirmation required".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let input = PathBuf::from(path);
        let entry = checked_entry(&input)?;
        let mut files = Vec::new();
        let mut directories = Vec::new();
        let mut total = 0u64;
        if entry.directory {
            for item in walkdir::WalkDir::new(&input).follow_links(false) {
                let item = item.map_err(|_| "Could not inspect folder contents".to_owned())?;
                let meta = fs::symlink_metadata(item.path()).map_err(|_| "Folder item unavailable".to_owned())?;
                if meta.file_type().is_symlink() { return Err("Shred refuses folders containing links".into()); }
                if meta.is_dir() { directories.push(item.path().to_path_buf()); }
                else if meta.is_file() { files.push(item.path().to_path_buf()); total = total.checked_add(meta.len()).ok_or("Folder is too large")?; }
                else { return Err("Shred cannot process special filesystem entries".into()); }
                if files.len() > MAX_SHRED_FILES || total > MAX_SHRED_BYTES { return Err("Shred limit: 500 files and 1 GB per operation".into()); }
            }
        } else { files.push(input.clone()); total = entry.bytes; }
        if total > MAX_SHRED_BYTES { return Err("Shred limit: 1 GB per operation".into()); }
        for file in files { remove_with_overwrite(&file)?; }
        directories.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
        for directory in directories { fs::remove_dir(directory).map_err(|_| "Could not remove emptied folder".to_owned())?; }
        Ok(())
    }).await.map_err(|_| "Shred worker stopped".to_owned())?
}

#[tauri::command]
pub fn ui_destination(choice: String) -> Result<Option<String>, String> {
    if choice == "Next to original" { return Ok(None); }
    if choice != "Desktop" && choice != "Downloads" {
        return Err("Use the folder picker for custom destinations".into());
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
        .ok_or("Cannot locate your home directory")?;
    let output = PathBuf::from(home).join(choice);
    if !output.is_dir() { return Err("Selected destination does not exist".into()); }
    Ok(Some(output.to_string_lossy().into_owned()))
}

const MAX_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;
const VIDEO_PREVIEW_EXTENSIONS: &[&str] = &[
    "mp4","m4v","mov","webm","mkv","avi","wmv","flv","mpeg","mpg","mts","m2ts","ogv",
];

fn thumbnail_from_video(path: &Path) -> Result<Option<String>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Video file is unavailable".to_owned())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Only regular local videos can be previewed".into());
    }
    let extension = path.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
    if !VIDEO_PREVIEW_EXTENSIONS.contains(&extension.as_str()) {
        return Ok(None);
    }
    // Preview is non-mutating. Fixed argv, file-only protocols, 8-second kill,
    // a small output image and no network or filename-interpreted switches.
    let ffmpeg = crate::external::find_binary("ffmpeg")
        .ok_or("FFmpeg is required for a thumbnail of this video format")?;
    let stage = tempfile::tempdir().map_err(|_| "Could not create thumbnail workspace".to_owned())?;
    let out = stage.path().join("preview.png");
    for seek in ["0.25", "0"] {
        let mut cmd = std::process::Command::new(&ffmpeg);
        crate::external::hide_subprocess_window(&mut cmd);
        cmd.args(["-hide_banner","-loglevel","error","-nostdin","-y",
            "-ss",seek,"-protocol_whitelist","file,pipe,data,crypto","-i"])
            .arg(path)
            .args(["-frames:v","1","-vf","scale=640:360:force_original_aspect_ratio=decrease",
                "-f","image2","-vcodec","png"])
            .arg(&out);
        cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let mut child = cmd.spawn().map_err(|_| "Cannot start the FFmpeg preview engine".to_owned())?;
        let started = std::time::Instant::now();
        let success = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.success(),
                Err(_) => { let _ = child.kill(); let _ = child.wait(); break false; }
                Ok(None) if started.elapsed() > std::time::Duration::from_secs(8) => {
                    let _ = child.kill(); let _ = child.wait();
                    return Err("Video thumbnail decoding exceeded 8 seconds".into());
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(35)),
            }
        };
        if success {
            let meta = fs::metadata(&out).map_err(|_| "Thumbnail was not written".to_owned())?;
            if meta.len() > 0 && meta.len() <= MAX_PREVIEW_BYTES {
                let bytes = fs::read(&out).map_err(|_| "Could not read the decoded thumbnail".to_owned())?;
                return Ok(Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes))));
            }
        }
    }
    Err("FFmpeg could not decode a video frame from the selected file".into())
}

#[tauri::command]
pub async fn media_thumbnail(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || thumbnail_from_video(Path::new(&path)))
        .await.map_err(|_| "The video thumbnail worker stopped unexpectedly".to_owned())?
}
