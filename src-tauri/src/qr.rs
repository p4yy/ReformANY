//! Offline QR-code generation for Float. No file upload or remote endpoint.
use qrcodegen::{QrCode, QrCodeEcc};
use std::fmt::Write as FmtWrite;
use std::path::Path;

fn render_svg(value: &str) -> Result<String, String> {
    let content = value.trim();
    if content.is_empty() {
        return Err("Enter text or a URL to generate a QR code".into());
    }
    // Keep the QR legible in the small Float window. Longer content belongs in a file.
    if content.len() > 1600 {
        return Err("QR content is too long (maximum 1600 UTF-8 bytes)".into());
    }
    let code = QrCode::encode_text(content, QrCodeEcc::Medium)
        .map_err(|_| "Content is too long for a QR code".to_owned())?;
    let side = code.size() + 8; // Four-module quiet zone for reliable scanners.
    let mut path = String::with_capacity((code.size() * code.size() * 10) as usize);
    for y in 0..code.size() {
        for x in 0..code.size() {
            if code.get_module(x, y) {
                write!(&mut path, "M{} {}h1v1h-1z", x + 4, y + 4)
                    .expect("Writing to a String cannot fail");
            }
        }
    }
    // User data is encoded only as QR modules, never interpolated into XML.
    Ok(format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}" width="640" height="640" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path fill="#172119" d="{path}"/></svg>"##
    ))
}

#[tauri::command]
pub fn qr_svg(content: String) -> Result<String, String> {
    render_svg(&content)
}

#[tauri::command]
pub async fn qr_save_svg(content: String, destination: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = Path::new(&destination);
        if !target.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("svg")) {
            return Err("Save QR codes as an .svg file".into());
        }
        let parent = target.parent().ok_or("Choose a destination folder")?;
        if !parent.is_dir() {
            return Err("Destination folder does not exist".into());
        }
        let svg = render_svg(&content)?;
        // Save dialog is an explicit user interaction; do not create parent folders.
        std::fs::write(target, svg.as_bytes())
            .map_err(|err| format!("Could not save QR code: {err}"))
    }).await.map_err(|_| "QR export worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_svg_has_quiet_zone_and_scannable_modules() {
        let svg = render_svg("https://example.com/file").unwrap();
        assert!(svg.contains("viewBox="));
        assert!(svg.contains("shape-rendering=\"crispEdges\""));
        assert!(svg.contains("<path fill="));
        assert!(!svg.contains("https://example.com"));
    }

    #[test]
    fn qr_handles_unicode_and_rejects_empty_or_oversized_content() {
        assert!(render_svg("مرحبا بالعالم").is_ok());
        assert!(render_svg("    ").is_err());
        assert!(render_svg(&"a".repeat(1601)).is_err());
    }
}
