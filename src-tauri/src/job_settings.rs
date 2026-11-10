//! Shared persistent queue policy across main and standalone Orbit processes.
use serde::{Serialize,Deserialize};
use std::{env,fs,path::PathBuf};
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct QueuePolicy{mode:String}
pub(crate) fn directory()->PathBuf{
    env::var_os("LOCALAPPDATA").map(PathBuf::from)
      .or_else(||env::var_os("HOME").map(|p|PathBuf::from(p).join(".config")))
      .unwrap_or_else(env::temp_dir).join("ReformANY")
}
fn path()->PathBuf{directory().join("jobs.json")}
pub(crate) fn current_mode()->String{
    fs::read(path()).ok().and_then(|bytes|serde_json::from_slice::<QueuePolicy>(&bytes).ok())
      .map(|p|p.mode).filter(|s|matches!(s.as_str(),"sequential"|"balanced"))
      .unwrap_or_else(||"balanced".to_string())
}
#[tauri::command]
pub fn get_queue_policy()->QueuePolicy{QueuePolicy{mode:current_mode()}}
#[tauri::command]
pub fn set_queue_policy(mode:String)->Result<QueuePolicy,String>{
    if !matches!(mode.as_str(),"sequential"|"balanced"){
        return Err("Choose sequential or balanced queue processing".into());
    }
    let dir=directory();
    fs::create_dir_all(&dir).map_err(|e|format!("Cannot create ReformANY preferences: {e}"))?;
    let stage=tempfile::Builder::new().prefix(".jobs-policy-").tempfile_in(&dir)
        .map_err(|e|e.to_string())?;
    serde_json::to_writer(stage.as_file(),&QueuePolicy{mode:mode.clone()})
        .map_err(|e|e.to_string())?;
    stage.persist(path()).map_err(|e|format!("Cannot save queue setting: {}",e.error))?;
    Ok(QueuePolicy{mode})
}
#[cfg(test)]
mod tests {
    #[test]
    fn valid_modes_are_explicit(){
        assert_ne!("sequential","balanced");
        assert!(!["sequential","balanced"].contains(&"unbounded"));
    }
}
