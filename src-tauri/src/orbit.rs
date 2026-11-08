use crate::conversion::{describe, inspect_files, FileInfo};
use base64::Engine;
use image::{ImageFormat, ImageReader};
use std::ffi::OsString;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Default)]
pub struct OrbitLaunch {
    path: Option<PathBuf>,
}

impl OrbitLaunch {
    pub fn new(path: Option<PathBuf>) -> Self {
        Self { path }
    }
}

/// Explorer passes the file as one quoted argument. Other command forms do not
/// turn on Orbit and cannot accidentally interpret a filename as a switch.
pub fn parse_orbit_args(args: impl IntoIterator<Item = OsString>) -> Option<PathBuf> {
    let args: Vec<_> = args.into_iter().collect();
    if args.len() != 2 || args[0] != "orbit" {
        return None;
    }
    let path = PathBuf::from(&args[1]);
    if path.as_os_str().is_empty() {
        return None;
    }
    Some(path)
}

#[tauri::command]
pub fn orbit_context(state: State<'_, OrbitLaunch>) -> Option<FileInfo> {
    state.path.as_ref().and_then(|path| {
        inspect_files(vec![path.to_string_lossy().into_owned()])
            .into_iter()
            .next()
    })
}

#[tauri::command]
pub async fn orbit_preview(state: State<'_, OrbitLaunch>) -> Result<Option<String>, String> {
    let path = match state.path.clone() {
        Some(path) => path,
        None => return Ok(None),
    };
    tauri::async_runtime::spawn_blocking(move || make_preview(&path))
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
    if !file.is_file() {
        return Err("Converted file no longer exists".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg("/select,")
            .arg(file)
            .spawn()
            .map_err(|_| "Could not open File Explorer".to_owned())?;
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
        let x = (cursor.x + 14).clamp(left, max_x.max(left));
        let y = (cursor.y - (size.height as i32 / 2)).clamp(top, max_y.max(top));
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    }
}

#[cfg(not(target_os = "windows"))]
pub fn position_near_cursor(window: &WebviewWindow) {
    let _ = window.center();
}

#[cfg(test)]
mod tests {
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
}
