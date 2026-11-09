//! Non-destructive PDF text overlay operations. Visual signatures are NOT digital
//! signatures; no cryptographic verification or certificate is represented.
use crate::pdf_ops::{open_pdf, stage_pdf, parse_pages};
use lopdf::{dictionary, Document, Object, ObjectId, content::{Content,Operation}};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PdfMark {
    text: String,
    color: String,
    size: f32,
    opacity: f32,
    rotation: f32,
    x: f32,
    y: f32,
    pages: Option<String>,
}
fn number(value:&Object)->Option<f32>{
    match value { Object::Integer(v)=>Some(*v as f32), Object::Real(v)=>Some(*v), _=>None }
}
fn page_box(pdf:&Document,id:ObjectId)->Result<(f32,f32,f32,f32),String>{
    let mut current=id;
    for _ in 0..32 {
        let dict=pdf.get_dictionary(current).map_err(|e|e.to_string())?;
        if let Ok(Object::Array(rect))=dict.get(b"MediaBox"){
            if rect.len()==4 {
                let coords=rect.iter().map(number).collect::<Option<Vec<_>>>();
                if let Some(v)=coords {
                    if v[2]>v[0] && v[3]>v[1] {
                        return Ok((v[0],v[1],v[2]-v[0],v[3]-v[1]));
                    }
                }
            }
        }
        match dict.get(b"Parent").and_then(Object::as_reference){
            Ok(parent)=>current=parent,
            Err(_)=>break
        }
    }
    Err("This PDF page has no valid media box".into())
}
fn color_rgb(text:&str)->Result<(f32,f32,f32),String>{
    if text.len()!=7||!text.starts_with('#')||!text[1..].bytes().all(|b|b.is_ascii_hexdigit()){
        return Err("Choose an RGB hex color such as #C8D4A2".into());
    }
    let n=u32::from_str_radix(&text[1..],16).map_err(|e|e.to_string())?;
    Ok((((n>>16)&255)as f32/255.0,((n>>8)&255)as f32/255.0,(n&255)as f32/255.0))
}
fn check(mark:&PdfMark)->Result<(),String>{
    if mark.text.trim().is_empty()||mark.text.len()>96||
        !mark.text.bytes().all(|b| (32..=126).contains(&b)) {
        return Err("Text must be 1–96 printable ASCII characters for the built-in PDF font".into());
    }
    if !mark.size.is_finite()||!(8.0..=108.0).contains(&mark.size) {
        return Err("Text size must be between 8 and 108 pt".into());
    }
    if !mark.opacity.is_finite()||!(0.05..=1.0).contains(&mark.opacity){
        return Err("Opacity must be between 5% and 100%".into());
    }
    if !mark.x.is_finite()||!mark.y.is_finite()||
        !(0.10..=0.90).contains(&mark.x)||!(0.10..=0.90).contains(&mark.y){
        return Err("Place the text inside the page, between 10% and 90%".into());
    }
    if !mark.rotation.is_finite()||mark.rotation.abs()>180.0 {
        return Err("Rotation must be between -180 and 180 degrees".into());
    }
    color_rgb(&mark.color)?;
    Ok(())
}
fn register_font(pdf:&mut Document,page_id:ObjectId,font_id:ObjectId)->Result<(),String>{
    let existing=pdf.get_or_create_resources(page_id)
        .map_err(|e|e.to_string())?.clone();
    let mut resources=match existing {
        Object::Dictionary(dict)=>dict,
        Object::Reference(id)=>pdf.get_object(id).map_err(|e|e.to_string())?
            .as_dict().map_err(|e|e.to_string())?.clone(),
        _=>return Err("Unsupported PDF resource dictionary".into())
    };
    let mut fonts=match resources.get(b"Font"){
        Ok(Object::Dictionary(dict))=>dict.clone(),
        Ok(Object::Reference(id))=>pdf.get_object(*id).map_err(|e|e.to_string())?
            .as_dict().map_err(|e|e.to_string())?.clone(),
        Ok(_)=>return Err("Unsupported PDF fonts dictionary".into()),
        Err(_)=>lopdf::Dictionary::new(),
    };
    fonts.set("RAVisualMark",Object::Reference(font_id));
    resources.set("Font",Object::Dictionary(fonts));
    pdf.get_object_mut(page_id).map_err(|e|e.to_string())?
        .as_dict_mut().map_err(|e|e.to_string())?
        .set("Resources",Object::Dictionary(resources));
    Ok(())
}
fn apply(path:&str,mark:PdfMark,visual_signature:bool,destination:Option<&str>)
    ->Result<String,String>{
    check(&mark)?;
    let source=Path::new(path);
    let mut pdf=open_pdf(source)?;
    let count=pdf.get_pages().len();
    let selection=match mark.pages.as_deref().filter(|s|!s.trim().is_empty()){
        Some(expr)=>parse_pages(expr,count)?,
        None if visual_signature=>vec![1],
        None=>(1..=count as u32).collect(),
    };
    let (r,g,b)=color_rgb(&mark.color)?;
    let font_id=pdf.add_object(dictionary!{
        "Type"=>"Font","Subtype"=>"Type1",
        "BaseFont"=>if visual_signature {"Helvetica-Oblique"} else {"Helvetica"}
    });
    let state_id=pdf.add_object(dictionary! {
        "Type"=>"ExtGState",
        "ca"=>mark.opacity, "CA"=>mark.opacity
    });
    let pages=pdf.get_pages();
    for number in selection {
        let page=*pages.get(&number).ok_or("Invalid selected page")?;
        let (left,bottom,width,height)=page_box(&pdf,page)?;
        register_font(&mut pdf,page,font_id)?;
        pdf.add_graphics_state(page,b"RAVisualAlpha",state_id)
            .map_err(|e|format!("Cannot add transparency: {e}"))?;
        let theta=mark.rotation.to_radians();
        let (cos,sin)=(theta.cos(),theta.sin());
        let x=left+width*mark.x;
        let y=bottom+height*mark.y;
        let text_width=mark.text.len() as f32*mark.size*0.45;
        let dx=-text_width/2.0;
        let operations=vec![
            Operation::new("q",vec![]),
            Operation::new("gs",vec![Object::Name(b"RAVisualAlpha".to_vec())]),
            Operation::new("rg",vec![r.into(),g.into(),b.into()]),
            Operation::new("BT",vec![]),
            Operation::new("Tf",vec![Object::Name(b"RAVisualMark".to_vec()),mark.size.into()]),
            Operation::new("Tm",vec![cos.into(),sin.into(),(-sin).into(),cos.into(),
                (x+dx*cos).into(),(y+dx*sin).into()]),
            Operation::new("Tj",vec![Object::string_literal(mark.text.as_str())]),
            Operation::new("ET",vec![]),
            Operation::new("Q",vec![]),
        ];
        pdf.add_to_page_content(page,Content{operations})
            .map_err(|e|format!("Cannot overlay selected PDF page: {e}"))?;
    }
    let suffix=if visual_signature {"visual_signature"}else{"watermarked"};
    let output=stage_pdf(source,destination,suffix,&mut pdf)?;
    let verified=open_pdf(Path::new(&output))?;
    if verified.get_pages().len()!=count{
        return Err("PDF output failed page-count verification".into());
    }
    Ok(output)
}
#[tauri::command]
pub async fn pdf_add_mark(path:String,mark:PdfMark,visual_signature:bool,
    destination:Option<String>)->Result<String,String>{
    tauri::async_runtime::spawn_blocking(move||apply(&path,mark,visual_signature,destination.as_deref()))
        .await.map_err(|_|"PDF annotation worker stopped unexpectedly".to_owned())?
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn watermark_and_visible_signature_create_real_pdf_page_content(){
        let tmp=tempfile::tempdir().unwrap();
        let path=tmp.path().join("original.pdf");
        let mut pdf=Document::with_version("1.4");
        let root=pdf.new_object_id();
        let mut kids=Vec::<Object>::new();
        for _ in 0..2{
            let content=pdf.add_object(lopdf::Stream::new(dictionary!{},Vec::new()));
            let id=pdf.add_object(dictionary!{
                "Type"=>"Page","Parent"=>root,
                "MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()],
                "Contents"=>content
            });
            kids.push(Object::Reference(id));
        }
        pdf.objects.insert(root,Object::Dictionary(dictionary!{
            "Type"=>"Pages","Kids"=>kids,"Count"=>2
        }));
        let catalog=pdf.add_object(dictionary!{"Type"=>"Catalog","Pages"=>root});
        pdf.trailer.set("Root",catalog);
        pdf.save(&path).unwrap();
        let mark=PdfMark{
            text:"CONFIDENTIAL".into(),color:"#C8D4A2".into(),size:42.0,
            opacity:.22,rotation:-45.0,x:.5,y:.5,pages:None
        };
        let watermark=apply(path.to_str().unwrap(),mark,false,None).unwrap();
        let reread=Document::load(&watermark).unwrap();
        assert_eq!(reread.get_pages().len(),2);
        for page in reread.get_pages().values(){
            let bytes=reread.get_page_content(*page).unwrap();
            let content=lopdf::content::Content::decode(&bytes).unwrap();
            assert!(content.operations.iter().any(|op|op.operator=="Tj"&&
                op.operands.iter().any(|x|matches!(x,Object::String(bytes,_) if bytes.as_slice()==b"CONFIDENTIAL"))));
        }
        let signature=apply(path.to_str().unwrap(),PdfMark{
            text:"APPROVED".into(),color:"#273B2E".into(),size:20.0,
            opacity:1.0,rotation:0.0,x:.5,y:.2,pages:Some("2".into())
        },true,None).unwrap();
        let signed=Document::load(signature).unwrap();
        assert_eq!(signed.get_pages().len(),2);
        let page2=*signed.get_pages().get(&2).unwrap();
        let signed_content=lopdf::content::Content::decode(&signed.get_page_content(page2).unwrap()).unwrap();
        assert!(signed_content.operations.iter().any(|op|op.operator=="Tj"));
        let original=Document::load(path).unwrap();
        assert_eq!(original.get_pages().len(),2);
        for page in original.get_pages().values(){
            assert!(original.get_page_content(*page).unwrap().is_empty());
        }
    }
    #[test]
    fn rejects_unsafe_marks_and_invalid_colors(){
        let mut m=PdfMark{
            text:"DRAFT".into(),color:"#C8D4A2".into(),size:32.0,opacity:0.25,
            rotation:-35.0,x:0.5,y:0.5,pages:None
        };
        assert!(check(&m).is_ok());
        m.text="Bad\ntext".into();assert!(check(&m).is_err());
        m.text="Signature".into();m.opacity=0.0;assert!(check(&m).is_err());
        m.opacity=1.0;m.color="navy".into();assert!(check(&m).is_err());
    }
}
