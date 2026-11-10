//! Rendered PDF page-image publisher. Rendering is performed by the bundled
//! offline PDF.js worker in the WebView; Rust validates every PNG/JPEG before
//! publishing a complete, collision-safe set of images.
use base64::Engine;
use crate::external::{format_name,output_dir,publish,verify_input};
use lopdf::Document;
use std::{fs, path::{Path, PathBuf}};

const MAX_PAGES: usize = 60;
const MAX_PAGE_BYTES: usize = 24 * 1024 * 1024;
const MAX_PIXEL_COUNT: u64 = 18_000_000;

fn save_pages(path: &str, target: &str, images: Vec<String>, destination: Option<&str>)
    -> Result<Vec<String>,String>
{
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
    if !(1..=MAX_PAGES).contains(&count) || images.len()!=count {
        return Err(format!("PDF rendering requires all {count} pages, up to {MAX_PAGES} pages per job"));
    }
    let folder=output_dir(input,destination)?;
    let stem=format_name(input)?;
    let staged=tempfile::Builder::new().prefix(".reformany-pdf-pages-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let mut ready: Vec<PathBuf>=Vec::with_capacity(count);
    let expected=if target=="png" {image::ImageFormat::Png} else {image::ImageFormat::Jpeg};
    for (index,encoded) in images.into_iter().enumerate() {
        if encoded.len() > MAX_PAGE_BYTES*4/3+16 {
            return Err(format!("Page {} is too large",index+1));
        }
        let bytes=base64::engine::general_purpose::STANDARD.decode(encoded)
            .map_err(|_| format!("Page {} has invalid encoded image data",index+1))?;
        if bytes.is_empty() || bytes.len() > MAX_PAGE_BYTES {
            return Err(format!("Page {} is empty or too large",index+1));
        }
        let detected=image::guess_format(&bytes)
            .map_err(|e| format!("Cannot identify page image {}: {e}",index+1))?;
        if detected!=expected {return Err(format!("Page {} has an unexpected image format",index+1));}
        let picture=image::load_from_memory_with_format(&bytes,expected)
            .map_err(|e| format!("Cannot decode page image {}: {e}",index+1))?;
        let (w,h)=(picture.width(),picture.height());
        if w==0 || h==0 || u64::from(w)*u64::from(h)>MAX_PIXEL_COUNT {
            return Err(format!("Page {} has unsupported image dimensions",index+1));
        }
        let file=staged.path().join(format!("page-{:03}.{target}",index+1));
        fs::write(&file,&bytes).map_err(|e| format!("Cannot stage page {}: {e}",index+1))?;
        ready.push(file);
    }
    let mut published: Vec<PathBuf>=Vec::with_capacity(count);
    for (i,source) in ready.iter().enumerate() {
        let label=format!("{stem}_page_{:03}",i+1);
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

#[tauri::command]
pub async fn pdf_save_rendered_pages(path:String, target:String, images:Vec<String>, destination:Option<String>)
    -> Result<Vec<String>,String>
{
    tauri::async_runtime::spawn_blocking(move ||save_pages(&path,&target,images,destination.as_deref()))
        .await.map_err(|_| "PDF image publisher interrupted".to_owned())?
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
        assert_eq!(image::open(&outputs[0]).unwrap().width(),1);
        assert_eq!(Document::load(input).unwrap().get_pages().len(),1);
    }
}
