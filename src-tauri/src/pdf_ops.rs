//! Safe, non-destructive PDF page extraction and rotation.
//! These are document operations, separate from binary file splitting.
use crate::external::{format_name, output_dir, publish, verify_input};
use lopdf::Document;
use std::fs;
use std::path::Path;

const MAX_PAGE_COUNT: usize = 500;
const MAX_FILE_BYTES: u64 = 96 * 1024 * 1024;

pub(crate) fn open_pdf(path: &Path) -> Result<Document, String> {
    verify_input(path, false)?;
    if !path.extension().and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("pdf")) {
        return Err("Choose a PDF document".into());
    }
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_FILE_BYTES {
        return Err("PDF editor currently supports files up to 96 MB".into());
    }
    let pdf = Document::load(path).map_err(|e| format!("Cannot read this PDF: {e}"))?;
    if !(1..=MAX_PAGE_COUNT).contains(&pdf.get_pages().len()) {
        return Err("PDF editor requires 1 to 500 pages".into());
    }
    Ok(pdf)
}

/// Strict parser: preserves the supplied order and never silently drops
/// malformed or duplicate page numbers. "1,3-5,9" -> [1,3,4,5,9].
pub(crate) fn parse_pages(expression: &str, count: usize) -> Result<Vec<u32>, String> {
    if expression.trim().is_empty() {
        return Err("Enter page numbers such as 1,3-5,9".into());
    }
    let mut selected = Vec::new();
    let mut seen = vec![false; count];
    for chunk in expression.split(',') {
        let chunk = chunk.trim();
        if chunk.is_empty() { return Err("Remove empty page entries".into()); }
        let parse = |text: &str| -> Result<usize, String> {
            if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
                return Err(format!("Invalid page entry: {text}"));
            }
            let number = text.parse::<usize>().map_err(|_| "Page number is too large")?;
            if number < 1 || number > count {
                return Err(format!("Page {number} is outside 1–{count}"));
            }
            Ok(number)
        };
        let (first,last) = if let Some((first,last)) = chunk.split_once('-') {
            (parse(first.trim())?,parse(last.trim())?)
        } else { let n=parse(chunk)?; (n,n) };
        if first > last { return Err(format!("Reversed page range: {chunk}")); }
        for n in first..=last {
            if seen[n-1] { return Err(format!("Page {n} is selected more than once")); }
            seen[n-1] = true;
            selected.push(n as u32);
        }
    }
    if selected.len() > MAX_PAGE_COUNT { return Err("Too many selected pages".into()); }
    // lopdf::delete_pages maintains the original page order, so don't accept
    // requests that could appear reordered without actually being so.
    if selected.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err("Enter page ranges in ascending order".into());
    }
    Ok(selected)
}

pub(crate) fn stage_pdf(original: &Path, destination: Option<&str>, suffix: &str, pdf: &mut Document)
    -> Result<String, String>
{
    let folder = output_dir(original, destination)?;
    let base = format!("{}_{}", format_name(original)?, suffix);
    let stage = tempfile::Builder::new().prefix(".reformany-pdf-op-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let file = stage.path().join("output.pdf");
    pdf.save(&file).map_err(|e| format!("Cannot save PDF: {e}"))?;
    let saved = Document::load(&file).map_err(|e| format!("PDF validation failed: {e}"))?;
    if saved.get_pages().is_empty() {
        return Err("PDF output has no pages".into());
    }
    let path = publish(&file, &folder, &base, "pdf")?;
    Ok(path.to_string_lossy().into_owned())
}

fn extract_pages(path: &str, selection: &str, destination: Option<&str>) -> Result<String,String> {
    let input=Path::new(path);
    let mut pdf=open_pdf(input)?;
    let count=pdf.get_pages().len();
    let keep=parse_pages(selection,count)?;
    let remove: Vec<u32>=(1..=count as u32).filter(|n| !keep.contains(n)).collect();
    pdf.delete_pages(&remove);
    pdf.prune_objects();
    if pdf.get_pages().len()!=keep.len() {
        return Err("Page extraction did not preserve the requested number of pages".into());
    }
    stage_pdf(input,destination,"extracted_pages",&mut pdf)
}

fn rotation_on_page(pdf: &Document, page_id: lopdf::ObjectId) -> i64 {
    let mut current=page_id;
    for _ in 0..32 {
        let Ok(dict)=pdf.get_dictionary(current) else { break };
        if let Ok(value)=dict.get(b"Rotate").and_then(lopdf::Object::as_i64) { return value; }
        let Ok(parent)=dict.get(b"Parent").and_then(lopdf::Object::as_reference) else { break };
        current=parent;
    }
    0
}

fn rotate_pages(path: &str, selection: Option<&str>, degrees: i32, destination: Option<&str>)
    -> Result<String,String>
{
    if !matches!(degrees, 90 | -90 | 180) {
        return Err("Choose 90° right, 90° left, or 180°".into());
    }
    let input=Path::new(path);
    let mut pdf=open_pdf(input)?;
    let page_ids=pdf.get_pages();
    let count=page_ids.len();
    let selected=if let Some(expr)=selection.filter(|s| !s.trim().is_empty()) {
        parse_pages(expr,count)?
    } else { (1..=count as u32).collect() };
    for number in selected {
        let page_id=*page_ids.get(&number).ok_or("PDF page index changed unexpectedly")?;
        let old=rotation_on_page(&pdf,page_id);
        let degrees=(old+i64::from(degrees)).rem_euclid(360);
        pdf.get_object_mut(page_id).map_err(|e| e.to_string())?
            .as_dict_mut().map_err(|e| e.to_string())?
            .set("Rotate",degrees);
    }
    let result=stage_pdf(input,destination,"rotated",&mut pdf)?;
    let verify=open_pdf(Path::new(&result))?;
    if verify.get_pages().len()!=count {
        return Err("Rotation changed the PDF page count unexpectedly".into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn pdf_page_count(path: String) -> Result<usize,String> {
    tauri::async_runtime::spawn_blocking(move || Ok(open_pdf(Path::new(&path))?.get_pages().len()))
        .await.map_err(|_| "PDF page check interrupted".to_owned())?
}

#[tauri::command]
pub async fn pdf_extract_pages(path: String, pages: String, destination: Option<String>)
    -> Result<String,String>
{
    tauri::async_runtime::spawn_blocking(move || extract_pages(&path,&pages,destination.as_deref()))
        .await.map_err(|_| "PDF page extraction worker interrupted".to_owned())?
}

#[tauri::command]
pub async fn pdf_rotate_pages(path: String, pages: Option<String>, degrees: i32, destination: Option<String>)
    -> Result<String,String>
{
    tauri::async_runtime::spawn_blocking(move || rotate_pages(&path,pages.as_deref(),degrees,destination.as_deref()))
        .await.map_err(|_| "PDF page rotation worker interrupted".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary,Object,Stream};
    fn example(path:&Path) {
        let mut pdf=Document::with_version("1.5");
        let root=pdf.new_object_id();
        let mut children=Vec::<Object>::new();
        for _ in 0..9 {
            let content=pdf.add_object(Stream::new(dictionary! {},vec![]));
            let page=pdf.add_object(dictionary! {
                "Type"=>"Page", "Parent"=>root,
                "MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()],
                "Contents"=>content
            });
            children.push(page.into());
        }
        pdf.objects.insert(root,Object::Dictionary(dictionary! {
            "Type"=>"Pages","Kids"=>children,"Count"=>9
        }));
        let catalog=pdf.add_object(dictionary! {"Type"=>"Catalog","Pages"=>root});
        pdf.trailer.set("Root",catalog);
        pdf.save(path).unwrap();
    }
    #[test]
    fn page_selection_rejects_malformed_duplicate_and_reversed_ranges() {
        assert_eq!(parse_pages("1,3-5,9",9).unwrap(),vec![1,3,4,5,9]);
        for bad in ["", "1SDASD", "1-", "1,1", "1,3-5,4", "8-2", "10", "0", "3,2", "1,,2", "1-2-3"] {
            assert!(parse_pages(bad,9).is_err(),"Expected invalid: {bad}");
        }
    }
    #[test]
    fn actual_extraction_and_rotation_keep_source_intact() {
        let stage=tempfile::tempdir().unwrap();
        let input=stage.path().join("Source.pdf");
        example(&input);
        let extracted=extract_pages(input.to_str().unwrap(),"1,3-5,9",None).unwrap();
        assert_eq!(Document::load(extracted).unwrap().get_pages().len(),5);
        let rotated=rotate_pages(input.to_str().unwrap(),Some("2,4"),90,None).unwrap();
        let doc=Document::load(rotated).unwrap();
        assert_eq!(doc.get_pages().len(),9);
        for (number,id) in doc.get_pages() {
            let angle=rotation_on_page(&doc,id);
            assert_eq!(angle,if number==2 || number==4 {90} else {0});
        }
        let original=Document::load(&input).unwrap();
        assert_eq!(original.get_pages().len(),9);
        assert_eq!(rotation_on_page(&original,*original.get_pages().get(&2).unwrap()),0);
    }
}
