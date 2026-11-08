//! Bounded, read-only local document data for the WebView preview.
//! PDF pages are rendered by the bundled PDF.js worker, not by extracting
//! text or making an HTML approximation of the original document.
use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::Path;

const PDF_LIMIT: u64 = 48 * 1024 * 1024;
const TEXT_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewData {
    kind: &'static str,
    name: String,
    bytes: u64,
    content: String,
}

fn decode_text(data: &[u8]) -> Result<String, String> {
    // UTF-8, UTF-8 BOM, and UTF-16 BOM are common in TXT/MD documents.
    if data.starts_with(&[0xef, 0xbb, 0xbf]) {
        return String::from_utf8(data[3..].to_vec())
            .map_err(|_| "Text file is not valid UTF-8".into());
    }
    if data.starts_with(&[0xff, 0xfe]) || data.starts_with(&[0xfe, 0xff]) {
        if !(data.len() - 2).is_multiple_of(2) {
            return Err("Text file contains incomplete UTF-16 characters".into());
        }
        let little = data[0] == 0xff;
        let units: Vec<u16> = data[2..].as_chunks::<2>().0.iter().map(|part| {
            if little { u16::from_le_bytes([part[0], part[1]]) }
            else { u16::from_be_bytes([part[0], part[1]]) }
        }).collect();
        return String::from_utf16(&units).map_err(|_| "Text file contains invalid UTF-16".into());
    }
    String::from_utf8(data.to_vec())
        .map_err(|_| "This text file is not UTF-8. Convert its encoding before previewing.".into())
}

fn load_document(path: &Path) -> Result<PreviewData, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "Selected document is not accessible".to_owned())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Preview requires a regular file (no symbolic links)".into());
    }
    let kind = match path.extension().and_then(|x| x.to_str())
        .unwrap_or("").to_ascii_lowercase().as_str() {
        "pdf" => "pdf",
        "md" | "markdown" => "markdown",
        "txt" | "text" | "log" => "text",
        _ => return Err("Preview supports PDF, TXT and Markdown files".into()),
    };
    let limit = if kind == "pdf" { PDF_LIMIT } else { TEXT_LIMIT };
    if metadata.len() > limit {
        return Err(format!(
            "Preview limit reached. PDF files must be under 48 MB and text files under 8 MB. This file is {} MB.",
            metadata.len().div_ceil(1_048_576)
        ));
    }
    let bytes = fs::read(path).map_err(|_| "Unable to read the selected document".to_owned())?;
    let content = if kind == "pdf" {
        // Don't mislabel an arbitrary file as PDF because it has a .pdf suffix.
        if !bytes.iter().take(1024).copied().collect::<Vec<_>>()
            .windows(5).any(|window| window == b"%PDF-")
        {
            return Err("This file has no recognizable PDF header".into());
        }
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    } else {
        decode_text(&bytes)?
    };
    let name = path.file_name().map(|s| s.to_string_lossy().into_owned())
        .unwrap_or("Document".into());
    Ok(PreviewData { kind, name, bytes: metadata.len(), content })
}

#[tauri::command]
pub async fn document_preview(path: String) -> Result<PreviewData, String> {
    tauri::async_runtime::spawn_blocking(move || load_document(Path::new(&path)))
        .await.map_err(|_| "Document preview worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_plain_and_utf16_text_whitespace() {
        assert_eq!(decode_text(b"first\n  indented\n").unwrap(), "first\n  indented\n");
        assert_eq!(decode_text(&[0xff,0xfe,0x41,0,0x0a,0]).unwrap(), "A\n");
        assert!(decode_text(&[0xff,0xfe,0x41]).is_err());
    }

    #[test]
    fn loads_real_pdf_bytes_without_flattening_page_images() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("illustrated.pdf");
        let source = b"%PDF-1.4\nEmbedded page content is passed through unchanged";
        fs::write(&path, source).unwrap();
        let doc = load_document(&path).unwrap();
        assert_eq!(doc.kind, "pdf");
        assert_eq!(
            base64::engine::general_purpose::STANDARD.decode(doc.content).unwrap(),
            source
        );
    }

    #[test]
    fn rejects_unknown_extensions_and_disguised_pdfs() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("bad.pdf");
        fs::write(&bad, "not a PDF").unwrap();
        assert!(load_document(&bad).is_err());
        let other = dir.path().join("script.js");
        fs::write(&other, "hello").unwrap();
        assert!(load_document(&other).is_err());
    }
}
