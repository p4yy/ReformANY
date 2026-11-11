//! PDF -> PNG/JPG page-image publisher, offline and collision-safe.
//! JavaScript PDF.js renders bounded batches; Rust validates their page numbers,
//! contents, and real PDF page count before putting them in <stem>_images.
use base64::Engine;
use crate::external::{format_name,output_dir,publish,verify_input};
use lopdf::Document;
use std::{fs, path::{Path, PathBuf}};

const MAX_PAGE_BYTES: usize = 24 * 1024 * 1024;
const MAX_PIXEL_COUNT: u64 = 18_000_000;
const MAX_BATCH_PAGES: usize = 12;

fn save_pages_at(
    path: &str, target: &str, images: Vec<String>,
    start_page: usize, total_pages: Option<usize>, destination: Option<&str>,
) -> Result<Vec<String>,String> {
    if !matches!(target, "png" | "jpg") {
        return Err("Only PNG and JPG page renders are supported".into());
    }
    let input=Path::new(path);
    verify_input(input,false)?;
    if !input.extension().and_then(|x| x.to_str())
        .is_some_and(|x| x.eq_ignore_ascii_case("pdf"))
    { return Err("Full-page rendering requires a PDF document".into()); }
    let document=Document::load(input).map_err(|e| format!("Cannot read source PDF: {e}"))?;
    let count=document.get_pages().len();
    if count==0 || images.is_empty() || start_page==0 ||
       start_page.checked_add(images.len()-1).is_none_or(|last|last>count) {
        return Err(format!("Requested PDF page range is outside the 1-{count} document range"));
    }
    if let Some(expected)=total_pages {
        if expected!=count {return Err("PDF page count changed during rendering; output was not published".into());}
        if images.len()>MAX_BATCH_PAGES {return Err("PDF image batch exceeds the memory-safe limit".into());}
    } else if start_page!=1 || images.len()!=count {
        return Err("Legacy PDF page publisher requires the complete document".into());
    }
    let root=output_dir(input,destination)?;
    let stem=format_name(input)?;
    let folder=root.join(format!("{stem}_images"));
    // Stage/validate all pages before publishing this batch. Never place
    // loose images in the original PDF directory.
    fs::create_dir_all(&folder).map_err(|e|format!("Cannot create PDF image output folder: {e}"))?;
    let staged=tempfile::Builder::new().prefix(".reformany-pdf-pages-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let mut ready: Vec<PathBuf>=Vec::with_capacity(images.len());
    let expected=if target=="png" {image::ImageFormat::Png} else {image::ImageFormat::Jpeg};
    for (index,encoded) in images.into_iter().enumerate() {
        let page=start_page+index;
        if encoded.len()>MAX_PAGE_BYTES*4/3+16 {
            return Err(format!("Page {page} is too large"));
        }
        let bytes=base64::engine::general_purpose::STANDARD.decode(encoded)
            .map_err(|_| format!("Page {page} has invalid encoded image data"))?;
        if bytes.is_empty() || bytes.len()>MAX_PAGE_BYTES {
            return Err(format!("Page {page} is empty or too large"));
        }
        let detected=image::guess_format(&bytes)
            .map_err(|e| format!("Cannot identify page image {page}: {e}"))?;
        if detected!=expected {return Err(format!("Page {page} has an unexpected image format"));}
        let picture=image::load_from_memory_with_format(&bytes,expected)
            .map_err(|e| format!("Cannot decode page image {page}: {e}"))?;
        let (w,h)=(picture.width(),picture.height());
        if w==0 || h==0 || u64::from(w)*u64::from(h)>MAX_PIXEL_COUNT {
            return Err(format!("Page {page} has unsupported image dimensions"));
        }
        let file=staged.path().join(format!("page-{page:04}.{target}"));
        fs::write(&file,&bytes).map_err(|e| format!("Cannot stage page {page}: {e}"))?;
        ready.push(file);
    }
    let mut published: Vec<PathBuf>=Vec::with_capacity(ready.len());
    for (i,source) in ready.iter().enumerate() {
        let label=format!("{stem}_page_{:04}",start_page+i);
        match publish(source,&folder,&label,target) {
            Ok(output)=>published.push(output),
            Err(error)=>{
                for saved in &published {let _=fs::remove_file(saved);}
                return Err(error);
            }
        }
    }
    Ok(published.into_iter().map(|p|p.to_string_lossy().into_owned()).collect())
}

fn save_pages(path:&str,target:&str,images:Vec<String>,destination:Option<&str>)
    -> Result<Vec<String>,String>
{
    save_pages_at(path,target,images,1,None,destination)
}

#[tauri::command]
pub async fn pdf_save_rendered_pages(path:String, target:String, images:Vec<String>, destination:Option<String>)
    -> Result<Vec<String>,String>
{
    tauri::async_runtime::spawn_blocking(move ||save_pages(&path,&target,images,destination.as_deref()))
        .await.map_err(|_| "PDF image publisher interrupted".to_owned())?
}

/// Stream a small, validated range, so even 269+ pages never need to cross
/// one giant WebView-to-Rust IPC call.
#[tauri::command]
pub async fn pdf_save_rendered_page_batch(
    path:String, target:String, images:Vec<String>,
    start_page:usize, total_pages:usize, destination:Option<String>,
) -> Result<Vec<String>,String>
{
    tauri::async_runtime::spawn_blocking(move ||
        save_pages_at(&path,&target,images,start_page,Some(total_pages),destination.as_deref())
    ).await.map_err(|_| "PDF image batch publisher interrupted".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary,Object,Stream};
    use image::ImageEncoder;
    #[test]
    fn publisher_rejects_wrong_format_and_preserves_original_pdf() {
        let tmp=tempfile::tempdir().unwrap();
        let source=tmp.path().join("sample.pdf");
        let mut doc=Document::with_version("1.4");
        let root=doc.new_object_id();
        let content=doc.add_object(Stream::new(dictionary! {},vec![]));
        let page=doc.add_object(dictionary! {
            "Type"=>"Page","Parent"=>root,
            "MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()],
            "Contents"=>content
        });
        doc.objects.insert(root,Object::Dictionary(dictionary! {
            "Type"=>"Pages","Kids"=>vec![Object::Reference(page)],"Count"=>1
        }));
        let catalog=doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>root});
        doc.trailer.set("Root",catalog);
        doc.save(&source).unwrap();
        let mut png=Vec::<u8>::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(&[255,0,0,255],1,1,image::ExtendedColorType::Rgba8).unwrap();
        let encoded=base64::engine::general_purpose::STANDARD.encode(&png);
        let input=source.to_str().unwrap();
        assert!(save_pages(input,"jpg",vec![encoded.clone()],None).is_err());
        assert!(save_pages(input,"png",vec![],None).is_err());
        let outputs=save_pages(input,"png",vec![encoded],None).unwrap();
        assert_eq!(outputs.len(),1);
        assert!(Path::new(&outputs[0]).parent().unwrap().ends_with("sample_images"));
        assert_eq!(image::open(&outputs[0]).unwrap().width(),1);
        assert_eq!(Document::load(input).unwrap().get_pages().len(),1);
    }
}
