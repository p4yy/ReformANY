//! PDF 2.0 AES-256 encryption and authorized password removal.
//! Passwords are never included in process argv, telemetry or persistent settings.
use crate::external::{format_name,output_dir,publish,verify_input};
use lopdf::{Document,encryption::{EncryptionState,EncryptionVersion,Permissions,
    crypt_filters::{Aes256CryptFilter,CryptFilter}}};
use std::{collections::BTreeMap,path::Path,sync::Arc};

fn check_password(p:&str)->Result<(),String>{
    if p.len()<8||p.len()>127||p.chars().any(|c|c.is_control()){
        return Err("PDF password must contain 8–127 characters and no control characters".into());
    }
    Ok(())
}
fn encrypt(path:&str,password:&str,destination:Option<&str>)->Result<String,String>{
    check_password(password)?;
    let input=Path::new(path);
    let mut doc=crate::pdf_ops::open_pdf(input)?;
    if doc.is_encrypted(){
        return Err("This PDF is already encrypted; remove its password using the owner password first".into());
    }
    let mut key=[0_u8;32];
    getrandom::fill(&mut key).map_err(|_|"Cannot obtain secure encryption randomness".to_owned())?;
    let filter:Arc<dyn CryptFilter>=Arc::new(Aes256CryptFilter);
    let version=EncryptionVersion::V5{
        encrypt_metadata:true,
        crypt_filters:BTreeMap::from([(b"StdCF".to_vec(),filter)]),
        file_encryption_key:&key,
        stream_filter:b"StdCF".to_vec(),string_filter:b"StdCF".to_vec(),
        owner_password:password,user_password:password,permissions:Permissions::all()
    };
    let state=EncryptionState::try_from(version)
        .map_err(|e|format!("Cannot create PDF encryption: {e}"))?;
    doc.encrypt(&state).map_err(|e|format!("PDF encryption failed: {e}"))?;
    let folder=output_dir(input,destination)?;
    let stage=tempfile::Builder::new().prefix(".reformany-protect-")
        .tempdir_in(&folder).map_err(|e|e.to_string())?;
    let file=stage.path().join("protected.pdf");
    doc.save(&file).map_err(|e|e.to_string())?;
    let mut probe=Document::load(&file).map_err(|e|e.to_string())?;
    if !probe.is_encrypted(){
        return Err("Security verification failed: PDF can be opened without authentication".into());
    }
    let wrong=format!("{password}__not_the_correct_password");
    if probe.authenticate_password(&wrong).is_ok(){
        return Err("Security verification failed: incorrect password was accepted".into());
    }
    probe.decrypt(password).map_err(|e|format!("PDF cannot be opened with the chosen password: {e}"))?;
    if probe.get_pages().is_empty(){
        return Err(format!("Encrypted result has no readable pages after decryption: source_pages={}, encrypted_obj_count={}, is_encrypted_after={}, trailer={:?}",
            doc.get_pages().len(),probe.objects.len(),probe.is_encrypted(),probe.trailer));
    }
    let name=format!("{}_protected",format_name(input)?);
    let saved=publish(&file,&folder,&name,"pdf")?;
    Ok(saved.to_string_lossy().into_owned())
}
fn decrypt(path:&str,password:&str,destination:Option<&str>)->Result<String,String>{
    if password.is_empty(){return Err("Enter the current owner password".into());}
    let input=Path::new(path);
    verify_input(input,false)?;
    if !input.extension().and_then(|e|e.to_str())
        .is_some_and(|e|e.eq_ignore_ascii_case("pdf")){
        return Err("Select a PDF".into());
    }
    let mut doc=Document::load(input).map_err(|e|format!("Cannot load PDF: {e}"))?;
    if !doc.is_encrypted(){return Err("This PDF is not password protected".into());}
    doc.authenticate_owner_password(password)
        .map_err(|_|"This PDF requires its correct owner password to remove protection".to_owned())?;
    doc.decrypt(password).map_err(|_|"Incorrect PDF password".to_owned())?;
    if doc.is_encrypted(){
        return Err("PDF protection could not be removed".into());
    }
    crate::pdf_ops::stage_pdf(input,destination,"unlocked",&mut doc)
}
#[tauri::command]
pub async fn pdf_protect(path:String,password:String,destination:Option<String>)
    ->Result<String,String>
{
    tauri::async_runtime::spawn_blocking(move||encrypt(&path,&password,destination.as_deref()))
        .await.map_err(|_|"PDF encryption worker interrupted".to_owned())?
}
#[tauri::command]
pub async fn pdf_unlock(path:String,password:String,destination:Option<String>)
    ->Result<String,String>
{
    tauri::async_runtime::spawn_blocking(move||decrypt(&path,&password,destination.as_deref()))
        .await.map_err(|_|"PDF unlock worker interrupted".to_owned())?
}
#[cfg(test)]
mod tests{
    use super::*;
    use lopdf::{dictionary,Object,Stream};
    #[test]
    fn aes256_password_roundtrip_and_wrong_password_rejected(){
        let dir=tempfile::tempdir().unwrap();
        let input=dir.path().join("document.pdf");
        let mut pdf=Document::with_version("2.0");
        let pages=pdf.new_object_id();
        let stream=pdf.add_object(Stream::new(dictionary!{},Vec::new()));
        let page=pdf.add_object(dictionary!{
            "Type"=>"Page","Parent"=>pages,"Contents"=>stream,
            "MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()]
        });
        pdf.objects.insert(pages,Object::Dictionary(dictionary!{
            "Type"=>"Pages","Kids"=>vec![Object::Reference(page)],"Count"=>1
        }));
        let catalog=pdf.add_object(dictionary!{"Type"=>"Catalog","Pages"=>pages});
        pdf.trailer.set("Root",catalog);
        pdf.save(&input).unwrap();
        let protected=encrypt(input.to_str().unwrap(),"StrongTestPassword123",None).unwrap();
        let raw=Document::load(&protected).unwrap();
        assert!(raw.is_encrypted());
        assert!(raw.authenticate_password("wrong").is_err());
        assert!(raw.authenticate_password("StrongTestPassword123").is_ok());
        assert!(decrypt(&protected,"wrong",None).is_err());
        let plain=decrypt(&protected,"StrongTestPassword123",None).unwrap();
        let recovered=Document::load(plain).unwrap();
        assert!(!recovered.is_encrypted());
        assert_eq!(recovered.get_pages().len(),1);
        assert_eq!(Document::load(&input).unwrap().get_pages().len(),1);
    }
}
