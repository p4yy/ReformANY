#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Fail any future release build that would mistakenly open build.devUrl.
// The feature embeds the production Vite output behind Tauri's app protocol.
#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!("ReformANY premium setup release requires the custom-protocol feature to embed its frontend");

// Owner-supplied React installer shell. The embedded Tauri/NSIS installer is the
// authoritative installation engine; UI never simulates completion or writes
// system registry entries directly.
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{atomic::{AtomicBool, Ordering}, Arc},
};
use tauri::{Emitter, Manager};

const REAL_NSIS: &[u8] = include_bytes!(env!("REFORMANY_NSIS_PAYLOAD"));

#[derive(Default)]
struct SetupState(Arc<AtomicBool>);

struct ResetBusy(Arc<AtomicBool>);
impl Drop for ResetBusy {
    fn drop(&mut self) { self.0.store(false, Ordering::Release); }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupDefaults { install_path: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupOptions {
    install_path: String,
    media_engines: bool,
    desktop_shortcut: bool,
    context_menu: bool,
}

#[derive(Serialize, Clone)]
struct SetupStatus { stage: String, percent: u8, indeterminate: bool }

// Percent is weighted by completed *verified* milestones, not wall time.
// Silent NSIS provides no reliable granular callback; that phase must remain
// indeterminate until the installer process exits successfully.
fn emit_stage(app: &tauri::AppHandle, stage: &str, percent: u8, indeterminate: bool) {
    let _ = app.emit("setup-status", SetupStatus {
        stage: stage.to_string(), percent: percent.min(100), indeterminate,
    });
}

fn requested_folder(value: &str) -> Result<PathBuf, String> {
    let requested = value.trim();
    if requested.is_empty() || requested.contains(['"', '\n', '\r']) {
        return Err("Choose a valid installation path".into());
    }
    let result = PathBuf::from(requested);
    if !result.is_absolute() || result.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Choose an absolute Windows folder, without '..' segments".into());
    }
    if result.parent().is_none_or(|parent| parent.parent().is_none()) {
        return Err("Do not install ReformANY directly into a drive root".into());
    }
    if result.is_file() { return Err("That installation path is an existing file".into()); }
    Ok(result)
}

fn default_install_path() -> PathBuf {
    let base = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(|s| PathBuf::from(s).join("AppData").join("Local")))
        .unwrap_or_else(|| env::temp_dir());
    base.join("ReformANY")
}

#[tauri::command]
fn setup_defaults() -> SetupDefaults {
    SetupDefaults { install_path: default_install_path().to_string_lossy().into_owned() }
}

fn app_ready(path: &Path) -> Result<(), String> {
    let exe = path.join("ReformANY.exe");
    if !exe.is_file() { return Err("Windows setup did not install ReformANY.exe".into()); }
    Ok(())
}

fn media_ready(path: &Path) -> bool {
    // Bundled installation MUST contain private executables. A machine PATH
    // fallback would hide broken packaging and fail on a different computer.
    let directory = path.join("engines");
    directory.join("ffmpeg.exe").is_file() && directory.join("ffprobe.exe").is_file()
}

fn install(app: tauri::AppHandle, options: SetupOptions) -> Result<(), String> {
    let destination = requested_folder(&options.install_path)?;
    if REAL_NSIS.len() < 1024 || !REAL_NSIS.starts_with(b"MZ") {
        return Err("The bundled Windows installer is missing or damaged".into());
    }
    emit_stage(&app, "Preparing bundled installation files…", 5, true);
    let temp = tempfile::Builder::new().prefix("reformany-setup-")
        .tempdir().map_err(|e| format!("Cannot create setup workspace: {e}"))?;
    let nsis = temp.path().join("ReformANY-backend-setup.exe");
    fs::write(&nsis, REAL_NSIS)
        .map_err(|e| format!("Cannot prepare Windows installer: {e}"))?;
    emit_stage(&app, "Installing files, components, shortcuts and Orbit integration…", 18, true);
    let mut process = Command::new(&nsis);
    process.arg("/S");
    if options.media_engines { process.arg("/MEDIA=1"); }
    if !options.desktop_shortcut { process.arg("/NO_DESKTOP"); }
    if !options.context_menu { process.arg("/NO_CONTEXT"); }
    // NSIS /D= must be the LAST token and is intentionally unquoted, including
    // when the location contains spaces. CreateProcessW is used directly, no shell.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        process.raw_arg(format!(" /D={}", destination.display()));
    }
    #[cfg(not(windows))]
    process.arg(format!("/D={}", destination.display()));
    // Explicit timeout so a hung installer cannot freeze the setup UI.
    let mut child = process.spawn().map_err(|e| format!("Could not launch the Windows installer: {e}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(600);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? { break status; }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Silent setup exceeded the 10-minute limit. See the Windows installer logs.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    };
    if !status.success() {
        return Err(format!("Windows installer exited with code {:?}. No completion has been reported.", status.code()));
    }
    emit_stage(&app, "Verifying application and Windows integration…", 85, false);
    app_ready(&destination)?;
    if options.media_engines && !media_ready(&destination) {
        return Err("ReformANY was installed, but the requested FFmpeg/FFprobe tools were not available. The offline installer payload may be damaged; reinstall using a verified setup executable.".into());
    }
    emit_stage(&app, "ReformANY installation verified", 100, false);
    Ok(())
}

#[tauri::command]
async fn start_install(app: tauri::AppHandle, options: SetupOptions) -> Result<(), String> {
    let state = app.state::<SetupState>();
    let busy = Arc::clone(&state.0);
    if busy.swap(true, Ordering::AcqRel) {
        return Err("Installation is already running".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _reset = ResetBusy(busy);
        install(app, options)
    }).await.map_err(|_| "Installer worker stopped unexpectedly".to_string())?
}

#[tauri::command]
fn finish_setup(install_path: String, launch: bool) -> Result<(), String> {
    let destination = requested_folder(&install_path)?;
    app_ready(&destination)?;
    if launch {
        Command::new(destination.join("ReformANY.exe"))
            .spawn().map_err(|e| format!("Installation succeeded, but ReformANY could not launch: {e}"))?;
    }
    Ok(())
}

fn main() {
    // Safe CI check, no installer launch, no user files changed.
    if env::args().nth(1).as_deref() == Some("--verify-payload") {
        if REAL_NSIS.len() > 1024 && REAL_NSIS.starts_with(b"MZ") {
            println!("Verified bundled NSIS payload ({} bytes)", REAL_NSIS.len());
            return;
        }
        std::process::exit(1);
    }
    tauri::Builder::default()
        .manage(SetupState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![setup_defaults, start_install, finish_setup])
        .run(tauri::generate_context!())
        .expect("ReformANY premium setup failed to open");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_absolute_destination_not_drive_root() {
        assert!(requested_folder("relative/folder").is_err());
        assert!(requested_folder("C:\\\\").is_err());
        assert!(requested_folder("C:\\\\Users\\\\Example\\\\ReformANY").is_ok());
    }
}
