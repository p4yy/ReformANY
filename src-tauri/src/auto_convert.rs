//! Native OS-backed folder watches. Only selected image types are converted,
//! and outputs use a different extension to prevent self-triggered loops.
use notify::{EventKind,RecommendedWatcher,RecursiveMode,Watcher};
use serde::{Deserialize,Serialize};
use std::{collections::{HashMap,HashSet},fs,path::{Path,PathBuf},
    sync::{Arc,Mutex,atomic::{AtomicBool,Ordering},mpsc},thread,
    time::{Duration,Instant,SystemTime}};
use tauri::{AppHandle,Emitter,Manager,State};
use uuid::Uuid;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct WatchRule {
    id:String,folder:String,input_ext:String,target:String,destination:Option<String>,
}
#[derive(Default)]
pub struct WatchRegistry{running:Mutex<HashMap<String,Arc<AtomicBool>>>}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
struct WatchEvent{id:String,path:String,status:&'static str,
    output_path:Option<String>,error:Option<String>}
fn rules_file()->PathBuf{crate::job_settings::directory().join("auto-convert.json")}
fn load()->Result<Vec<WatchRule>,String>{
    match fs::read(rules_file()){
        Ok(data)=>serde_json::from_slice::<Vec<WatchRule>>(&data)
            .map_err(|e|format!("Cannot load saved Auto Convert rules: {e}")),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(Vec::new()),
        Err(e)=>Err(format!("Cannot read Auto Convert configuration: {e}")),
    }
}
fn save(rules:&[WatchRule])->Result<(),String>{
    let file=rules_file();
    let dir=file.parent().ok_or("Invalid configuration folder")?;
    fs::create_dir_all(dir).map_err(|e|e.to_string())?;
    let temp=tempfile::Builder::new().prefix(".auto-convert-")
        .tempfile_in(dir).map_err(|e|e.to_string())?;
    serde_json::to_writer_pretty(temp.as_file(),rules)
        .map_err(|e|e.to_string())?;
    temp.persist(file).map_err(|e|format!("Cannot save watched folder rule: {}",e.error))?;
    Ok(())
}
fn check(rule:&WatchRule)->Result<PathBuf,String>{
    if !matches!(rule.input_ext.as_str(),"png"|"jpg"|"jpeg"|"webp"|"bmp"|"tiff"){
        return Err("Choose PNG, JPG, WEBP, BMP or TIFF as the watched input".into());
    }
    if !matches!(rule.target.as_str(),"pdf"|"png"|"jpeg"|"webp"|"bmp"|"tiff"){
        return Err("Choose a real PDF or image output format".into());
    }
    let same_input=if rule.input_ext=="jpg" {"jpeg"} else {rule.input_ext.as_str()};
    let same_target=if rule.target=="jpg" {"jpeg"} else {rule.target.as_str()};
    if same_input==same_target{
        return Err("Input and output format must differ to prevent a conversion loop".into());
    }
    let folder=PathBuf::from(&rule.folder);
    let meta=fs::symlink_metadata(&folder).map_err(|e|format!("Cannot watch this folder: {e}"))?;
    if !meta.is_dir()||meta.file_type().is_symlink(){
        return Err("Choose an existing regular folder, not a symbolic link".into());
    }
    #[cfg(windows)]
    { use std::os::windows::fs::MetadataExt;
      if meta.file_attributes() & 0x400!=0 {
        return Err("Watched folders cannot be Windows reparse points".into());
      }
    }
    if let Some(dest)=&rule.destination{
        if !Path::new(dest).is_dir(){return Err("The chosen output folder is not accessible".into());}
    }
    folder.canonicalize().map_err(|e|e.to_string())
}
fn emit(app:&AppHandle,rule:&WatchRule,path:&Path,status:&'static str,
    output:Option<String>,error:Option<String>)
{
    let _=app.emit("reformany:watch-job",WatchEvent{
        id:rule.id.clone(),path:path.to_string_lossy().into_owned(),
        status,output_path:output,error
    });
}
fn process(rule:&WatchRule,path:&Path)->Result<String,String>{
    let output=rule.destination.as_deref();
    if rule.target=="pdf" {
        crate::documents::watched_image_to_pdf(path,output)
    } else {
        crate::conversion::convert_watched_image(path,&rule.target,output)
            .map(|result|result.to_string_lossy().into_owned())
    }
}
fn suitable(rule:&WatchRule,file:&Path,folder:&Path)->bool{
    if file.parent()!=Some(folder){return false;}
    file.extension().and_then(|x|x.to_str())
      .is_some_and(|ext|ext.eq_ignore_ascii_case(&rule.input_ext))
}
struct Pending{len:u64,modified:Option<SystemTime>,last_change:Instant}
fn pending_metadata(path:&Path)->Option<(u64,Option<SystemTime>)>{
    let meta=fs::symlink_metadata(path).ok()?;
    if !meta.is_file()||meta.file_type().is_symlink(){return None;}
    Some((meta.len(),meta.modified().ok()))
}
fn start(app:AppHandle,rule:WatchRule)->Result<Arc<AtomicBool>,String>{
    let folder=check(&rule)?;
    let (tx,rx)=mpsc::channel();
    let mut watcher:RecommendedWatcher=notify::recommended_watcher(move|event|{
        let _=tx.send(event);
    }).map_err(|e|format!("Cannot initialize Windows folder notifications: {e}"))?;
    watcher.watch(&folder,RecursiveMode::NonRecursive)
        .map_err(|e|format!("Cannot watch {}: {e}",folder.display()))?;
    let stop=Arc::new(AtomicBool::new(false));
    let flag=stop.clone();
    thread::Builder::new().name("ReformANY Auto Convert".into()).spawn(move||{
        let _watcher=watcher;
        let mut pending=HashMap::<PathBuf,Pending>::new();
        let mut processed=HashSet::<(PathBuf,u64,Option<SystemTime>)>::new();
        while !flag.load(Ordering::Relaxed){
            match rx.recv_timeout(Duration::from_millis(450)){
                Ok(Ok(event)) if matches!(event.kind,EventKind::Create(_)|EventKind::Modify(_))=>{
                    for source in event.paths{
                        if !suitable(&rule,&source,&folder){continue;}
                        if let Some((len,modified))=pending_metadata(&source){
                            pending.insert(source,Pending{len,modified,last_change:Instant::now()});
                        }
                    }
                }
                Ok(Err(e))=>emit(&app,&rule,&folder,"failed",None,
                    Some(format!("Native file watcher error: {e}"))),
                _=>{}
            }
            let due=pending.iter().filter(|(_,state)|state.last_change.elapsed()>=Duration::from_secs(2))
                .map(|(path,_)|path.clone()).collect::<Vec<_>>();
            for source in due{
                let Some(mut state)=pending.remove(&source) else {continue};
                let Some((len,modified))=pending_metadata(&source) else {continue};
                if len!=state.len||modified!=state.modified{
                    state.len=len;state.modified=modified;state.last_change=Instant::now();
                    pending.insert(source,state);continue;
                }
                if !processed.insert((source.clone(),len,modified)){continue;}
                emit(&app,&rule,&source,"processing",None,None);
                match process(&rule,&source){
                    Ok(output)=>emit(&app,&rule,&source,"completed",Some(output),None),
                    Err(error)=>emit(&app,&rule,&source,"failed",None,Some(error)),
                }
                if processed.len()>1000{processed.clear();}
            }
        }
    }).map_err(|e|format!("Cannot start Auto Convert thread: {e}"))?;
    Ok(stop)
}
pub(crate) fn restore(app:&AppHandle){
    match load(){
        Ok(rules)=>{
            let registry=app.state::<WatchRegistry>();
            for rule in rules{
                if let Ok(stop)=start(app.clone(),rule.clone()){
                    if let Ok(mut running)=registry.running.lock(){
                        running.insert(rule.id,stop);
                    }
                }else{
                    emit(app,&rule,Path::new(&rule.folder),"failed",None,
                        Some("Could not restore watched folder; verify its location".into()));
                }
            }
        }
        Err(error)=>{
            let _=app.emit("reformany:watch-configuration-error",error);
        }
    }
}
#[tauri::command]
pub fn get_watch_rules()->Result<Vec<WatchRule>,String>{load()}
#[tauri::command]
pub fn add_watch_rule(app:AppHandle,state:State<'_,WatchRegistry>,folder:String,
    input_ext:String,target:String,destination:Option<String>)->Result<Vec<WatchRule>,String>
{
    let mut rules=load()?;
    if rules.len()>=10{return Err("Auto Convert supports up to ten watched folders".into());}
    let rule=WatchRule{id:Uuid::new_v4().to_string(),folder,input_ext,target,destination};
    let canonical=check(&rule)?;
    if rules.iter().any(|r|Path::new(&r.folder).canonicalize().ok()==Some(canonical.clone())
        &&r.input_ext==rule.input_ext){
        return Err("A rule already watches that input format in this folder".into());
    }
    let stop=start(app,rule.clone())?;
    rules.push(rule.clone());
    if let Err(e)=save(&rules){stop.store(true,Ordering::Relaxed);return Err(e);}
    state.running.lock().map_err(|_|"Watcher registry is busy")?.insert(rule.id,stop);
    Ok(rules)
}
#[tauri::command]
pub fn remove_watch_rule(state:State<'_,WatchRegistry>,id:String)->Result<Vec<WatchRule>,String>{
    let mut rules=load()?;
    if !rules.iter().any(|r|r.id==id){return Err("Watched folder rule does not exist".into());}
    rules.retain(|r|r.id!=id);
    save(&rules)?;
    if let Some(flag)=state.running.lock().map_err(|_|"Watcher registry is busy")?.remove(&id){
        flag.store(true,Ordering::Relaxed);
    }
    Ok(rules)
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn requires_real_input_filter_and_nonloop_output(){
        let dir=tempfile::tempdir().unwrap();
        let mut rule=WatchRule{
            id:"test".into(),folder:dir.path().to_string_lossy().into_owned(),
            input_ext:"png".into(),target:"jpeg".into(),destination:None
        };
        assert!(check(&rule).is_ok());
        rule.target="png".into();assert!(check(&rule).is_err());
        rule.target="pdf".into();assert!(check(&rule).is_ok());
        rule.input_ext="exe".into();assert!(check(&rule).is_err());
    }
}
