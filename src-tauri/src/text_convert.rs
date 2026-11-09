//! Real, offline TXT exports. No file extensions are ever merely renamed.
use crate::external::{output_dir, publish, verify_input};
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const LIMIT: u64 = 4 * 1024 * 1024;

fn read_text(path: &Path) -> Result<String, String> {
    verify_input(path, false)?;
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > LIMIT {
        return Err("TXT must be a regular file smaller than 4 MB".into());
    }
    if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("txt")) {
        return Err("Choose a TXT source file".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let result = if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        let le = bytes[0] == 0xFF;
        if (bytes.len() - 2) % 2 != 0 { return Err("Truncated UTF-16".into()); }
        let units: Vec<u16> = bytes[2..].chunks_exact(2).map(|chunk| {
            if le { u16::from_le_bytes([chunk[0], chunk[1]]) }
            else { u16::from_be_bytes([chunk[0], chunk[1]]) }
        }).collect();
        String::from_utf16(&units).map_err(|_| "Invalid UTF-16 TXT contents")?
    } else {
        let data = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) { &bytes[3..] } else { &bytes };
        String::from_utf8(data.to_vec()).map_err(|_| "TXT must use UTF-8 or BOM-marked UTF-16")?
    };
    if result.contains('\0') { return Err("TXT contains binary NUL data".into()); }
    Ok(result.replace("\r\n", "\n").replace('\r', "\n"))
}
fn escape_xml(text: &str) -> String {
    text.chars().map(|c| match c {
        '&' => "&amp;".to_owned(),
        '<' => "&lt;".to_owned(),
        '>' => "&gt;".to_owned(),
        '"' => "&quot;".to_owned(),
        '\t' | '\n' => c.to_string(),
        c if c < '\u{20}' => "\u{FFFD}".to_owned(),
        c => c.to_string()
    }).collect()
}
fn archive(path: &Path, entries: &[(&str, String)], epub: bool) -> Result<(), String> {
    let mut writer = ZipWriter::new(File::create(path).map_err(|e| e.to_string())?);
    if epub {
        writer.start_file("mimetype", SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)).map_err(|e| e.to_string())?;
        writer.write_all(b"application/epub+zip").map_err(|e| e.to_string())?;
    }
    for (name, data) in entries {
        writer.start_file(*name, SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)).map_err(|e| e.to_string())?;
        writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    writer.finish().map_err(|e| e.to_string())?;
    let mut verify = ZipArchive::new(File::open(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Document package invalid: {e}"))?;
    if verify.len() != entries.len() + usize::from(epub) {
        return Err("Document package has missing entries".into());
    }
    for (name, _) in entries {
        verify.by_name(name).map_err(|e| format!("Document part missing: {name}: {e}"))?;
    }
    Ok(())
}
fn docx(path: &Path, text: &str) -> Result<(), String> {
    let body: String = text.split('\n').map(|line| format!(
        "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>", escape_xml(line))).collect();
    archive(path, &[
        ("[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>".to_owned()),
        ("_rels/.rels", "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>".to_owned()),
        ("word/document.xml", format!("<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{body}<w:sectPr/></w:body></w:document>")),
    ], false)
}
fn odt(path: &Path, text: &str) -> Result<(), String> {
    let body: String = text.split('\n').map(|line| format!("<text:p>{}</text:p>",escape_xml(line))).collect();
    archive(path,&[
        ("mimetype","application/vnd.oasis.opendocument.text".to_owned()),
        ("content.xml",format!("<?xml version=\"1.0\"?><office:document-content xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" office:version=\"1.2\"><office:body><office:text>{body}</office:text></office:body></office:document-content>")),
        ("META-INF/manifest.xml","<?xml version=\"1.0\"?><manifest:manifest xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\" manifest:version=\"1.2\"><manifest:file-entry manifest:media-type=\"application/vnd.oasis.opendocument.text\" manifest:full-path=\"/\"/><manifest:file-entry manifest:media-type=\"text/xml\" manifest:full-path=\"content.xml\"/></manifest:manifest>".to_owned())
    ],false)
}
fn epub(path: &Path, text: &str, title: &str) -> Result<(), String> {
    archive(path,&[
        ("META-INF/container.xml","<?xml version=\"1.0\"?><container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles><rootfile full-path=\"OEBPS/package.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>".to_owned()),
        ("OEBPS/package.opf",format!("<?xml version=\"1.0\"?><package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"id\"><metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:identifier id=\"id\">urn:uuid:3cf76dc7-a95b-4f38-8fba-1a9a96522961</dc:identifier><dc:title>{}</dc:title><dc:language>en</dc:language><meta property=\"dcterms:modified\">2026-01-01T00:00:00Z</meta></metadata><manifest><item id=\"text\" href=\"text.xhtml\" media-type=\"application/xhtml+xml\"/><item id=\"nav\" href=\"nav.xhtml\" properties=\"nav\" media-type=\"application/xhtml+xml\"/></manifest><spine><itemref idref=\"text\"/></spine></package>",escape_xml(title))),
        ("OEBPS/text.xhtml",format!("<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>{}</title></head><body><pre>{}</pre></body></html>",escape_xml(title),escape_xml(text))),
        ("OEBPS/nav.xhtml",format!("<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><head><title>Contents</title></head><body><nav epub:type=\"toc\"><h1>Contents</h1><ol><li><a href=\"text.xhtml\">{}</a></li></ol></nav></body></html>",escape_xml(title))),
    ],true)
}

const PAGE_WIDTH: u32 = 1240;
const PAGE_HEIGHT: u32 = 1754;
const LINE_LIMIT: usize = 78;
const LINES_PER_PAGE: usize = 37;
const MAX_PAGES: usize = 120;

fn page_lines(text: &str) -> Result<Vec<Vec<String>>, String> {
    let mut lines = Vec::<String>::new();
    for source_line in text.split('\n') {
        let mut current = String::new();
        let mut width = 0usize;
        for character in source_line.chars() {
            if character == '\t' {
                for _ in 0..4 {
                    current.push(' '); width += 1;
                    if width == LINE_LIMIT {
                        lines.push(std::mem::take(&mut current)); width = 0;
                    }
                }
            } else {
                current.push(character); width += 1;
                if width == LINE_LIMIT {
                    lines.push(std::mem::take(&mut current)); width = 0;
                }
            }
            if lines.len() > MAX_PAGES * LINES_PER_PAGE {
                return Err("TXT is too long for the 120-page PDF/image export safety limit".into());
            }
        }
        if !current.is_empty() || source_line.is_empty() {
            lines.push(current);
        }
    }
    if lines.is_empty() { lines.push(String::new()); }
    let pages = lines.chunks(LINES_PER_PAGE).map(|part| part.to_vec())
        .collect::<Vec<_>>();
    if pages.len() > MAX_PAGES {
        return Err("TXT is too long for the 120-page PDF/image export safety limit".into());
    }
    Ok(pages)
}

fn system_fonts() -> std::sync::Arc<resvg::usvg::fontdb::Database> {
    use std::sync::{Arc, OnceLock};
    static DB: OnceLock<Arc<resvg::usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut database = resvg::usvg::fontdb::Database::new();
        database.load_system_fonts();
        database.set_sans_serif_family("Segoe UI");
        Arc::new(database)
    }).clone()
}

fn render_page(lines: &[String], png: &Path) -> Result<(), String> {
    let fonts = system_fonts();
    if fonts.faces().next().is_none() {
        return Err("No installed text fonts were found; install a Unicode font before exporting TXT to PDF/images".into());
    }
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{PAGE_WIDTH}\" height=\"{PAGE_HEIGHT}\"><rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/>"
    );
    for (index,line) in lines.iter().enumerate() {
        let baseline = 118 + index * 40;
        svg.push_str(&format!(
            "<text x=\"90\" y=\"{baseline}\" fill=\"#1a211a\" font-family=\"sans-serif\" font-size=\"25\" xml:space=\"preserve\">{}</text>",
            escape_xml(line)
        ));
    }
    svg.push_str("</svg>");
    let mut options = resvg::usvg::Options::default();
    options.fontdb = fonts;
    let tree = resvg::usvg::Tree::from_str(&svg, &options)
        .map_err(|e| format!("Cannot lay out TXT page: {e}"))?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(PAGE_WIDTH, PAGE_HEIGHT)
        .ok_or("Cannot allocate TXT page image")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pixmap.as_mut());
    pixmap.save_png(png).map_err(|e| format!("Cannot encode TXT page as PNG: {e}"))
}
fn raster_text(source: &Path, text: &str, target: &str, output: &Path,
    staging: &Path) -> Result<Vec<String>,String>
{
    let pages = page_lines(text)?;
    let mut bitmaps = Vec::new();
    for (index, lines) in pages.iter().enumerate() {
        let png = staging.join(format!("txt-page-{:03}.png",index+1));
        render_page(lines, &png)?;
        bitmaps.push(png);
    }
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("Document");
    if target == "pdf" {
        // Reuse the same verified PDF writer as Images→PDF, but keep its
        // temporary "Images" filename out of the final user-facing output.
        let source_paths = bitmaps.iter()
            .map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>();
        let temporary_folder = staging.to_string_lossy().into_owned();
        let draft = crate::documents::build_image_pdf(
            &source_paths,Some(&temporary_folder))?;
        let file = publish(Path::new(&draft),output,stem,"pdf")
            .map_err(|e| e.to_string())?;
        return Ok(vec![file.to_string_lossy().into_owned()]);
    }
    let mut produced = Vec::new();
    for (index, png) in bitmaps.iter().enumerate() {
        let name = if bitmaps.len() == 1 {stem.to_owned()}
            else {format!("{stem}-page-{:03}",index+1)};
        let staged = if target == "jpg" {
            let jpeg = staging.join(format!("txt-page-{:03}.jpg",index+1));
            image::open(png).map_err(|e| e.to_string())?
                .save_with_format(&jpeg,image::ImageFormat::Jpeg)
                .map_err(|e| format!("Cannot encode TXT page as JPEG: {e}"))?;
            jpeg
        } else {
            png.clone()
        };
        let path = publish(&staged,output,&name,target).map_err(|e| e.to_string())?;
        produced.push(path.to_string_lossy().into_owned());
    }
    Ok(produced)
}

fn convert_text(path: &str, target: &str, destination: Option<&str>) -> Result<Vec<String>, String> {
    let source = Path::new(path);
    let text = read_text(source)?;
    let target = target.to_ascii_lowercase();
    if !matches!(target.as_str(),"html"|"md"|"rtf"|"docx"|"odt"|"epub"|"pdf"|"png"|"jpg") {
        return Err("TXT export supports PDF, DOCX, RTF, ODT, HTML, Markdown, EPUB, PNG and JPG".into());
    }
    let folder = output_dir(source, destination)?;
    let stage = tempfile::Builder::new().prefix(".reformany-text-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("Document");
    if matches!(target.as_str(),"pdf"|"png"|"jpg") {
        return raster_text(source,&text,&target,&folder,stage.path());
    }
    let temporary = stage.path().join(format!("document.{target}"));
    match target.as_str() {
        "html" => fs::write(&temporary,format!("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>ReformANY Text</title></head><body><pre style=\"white-space:pre-wrap;overflow-wrap:anywhere\">{}</pre></body></html>",escape_xml(&text))).map_err(|e| e.to_string())?,
        "md" => fs::write(&temporary,text).map_err(|e| e.to_string())?,
        "rtf" => {
            let mut data = String::from("{\\rtf1\\ansi\\deff0 ");
            for character in text.chars() {
                match character {
                    '\\' | '{' | '}' => {data.push('\\');data.push(character);}
                    '\n' => data.push_str("\\par\n"),
                    '\t' => data.push_str("\\tab "),
                    c if c.is_ascii() && !c.is_ascii_control() => data.push(c),
                    c => {
                        let mut buf = [0u16;2];
                        for unit in c.encode_utf16(&mut buf).iter().copied() {
                            data.push_str(&format!("\\u{}?",unit as i16));
                        }
                    }
                }
            }
            data.push('}');
            fs::write(&temporary,data).map_err(|e| e.to_string())?;
        }
        "docx" => docx(&temporary,&text)?,
        "odt" => odt(&temporary,&text)?,
        "epub" => epub(&temporary,&text,stem)?,
        _ => unreachable!(),
    }
    let output = publish(&temporary,&folder,stem,&target).map_err(|e| e.to_string())?;
    Ok(vec![output.to_string_lossy().into_owned()])
}
#[tauri::command]
pub async fn text_convert(path:String,target:String,destination:Option<String>)->Result<Vec<String>,String>{
    tauri::async_runtime::spawn_blocking(move || convert_text(&path,&target,destination.as_deref()))
        .await.map_err(|e| format!("TXT conversion worker failed: {e}"))?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rasterizes_paginated_unicode_txt() {
        let dir=tempfile::tempdir().unwrap();
        let file=dir.path().join("Report.txt");
        fs::write(&file,"Hello, world!\nThis page must be readable.").unwrap();
        for target in ["png","jpg","pdf"] {
            let outputs=convert_text(&file.to_string_lossy(),target,None).unwrap();
            assert!(!outputs.is_empty());
            assert!(Path::new(&outputs[0]).is_file());
            assert!(fs::metadata(&outputs[0]).unwrap().len()>200);
        }
    }
    #[test]
    fn utf16_unicode_to_real_text_documents(){
        let dir=tempfile::tempdir().unwrap();
        let path=dir.path().join("Test.txt");
        let mut raw=vec![0xFF,0xFE];
        for code in "Hello 🌍\r\nline 2".encode_utf16(){raw.extend_from_slice(&code.to_le_bytes());}
        fs::write(&path,raw).unwrap();
        assert_eq!(read_text(&path).unwrap(),"Hello 🌍\nline 2");
        for target in ["html","md","rtf","docx","odt","epub"]{
            let outputs=convert_text(&path.to_string_lossy(),target,None).unwrap();
            assert!(Path::new(&outputs[0]).is_file());
            assert!(fs::metadata(&outputs[0]).unwrap().len()>10);
        }
    }
}
