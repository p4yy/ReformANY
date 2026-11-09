//! Apply a UI-arranged page sequence to an actual PDF page tree.
//! No source file is modified. Files with protected/encrypted page trees
//! fail clearly; unsupported external insertions are not falsely advertised.
use crate::pdf_ops::{open_pdf,stage_pdf};
use lopdf::{Document,Object,ObjectId};
use serde::Deserialize;
use std::{collections::HashSet,path::Path};

#[derive(Debug,Clone,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PageEdit{source_page:u32,rotation:i32}

fn inherited_attribute(pdf:&Document,page:ObjectId,key:&[u8])->Option<Object>{
    let mut id=page;
    let mut seen=HashSet::new();
    for _ in 0..32 {
        if !seen.insert(id){return None;}
        let dict=pdf.get_dictionary(id).ok()?;
        if let Ok(value)=dict.get(key){return Some(value.clone());}
        id=match dict.get(b"Parent").and_then(Object::as_reference){
            Ok(parent)=>parent,Err(_)=>return None
        };
    }
    None
}
fn rotate_on_page(pdf:&Document,page:ObjectId)->i64{
    match inherited_attribute(pdf,page,b"Rotate"){
        Some(Object::Integer(n))=>n,
        Some(Object::Real(n))=>n as i64,
        _=>0
    }
}
fn apply(path:&str,items:Vec<PageEdit>,destination:Option<&str>)->Result<String,String>{
    let source=Path::new(path);
    let mut pdf=open_pdf(source)?;
    let original=pdf.get_pages();
    if items.is_empty()||items.len()>original.len(){
        return Err("Keep at least one page and no more than the source page count".into());
    }
    let mut unique=HashSet::new();
    let mut selected=Vec::<ObjectId>::new();
    for item in &items{
        if !unique.insert(item.source_page){
            return Err(format!("Page {} appears more than once",item.source_page));
        }
        if !matches!(item.rotation,0|90|180|270|-90|-180|-270){
            return Err("Page rotation must be a 90-degree increment".into());
        }
        selected.push(*original.get(&item.source_page)
            .ok_or_else(||format!("Page {} is outside the document",item.source_page))?);
    }
    let catalog=pdf.trailer.get(b"Root").map_err(|e|e.to_string())?
        .as_reference().map_err(|e|e.to_string())?;
    let pages_id=pdf.get_dictionary(catalog).map_err(|e|e.to_string())?
        .get(b"Pages").map_err(|e|e.to_string())?
        .as_reference().map_err(|e|e.to_string())?;
    // Materialize inherited page attributes BEFORE redirecting Parent links
    // to a flattened page tree. Otherwise some PDFs lose fonts, crop box
    // or page rotation when imported from nested trees.
    for (page,item) in selected.iter().copied().zip(items.iter()){
        let attrs=["Resources","MediaBox","CropBox","Rotate","UserUnit","BleedBox","TrimBox","ArtBox"];
        let mut inherited=Vec::new();
        for key in attrs {
            let name=key.as_bytes();
            if let Some(value)=inherited_attribute(&pdf,page,name){
                inherited.push((key,value));
            }
        }
        let absolute=(rotate_on_page(&pdf,page)+i64::from(item.rotation)).rem_euclid(360);
        let dict=pdf.get_object_mut(page).map_err(|e|e.to_string())?
            .as_dict_mut().map_err(|e|e.to_string())?;
        for (key,value) in inherited{
            if !dict.has(key.as_bytes()){dict.set(key,value);}
        }
        dict.set("Parent",Object::Reference(pages_id));
        dict.set("Rotate",absolute);
    }
    let root=pdf.get_object_mut(pages_id).map_err(|e|e.to_string())?
        .as_dict_mut().map_err(|e|e.to_string())?;
    root.set("Kids",Object::Array(selected.iter().copied().map(Object::Reference).collect()));
    root.set("Count",selected.len() as i64);
    // Inherited resources/media boxes must belong to individual leaf pages
    // when flattening the tree, never to the root for all pages.
    for key in [b"Resources".as_slice(),b"MediaBox",b"CropBox",b"Rotate",b"UserUnit"]{
        root.remove(key);
    }
    pdf.prune_objects();
    let output=stage_pdf(source,destination,"arranged",&mut pdf)?;
    let verified=Document::load(&output).map_err(|e|e.to_string())?;
    if verified.get_pages().len()!=selected.len(){
        return Err("Arranged document did not save the selected page count".into());
    }
    Ok(output)
}
#[tauri::command]
pub async fn pdf_arrange_pages(path:String,items:Vec<PageEdit>,destination:Option<String>)
    ->Result<String,String>
{
    tauri::async_runtime::spawn_blocking(move||apply(&path,items,destination.as_deref()))
        .await.map_err(|_|"PDF arrangement worker interrupted".to_owned())?
}
#[cfg(test)]
mod tests{
    use super::*;
    use lopdf::{dictionary,Stream};
    #[test]
    fn truly_reorders_and_rotates_fourteen_real_pages(){
        let dir=tempfile::tempdir().unwrap();
        let input=dir.path().join("Fourteen.pdf");
        let mut pdf=Document::with_version("1.5");
        let root=pdf.new_object_id();
        let mut pages=Vec::new();
        for n in 1..=14 {
            let content=pdf.add_object(Stream::new(dictionary! {},Vec::new()));
            let page=pdf.add_object(dictionary! {
                "Type"=>"Page","Parent"=>root,
                "MediaBox"=>vec![0.into(),0.into(),(500+n).into(),720.into()],
                "Contents"=>content
            });
            pages.push(Object::Reference(page));
        }
        pdf.objects.insert(root,Object::Dictionary(dictionary! {
            "Type"=>"Pages","Kids"=>pages,"Count"=>14
        }));
        let catalog=pdf.add_object(dictionary! {"Type"=>"Catalog","Pages"=>root});
        pdf.trailer.set("Root",catalog);
        pdf.save(&input).unwrap();
        let edits=vec![
            PageEdit{source_page:14,rotation:90},
            PageEdit{source_page:1,rotation:0},
            PageEdit{source_page:3,rotation:-90},
        ];
        let output=apply(input.to_str().unwrap(),edits,None).unwrap();
        let result=Document::load(output).unwrap();
        let ids=result.get_pages();
        assert_eq!(ids.len(),3);
        let first=result.get_dictionary(*ids.get(&1).unwrap()).unwrap();
        assert_eq!(first.get(b"Rotate").unwrap().as_i64().unwrap(),90);
        assert_eq!(first.get(b"MediaBox").unwrap().as_array().unwrap()[2].as_i64().unwrap(),514);
        assert_eq!(Document::load(input).unwrap().get_pages().len(),14);
        assert!(apply(input.to_str().unwrap(),
            vec![PageEdit{source_page:2,rotation:0},PageEdit{source_page:2,rotation:0}],None).is_err());
    }
}
