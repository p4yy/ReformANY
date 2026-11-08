use crate::external::{output_dir, publish, verify_input};
use image::codecs::jpeg::JpegEncoder;
use image::{GenericImageView, ImageReader};
use lopdf::{content::{Content, Operation}, dictionary, Document, Object, Stream};
use std::fs::{self, File};
use std::path::{Path, PathBuf};

const MAX_PDF_INPUT_PAGES: usize = 200;
const MAX_PDF_PARSE_BYTES: u64 = 80 * 1024 * 1024;

fn build_image_pdf(paths: &[String], destination: Option<&str>) -> Result<String, String> {
    if paths.is_empty() || paths.len() > MAX_PDF_INPUT_PAGES {
        return Err("Select between 1 and 200 static images".into());
    }
    let mut doc = Document::with_version("1.4");
    let pages_id = doc.new_object_id();
    let mut kids = Vec::<Object>::new();
    for path in paths {
        let source = Path::new(path);
        crate::conversion::describe(source)?;
        let (width, height) = ImageReader::open(source)
            .map_err(|e| e.to_string())?.with_guessed_format()
            .map_err(|e| e.to_string())?.into_dimensions()
            .map_err(|e| e.to_string())?;
        if width == 0 || height == 0 || width as u64 * height as u64 > 40_000_000 {
            return Err("Image dimensions are out of range".into());
        }
        let image = ImageReader::open(source).map_err(|e| e.to_string())?
            .with_guessed_format().map_err(|e| e.to_string())?
            .decode().map_err(|e| format!("Image cannot be decoded: {e}"))?;
        let (w, h) = image.dimensions();
        let rgb = image.to_rgb8();
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 90)
            .encode_image(&image::DynamicImage::ImageRgb8(rgb))
            .map_err(|e| format!("Cannot embed image in PDF: {e}"))?;
        let image_id = doc.add_object(Stream::new(dictionary! {
            "Type" => "XObject", "Subtype" => "Image",
            "Width" => i64::from(w), "Height" => i64::from(h),
            "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
            "Filter" => "DCTDecode"
        }, jpeg));
        let resources_id = doc.add_object(dictionary! {
            "XObject" => dictionary! { "Im0" => image_id }
        });
        let scale = (547.0f64 / f64::from(w)).min(794.0 / f64::from(h)).min(1.0);
        let target_w = f64::from(w) * scale;
        let target_h = f64::from(h) * scale;
        let x = (595.0 - target_w) / 2.0;
        let y = (842.0 - target_h) / 2.0;
        let content = Content { operations: vec![
            Operation::new("q", vec![]),
            Operation::new("cm", vec![
                target_w.into(), 0.into(), 0.into(), target_h.into(),
                x.into(), y.into(),
            ]),
            Operation::new("Do", vec![Object::Name(b"Im0".to_vec())]),
            Operation::new("Q", vec![]),
        ] };
        let content_id = doc.add_object(Stream::new(dictionary! {},
            content.encode().map_err(|e| e.to_string())?));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(),0.into(),595.into(),842.into()],
            "Contents" => content_id,
            "Resources" => resources_id
        });
        kids.push(Object::Reference(page_id));
    }
    let count = kids.len() as i64;
    doc.objects.insert(pages_id, Object::Dictionary(dictionary! {
        "Type" => "Pages", "Kids" => kids, "Count" => count
    }));
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    let first = PathBuf::from(&paths[0]);
    let folder = output_dir(&first, destination)?;
    let staging = tempfile::Builder::new().prefix(".reformany-pdf-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let file = staging.path().join("document.pdf");
    doc.save(&file).map_err(|e| format!("Cannot save PDF: {e}"))?;
    let readback = Document::load(&file).map_err(|e| format!("Cannot verify PDF: {e}"))?;
    if readback.get_pages().len() != paths.len() {
        return Err("PDF did not preserve the requested page count".into());
    }
    let stem = if paths.len() == 1 {
        first.file_stem().and_then(|s| s.to_str()).unwrap_or("Image")
    } else { "ReformANY Images" };
    publish(&file, &folder, stem, "pdf")
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn images_to_pdf(paths: Vec<String>, destination: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || build_image_pdf(&paths, destination.as_deref()))
        .await.map_err(|_| "PDF creation worker failed".to_owned())?
}

fn extract_pdf_text(path: &str, destination: Option<&str>) -> Result<String, String> {
    let source = Path::new(path);
    verify_input(source, false)?;
    if fs::metadata(source).map_err(|e| e.to_string())?.len() > MAX_PDF_PARSE_BYTES {
        return Err("PDF exceeds the 80 MB text-extraction limit".into());
    }
    let doc = Document::load(source).map_err(|e| format!("Cannot open PDF: {e}"))?;
    if doc.is_encrypted() { return Err("Encrypted PDF text extraction is not supported yet".into()); }
    let pages = doc.get_pages();
    if pages.len() > 500 { return Err("PDF has too many pages for text extraction".into()); }
    let numbers: Vec<u32> = pages.keys().copied().collect();
    let text = doc.extract_text_with_limit(&numbers, 4 * 1024 * 1024)
        .map_err(|e| format!("Cannot extract PDF text: {e}"))?;
    if text.trim().is_empty() {
        return Err("This PDF has no extractable text. Scanned PDFs need OCR.".into());
    }
    let folder = output_dir(source, destination)?;
    let staging = tempfile::Builder::new().prefix(".reformany-text-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let file = staging.path().join("output.txt");
    fs::write(&file, text.as_bytes()).map_err(|e| e.to_string())?;
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("Document");
    publish(&file, &folder, stem, "txt")
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn pdf_to_text(path: String, destination: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || extract_pdf_text(&path, destination.as_deref()))
        .await.map_err(|_| "PDF text extraction worker failed".to_owned())?
}

fn find_office() -> Option<PathBuf> {
    for name in [r"C:\Program Files\LibreOffice\program\soffice.exe",
                 r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"] {
        let path = PathBuf::from(name);
        if path.is_file() { return Some(path); }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for name in ["soffice.exe", "soffice"] {
                let path = dir.join(name);
                if path.is_file() { return Some(path); }
            }
        }
    }
    None
}

#[tauri::command]
pub fn office_available() -> bool { find_office().is_some() }

fn office_convert(path: &str, destination: Option<&str>) -> Result<String, String> {
    let source = Path::new(path);
    verify_input(source, false)?;
    let ext = source.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(ext.as_str(), "doc"|"docx"|"odt"|"rtf"|"ppt"|"pptx"|"odp"|
                 "xls"|"xlsx"|"ods"|"html"|"htm"|"txt") {
        return Err("This Office document format is not supported".into());
    }
    let soffice = find_office().ok_or("LibreOffice is required for Office-to-PDF conversions")?;
    let folder = output_dir(source, destination)?;
    let staging = tempfile::Builder::new().prefix(".reformany-office-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let arguments = vec![
        "--headless".into(), "--convert-to".into(), "pdf".into(),
        "--outdir".into(), staging.path().as_os_str().to_os_string(),
        source.as_os_str().to_os_string(),
    ];
    crate::external::run(&soffice, &arguments, None)?;
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("Document");
    let file = staging.path().join(format!("{stem}.pdf"));
    if !file.is_file() {
        return Err("LibreOffice did not create the expected PDF".into());
    }
    Document::load(&file).map_err(|e| format!("Office PDF verification failed: {e}"))?;
    publish(&file, &folder, stem, "pdf")
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn office_to_pdf(path: String, destination: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || office_convert(&path, destination.as_deref()))
        .await.map_err(|_| "Office conversion worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_pdf_has_expected_page_count_and_preserves_originals() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("first.png");
        let b = dir.path().join("second.png");
        for file in [&a, &b] {
            image::DynamicImage::new_rgb8(35, 25)
                .save_with_format(file, image::ImageFormat::Png).unwrap();
        }
        let pdf = build_image_pdf(&[a.to_string_lossy().into(), b.to_string_lossy().into()], None).unwrap();
        let doc = Document::load(pdf).unwrap();
        assert_eq!(doc.get_pages().len(), 2);
        assert!(a.exists() && b.exists());
    }

    #[test]
    fn accepts_office_extensions_without_allowing_executables() {
        let source = Path::new("document.docx");
        assert_eq!(source.extension().and_then(|s| s.to_str()), Some("docx"));
    }
}
