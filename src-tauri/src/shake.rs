//! Native Windows hold → shake gesture state machine.
//!
//! Polled pointer coordinates contain NO file identity. Only an Explorer shell
//! IDataObject validated separately may launch Orbit. This detector cannot
//! operate outside a qualifying primary-button hold in an Explorer/Desktop view.
use serde::{Deserialize,Serialize};
use std::{fs,path::PathBuf};
#[cfg(windows)]
use std::sync::{Mutex,OnceLock};

#[derive(Debug,Clone,Copy,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ShakeSettings {
    pub enabled:bool,
    pub sensitivity:u8,
}
impl Default for ShakeSettings {
    fn default()->Self{Self{enabled:false,sensitivity:3}}
}
fn path()->PathBuf{crate::job_settings::directory().join("orbit-gesture.json")}
fn read_settings()->ShakeSettings{
    fs::read(path()).ok().and_then(|bytes|serde_json::from_slice::<ShakeSettings>(&bytes).ok())
      .filter(|c|(1..=5).contains(&c.sensitivity))
      .unwrap_or_default()
}
#[tauri::command]
pub fn get_shake_settings()->ShakeSettings{read_settings()}
#[tauri::command]
pub fn set_shake_settings(enabled:bool,sensitivity:u8)->Result<ShakeSettings,String>{
    if !(1..=5).contains(&sensitivity){
        return Err("Choose shake sensitivity between 1 and 5".into());
    }
    let settings=ShakeSettings{enabled,sensitivity};
    let folder=crate::job_settings::directory();
    fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
    let stage=tempfile::Builder::new().prefix(".shake-settings-").tempfile_in(&folder)
        .map_err(|e|e.to_string())?;
    serde_json::to_writer(stage.as_file(),&settings).map_err(|e|e.to_string())?;
    stage.persist(path()).map_err(|e|format!("Cannot save gesture preferences: {}",e.error))?;
    #[cfg(windows)]{
        if enabled {
            // Reload sensitivity in the running listener. Do not spawn a new
            // process on every slider movement or cache stale settings.
            let running=unsafe{reformany_reload_shake_listener()};
            if !running {
                // Previous versions leave their opted-in listener alive when
                // the app UI exits. Replace that process before enabling the
                // new OLE implementation, or report a real error.
                unsafe{reformany_stop_shake_listener();}
                if !unsafe{reformany_wait_shake_listener_exit(1800)} {
                    return Err("The previous Orbit listener could not exit. Close any remaining ReformANY process and enable the gesture again.".into());
                }
                launch_listener()?;
            }
        } else {unsafe{reformany_stop_shake_listener()}}
    }
    Ok(settings)
}

/// Deterministic gesture detector. Native side polls physical coordinates
/// every 20ms from a standalone STA, never the UI thread.
#[derive(Debug,Clone,Copy,PartialEq,Eq)]
#[cfg(any(windows,test))]
enum Phase { Idle, ButtonHeld, PotentialDrag, Handled, WaitingForDrop }
#[derive(Debug)]
#[cfg(any(windows,test))]
pub struct Detector {
    phase:Phase,
    origin:(i32,i32),
    direction:Option<i8>,
    furthest_x:i32,
    furthest_y:i32,
    first_direction_time:u32,
    reversals:u8,
    handled:bool,
}
#[cfg(any(windows,test))]
impl Default for Detector{
    fn default()->Self {
        Self{phase:Phase::Idle,origin:(0,0),direction:None,
            furthest_x:0,furthest_y:0,first_direction_time:0,reversals:0,handled:false}
    }
}
#[cfg(any(windows,test))]
impl Detector{
    fn reset(&mut self){*self=Self::default();}
    /// Eligible is established only once, at initial button down, by native
    /// Explorer/Desktop hit-testing. Native passes SM_CXDRAG from Windows.
    /// Return true once per press after 3 real horizontal 40px reversals.
    pub fn sample(&mut self,x:i32,y:i32,time:u32,primary_down:bool,
        eligible:bool,drag_threshold:u32,sensitivity:u8)->bool {
        if !primary_down {self.reset();return false;}
        if self.handled {return false;}
        if !eligible {self.reset();return false;}
        if self.phase==Phase::Idle{
            self.phase=Phase::ButtonHeld;
            self.origin=(x,y);
            return false;
        }
        if self.phase==Phase::ButtonHeld{
            let dist=x.abs_diff(self.origin.0).saturating_add(y.abs_diff(self.origin.1));
            if dist<=drag_threshold.saturating_mul(2).max(8){return false;}
            self.phase=Phase::PotentialDrag;
        }
        // Sensitivity adjusts time strictness but never permits under-40px
        // reversals or a window longer than the specified 800ms.
        let max_age=800u32.saturating_sub(
            5u32.saturating_sub(u32::from(sensitivity.clamp(1,5)))*25);
        if self.direction.is_some()
            && time.wrapping_sub(self.first_direction_time)>max_age{
            self.direction=None;
            self.reversals=0;
            self.origin=(x,y);
            self.furthest_x=x;
            self.furthest_y=y;
            return false;
        }
        const PX:u32=40;
        match self.direction {
            None=>{
                let dx=x.saturating_sub(self.origin.0);
                let dy=y.saturating_sub(self.origin.1);
                if dx.unsigned_abs()>=PX && dx.unsigned_abs()>=dy.unsigned_abs(){
                    self.direction=Some(if dx>0{1}else{-1});
                    self.furthest_x=x;
                    self.furthest_y=y;
                    self.first_direction_time=time;
                }
            }
            Some(sign)=>{
                let dx=x.saturating_sub(self.furthest_x);
                if (sign>0&&dx>0)||(sign<0&&dx<0) {
                    self.furthest_x=x;
                    self.furthest_y=y;
                }else if dx.unsigned_abs()>=PX
                    && dx.unsigned_abs()>=y.abs_diff(self.furthest_y) {
                    self.direction=Some(-sign);
                    self.furthest_x=x;
                    self.furthest_y=y;
                    self.reversals=self.reversals.saturating_add(1);
                    if self.reversals>=3 {
                        // Handled BEFORE checking SysDragImage in C++. If
                        // absent, do not retry until the primary button resets.
                        self.handled=true;
                        self.phase=Phase::Handled;
                        return true;
                    }
                }
            }
        }
        false
    }
    fn validated_drag(&mut self){
        if self.handled && self.phase==Phase::Handled {
            self.phase=Phase::WaitingForDrop;
        }
    }
}
#[cfg(windows)]
static SENSOR:OnceLock<Mutex<Detector>>=OnceLock::new();
#[cfg(windows)]
static SETTINGS:OnceLock<Mutex<ShakeSettings>>=OnceLock::new();

#[cfg(windows)]
extern "C"{
    fn reformany_win_shake_listen(tick:extern "C" fn(i32,i32,u32,bool,bool,u32)->u8,
        launch:extern "C" fn(*const u16,u8), reload:extern "C" fn(),
        validated:extern "C" fn());
    fn reformany_stop_shake_listener();
    fn reformany_reload_shake_listener()->bool;
    fn reformany_wait_shake_listener_exit(timeout_ms:u32)->bool;
}

/// Native polling returns 2 exactly once on a completed gesture.
#[cfg(windows)]
extern "C" fn tick(x:i32,y:i32,time:u32,primary:bool,eligible:bool,
    threshold:u32)->u8 {
    let config=SETTINGS.get_or_init(||Mutex::new(read_settings()));
    let Ok(config)=config.try_lock() else{return 0;};
    let Ok(mut detector)=SENSOR.get_or_init(||Mutex::new(Detector::default())).try_lock()
        else{return 0};
    if !config.enabled {detector.reset();return 0;}
    if detector.sample(x,y,time,primary,eligible,threshold,config.sensitivity){2}
    else if detector.phase==Phase::PotentialDrag && detector.reversals>=2{1}
    else{0}
}
#[cfg(windows)]
extern "C" fn mark_waiting_for_drop(){
    if let Some(sensor)=SENSOR.get(){
        if let Ok(mut detector)=sensor.lock(){detector.validated_drag();}
    }
}
/// Invoked from the listener STA, never on the main GUI thread.
#[cfg(windows)]
extern "C" fn reload_listener_settings(){
    let updated=read_settings();
    if let Some(current)=SETTINGS.get(){
        if let Ok(mut config)=current.lock(){*config=updated;}
    }
    if let Some(detector)=SENSOR.get(){
        if let Ok(mut detector)=detector.lock(){*detector=Detector::default();}
    }
}
#[cfg(windows)]
extern "C" fn open_orbit(wide:*const u16,tab:u8){
    if wide.is_null(){return;}
    // C++ passes an NUL-terminated, checked CF_HDROP path of bounded length.
    use std::os::windows::ffi::OsStringExt;
    let length=unsafe{(0..32768).find(|&i|*wide.add(i)==0)};
    let Some(length)=length else{return;};
    if length==0{return;}
    let chars=unsafe{std::slice::from_raw_parts(wide,length)};
    let file=std::ffi::OsString::from_wide(chars);
    let path=PathBuf::from(&file);
    let Ok(metadata)=fs::symlink_metadata(&path) else{return;};
    if !metadata.is_file() || metadata.file_type().is_symlink(){return;}
    if let Ok(exe)=std::env::current_exe(){
        let mut command=std::process::Command::new(exe);
        command.arg("orbit").arg(&path);
        match tab {1=>{command.arg("--tab=tools");},2=>{command.arg("--tab=actions");},_=>{}}
        crate::external::hide_subprocess_window(&mut command);
        let _=command.spawn();
    }
}
#[cfg(windows)]
fn launch_listener()->Result<(),String>{
    let exe=std::env::current_exe().map_err(|e|e.to_string())?;
    let mut command=std::process::Command::new(exe);
    command.arg("--shake-listener");
    crate::external::hide_subprocess_window(&mut command);
    command.spawn().map_err(|e|format!("Cannot start shake listener: {e}"))?;
    Ok(())
}
#[cfg(windows)]
pub fn start_when_enabled(){
    if read_settings().enabled{
        // On upgrade, ensure the old background listener actually exits.
        // Otherwise its mutex would block the new drag-data implementation.
        unsafe{reformany_stop_shake_listener();}
        if unsafe{reformany_wait_shake_listener_exit(1800)}{
            let _=launch_listener();
        }
    }
}
#[cfg(not(windows))]
pub fn start_when_enabled(){}

#[cfg(windows)]
pub fn run_listener(){
    if !read_settings().enabled{return;}
    unsafe{reformany_win_shake_listen(tick,open_orbit,reload_listener_settings,mark_waiting_for_drop);}
}
#[cfg(not(windows))]
pub fn run_listener(){}

#[cfg(windows)]
pub fn stop_listener(){unsafe{reformany_stop_shake_listener()}}
#[cfg(not(windows))]
pub fn stop_listener(){}

#[cfg(test)]
mod tests {
    use super::*;
    fn step(d:&mut Detector,x:i32,y:i32,ms:u32)->bool{
        d.sample(x,y,ms,true,true,4,3)
    }
    fn completed(d:&mut Detector,start:u32)->bool{
        let mut count=0;
        for (i,x) in [0,55,0,55,0].into_iter().enumerate(){
            if step(d,x,0,start+i as u32*100){count+=1;}
        }
        count==1
    }
    #[test]
    fn three_horizontal_reversals_within_eight_hundred_ms(){
        let mut d=Detector::default();
        assert!(completed(&mut d,0));
        assert_eq!(d.reversals,3);
        assert_eq!(d.phase,Phase::Handled);
        assert!(d.handled);
        assert!(!step(&mut d,55,0,600));
        d.validated_drag();
        assert_eq!(d.phase,Phase::WaitingForDrop);
    }
    #[test]
    fn vertical_only_has_zero_reversals(){
        let mut d=Detector::default();
        for(i,y) in [0,70,0,70,0,70,0].into_iter().enumerate(){
            assert!(!step(&mut d,0,y,i as u32*90));
        }
        assert_eq!(d.reversals,0);
    }
    #[test]
    fn jitter_and_single_horizontal_sweep_rejected(){
        let mut d=Detector::default();
        for i in 0..70 { assert!(!step(&mut d,(i%8)-4,0,i as u32*20)); }
        assert_eq!(d.reversals,0);
        d.reset();
        for i in 0..70 { assert!(!step(&mut d,i*3,0,i as u32*20)); }
        assert_eq!(d.reversals,0);
    }
    #[test]
    fn direction_and_reversals_require_forty_pixels(){
        let mut d=Detector::default();
        assert!(!step(&mut d,0,0,0));
        assert!(!step(&mut d,39,0,100));
        assert_eq!(d.direction,None);
        assert!(!step(&mut d,40,0,120));
        assert_eq!(d.direction,Some(1));
        assert!(!step(&mut d,1,0,150));
        assert_eq!(d.reversals,0);
        assert!(!step(&mut d,0,0,170));
        assert_eq!(d.reversals,1);
    }
    #[test]
    fn slow_reversal_window_expired(){
        let mut d=Detector::default();
        assert!(!step(&mut d,0,0,0));
        assert!(!step(&mut d,55,0,100));
        assert!(!step(&mut d,0,0,1000));
        assert_eq!(d.reversals,0);
    }
    #[test]
    fn button_release_resets_handled_and_history(){
        let mut d=Detector::default();
        assert!(completed(&mut d,0));
        assert!(!d.sample(0,0,450,false,true,4,3));
        assert_eq!(d.phase,Phase::Idle);
        assert_eq!(d.reversals,0);
        assert!(!d.handled);
        assert!(completed(&mut d,500));
    }
    #[test]
    fn handled_stays_handled_if_drag_validation_fails(){
        let mut d=Detector::default();
        assert!(completed(&mut d,0));
        for(i,x) in [55,0,55,0,55].into_iter().enumerate(){
            assert!(!step(&mut d,x,0,450+i as u32*45));
        }
        assert_eq!(d.phase,Phase::Handled);
        assert!(d.handled);
    }
    #[test]
    fn only_eligible_shell_initial_press_is_tracked(){
        let mut d=Detector::default();
        for (i,x) in [0,55,0,55,0].into_iter().enumerate(){
            assert!(!d.sample(x,0,i as u32*100,true,false,4,3));
        }
        assert_eq!(d.phase,Phase::Idle);
    }
    #[test]
    fn initial_drag_counts_both_axes(){
        let mut d=Detector::default();
        assert!(!step(&mut d,0,0,0));
        assert!(!step(&mut d,6,2,20));
        assert_eq!(d.phase,Phase::ButtonHeld);
        assert!(!step(&mut d,6,3,40));
        assert_eq!(d.phase,Phase::PotentialDrag);
    }
    #[test]
    fn physical_button_mapping_is_the_native_pollers_responsibility(){
        let mut d=Detector::default();
        assert!(completed(&mut d,0));
        d.sample(0,0,500,false,true,4,3);
        assert!(!d.handled);
    }
}
