use crate::external::{find_binary, format_name, output_dir, publish, verify_input};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

const SUPPORTED_INPUTS: &[&str] = &[
    "epub", "mobi", "fb2", "fbz", "azw", "azw3", "cbz", "cbr", "cb7",
    "pdf", "docx", "odt", "rtf", "html", "htmlz", "txt",
];
const SUPPORTED_OUTPUTS: &[&str] = &[
    "epub", "mobi", "fb2", "azw3", "docx", "pdf", "txt", "rtf", "htmlz",
];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EbookJob {
    path: String,
    target: String,
    destination: Option<String>,
}

fn validate(job: &EbookJob) -> Result<(), String> {
    let extension = Path::new(&job.path).extension().and_then(|s| s.to_str())
        .unwrap_or("").to_ascii_lowercase();
    if !SUPPORTED_INPUTS.contains(&extension.as_str()) {
        return Err("This e-book or document input format is not supported".into());
    }
    if !SUPPORTED_OUTPUTS.contains(&job.target.as_str()) {
        return Err("This e-book destination is not supported".into());
    }
    if extension == job.target {
        return Err("Source and destination are the same type".into());
    }
    Ok(())
}

pub fn calibre_available() -> bool { find_binary("ebook-convert").is_some() }

fn ebook_convert(job: EbookJob) -> Result<String, String> {
    validate(&job)?;
    let source = PathBuf::from(&job.path);
    verify_input(&source, false)?;
    let binary = find_binary("ebook-convert")
        .ok_or("Calibre's ebook-convert is not installed. Install Calibre to enable this route.")?;
    let folder = output_dir(&source, job.destination.as_deref())?;
    let staging = tempfile::Builder::new().prefix(".reformany-ebook-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let intermediate = staging.path().join(format!("result.{}", job.target));
    // Arguments are passed directly, without a shell. Calibre selects its
    // output adapter based on the output filename extension.
    let args = vec![
        source.as_os_str().to_os_string(),
        intermediate.as_os_str().to_os_string(),
    ];
    crate::external::run(&binary, &args, None)?;
    if !intermediate.is_file()
        || fs::metadata(&intermediate).map_err(|e| e.to_string())?.len() == 0
    {
        return Err("Calibre did not produce a non-empty output file".into());
    }
    if job.target == "pdf" {
        lopdf::Document::load(&intermediate)
            .map_err(|e| format!("Converted PDF is unreadable: {e}"))?;
    }
    if job.target == "docx" {
        let input = std::fs::File::open(&intermediate).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(input)
            .map_err(|e| format!("DOCX container is unreadable: {e}"))?;
        archive.by_name("word/document.xml")
            .map_err(|_| "Converted DOCX has no document body".to_owned())?;
    }
    let stem = format_name(&source)?;
    publish(&intermediate, &folder, &stem, &job.target)
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn ebook_engine_available() -> bool { calibre_available() }

#[tauri::command]
pub async fn ebook_convert_file(job: EbookJob) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ebook_convert(job))
        .await.map_err(|_| "E-book conversion worker ended unexpectedly".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job(ext: &str, target: &str) -> EbookJob {
        EbookJob { path: format!("C:/Books/Novel.{ext}"), target: target.into(), destination: None }
    }
    #[test]
    fn allows_calibre_routes_but_blocks_unrelated_files() {
        assert!(validate(&job("epub", "mobi")).is_ok());
        assert!(validate(&job("mobi", "fb2")).is_ok());
        assert!(validate(&job("pdf", "docx")).is_ok());
        assert!(validate(&job("fb2", "htmlz")).is_ok());
        assert!(validate(&job("exe", "docx")).is_err());
        assert!(validate(&job("epub", "exe")).is_err());
        assert!(validate(&job("pdf", "pdf")).is_err());
    }
}
