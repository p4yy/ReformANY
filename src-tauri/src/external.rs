use serde::Serialize;
use std::ffi::{OsStr, OsString};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub ffmpeg: bool,
    pub ffprobe: bool,
    pub seven_zip: bool,
    pub winrar: bool,
}

/// Prefer audited executables shipped alongside the installed application.
/// No network lookup or download is performed at runtime.
fn bundled_binary(name: &str) -> Option<PathBuf> {
    if !matches!(name, "ffmpeg" | "ffprobe") { return None; }
    let executable = if cfg!(windows) { format!("{name}.exe") } else { name.to_owned() };
    let app_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    [
        app_dir.join("engines").join(&executable),
        app_dir.join(&executable),
    ].into_iter().find(|path| path.is_file())
}

pub fn find_binary(name: &str) -> Option<PathBuf> {
    if let Some(binary) = bundled_binary(name) { return Some(binary); }
    // Windows installers commonly use these locations. PATH resolution is
    // supported but no untrusted file name becomes an executable command.
    let locations: &[&str] = match name {
        "ffmpeg" => &[
            r"C:\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files\FFmpeg\bin\ffmpeg.exe",
            r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        ],
        "ffprobe" => &[
            r"C:\ffmpeg\bin\ffprobe.exe",
            r"C:\Program Files\FFmpeg\bin\ffprobe.exe",
            r"C:\Program Files\ffmpeg\bin\ffprobe.exe",
        ],
        "7z" => &[
            r"C:\Program Files\7-Zip\7z.exe",
            r"C:\Program Files (x86)\7-Zip\7z.exe",
        ],
        "7zz" => &[],
        "ebook-convert" => &[
            r"C:\Program Files\Calibre2\ebook-convert.exe",
            r"C:\Program Files (x86)\Calibre2\ebook-convert.exe",
        ],
        "rembg" => &[],
        "whisper-cli" => &[],
        "rar" => &[
            r"C:\Program Files\WinRAR\Rar.exe",
            r"C:\Program Files (x86)\WinRAR\Rar.exe",
        ],
        _ => return None,
    };
    for item in locations {
        let p = PathBuf::from(item);
        if p.is_file() { return Some(p); }
    }
    // Check PATH ourselves rather than spawning a shell. On Windows paths may
    // include spaces; Command receives executable paths directly.
    if let Some(paths) = std::env::var_os("PATH") {
        let executable = if cfg!(windows) { format!("{name}.exe") } else { name.to_owned() };
        for dir in std::env::split_paths(&paths) {
            let p = dir.join(&executable);
            if p.is_file() { return Some(p); }
        }
    }
    None
}

pub fn seven_zip() -> Option<PathBuf> {
    find_binary("7z").or_else(|| find_binary("7zz"))
}

// Installed does not imply runnable. Test FFmpeg/FFprobe by executing
// their harmless version command without a console, shell, or network.
fn working_binary(name: &str) -> bool {
    let Some(path) = find_binary(name) else { return false; };
    let mut command = Command::new(path);
    hide_subprocess_window(&mut command);
    command.arg("-version").stdin(Stdio::null())
        .stdout(Stdio::null()).stderr(Stdio::null());
    let Ok(mut child) = command.spawn() else { return false; };
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Err(_) => { let _ = child.kill(); let _ = child.wait(); return false; }
            Ok(None) if start.elapsed() >= std::time::Duration::from_secs(3) => {
                let _ = child.kill(); let _ = child.wait();
                return false;
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(30)),
        }
    }
}

#[tauri::command]
pub fn engine_status() -> EngineStatus {
    EngineStatus {
        ffmpeg: working_binary("ffmpeg"),
        ffprobe: working_binary("ffprobe"),
        seven_zip: seven_zip().is_some(),
        winrar: find_binary("rar").is_some(),
    }
}

/// All background encoders/archivers must run without flashing a Windows
/// console window. This intentionally does not apply to user-requested
/// "Open terminal" actions.
pub fn hide_subprocess_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    { let _ = command; }
}

/// External processes run with argv, never through a shell, and with stdin
/// disabled so they cannot freeze waiting for a console prompt.
pub fn run(program: &Path, args: &[OsString], cwd: Option<&Path>) -> Result<(), String> {
    let stderr_file = tempfile::tempfile().map_err(|e| format!("Cannot create log: {e}"))?;
    let mut command = Command::new(program);
    hide_subprocess_window(&mut command);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::null())
        .stderr(stderr_file.try_clone().map_err(|e| e.to_string())?);
    if let Some(cwd) = cwd { command.current_dir(cwd); }
    let status = command.status().map_err(|e| format!("Cannot run {}: {e}", program.display()))?;
    if status.success() { return Ok(()); }
    let mut file = stderr_file;
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut text = String::new();
    file.take(3500).read_to_string(&mut text).map_err(|e| e.to_string())?;
    let reason = text.trim();
    Err(if reason.is_empty() {
        format!("External engine exited with status {status}")
    } else {
        format!("External engine failed: {reason}")
    })
}

pub fn verify_input(input: &Path, allow_dir: bool) -> Result<(), String> {
    let meta = fs::symlink_metadata(input).map_err(|_| "Selected path is not accessible".to_owned())?;
    if meta.file_type().is_symlink() {
        return Err("Symbolic links cannot be used as archive or media inputs".into());
    }
    if !meta.is_file() && !(allow_dir && meta.is_dir()) {
        return Err("Expected a regular file or folder".into());
    }
    if meta.is_file() && meta.len() > 16 * 1024 * 1024 * 1024 {
        return Err("Files above 16 GB require a future streaming release".into());
    }
    Ok(())
}

pub fn output_dir(input: &Path, destination: Option<&str>) -> Result<PathBuf, String> {
    let dir = match destination {
        Some(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => input.parent().ok_or("No output directory for input file")?.to_path_buf(),
    };
    if !dir.is_dir() { return Err("Output directory is not accessible".into()); }
    Ok(dir)
}

/// Publish a fully written staged file without replacing existing files. This
/// uses tempfile's no-clobber persist, even if another job races the filename.
pub fn publish(staged: &Path, dir: &Path, stem: &str, extension: &str) -> Result<PathBuf, String> {
    for idx in 0..1000 {
        let filename = if idx == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem} ({idx}).{extension}")
        };
        let dest = dir.join(filename);
        let mut temp = tempfile::Builder::new().prefix(".reformany-")
            .tempfile_in(dir).map_err(|e| e.to_string())?;
        let mut source = File::open(staged).map_err(|e| e.to_string())?;
        std::io::copy(&mut source, temp.as_file_mut()).map_err(|e| e.to_string())?;
        temp.as_file_mut().flush().map_err(|e| e.to_string())?;
        temp.as_file_mut().sync_all().map_err(|e| e.to_string())?;
        match temp.persist_noclobber(&dest) {
            Ok(_) => return Ok(dest),
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Unable to save result: {}", error.error)),
        }
    }
    Err("Too many existing outputs with the same name".into())
}

pub fn format_name(input: &Path) -> Result<String, String> {
    input.file_stem()
        .and_then(OsStr::to_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or("File name cannot be represented as text".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publishes_twice_without_overwriting() {
        let temp = tempfile::tempdir().unwrap();
        let original = temp.path().join("output.bin");
        fs::write(&original, b"old").unwrap();
        let staging = temp.path().join("stage.bin");
        fs::write(&staging, b"new").unwrap();
        let next = publish(&staging, temp.path(), "output", "bin").unwrap();
        assert_ne!(next, original);
        assert_eq!(fs::read(original).unwrap(), b"old");
        assert_eq!(fs::read(next).unwrap(), b"new");
    }
}
