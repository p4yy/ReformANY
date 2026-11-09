//! Extract embedded image objects, not whole rendered PDF pages.
//! This is deliberately independent from PDF -> PNG/JPG page rendering.
use crate::external::{format_name, output_dir, publish, verify_input};
use lopdf::{Document, Object};
use serde::Serialize;
use std::{fs, path::{Path,PathBuf}};

const MAX_EMBEDDED_IMAGES: usize=200;
const MAX_PDF_SIZE: u64=80*1024*1024;
const MAX_PIXELS: u64=18_000_000;

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ExtractedPdfImages {
    output_paths: Vec<String>,
    skipped_unsupported: usize,
}

fn as_name(value: &Object) -> Option<&[u8]> {
    if let Object::Name(n)=value {Some(n)} else {None}
}

fn extract(path:&str,destination:Option<&str>) -> Result<ExtractedPdfImages,String> {
    let input=Path::new(path);
    verify_input(input,false)?;
    if !input.extension().and_then(|x|x.to_str())
        .is_some_and(|x|x.eq_ignore_ascii_case("pdf")) {
        return Err("Embedded image extraction requires a PDF".into());
    }
    if fs::metadata(input).map_err(|e|e.to_string())?.len()>MAX_PDF_SIZE {
        return Err("PDF embedded image extraction supports files up to 80 MB".into());
    }
    let pdf=Document::load(input).map_err(|e|format!("Cannot read PDF: {e}"))?;
    let mut selected=Vec::<(String,Vec<u8>)>::new();
    let mut skipped=0usize;
    for object in pdf.objects.values() {
        let Object::Stream(stream)=object else {continue};
        if !stream.dict.get(b"Subtype").ok().and_then(as_name)
            .is_some_and(|name|name==b"Image") {continue;}
        if selected.len()+skipped>=MAX_EMBEDDED_IMAGES {
            return Err("PDF contains too many embedded image objects".into());
        }
        let dct=stream.dict.get(b"Filter").ok().is_some_and(|filter|match filter {
            Object::Name(n)=>n==b"DCTDecode",
            Object::Array(a)=>a.iter().any(|x|as_name(x).is_some_and(|n|n==b"DCTDecode")),
            _=>false
        });
        let width=stream.dict.get(b"Width").ok().and_then(|v|v.as_i64().ok()).unwrap_or(0);
        let height=stream.dict.get(b"Height").ok().and_then(|v|v.as_i64().ok()).unwrap_or(0);
        if width<1||height<1||(width as u64).saturating_mul(height as u64)>MAX_PIXELS {
            skipped+=1;continue;
        }
        if dct {
            // DCTDecode stores JPEG bytes: keep them bit-for-bit and verify.
            if image::load_from_memory_with_format(&stream.content,image::ImageFormat::Jpeg).is_ok(){
                selected.push(("jpg".into(),stream.content.clone()));
            } else {skipped+=1;}
            continue;
        }
        let depth=stream.dict.get(b"BitsPerComponent").ok().and_then(|v|v.as_i64().ok()).unwrap_or(0);
        let space=stream.dict.get(b"ColorSpace").ok().and_then(as_name);
        if depth!=8 || !matches!(space,Some(b"DeviceRGB")|Some(b"DeviceGray")) {
            skipped+=1;continue;
        }
        let pixels=if stream.dict.get(b"Filter").is_ok() {
            match stream.decompressed_content(){Ok(p)=>p,Err(_)=>{skipped+=1;continue}}
        } else {stream.content.clone()};
        let mut buffer=Vec::<u8>::new();
        let expected=(width as usize).saturating_mul(height as usize)
            .saturating_mul(if space==Some(b"DeviceRGB"){3}else{1});
        if pixels.len()!=expected {skipped+=1;continue;}
        let mut writer=std::io::Cursor::new(&mut buffer);
        let color=if space==Some(b"DeviceRGB"){
            image::ExtendedColorType::Rgb8
        }else{image::ExtendedColorType::L8};
        use image::ImageEncoder;
        if image::codecs::png::PngEncoder::new(&mut writer).write_image(
            &pixels,width as u32,height as u32,color
        ).is_err(){skipped+=1;continue;}
        selected.push(("png".into(),buffer));
    }
    if selected.is_empty(){
        return Err(if skipped>0 {
            "No supported embedded images found. This PDF uses image color spaces or codecs that require a different extractor."
        }else{"No embedded raster images were found in this PDF."}.into());
    }
    let folder=output_dir(input,destination)?;
    let name=format_name(input)?;
    let stage=tempfile::Builder::new().prefix(".reformany-pdf-images-")
        .tempdir_in(&folder).map_err(|e|e.to_string())?;
    let mut ready=Vec::<(PathBuf,String)>::new();
    for(i,(format,bytes)) in selected.into_iter().enumerate(){
        let path=stage.path().join(format!("image-{:03}.{format}",i+1));
        fs::write(&path,bytes).map_err(|e|e.to_string())?;
        ready.push((path,format));
    }
    let mut saved=Vec::<PathBuf>::new();
    for (i,(source,format)) in ready.iter().enumerate(){
        let stem=format!("{name}_embedded_{:03}",i+1);
        match publish(source,&folder,&stem,format){
            Ok(path)=>saved.push(path),
            Err(e)=>{
                for p in &saved{let _=fs::remove_file(p);}
                return Err(e);
            }
        }
    }
    Ok(ExtractedPdfImages{
        output_paths:saved.into_iter().map(|p|p.to_string_lossy().into_owned()).collect(),
        skipped_unsupported:skipped,
    })
}
#[tauri::command]
pub async fn pdf_extract_images(path:String,destination:Option<String>)
    -> Result<ExtractedPdfImages,String>
{
    tauri::async_runtime::spawn_blocking(move||extract(&path,destination.as_deref()))
        .await.map_err(|_|"PDF image extraction worker stopped unexpectedly".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary,Stream};
    use image::ImageEncoder;
    #[test]
    fn extracts_real_embedded_jpeg_without_changing_pdf() {
        let tmp=tempfile::tempdir().unwrap();
        let path=tmp.path().join("picture.pdf");
        let mut jpeg=Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg,90)
            .write_image(&[255,0,0],1,1,image::ExtendedColorType::Rgb8).unwrap();
        let mut pdf=Document::with_version("1.5");
        let pages=pdf.new_object_id();
        let img=pdf.add_object(Stream::new(dictionary! {
            "Type"=>"XObject","Subtype"=>"Image","Width"=>1,"Height"=>1,
            "BitsPerComponent"=>8,"ColorSpace"=>"DeviceRGB","Filter"=>"DCTDecode"
        },jpeg));
        let contents=pdf.add_object(Stream::new(dictionary! {},Vec::new()));
        let page=pdf.add_object(dictionary! {
            "Type"=>"Page","Parent"=>pages,
            "MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()],
            "Resources"=>dictionary! {"XObject"=>dictionary!{"Example"=>img}},
            "Contents"=>contents
        });
        pdf.objects.insert(pages,Object::Dictionary(dictionary! {
            "Type"=>"Pages","Kids"=>vec![page],"Count"=>1
        }));
        let cat=pdf.add_object(dictionary!{"Type"=>"Catalog","Pages"=>pages});
        pdf.trailer.set("Root",cat);
        pdf.save(&path).unwrap();
        let result=extract(path.to_str().unwrap(),None).unwrap();
        assert_eq!(result.output_paths.len(),1);
        assert_eq!(result.skipped_unsupported,0);
        assert_eq!(image::open(&result.output_paths[0]).unwrap().width(),1);
        assert_eq!(Document::load(&path).unwrap().get_pages().len(),1);
    }
}
