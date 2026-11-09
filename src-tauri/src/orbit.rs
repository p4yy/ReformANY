use crate::conversion::describe;
use serde::Serialize;
use base64::Engine;
use image::{ImageFormat, ImageReader};
use std::ffi::OsString;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::Semaphore;

// A decoded 40MP image can require substantial memory. Generate only one
// thumbnail at a time, regardless of the number of visible rows.
static THUMBNAIL_POOL: Semaphore = Semaphore::const_new(1);

#[derive(Default)]
pub struct OrbitLaunch {
    path: Option<PathBuf>,
    initial_tab: Option<String>,
}
impl OrbitLaunch {
    pub fn new_with_tab(path: Option<PathBuf>, initial_tab: Option<String>) -> Self {
        Self { path, initial_tab }
    }
}

/// Explorer passes the file as one quoted argument. Other command forms do not
/// turn on Orbit and cannot accidentally interpret a filename as a switch.
pub fn parse_orbit_args(args: impl IntoIterator<Item = OsString>) -> Option<PathBuf> {
    let args: Vec<_> = args.into_iter().collect();
    if !(args.len()==2 || args.len()==3) || args[0] != "orbit" {
        return None;
    }
    if args.len()==3 && !matches!(args[2].to_str(),
        Some("--tab=convert"|"--tab=tools"|"--tab=actions")) {
        return None;
    }
    let path = PathBuf::from(&args[1]);
    if path.as_os_str().is_empty() {
        return None;
    }
    Some(path)
}

pub fn parse_orbit_tab(args: impl IntoIterator<Item = OsString>) -> Option<String> {
    let args: Vec<_> = args.into_iter().collect();
    if parse_orbit_args(args.iter().cloned()).is_none(){return None;}
    args.get(2).and_then(|argument|argument.to_str())
        .and_then(|argument|argument.strip_prefix("--tab="))
        .map(str::to_owned)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbitInfo {
    path: String,
    name: String,
    bytes: u64,
    detected: Option<String>,
    error: Option<String>,
}

fn classify_file(path: &Path) -> &'static str {
    let extension = path.extension().and_then(|x| x.to_str())
        .unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "png"|"jpg"|"jpeg"|"webp"|"bmp"|"gif"|"tif"|"tiff"|"ico"|"tga"|"qoi"|"svg" => "Image",
        "mp4"|"mov"|"mkv"|"webm"|"avi"|"wmv"|"m4v"|"flv"|"mpeg"|"mpg"| "3gp"|"ts"|"mts"|"m2ts"|"vob"|"ogv"|"mxf"|"f4v"|"asf" => "Video",
        "mp3"|"m4a"|"wav"|"flac"|"ogg"|"opus"|"aiff"|"aif"|"wma"|"aac"|"ac3"|"mka"|"caf"|"m4b"|"amr"|"au"|"dts" => "Audio",
        "zip"|"7z"|"rar"|"tar"|"gz"|"bz2"|"xz"|"001"|"iso"|"cab"|"arj"|"lzh"|"zst"|"tgz" => "Archive",
        "pdf" => "PDF",
        "doc"|"docx"|"odt"|"rtf"|"ppt"|"pptx"|"odp"|"txt"|"html"|"htm" => "Office",
        "csv"|"tsv"|"json"|"xls"|"xlsx"|"ods" => "Spreadsheet",
        "srt"|"vtt" => "Subtitle",
        "epub"|"mobi"|"fb2"|"fbz"|"azw"|"azw3"|"cbz"|"cbr"|"cb7"|"htmlz" => "Ebook",
        "lnk"|"url" => "Shortcut",
        "exe"|"msi"|"msix"|"bat"|"cmd" => "Application",
        _ => "File",
    }
}

fn orbit_file_info(path: &Path) -> Option<OrbitInfo> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let raw = path.to_string_lossy().into_owned();
    let kind = classify_file(path);
    let info = match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => OrbitInfo {
            path: raw, name, bytes: 0, detected: None,
            error: Some("Linked files and folders cannot be opened safely".into()),
        },
        Ok(metadata) if metadata.is_dir() => OrbitInfo {
            path: raw, name, bytes: 0,
            detected: Some("Folder".into()), error: None,
        },
        Ok(metadata) if metadata.is_file() => {
            if kind == "Image" && crate::svg_image::is_svg(path) {
                // SVG is a first-class input, but image::guess_format cannot
                // recognize it. Apply the same local-only SVG validation used
                // by conversion before advertising a quick-convert action.
                match crate::svg_image::inspect_svg(path) {
                    Ok(bytes) => OrbitInfo {
                        path: raw, name, bytes,
                        detected: Some("SVG".into()), error: None,
                    },
                    Err(error) => OrbitInfo {
                        path: raw, name, bytes: metadata.len(),
                        detected: Some("SVG".into()), error: Some(error),
                    },
                }
            } else if kind == "Image" {
                match describe(path) {
                    Ok((bytes, format)) => OrbitInfo {
                        path: raw, name, bytes,
                        detected: Some(format!("{format:?}")),
                        error: None,
                    },
                    Err(error) => OrbitInfo { path: raw, name, bytes: metadata.len(),
                        detected: Some(kind.to_owned()), error: Some(error) },
                }
            } else {
                OrbitInfo { path: raw, name, bytes: metadata.len(),
                    detected: Some(kind.to_owned()), error: None }
            }
        }
        _ => OrbitInfo { path: raw, name, bytes: 0, detected: None,
            error: Some("Selected file cannot be opened".into()) },
    };
    Some(info)
}

#[tauri::command]
pub fn orbit_context(state: State<'_, OrbitLaunch>) -> Option<OrbitInfo> {
    state.path.as_ref().and_then(|path| orbit_file_info(path))
}
#[tauri::command]
pub fn orbit_initial_tab(state: State<'_, OrbitLaunch>) -> Option<String> {
    state.initial_tab.clone()
}

#[tauri::command]
pub async fn orbit_preview(state: State<'_, OrbitLaunch>) -> Result<Option<String>, String> {
    let path = match state.path.clone() {
        Some(path) => path,
        None => return Ok(None),
    };
    image_thumbnail(path.to_string_lossy().into_owned()).await
}

#[tauri::command]
pub async fn image_thumbnail(path: String) -> Result<Option<String>, String> {
    let _permit = THUMBNAIL_POOL.acquire().await
        .map_err(|_| "Thumbnail worker unavailable".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || make_preview(Path::new(&path)))
        .await
        .map_err(|_| "Preview worker failed".to_owned())?
}

fn make_preview(path: &Path) -> Result<Option<String>, String> {
    // The same signature and byte-size checks as the conversion engine.
    if describe(path).is_err() {
        return Ok(None);
    }
    let reader = ImageReader::open(path)
        .map_err(|_| "Cannot open preview source".to_owned())?
        .with_guessed_format()
        .map_err(|_| "Cannot detect image format".to_owned())?;
    let (w, h) = reader
        .into_dimensions()
        .map_err(|_| "Cannot inspect preview dimensions".to_owned())?;
    if w as u64 * h as u64 > 40_000_000 {
        return Ok(None);
    }
    let image = ImageReader::open(path)
        .map_err(|_| "Cannot open preview source".to_owned())?
        .with_guessed_format()
        .map_err(|_| "Cannot detect image format".to_owned())?
        .decode()
        .map_err(|_| "Cannot decode image preview".to_owned())?
        .thumbnail(148, 148);
    let mut png = Cursor::new(Vec::<u8>::new());
    image.write_to(&mut png, ImageFormat::Png)
        .map_err(|_| "Cannot encode thumbnail".to_owned())?;
    Ok(Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png.into_inner())
    )))
}

/// Explicit onboarding action: the native file picker supplies an exact
/// source path. Unlike the mouse shake listener, there is no ambiguity about
/// the chosen file. Reuse the same process command as Explorer's Orbit verb.
#[tauri::command]
pub fn orbit_launch_file(path: String) -> Result<(), String> {
    let source = PathBuf::from(&path);
    if !source.is_absolute() {
        return Err("Choose a file using the system file picker".into());
    }
    let metadata = std::fs::symlink_metadata(&source)
        .map_err(|error| format!("The selected file is unavailable: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Orbit preview requires an existing regular file".into());
    }
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut process = std::process::Command::new(exe);
    process.arg("orbit").arg(&source);
    crate::external::hide_subprocess_window(&mut process);
    process.spawn().map_err(|error| format!("Cannot open Orbit for selected file: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn orbit_open_workspace(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        WebviewWindowBuilder::new(
            &app,
            "main",
            WebviewUrl::App("index.html".into()),
        )
        .title("ReformANY")
        .inner_size(1120.0, 760.0)
        .min_inner_size(750.0, 580.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    }
    if let Some(orbit) = app.get_webview_window("orbit") {
        orbit.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_output(path: String) -> Result<(), String> {
    let file = Path::new(&path);
    if !file.is_file() && !file.is_dir() {
        return Err("Selected output no longer exists".into());
    }
    #[cfg(target_os = "windows")]
    {
        let mut explorer = std::process::Command::new("explorer.exe");
        if file.is_file() {
            explorer.arg("/select,").arg(file);
        } else {
            explorer.arg(file);
        }
        explorer.spawn().map_err(|_| "Could not open File Explorer".to_owned())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = file;
        Err("Reveal in Explorer is available on Windows".into())
    }
}

/// A small window placed close to the mouse without ever hanging off-screen.
/// All positions and monitor working areas are physical pixels.
#[cfg(target_os = "windows")]
pub fn position_near_cursor(window: &WebviewWindow) {
    use tauri::{PhysicalPosition, Position};
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    unsafe {
        let mut cursor = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut cursor) == 0 {
            return;
        }
        let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
        if monitor.is_null() {
            return;
        }
        let mut info = std::mem::zeroed::<MONITORINFO>();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return;
        }
        let size = match window.outer_size() {
            Ok(size) => size,
            Err(_) => return,
        };
        let left = info.rcWork.left;
        let top = info.rcWork.top;
        let max_x = info.rcWork.right.saturating_sub(size.width as i32);
        let max_y = info.rcWork.bottom.saturating_sub(size.height as i32);
        // The selection is under the context-menu invocation point in normal
        // Explorer/desktop right clicks. Anchor the wheel *around* that point,
        // rather than opening the whole window to the far right of the file.
        let x = cursor.x.saturating_sub(size.width as i32 / 2)
            .clamp(left, max_x.max(left));
        let y = cursor.y.saturating_sub(size.height as i32 / 2)
            .clamp(top, max_y.max(top));
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    }
}

#[cfg(not(target_os = "windows"))]
pub fn position_near_cursor(window: &WebviewWindow) {
    let _ = window.center();
}

#[cfg(test)]
mod tests {
    #[test]
    fn orbit_accepts_only_known_tabs(){
        use super::*;
        let valid=["orbit","test.pdf","--tab=tools"].map(OsString::from);
        assert_eq!(parse_orbit_args(valid.clone()),Some(PathBuf::from("test.pdf")));
        assert_eq!(parse_orbit_tab(valid),Some("tools".to_owned()));
        assert!(parse_orbit_args(["orbit","test.pdf","--tab=shred"].map(OsString::from)).is_none());
        assert!(parse_orbit_args(["orbit","test.pdf","--tab=actions","extra"].map(OsString::from)).is_none());
    }
    use super::*;

    #[test]
    fn supports_quoted_path_with_spaces_as_one_argument() {
        let args = [
            OsString::from("orbit"),
            OsString::from("C:\\Users\\Example\\My Photos\\sky.png"),
        ];
        assert_eq!(
            parse_orbit_args(args),
            Some(PathBuf::from("C:\\Users\\Example\\My Photos\\sky.png"))
        );
    }

    #[test]
    fn rejects_other_launch_modes() {
        assert!(parse_orbit_args([OsString::from("settings")]).is_none());
        assert!(parse_orbit_args([OsString::from("orbit")]).is_none());
        assert!(parse_orbit_args([
            OsString::from("orbit"),
            OsString::from("image.png"),
            OsString::from("extra"),
        ])
        .is_none());
    }
    #[test]
    fn orbit_accepts_regular_folders_for_archiving() {
        let folder = tempfile::tempdir().unwrap();
        let info = orbit_file_info(folder.path()).unwrap();
        assert_eq!(info.detected.as_deref(), Some("Folder"));
        assert!(info.error.is_none());
        assert_eq!(info.bytes, 0);
    }

    #[test]
    fn orbit_rejects_unavailable_inputs() {
        let folder = tempfile::tempdir().unwrap();
        let info = orbit_file_info(&folder.path().join("missing.bin")).unwrap();
        assert!(info.error.is_some());
    }

    #[test]
    fn orbit_accepts_safe_svg_and_rejects_remote_svg() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.svg");
        std::fs::write(&path,
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#1166dd"/></svg>"##,
        ).unwrap();
        let safe = orbit_file_info(&path).unwrap();
        assert_eq!(safe.detected.as_deref(), Some("SVG"));
        assert!(safe.error.is_none());

        std::fs::write(&path,
            r#"<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/unsafe.png"/></svg>"#,
        ).unwrap();
        let blocked = orbit_file_info(&path).unwrap();
        assert!(blocked.error.is_some());
    }

    #[test]
    fn orbit_classifies_media_archive_and_images() {
        assert_eq!(classify_file(Path::new("video.MP4")), "Video");
        assert_eq!(classify_file(Path::new("voice.FLAC")), "Audio");
        assert_eq!(classify_file(Path::new("backup.RAR")), "Archive");
        assert_eq!(classify_file(Path::new("photo.webp")), "Image");
        for extension in ["ICO", "TGA", "QOI", "SVG"] {
            assert_eq!(classify_file(Path::new(&format!("artwork.{extension}"))), "Image");
        }
        assert_eq!(classify_file(Path::new("report.PDF")), "PDF");
        assert_eq!(classify_file(Path::new("presentation.PPTX")), "Office");
        assert_eq!(classify_file(Path::new("sheet.XLSX")), "Spreadsheet");
        assert_eq!(classify_file(Path::new("data.CSV")), "Spreadsheet");
        assert_eq!(classify_file(Path::new("subtitle.VTT")), "Subtitle");
        assert_eq!(classify_file(Path::new("book.EPUB")), "Ebook");
        assert_eq!(classify_file(Path::new("tool.LNK")), "Shortcut");
        assert_eq!(classify_file(Path::new("website.url")), "Shortcut");
        assert_eq!(classify_file(Path::new("installer.MSI")), "Application");
        assert_eq!(classify_file(Path::new("notes.txt")), "Office");
        assert_eq!(classify_file(Path::new("notes.html")), "Office");
        assert_eq!(classify_file(Path::new("unknown.xyz")), "File");
    }

}
