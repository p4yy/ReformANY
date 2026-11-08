//! Experimental opt-in, local-only Windows mouse gesture recognizer.
//! The hook never reads keys, clipboard data or file contents, and always
//! passes mouse events to the next hook. A gesture opens a drop target;
//! the actual source path is obtained only from a user-authorized file drop.
use tauri::{AppHandle, State};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Gesture { Shake, Scroll }

#[derive(Clone, Copy)]
enum MouseInput { Down, Move, Wheel(i16), Up }

#[derive(Default)]
struct Detector {
    down: bool,
    armed: bool,
    start_x: i32,
    start_y: i32,
    last_turn_x: i32,
    direction: i32,
    reversals: u8,
    start_time: u32,
    wheel_sum: i32,
}

impl Detector {
    fn handle(&mut self, event: MouseInput, x: i32, y: i32, at: u32, modes: u8) -> Option<Gesture> {
        match event {
            MouseInput::Down => {
                *self = Self {
                    down: true, start_x: x, start_y: y,
                    last_turn_x: x, start_time: at, ..Self::default()
                };
                None
            }
            MouseInput::Up => { *self = Self::default(); None }
            MouseInput::Move | MouseInput::Wheel(_) => {
                if !self.down || modes == 0 { return None; }
                if at.wrapping_sub(self.start_time) > 7_000 {
                    *self = Self::default();
                    return None;
                }
                if !self.armed {
                    let dx = (x as i64 - self.start_x as i64).abs();
                    let dy = (y as i64 - self.start_y as i64).abs();
                    if dx.max(dy) < 22 { return None; }
                    self.armed = true;
                    self.last_turn_x = x;
                    self.direction = 0;
                }
                match event {
                    MouseInput::Wheel(delta) if modes & 0b10 != 0 => {
                        self.wheel_sum = self.wheel_sum.saturating_add(i32::from(delta));
                        if self.wheel_sum.abs() >= 120 {
                            self.down = false;
                            return Some(Gesture::Scroll);
                        }
                    }
                    MouseInput::Move if modes & 0b01 != 0 => {
                        if at.wrapping_sub(self.start_time) > 1300 {
                            self.reversals = 0;
                            self.start_time = at;
                            self.direction = 0;
                            self.last_turn_x = x;
                            return None;
                        }
                        let difference = x - self.last_turn_x;
                        if difference.abs() >= 28 {
                            let next = difference.signum();
                            if self.direction == 0 {
                                self.direction = next;
                                self.last_turn_x = x;
                            } else if self.direction == next {
                                self.last_turn_x = x;
                            } else {
                                self.direction = next;
                                self.last_turn_x = x;
                                self.reversals += 1;
                                if self.reversals >= 3 {
                                    self.down = false;
                                    return Some(Gesture::Shake);
                                }
                            }
                        }
                    }
                    _ => {}
                }
                None
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod native {
    use super::*;
    use std::sync::{mpsc, Mutex, OnceLock};
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::thread::{self, JoinHandle};
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, MSLLHOOKSTRUCT,
        PeekMessageW, PostThreadMessageW, SetWindowsHookExW, TranslateMessage,
        UnhookWindowsHookEx, MSG, PM_NOREMOVE, WH_MOUSE_LL,
        WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_QUIT,
    };
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    static MODES: AtomicU8 = AtomicU8::new(0);
    static DETECTOR: OnceLock<Mutex<Detector>> = OnceLock::new();
    static EVENTS: OnceLock<Mutex<Option<mpsc::Sender<Gesture>>>> = OnceLock::new();

    struct MonitorHandle { thread_id: u32, thread: JoinHandle<()> }
    #[derive(Default)]
    pub struct GestureMonitor { thread: Mutex<Option<MonitorHandle>> }

    unsafe extern "system" fn low_level_mouse(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
        if code >= 0 && data != 0 && MODES.load(Ordering::Relaxed) != 0 {
            let sample = &*(data as *const MSLLHOOKSTRUCT);
            if sample.flags & 1 == 0 {
                let event = match message as u32 {
                    WM_LBUTTONDOWN => Some(MouseInput::Down),
                    WM_LBUTTONUP => Some(MouseInput::Up),
                    WM_MOUSEMOVE => Some(MouseInput::Move),
                    WM_MOUSEWHEEL => Some(MouseInput::Wheel((sample.mouseData >> 16) as i16)),
                    _ => None,
                };
                if let Some(event) = event {
                    if let Ok(mut state) = DETECTOR.get_or_init(|| Mutex::new(Detector::default())).lock() {
                        if let Some(gesture) = state.handle(event, sample.pt.x, sample.pt.y,
                            sample.time, MODES.load(Ordering::Relaxed)) {
                            if let Ok(send) = EVENTS.get_or_init(|| Mutex::new(None)).lock() {
                                if let Some(sender) = send.as_ref() { let _ = sender.send(gesture); }
                            }
                        }
                    }
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, message, data)
    }

    fn show_drop_target(app: &AppHandle, _gesture: Gesture) {
        if let Some(window) = app.get_webview_window("orbit") {
            let _ = window.show();
            return;
        }
        let window = WebviewWindowBuilder::new(app, "orbit", WebviewUrl::App("index.html".into()))
            .title("ReformANY Orbit")
            .inner_size(400.0, 400.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .build();
        if let Ok(window) = window { crate::orbit::position_near_cursor(&window); }
    }

    fn stop_monitor(handle: MonitorHandle) {
        MODES.store(0, Ordering::SeqCst);
        unsafe { PostThreadMessageW(handle.thread_id, WM_QUIT, 0, 0); }
        let _ = handle.thread.join();
        if let Ok(mut sender) = EVENTS.get_or_init(|| Mutex::new(None)).lock() {
            *sender = None;
        }
        if let Ok(mut detector) = DETECTOR.get_or_init(|| Mutex::new(Detector::default())).lock() {
            *detector = Detector::default();
        }
    }

    impl GestureMonitor {
        fn configure(&self, app: AppHandle, modes: u8) -> Result<(), String> {
            let mut guard = self.thread.lock().map_err(|_| "Mouse gesture controller is busy")?;
            if let Some(previous) = guard.take() { stop_monitor(previous); }
            if modes == 0 { return Ok(()); }
            let (events_tx, events_rx) = mpsc::channel::<Gesture>();
            if let Ok(mut sender) = EVENTS.get_or_init(|| Mutex::new(None)).lock() {
                *sender = Some(events_tx);
            }
            let receiver_app = app.clone();
            thread::spawn(move || {
                while let Ok(gesture) = events_rx.recv() {
                    show_drop_target(&receiver_app, gesture);
                }
            });
            let (ready_tx, ready_rx) = mpsc::channel();
            let hook_thread = thread::spawn(move || {
                let id = unsafe { GetCurrentThreadId() };
                let mut message = unsafe { std::mem::zeroed::<MSG>() };
                unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE); }
                let hook = unsafe {
                    SetWindowsHookExW(WH_MOUSE_LL, Some(low_level_mouse), std::ptr::null_mut(), 0)
                };
                let started = !hook.is_null();
                let _ = ready_tx.send((id, started));
                if !started { return; }
                loop {
                    let code = unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) };
                    if code <= 0 { break; }
                    unsafe { TranslateMessage(&message); DispatchMessageW(&message); }
                }
                unsafe { UnhookWindowsHookEx(hook); }
            });
            let (thread_id, started) = ready_rx.recv().map_err(|_| "Mouse hook did not initialize")?;
            if !started {
                let _ = hook_thread.join();
                EVENTS.get_or_init(|| Mutex::new(None)).lock().map(|mut tx| *tx = None).ok();
                return Err("Could not install the local mouse gesture hook".into());
            }
            MODES.store(modes, Ordering::SeqCst);
            *guard = Some(MonitorHandle { thread_id, thread: hook_thread });
            Ok(())
        }
    }

    impl Drop for GestureMonitor {
        fn drop(&mut self) {
            if let Ok(mut guard) = self.thread.lock() {
                if let Some(handle) = guard.take() { stop_monitor(handle); }
            }
        }
    }

    #[tauri::command]
    pub fn configure_orbit_gestures(app: AppHandle, state: State<'_, GestureMonitor>,
        shake: bool, scroll: bool) -> Result<(), String> {
        let modes = (shake as u8) | ((scroll as u8) << 1);
        state.configure(app, modes)
    }
}

#[cfg(target_os = "windows")]
pub use native::{configure_orbit_gestures, GestureMonitor};

#[cfg(not(target_os = "windows"))]
#[derive(Default)]
pub struct GestureMonitor;

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn configure_orbit_gestures(_app: AppHandle, _state: State<'_, GestureMonitor>,
    shake: bool, scroll: bool) -> Result<(), String> {
    if shake || scroll { Err("Explorer drag gestures require Windows".into()) }
    else { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shake_requires_holding_and_three_deliberate_reversals() {
        let mut input = Detector::default();
        assert_eq!(input.handle(MouseInput::Move, 50, 0, 200, 1), None);
        assert_eq!(input.handle(MouseInput::Down, 0, 0, 0, 1), None);
        for (x, at) in [(35, 70), (68, 100), (20, 190), (80, 280)] {
            assert_eq!(input.handle(MouseInput::Move, x, 0, at, 1), None);
        }
        assert_eq!(input.handle(MouseInput::Move, 15, 0, 370, 1), Some(Gesture::Shake));
        assert_eq!(input.handle(MouseInput::Move, 90, 0, 430, 1), None);
    }

    #[test]
    fn scroll_requires_drag_and_can_be_disabled() {
        let mut input = Detector::default();
        input.handle(MouseInput::Down, 0, 0, 0, 2);
        assert_eq!(input.handle(MouseInput::Wheel(120), 1, 1, 10, 2), None);
        input.handle(MouseInput::Move, 60, 0, 20, 2);
        assert_eq!(input.handle(MouseInput::Wheel(60), 60, 0, 25, 2), None);
        assert_eq!(input.handle(MouseInput::Wheel(60), 60, 0, 28, 2), Some(Gesture::Scroll));
        input.handle(MouseInput::Up, 60, 0, 40, 2);
        input.handle(MouseInput::Down, 0, 0, 60, 0);
        input.handle(MouseInput::Move, 60, 0, 80, 0);
        assert_eq!(input.handle(MouseInput::Wheel(120), 60, 0, 90, 0), None);
    }

    #[test]
    fn slow_shakes_do_not_trigger() {
        let mut input = Detector::default();
        input.handle(MouseInput::Down, 0, 0, 0, 1);
        for (x, at) in [(30, 40), (70, 140), (0, 900), (80, 2300), (0, 3900)] {
            assert_eq!(input.handle(MouseInput::Move, x, 0, at, 1), None);
        }
    }
}
