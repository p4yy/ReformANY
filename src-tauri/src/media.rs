use crate::external::{find_binary, format_name, output_dir, publish, verify_input};
use serde::Deserialize;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaJob {
    path: String,
    target: String,
    destination: Option<String>,
    profile: String,
    start_seconds: Option<f64>,
    duration_seconds: Option<f64>,
}

/// Supported output profiles are explicit; arbitrary ffmpeg switches are never
/// forwarded to an external process.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum MediaKind { Audio, Video }

fn output_spec(target: &str) -> Result<(MediaKind, &'static str), String> {
    match target {
        "mp3" | "m4a" | "wav" | "flac" | "ogg" | "opus" => Ok((MediaKind::Audio, target_extension(target))),
        "mp4" | "webm" | "mkv" | "mov" | "avi" => Ok((MediaKind::Video, target_extension(target))),
        _ => Err("Unsupported media destination format".into()),
    }
}

fn target_extension(target: &str) -> &'static str {
    match target {
        "mp3" => "mp3", "m4a" => "m4a", "wav" => "wav",
        "flac" => "flac", "ogg" => "ogg", "opus" => "opus",
        "mp4" => "mp4", "webm" => "webm", "mkv" => "mkv",
        "mov" => "mov", "avi" => "avi",
        _ => "",
    }
}

fn validate_job(job: &MediaJob) -> Result<MediaKind, String> {
    let (kind, _) = output_spec(&job.target)?;
    if !matches!(job.profile.as_str(), "standard" | "small" | "high") {
        return Err("Unsupported quality preset".into());
    }
    for value in [job.start_seconds, job.duration_seconds].into_iter().flatten() {
        if !value.is_finite() || !(0.0..=86400.0).contains(&value) {
            return Err("Trim times must be within 0–86400 seconds".into());
        }
    }
    if job.duration_seconds == Some(0.0) {
        return Err("Trim duration must be above zero".into());
    }
    Ok(kind)
}

fn media_args(job: &MediaJob, input: &Path, stage: &Path) -> Result<Vec<OsString>, String> {
    let kind = validate_job(job)?;
    let mut args: Vec<OsString> = vec![
        "-hide_banner".into(), "-loglevel".into(), "error".into(),
        "-nostdin".into(), "-n".into(),
    ];
    if let Some(start) = job.start_seconds {
        args.extend(["-ss".into(), format!("{start:.3}").into()]);
    }
    args.extend(["-i".into(), input.as_os_str().to_os_string()]);
    if let Some(duration) = job.duration_seconds {
        args.extend(["-t".into(), format!("{duration:.3}").into()]);
    }
    // Explicit stream selection avoids accidental stream mapping.
    match kind {
        MediaKind::Audio => {
            args.extend(["-map".into(), "0:a:0".into(), "-vn".into()]);
            let codec = match job.target.as_str() {
                "mp3" => "libmp3lame",
                "m4a" => "aac",
                "wav" => "pcm_s16le",
                "flac" => "flac",
                "ogg" => "libvorbis",
                "opus" => "libopus",
                _ => unreachable!(),
            };
            args.extend(["-c:a".into(), codec.into()]);
            if matches!(job.target.as_str(), "mp3" | "m4a" | "ogg" | "opus") {
                let bitrate = match job.profile.as_str() {
                    "small" => "96k",
                    "high" => "256k",
                    _ => "160k",
                };
                args.extend(["-b:a".into(), bitrate.into()]);
            }
        }
        MediaKind::Video => {
            args.extend([
                "-map".into(), "0:v:0".into(),
                "-map".into(), "0:a:0?".into(),
            ]);
            let codec = match job.target.as_str() {
                "webm" => "libvpx-vp9",
                "avi" => "mpeg4",
                _ => "libx264",
            };
            args.extend(["-c:v".into(), codec.into()]);
            if job.target == "avi" {
                args.extend(["-q:v".into(), (match job.profile.as_str() {
                    "high" => "3", "small" => "8", _ => "5",
                }).into()]);
                args.extend(["-c:a".into(), "libmp3lame".into()]);
            } else {
                args.extend(["-crf".into(), (match job.profile.as_str() {
                    "small" => "32", "high" => "18", _ => "24",
                }).into()]);
                if job.target == "webm" {
                    args.extend(["-b:v".into(), "0".into(), "-c:a".into(), "libopus".into()]);
                } else {
                    args.extend([
                        "-preset".into(), "medium".into(),
                        "-pix_fmt".into(), "yuv420p".into(),
                        "-c:a".into(), "aac".into(),
                    ]);
                    if matches!(job.target.as_str(), "mp4" | "mov") {
                        args.extend(["-movflags".into(), "+faststart".into()]);
                    }
                }
            }
        }
    }
    args.push(stage.as_os_str().to_os_string());
    Ok(args)
}

fn probe(input: &Path, desired: MediaKind, ffprobe: &Path) -> Result<(), String> {
    let output = Command::new(ffprobe)
        .args(["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0"])
        .arg(input)
        .output()
        .map_err(|e| format!("Cannot probe media: {e}"))?;
    if !output.status.success() {
        return Err("Media file could not be inspected by FFprobe".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let kind = match desired { MediaKind::Audio => "audio", MediaKind::Video => "video" };
    if !text.lines().any(|line| line.trim() == kind) {
        return Err(format!("Input does not contain a {kind} stream"));
    }
    Ok(())
}

fn convert(job: MediaJob) -> Result<String, String> {
    let kind = validate_job(&job)?;
    let ffmpeg = find_binary("ffmpeg")
        .ok_or("FFmpeg is not installed. Install a licensed FFmpeg build and add ffmpeg.exe to PATH.")?;
    let ffprobe = find_binary("ffprobe")
        .ok_or("FFprobe is not installed. It normally comes with FFmpeg.")?;
    let input = PathBuf::from(&job.path);
    verify_input(&input, false)?;
    probe(&input, kind, &ffprobe)?;
    let directory = output_dir(&input, job.destination.as_deref())?;
    let staging = tempfile::Builder::new().prefix(".reformany-media-")
        .tempdir_in(&directory).map_err(|e| e.to_string())?;
    let stage = staging.path().join(format!("converted.{}", target_extension(&job.target)));
    let args = media_args(&job, &input, &stage)?;
    crate::external::run(&ffmpeg, &args, None)?;
    if fs::metadata(&stage).map_err(|_| "FFmpeg did not produce an output file".to_owned())?.len() == 0 {
        return Err("FFmpeg produced an empty file".into());
    }
    probe(&stage, kind, &ffprobe)?;
    let original = format_name(&input)?;
    publish(&stage, &directory, &original, target_extension(&job.target))
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn media_convert(job: MediaJob) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || convert(job))
        .await
        .map_err(|_| "Media conversion worker exited unexpectedly".to_owned())?
}


/// Tracks cancellable FFmpeg conversions. Separate from the original Orbit
/// command so the existing quick-convert contract remains compatible.
#[derive(Default)]
pub struct MediaJobs {
    pending: std::sync::Mutex<std::collections::HashMap<String,
        std::sync::Arc<std::sync::atomic::AtomicBool>>>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaProgress {
    id: String,
    status: &'static str,
    percent: Option<u8>,
    output_path: Option<String>,
    error: Option<String>,
}

fn media_event(app: &tauri::AppHandle, id: &str, status: &'static str,
    percent: Option<u8>, output_path: Option<String>, error: Option<String>) {
    use tauri::Emitter;
    let _ = app.emit("reformany:media-progress", MediaProgress {
        id: id.to_owned(), status, percent, output_path, error,
    });
}

/// FFmpeg emits real out_time_us=... values; progress never extrapolates from
/// arbitrary wall-clock time, and is omitted for media with unknown duration.
fn parse_progress(value: &str, duration: Option<f64>) -> Option<u8> {
    let duration = duration.filter(|v| v.is_finite() && *v > 0.0)?;
    let micros = value.strip_prefix("out_time_us=")?.parse::<u64>().ok()?;
    let seconds = micros as f64 / 1_000_000.0;
    Some(((seconds / duration) * 100.0).clamp(0.0, 99.0) as u8)
}

fn probe_duration(ffprobe: &Path, input: &Path) -> Option<f64> {
    let result = Command::new(ffprobe).args([
        "-v", "error", "-protocol_whitelist", "file,pipe,data,crypto",
        "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
    ]).arg(input).output().ok()?;
    if !result.status.success() { return None; }
    String::from_utf8_lossy(&result.stdout).trim().parse::<f64>()
        .ok().filter(|n| n.is_finite() && *n > 0.0)
}

fn convert_tracked(job: MediaJob, app: &tauri::AppHandle, id: &str,
    cancelled: &std::sync::atomic::AtomicBool) -> Result<String, String> {
    use std::io::{BufRead, Read, Seek, SeekFrom};
    use std::process::Stdio;
    use std::sync::atomic::Ordering;

    let kind = validate_job(&job)?;
    let ffmpeg = find_binary("ffmpeg").ok_or("FFmpeg is not installed")?;
    let ffprobe = find_binary("ffprobe").ok_or("FFprobe is not installed")?;
    let input = PathBuf::from(&job.path);
    verify_input(&input, false)?;
    probe(&input, kind, &ffprobe)?;
    let total_duration = job.duration_seconds.or_else(|| {
        probe_duration(&ffprobe, &input).map(|full| (full - job.start_seconds.unwrap_or(0.0)).max(0.0))
    });
    let directory = output_dir(&input, job.destination.as_deref())?;
    let stage = tempfile::Builder::new().prefix(".reformany-media-")
        .tempdir_in(&directory).map_err(|e| e.to_string())?;
    let intermediate = stage.path().join(format!("converted.{}", target_extension(&job.target)));
    let mut args = media_args(&job, &input, &intermediate)?;
    let file = args.pop().ok_or("Missing media output argument")?;
    args.extend(["-stats_period".into(), "0.2".into(),
        "-progress".into(), "pipe:1".into(), file]);

    if cancelled.load(Ordering::Relaxed) { return Err("cancelled".into()); }
    let stderr = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut child = Command::new(ffmpeg).args(args).stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(stderr.try_clone().map_err(|e| e.to_string())?)
        .spawn().map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let output = child.stdout.take().ok_or("Could not read FFmpeg progress")?;
    let app_for_progress = app.clone();
    let job_id = id.to_owned();
    let reader = std::thread::spawn(move || {
        let mut last_percent = None;
        for line in std::io::BufReader::new(output).lines().map_while(Result::ok) {
            if let Some(percent) = parse_progress(&line, total_duration) {
                if last_percent != Some(percent) {
                    last_percent = Some(percent);
                    media_event(&app_for_progress, &job_id, "processing", Some(percent), None, None);
                }
            }
        }
    });

    let status = loop {
        if cancelled.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("cancelled".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(90)),
            Err(e) => { let _ = child.kill(); let _ = reader.join(); return Err(e.to_string()); }
        }
    };
    let _ = reader.join();
    if !status.success() {
        let mut stderr = stderr;
        let mut detail = String::new();
        stderr.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        stderr.take(3000).read_to_string(&mut detail).map_err(|e| e.to_string())?;
        return Err(format!("FFmpeg failed: {}", detail.trim()));
    }
    if cancelled.load(Ordering::Relaxed) { return Err("cancelled".into()); }
    if !intermediate.is_file() || fs::metadata(&intermediate)
        .map_err(|e| e.to_string())?.len() == 0 {
        return Err("FFmpeg did not produce a media file".into());
    }
    probe(&intermediate, kind, &ffprobe)?;
    if cancelled.load(Ordering::Relaxed) { return Err("cancelled".into()); }
    let name = format_name(&input)?;
    publish(&intermediate, &directory, &name, target_extension(&job.target))
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn media_convert_tracked(app: tauri::AppHandle,
    state: tauri::State<'_, MediaJobs>, job: MediaJob, job_id: String) -> Result<String, String> {
    if uuid::Uuid::parse_str(&job_id).is_err() {
        return Err("Invalid conversion job identifier".into());
    }
    validate_job(&job)?;
    let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut jobs = state.pending.lock().map_err(|_| "Job state unavailable")?;
        if jobs.contains_key(&job_id) { return Err("A job with this ID is already running".into()); }
        if jobs.len() >= 2 { return Err("At most two media jobs may run at once".into()); }
        jobs.insert(job_id.clone(), cancelled.clone());
    }
    let id = job_id.clone();
    let worker_app = app.clone();
    tauri::async_runtime::spawn(async move {
        media_event(&worker_app, &id, "processing", None, None, None);
        let token = cancelled;
        let for_job = worker_app.clone();
        let current_id = id.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move ||
            convert_tracked(job, &for_job, &current_id, &token)
        ).await;
        match outcome {
            Ok(Ok(path)) => media_event(&worker_app, &id, "completed", Some(100), Some(path), None),
            Ok(Err(error)) if error == "cancelled" =>
                media_event(&worker_app, &id, "cancelled", None, None, None),
            Ok(Err(error)) => media_event(&worker_app, &id, "failed", None, None, Some(error)),
            Err(error) => media_event(&worker_app, &id, "failed", None, None, Some(error.to_string())),
        }
        use tauri::Manager;
        if let Ok(mut jobs) = worker_app.state::<MediaJobs>().pending.lock() {
            jobs.remove(&id);
        }
    });
    Ok(job_id)
}

#[tauri::command]
pub fn cancel_media_job(state: tauri::State<'_, MediaJobs>, job_id: String) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    let jobs = state.pending.lock().map_err(|_| "Job state unavailable")?;
    let cancelled = jobs.get(&job_id).ok_or("This media job already finished")?;
    cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(target: &str) -> MediaJob {
        MediaJob { path: "C:\\input.mov".into(), target: target.into(),
            destination: None, profile: "standard".into(), start_seconds: None,
            duration_seconds: None }
    }

    #[test]
    fn progress_uses_measured_ffmpeg_timestamps() {
        assert_eq!(parse_progress("out_time_us=5000000", Some(10.0)), Some(50));
        assert_eq!(parse_progress("out_time_us=20000000", Some(10.0)), Some(99));
        assert_eq!(parse_progress("out_time_us=5000000", None), None);
        assert_eq!(parse_progress("out_time_us=not-a-time", Some(10.0)), None);
    }

    #[test]
    fn output_profiles_have_explicit_codec_mappings() {
        for target in ["mp3","m4a","wav","flac","ogg","opus","mp4","webm","mkv","mov","avi"] {
            assert!(output_spec(target).is_ok(), "{target}");
            let args = media_args(&sample(target), Path::new("source"), Path::new("dest"))
                .unwrap();
            assert!(args.iter().any(|a| a == "-c:a"));
        }
        assert!(output_spec("exe").is_err());
    }

    #[test]
    fn trim_and_preset_validation_rejects_invalid_values() {
        let mut job = sample("mp4");
        job.start_seconds = Some(-1.0);
        assert!(validate_job(&job).is_err());
        job.start_seconds = Some(5.0);
        job.duration_seconds = Some(f64::INFINITY);
        assert!(validate_job(&job).is_err());
        job.duration_seconds = Some(2.0);
        job.profile = "custom command".into();
        assert!(validate_job(&job).is_err());
    }
    #[test]
    fn real_audio_transcode_when_ffmpeg_is_installed() {
        let (Some(ffmpeg), Some(_ffprobe)) = (find_binary("ffmpeg"), find_binary("ffprobe")) else {
            eprintln!("FFmpeg not installed; integration smoke test skipped");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("source.wav");
        let status = Command::new(ffmpeg)
            .args(["-nostdin", "-loglevel", "error", "-f", "lavfi",
                   "-i", "sine=frequency=440:duration=0.2",
                   "-c:a", "pcm_s16le", "-y"])
            .arg(&input).status().unwrap();
        assert!(status.success());
        let output = convert(MediaJob {
            path: input.to_string_lossy().into_owned(),
            target: "mp3".into(),
            destination: None, profile: "small".into(),
            start_seconds: None, duration_seconds: None,
        }).unwrap();
        assert!(Path::new(&output).is_file());
        assert!(fs::metadata(&output).unwrap().len() > 0);
    }

}
