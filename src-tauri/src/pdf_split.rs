//! Real PDF page splitting. Binary file volumes are deliberately a different tool.
//! Each published output remains a standalone, independently verified PDF.
use crate::external::{format_name, output_dir, publish, verify_input};
use lopdf::Document;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_PAGES: usize = 200;
const MAX_PARTS: usize = 200;
const MAX_PDF_BYTES: u64 = 80 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSplitResult {
    output_paths: Vec<String>,
    oversized_pages: Vec<u32>,
}

fn write_pages(source: &Path, stage: &Path, first: usize, last: usize, count: usize) -> Result<u64, String> {
    if first >= last || last > count {
        return Err("Invalid PDF page range".into());
    }
    let mut pdf = Document::load(source).map_err(|e| format!("Cannot read PDF: {e}"))?;
    let removed: Vec<u32> = (1..=count)
        .filter(|page| *page <= first || *page > last)
        .map(|page| page as u32)
        .collect();
    pdf.delete_pages(&removed);
    pdf.prune_objects();
    pdf.save(stage).map_err(|e| format!("Cannot write split PDF: {e}"))?;
    let verify = Document::load(stage).map_err(|e| format!("Split result is not a valid PDF: {e}"))?;
    if verify.get_pages().len() != last - first {
        return Err("Split PDF page count did not match the requested range".into());
    }
    fs::metadata(stage).map_err(|e| e.to_string()).map(|m| m.len())
}

fn plan_fixed(count: usize, mode: &str, value: u32) -> Result<Vec<(usize,usize)>, String> {
    let value = value as usize;
    match mode {
        "parts" => {
            if value < 2 || value > count || value > MAX_PARTS {
                return Err("Number of PDF parts must be between 2 and the page count".into());
            }
            let base = count / value;
            let remainder = count % value;
            let mut start = 0;
            let mut ranges = Vec::with_capacity(value);
            for part in 0..value {
                let end = start + base + usize::from(part < remainder);
                ranges.push((start, end));
                start = end;
            }
            Ok(ranges)
        }
        "pages" => {
            if value == 0 || value > count {
                return Err("Pages per PDF must be between 1 and the page count".into());
            }
            let ranges = (0..count).step_by(value)
                .map(|start| (start, (start + value).min(count)))
                .collect::<Vec<_>>();
            if ranges.len() > MAX_PARTS {
                return Err("Split would create too many PDF files".into());
            }
            Ok(ranges)
        }
        _ => Err("Choose PDF split by size, parts, or pages".into()),
    }
}

fn split(path: &str, destination: Option<&str>, mode: &str, value: u32) -> Result<PdfSplitResult,String> {
    let source = Path::new(path);
    verify_input(source, false)?;
    if !source.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("pdf")) {
        return Err("Split PDF requires an actual .pdf input".into());
    }
    if fs::metadata(source).map_err(|e| e.to_string())?.len() > MAX_PDF_BYTES {
        return Err("PDF splitting currently supports documents up to 80 MB".into());
    }
    let original = Document::load(source).map_err(|e| format!("Cannot open source PDF: {e}"))?;
    let count = original.get_pages().len();
    if !(2..=MAX_PAGES).contains(&count) {
        return Err("Split PDF requires 2 to 200 pages".into());
    }
    drop(original);
    let directory = output_dir(source, destination)?;
    let stem = format_name(source)?;
    let stage = tempfile::Builder::new().prefix(".reformany-pdf-split-")
        .tempdir_in(&directory).map_err(|e| e.to_string())?;
    let mut oversized_pages = Vec::new();
    let mut ranges = Vec::new();
    if mode == "size" {
        if !(1..=4096).contains(&value) {
            return Err("PDF target size must be between 1 and 4096 MB".into());
        }
        let target_bytes = u64::from(value) * 1024 * 1024;
        let candidate = stage.path().join("sizing.pdf");
        let mut start = 0;
        while start < count {
            let mut end = start + 1;
            let mut length = write_pages(source, &candidate, start, end, count)?;
            if length > target_bytes {
                oversized_pages.push((start + 1) as u32);
            } else {
                while end < count {
                    let next = stage.path().join("next.pdf");
                    let next_bytes = write_pages(source, &next, start, end + 1, count)?;
                    if next_bytes > target_bytes { break; }
                    fs::rename(&next, &candidate).map_err(|e| e.to_string())?;
                    end += 1;
                    length = next_bytes;
                }
            }
            let _ = length;
            ranges.push((start,end));
            if ranges.len() > MAX_PARTS {
                return Err("PDF split would generate more than 200 parts".into());
            }
            start = end;
        }
    } else {
        ranges = plan_fixed(count, mode, value)?;
    }
    if ranges.len() < 2 {
        return Err("These settings produce only one PDF. Choose smaller chunks or more parts.".into());
    }
    // Stage every PDF and verify its content before publishing any result.
    let mut prepared: Vec<PathBuf> = Vec::with_capacity(ranges.len());
    for (index, (first,last)) in ranges.iter().copied().enumerate() {
        let part = stage.path().join(format!("part-{index:03}.pdf"));
        if write_pages(source, &part, first, last, count)? == 0 {
            return Err("An empty split PDF was generated".into());
        }
        prepared.push(part);
    }
    let mut published: Vec<PathBuf> = Vec::new();
    for (index, part) in prepared.iter().enumerate() {
        let label = format!("{stem}_part_{:02}", index + 1);
        match publish(part, &directory, &label, "pdf") {
            Ok(result) => published.push(result),
            Err(error) => {
                for output in &published { let _ = fs::remove_file(output); }
                return Err(error);
            }
        }
    }
    Ok(PdfSplitResult {
        output_paths: published.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        oversized_pages,
    })
}

#[tauri::command]
pub async fn pdf_split(path: String, destination: Option<String>, mode: String, value: u32) -> Result<PdfSplitResult,String> {
    tauri::async_runtime::spawn_blocking(move || split(&path, destination.as_deref(), &mode, value))
        .await.map_err(|_| "PDF split worker stopped unexpectedly".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_plan_distributes_pages_evenly() {
        assert_eq!(plan_fixed(11, "parts", 3).unwrap(), vec![(0,4),(4,8),(8,11)]);
        assert_eq!(plan_fixed(7, "pages", 3).unwrap(), vec![(0,3),(3,6),(6,7)]);
        assert!(plan_fixed(5, "parts", 6).is_err());
        assert!(plan_fixed(5, "size", 2).is_err());
    }

    #[test]
    fn splits_real_pdf_into_verified_independent_documents() {
        use lopdf::{dictionary, Object, Stream};
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Sample document.pdf");
        let mut original = Document::with_version("1.5");
        let pages_id = original.new_object_id();
        let mut children: Vec<Object> = Vec::new();
        for _ in 0..6 {
            let content = original.add_object(Stream::new(dictionary! {}, Vec::new()));
            let media_box: Vec<Object> = vec![0.into(), 0.into(), 612.into(), 792.into()];
            let page_id = original.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => media_box,
                "Contents" => content
            });
            children.push(page_id.into());
        }
        original.objects.insert(pages_id, Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => children,
            "Count" => 6,
        }));
        let catalog = original.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        original.trailer.set("Root", catalog);
        original.save(&source).unwrap();

        let out = split(source.to_str().unwrap(), None, "parts", 2).unwrap();
        assert_eq!(out.output_paths.len(), 2);
        for output in &out.output_paths {
            assert!(output.ends_with(".pdf"));
            let pdf = Document::load(output).unwrap();
            assert_eq!(pdf.get_pages().len(), 3);
        }
        assert_eq!(Document::load(&source).unwrap().get_pages().len(), 6);

        let out = split(source.to_str().unwrap(), None, "pages", 2).unwrap();
        assert_eq!(out.output_paths.len(), 3);
        for output in &out.output_paths {
            let pdf = Document::load(output).unwrap();
            assert_eq!(pdf.get_pages().len(), 2);
        }
    }
}
