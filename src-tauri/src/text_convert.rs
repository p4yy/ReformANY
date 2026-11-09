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
fn convert_text(path: &str, target: &str, destination: Option<&str>) -> Result<Vec<String>, String> {
    let source = Path::new(path);
    let text = read_text(source)?;
    let target = target.to_ascii_lowercase();
    if !matches!(target.as_str(),"html"|"md"|"rtf"|"docx"|"odt"|"epub") {
        return Err("This native TXT converter supports HTML, Markdown, RTF, DOCX, ODT and EPUB".into());
    }
    let folder = output_dir(source, destination)?;
    let stage = tempfile::Builder::new().prefix(".reformany-text-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("Document");
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
