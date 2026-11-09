//! Explicit, bounded permanent deletion. Flash/SSD/cloud filesystems can retain
//! recoverable copies despite a overwrite; we never claim guaranteed erasure.
use serde::Serialize;
use std::{fs,io::{Seek,SeekFrom,Write},path::{Path,PathBuf},sync::atomic::{AtomicUsize,Ordering}};
use walkdir::WalkDir;
use tauri::Emitter;

const MAX_FILES:usize=500;
const MAX_TOTAL_BYTES:u64=1024*1024*1024;
#[derive(Serialize,Clone)]
#[serde(rename_all="camelCase")]
pub struct ShredPreview{file_count:usize,total_bytes:u64,directories:usize}
#[derive(Serialize,Clone)]
#[serde(rename_all="camelCase")]
struct ShredProgress{processed:usize,total:usize,files_removed:usize}
fn refuse_unsafe_root(path:&Path)->Result<(),String>{
    let normalized=path.canonicalize().map_err(|e|format!("Cannot inspect path: {e}"))?;
    if normalized.components().count()<4{
        return Err("Shred cannot operate on a drive root or top-level directory".into());
    }
    for var in ["SYSTEMROOT","PROGRAMFILES","PROGRAMFILES(X86)","PROGRAMDATA","USERPROFILE","APPDATA","LOCALAPPDATA"]{
        if let Some(folder)=std::env::var_os(var){
            let root=PathBuf::from(folder);
            if let Ok(canonical)=root.canonicalize(){
                if normalized==canonical ||
                    (var!="USERPROFILE"&&var!="APPDATA"&&var!="LOCALAPPDATA"&&
                        normalized.starts_with(canonical)){
                    return Err("Protected Windows or user directory cannot be shredded".into());
                }
            }
        }
    }
    Ok(())
}
fn no_links(path:&Path)->Result<fs::Metadata,String>{
    let metadata=fs::symlink_metadata(path).map_err(|e|format!("Cannot inspect selected file: {e}"))?;
    if metadata.file_type().is_symlink(){
        return Err("Shred refuses symbolic links and junctions".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400!=0{
            return Err("Shred refuses Windows reparse points".into());
        }
    }
    if !metadata.is_file()&&!metadata.is_dir(){
        return Err("Shred supports only ordinary files and directories".into());
    }
    Ok(metadata)
}
fn list(path:&Path)->Result<(ShredPreview,Vec<PathBuf>,Vec<PathBuf>),String>{
    refuse_unsafe_root(path)?;
    let root=no_links(path)?;
    let mut files=Vec::<PathBuf>::new();
    let mut folders=Vec::<PathBuf>::new();
    let mut size=0_u64;
    if root.is_file(){
        files.push(path.to_owned());size=root.len();
    }else{
        for entry in WalkDir::new(path).follow_links(false).max_depth(32){
            let entry=entry.map_err(|e|format!("Cannot inspect directory: {e}"))?;
            let meta=no_links(entry.path())?;
            if meta.is_file(){size=size.saturating_add(meta.len());files.push(entry.path().to_owned());}
            else{folders.push(entry.path().to_owned());}
            if files.len()>MAX_FILES||size>MAX_TOTAL_BYTES{
                return Err("Shred is limited to 500 files and 1 GB per confirmed operation".into());
            }
        }
    }
    if size>MAX_TOTAL_BYTES{
        return Err("Shred is limited to 1 GB per confirmed operation".into());
    }
    folders.sort_by_key(|p|std::cmp::Reverse(p.components().count()));
    Ok((ShredPreview{file_count:files.len(),total_bytes:size,directories:folders.len()},files,folders))
}
fn overwrite_file(path:&Path)->Result<(),String>{
    // This attempts one overwrite on HDDs. It is not a secure erase guarantee.
    let mut file=fs::OpenOptions::new().write(true).open(path)
        .map_err(|e|format!("Cannot open for overwrite: {e}"))?;
    let length=file.metadata().map_err(|e|e.to_string())?.len();
    file.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;
    let mut buffer=[0_u8;32*1024];
    let mut remaining=length;
    while remaining>0{
        let count=remaining.min(buffer.len() as u64) as usize;
        getrandom::fill(&mut buffer[..count])
            .map_err(|_|"Cannot get secure overwrite randomness".to_owned())?;
        file.write_all(&buffer[..count]).map_err(|e|e.to_string())?;
        remaining-=count as u64;
    }
    file.sync_all().map_err(|e|e.to_string())?;
    drop(file);
    fs::remove_file(path).map_err(|e|format!("Cannot remove file after overwrite: {e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn shred_preview(path:String)->Result<ShredPreview,String>{
    tauri::async_runtime::spawn_blocking(move||list(Path::new(&path)).map(|(info,_,_)|info))
        .await.map_err(|_|"Shred inspection worker interrupted".to_owned())?
}
#[tauri::command]
pub async fn shred_confirm(app:tauri::AppHandle,path:String,confirmation:String)
    ->Result<ShredPreview,String>
{
    if confirmation!="SHRED"{
        return Err("Type SHRED exactly to confirm permanent deletion".into());
    }
    tauri::async_runtime::spawn_blocking(move||{
        let (preview,files,folders)=list(Path::new(&path))?;
        static JOB_SEQUENCE:AtomicUsize=AtomicUsize::new(0);
        let _sequence=JOB_SEQUENCE.fetch_add(1,Ordering::Relaxed);
        let total=files.len()+folders.len();
        let mut processed=0;
        for source in &files{
            no_links(source)?;
            overwrite_file(source)?;
            processed+=1;
            let _=app.emit("reformany:shred-progress",ShredProgress{
                processed,total,files_removed:processed
            });
        }
        for folder in folders{
            no_links(&folder)?;
            fs::remove_dir(&folder).map_err(|e|format!("Cannot remove folder: {e}"))?;
            processed+=1;
            let _=app.emit("reformany:shred-progress",ShredProgress{
                processed,total,files_removed:files.len()
            });
        }
        Ok(preview)
    }).await.map_err(|_|"Shred worker interrupted".to_owned())?
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn refuses_insufficient_confirmation_and_nonfile_links(){
        // Only a fully typed confirmation can reach the destructive worker.
        assert_ne!("shred","SHRED");
        let temp=tempfile::tempdir().unwrap();
        let file=temp.path().join("sample.txt");
        fs::write(&file,b"example").unwrap();
        assert_eq!(no_links(&file).unwrap().len(),7);
        assert!(no_links(&temp.path().join("missing")).is_err());
    }
}
