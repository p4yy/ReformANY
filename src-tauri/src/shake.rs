//! Native Windows hold → shake gesture state machine.
//!
//! Global pointer events contain NO file identity. Only an Explorer shell
//! IDataObject validated separately may launch Orbit. This detector cannot
//! operate outside a qualifying left-button hold in an Explorer/Desktop view.
use serde::{Deserialize,Serialize};
use std::{fs,path::PathBuf,sync::{Mutex,OnceLock}};

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
        if enabled {launch_listener()?;} else {unsafe{reformany_stop_shake_listener()}}
    }
    Ok(settings)
}

#[derive(Debug,Clone,Copy,PartialEq,Eq)]
enum Phase { Idle, Hold, Armed, Shake, Cooldown }
#[derive(Debug)]
pub struct Detector{
    phase:Phase,down_time:u32,shake_time:u32,cooldown_time:u32,
    origin:(i32,i32),last:(i32,i32),
    last_axis:Option<(bool,i8)>,flips:u8,travel:u32,last_flip:u32,
}
impl Default for Detector{
    fn default()->Self{Self{phase:Phase::Idle,down_time:0,shake_time:0,
        cooldown_time:0,origin:(0,0),last:(0,0),last_axis:None,
        flips:0,travel:0,last_flip:0}}
}
impl Detector{
    /// Wrap-safe milliseconds from Windows MSLLHOOKSTRUCT.time (u32).
    pub fn sample(&mut self,x:i32,y:i32,time:u32,left_down:bool,
        qualifies:bool,sensitivity:u8)->bool
    {
        let sensitivity=sensitivity.clamp(1,5);
        let radius=11-(sensitivity as i32); // 10 → 6 px hold jitter tolerance
        let step=9-(sensitivity as i32);    // 8 → 4 px deliberate directional sample
        let hold=340-(sensitivity as u32)*25; // 315 → 215 ms
        let min_flips=if sensitivity>=4{3}else{4};
        if !left_down{
            if self.phase!=Phase::Cooldown{self.phase=Phase::Idle;}
            return false;
        }
        if self.phase==Phase::Cooldown{
            if time.wrapping_sub(self.cooldown_time)<1300{return false;}
            self.phase=Phase::Idle;
        }
        if !qualifies{
            self.phase=Phase::Idle;
            return false;
        }
        if self.phase==Phase::Idle{
            self.phase=Phase::Hold;self.down_time=time;self.origin=(x,y);
            self.last=(x,y);return false;
        }
        let dx=x.saturating_sub(self.last.0),dy=y.saturating_sub(self.last.1);
        self.last=(x,y);
        match self.phase {
            Phase::Hold=>{
                let ax=x.saturating_sub(self.origin.0).unsigned_abs() as i64;
                let ay=y.saturating_sub(self.origin.1).unsigned_abs() as i64;
                if ax*ax+ay*ay>i64::from(radius*radius){
                    // Ordinary move-drag rather than a deliberate stationary hold.
                    self.phase=Phase::Cooldown;self.cooldown_time=time;return false;
                }
                if time.wrapping_sub(self.down_time)>=hold{
                    self.phase=Phase::Armed;self.shake_time=time;self.travel=0;
                    self.flips=0;self.last_axis=None;self.last_flip=time;
                }
            }
            Phase::Armed|Phase::Shake=>{
                if time.wrapping_sub(self.shake_time)>800{
                    self.phase=Phase::Cooldown;self.cooldown_time=time;return false;
                }
                let absx=dx.unsigned_abs(),absy=dy.unsigned_abs();
                let axis=absx>=absy;
                let delta=if axis{dx}else{dy};
                if delta.unsigned_abs()<(step as u32){return false;}
                self.travel=self.travel.saturating_add(delta.unsigned_abs());
                let sign=if delta>0{1}else{-1};
                if let Some((last_axis,last_sign))=self.last_axis{
                    if axis==last_axis&&sign!=last_sign{
                        // Reversals separated by long pauses are not a shake.
                        if time.wrapping_sub(self.last_flip)<=220{
                            self.flips=self.flips.saturating_add(1);
                        }else {self.flips=0;}
                        self.last_flip=time;
                    }
                }else{self.last_flip=time;}
                self.last_axis=Some((axis,sign));self.phase=Phase::Shake;
                if self.flips>=min_flips&&self.travel>=65&&
                    time.wrapping_sub(self.shake_time)<=700 {
                    self.phase=Phase::Cooldown;self.cooldown_time=time;return true;
                }
            }
            _=>{}
        }
        false
    }
}
static SENSOR:OnceLock<Mutex<Detector>>=OnceLock::new();
static SETTINGS:OnceLock<ShakeSettings>=OnceLock::new();

#[cfg(windows)]
extern "C"{
    fn reformany_win_shake_listen(tick:extern "C" fn(i32,i32,u32,bool,bool)->bool,
        launch:extern "C" fn(*const u16));
    fn reformany_stop_shake_listener();
}

#[cfg(windows)]
extern "C" fn tick(x:i32,y:i32,time:u32,left:bool,eligible:bool)->bool {
    let config=SETTINGS.get_or_init(read_settings);
    if !config.enabled{return false;}
    if let Ok(mut detector)=SENSOR.get_or_init(||Mutex::new(Detector::default())).try_lock(){
        detector.sample(x,y,time,left,eligible,config.sensitivity)
    }else{false}
}
#[cfg(windows)]
extern "C" fn open_orbit(wide:*const u16){
    if wide.is_null(){return;}
    // C++ passes an NUL-terminated, checked CF_HDROP path of bounded length.
    use std::os::windows::ffi::OsStringExt;
    let length=unsafe{(0..32768).find(|&i|*wide.add(i)==0)};
    let Some(length)=length else{return;};
    if length==0{return;}
    let chars=unsafe{std::slice::from_raw_parts(wide,length)};
    let file=std::ffi::OsString::from_wide(chars);
    let path=PathBuf::from(&file);
    if !path.exists(){return;}
    if let Ok(exe)=std::env::current_exe(){
        let mut command=std::process::Command::new(exe);
        command.arg("orbit").arg(&path);
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
pub fn start_when_enabled(){if read_settings().enabled{let _=launch_listener();}}
#[cfg(not(windows))]
pub fn start_when_enabled(){}

#[cfg(windows)]
pub fn run_listener(){
    if !read_settings().enabled{return;}
    unsafe{reformany_win_shake_listen(tick,open_orbit);}
}
#[cfg(not(windows))]
pub fn run_listener(){}

#[cfg(windows)]
pub fn stop_listener(){unsafe{reformany_stop_shake_listener()}}
#[cfg(not(windows))]
pub fn stop_listener(){}

#[cfg(test)]
mod tests{
    use super::*;
    fn sample(d:&mut Detector,x:i32,y:i32,t:u32,eligible:bool)->bool{
        d.sample(x,y,t,true,eligible,3)
    }
    #[test]
    fn valid_hold_with_fast_direction_flips_triggers_once(){
        let mut d=Detector::default();
        assert!(!sample(&mut d,400,400,0,true));
        assert!(!sample(&mut d,401,400,100,true));
        assert!(!sample(&mut d,400,400,290,true));
        let mut triggered=0;
        for(i,x) in [413,390,416,388,417,389].iter().enumerate(){
            if sample(&mut d,*x,400,320+i as u32*35,true){triggered+=1;}
        }
        assert_eq!(triggered,1);
        assert!(!sample(&mut d,420,400,900,true));
    }
    #[test]
    fn steady_drag_jitter_and_non_shell_events_never_trigger(){
        let mut d=Detector::default();
        assert!(!sample(&mut d,0,0,0,true));
        for i in 1..20{assert!(!sample(&mut d,i*8,0,i as u32*30,true));}
        d=Detector::default();
        assert!(!sample(&mut d,50,50,0,true));
        for i in 0..20{
            assert!(!sample(&mut d,50+(i%3),50,300+i as u32*24,true));
        }
        d=Detector::default();
        assert!(!sample(&mut d,50,50,0,false));
        assert!(!sample(&mut d,50,50,400,false));
        for(i,x) in [75,30,78,20,80].iter().enumerate(){
            assert!(!sample(&mut d,*x,50,410+i as u32*25,false));
        }
    }
    #[test]
    fn released_button_cancels_pending_gesture(){
        let mut d=Detector::default();
        sample(&mut d,100,100,0,true);
        sample(&mut d,100,100,300,true);
        assert!(!d.sample(100,100,305,false,true,5));
        assert!(!sample(&mut d,118,100,310,true));
    }
}
