//! Offline Word DOCX output. "Flowing" contains editable paragraphs;
//! "Layout" contains one full-page PDF render per Word page (not editable text).
//! Neither mode claims OCR, nor does it alter the source PDF.
use crate::external::{format_name,output_dir,publish};
use base64::Engine;
use image::{ImageFormat,GenericImageView};
use lopdf::Document;
use std::{fs,io::{Read,Write},path::Path};
use zip::{CompressionMethod,ZipArchive,ZipWriter,write::SimpleFileOptions};

const MAX_TEXT:usize=4*1024*1024;
const MAX_IMAGES:usize=60;
const MAX_IMAGE_SIZE:usize=20*1024*1024;
const MAX_PIXELS:u64=18_000_000;
fn escape(text:&str)->String{
    let mut escaped=String::with_capacity(text.len());
    for c in text.chars(){
        match c{
            '&'=>escaped.push_str("&amp;"),
            '<'=>escaped.push_str("&lt;"),
            '>'=>escaped.push_str("&gt;"),
            '"'=>escaped.push_str("&quot;"),
            '\''=>escaped.push_str("&apos;"),
            c if c=='\t'||c=='\n'||c=='\r'||(c>=' '&&c!='\u{FFFE}'&&c!='\u{FFFF}')=>escaped.push(c),
            _=>{}
        }
    }
    escaped
}
fn paragraph(text:&str)->String{
    format!("<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",escape(text))
}
fn document(head:&str)->String{
    format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>{}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>
<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>
</w:body></w:document>"#,head)
}
const CONTENT_TYPES:&str=r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#;
const ROOT_RELS:&str=r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;
fn write_part(writer:&mut ZipWriter<fs::File>,name:&str,data:&[u8])->Result<(),String>{
    writer.start_file(name,SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated))
        .map_err(|e|format!("Cannot create DOCX part {name}: {e}"))?;
    writer.write_all(data).map_err(|e|e.to_string())
}
fn save(input:&Path,content:&str,images:&[(String,Vec<u8>)],
    destination:Option<&str>,suffix:&str)->Result<String,String>{
    let folder=output_dir(input,destination)?;
    let stage=tempfile::Builder::new().prefix(".reformany-word-")
        .tempdir_in(&folder).map_err(|e|e.to_string())?;
    let file=stage.path().join("output.docx");
    let mut zip=ZipWriter::new(fs::File::create(&file).map_err(|e|e.to_string())?);
    write_part(&mut zip,"[Content_Types].xml",CONTENT_TYPES.as_bytes())?;
    write_part(&mut zip,"_rels/.rels",ROOT_RELS.as_bytes())?;
    write_part(&mut zip,"word/document.xml",document(content).as_bytes())?;
    if !images.is_empty(){
        let mut rels=String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#);
        for (i,(name,bytes)) in images.iter().enumerate(){
            write_part(&mut zip,&format!("word/media/{name}"),bytes)?;
            rels.push_str(&format!(r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{}"/>"#,i+1,name));
        }
        rels.push_str("</Relationships>");
        write_part(&mut zip,"word/_rels/document.xml.rels",rels.as_bytes())?;
    }
    zip.finish().map_err(|e|format!("Cannot finish DOCX: {e}"))?;
    // Validate actual ZIP parts, not just a file extension.
    let mut check=ZipArchive::new(fs::File::open(&file).map_err(|e|e.to_string())?)
        .map_err(|e|format!("DOCX package cannot be read: {e}"))?;
    let mut body=String::new();
    check.by_name("word/document.xml").map_err(|e|e.to_string())?
        .read_to_string(&mut body).map_err(|e|e.to_string())?;
    if !body.starts_with("<?xml")||!body.contains("<w:document")||!body.contains("<w:sectPr>"){
        return Err("DOCX output is structurally incomplete".into());
    }
    for (name,_) in images{
        check.by_name(&format!("word/media/{name}"))
            .map_err(|e|format!("Missing DOCX page image: {e}"))?;
    }
    let stem=format!("{}_{}",format_name(input)?,suffix);
    publish(&file,&folder,&stem,"docx")
        .map(|path|path.to_string_lossy().into_owned())
}
fn editable(path:&str,destination:Option<&str>)->Result<String,String>{
    let source=Path::new(path);
    let pdf=crate::pdf_ops::open_pdf(source)?;
    let pages=pdf.get_pages();
    let mut doc=String::new();
    let mut total=0usize;
    for (i,number) in pages.keys().enumerate(){
        let text=pdf.extract_text(&[*number]).map_err(|e|format!("Cannot extract PDF text: {e}"))?;
        total=total.saturating_add(text.len());
        if total>MAX_TEXT{return Err("Editable DOCX conversion exceeds the 4MB text limit".into());}
        for line in text.lines(){
            doc.push_str(&paragraph(line));
        }
        if i+1<pages.len(){doc.push_str("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");}
    }
    if total==0||!doc.contains("<w:t"){
        return Err("This PDF has no editable text. Try DOCX (layout) for scanned pages".into());
    }
    save(source,&doc,&[],destination,"editable")
}
fn picture_markup(index:usize,width:u32,height:u32)->String{
    // Fit inside a US Letter sheet with half-inch margins, preserving aspect.
    const MAX_W:f64=6_858_000.0;
    const MAX_H:f64=9_144_000.0;
    let scale=(MAX_W/f64::from(width)).min(MAX_H/f64::from(height));
    let cx=(f64::from(width)*scale)as u64;
    let cy=(f64::from(height)*scale)as u64;
    format!(r#"<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{index}" name="PDF page {index}"/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic><pic:nvPicPr><pic:cNvPr id="{index}" name="page{index}.png"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rId{index}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#)
}
fn layout(path:&str,encoded:Vec<String>,destination:Option<&str>)->Result<String,String>{
    let source=Path::new(path);
    let pages=crate::pdf_ops::open_pdf(source)?.get_pages().len();
    if pages==0||pages>MAX_IMAGES||encoded.len()!=pages{
        return Err(format!("DOCX layout requires every page, up to {MAX_IMAGES} pages per job"));
    }
    let mut images=Vec::<(String,Vec<u8>)>::new();
    let mut markup=String::new();
    let mut memory=0usize;
    for (i,text) in encoded.into_iter().enumerate(){
        if text.len()>MAX_IMAGE_SIZE*4/3+16{
            return Err(format!("DOCX page {} exceeds the image size limit",i+1));
        }
        let bytes=base64::engine::general_purpose::STANDARD.decode(text)
            .map_err(|_|format!("DOCX page {} is not valid Base64",i+1))?;
        memory=memory.saturating_add(bytes.len());
        if bytes.len()>MAX_IMAGE_SIZE||memory>128*1024*1024{
            return Err("DOCX layout images exceed the configured memory limit".into());
        }
        let format=image::guess_format(&bytes).map_err(|e|e.to_string())?;
        if format!=ImageFormat::Png{return Err("DOCX page images must use PNG".into());}
        let image=image::load_from_memory_with_format(&bytes,ImageFormat::Png)
            .map_err(|e|format!("DOCX page {} cannot be decoded: {e}",i+1))?;
        let (w,h)=image.dimensions();
        if w==0||h==0||u64::from(w)*u64::from(h)>MAX_PIXELS{
            return Err(format!("DOCX page {} has unsafe dimensions",i+1));
        }
        markup.push_str(&picture_markup(i+1,w,h));
        if i+1<pages {markup.push_str("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");}
        images.push((format!("page{}.png",i+1),bytes));
    }
    save(source,&markup,&images,destination,"layout")
}
#[tauri::command]
pub async fn pdf_docx_editable(path:String,destination:Option<String>)->Result<String,String>{
    tauri::async_runtime::spawn_blocking(move||editable(&path,destination.as_deref()))
        .await.map_err(|_|"Editable DOCX worker interrupted".into())?
}
#[tauri::command]
pub async fn pdf_docx_layout(path:String,images:Vec<String>,destination:Option<String>)
    ->Result<String,String>{
    tauri::async_runtime::spawn_blocking(move||layout(&path,images,destination.as_deref()))
        .await.map_err(|_|"Layout DOCX worker interrupted".into())?
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn word_escapes_text_and_writes_real_valid_package(){
        let dir=tempfile::tempdir().unwrap();
        let path=dir.path().join("Sample.pdf");
        fs::write(&path,b"%PDF-1.4").unwrap();
        let result=save(&path,&paragraph("Hello & World <editable>"),&[],None,"editable").unwrap();
        let mut archive=ZipArchive::new(fs::File::open(result).unwrap()).unwrap();
        let mut body=String::new();
        archive.by_name("word/document.xml").unwrap().read_to_string(&mut body).unwrap();
        assert!(body.contains("Hello &amp; World &lt;editable&gt;"));
        assert!(body.contains("w:sectPr"));
    }
}
