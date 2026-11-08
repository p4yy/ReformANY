use crate::external::{find_binary, format_name, output_dir, publish, verify_input};
use serde::Deserialize;
use tauri::{AppHandle, State}; 
use std::sync::{Arc, atomic::AtomicBool};
use crate::engine_progress::{self, JobRegistry};
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
    #[serde(default)]
    progress_id: Option<String>,
}

/// Supported output profiles are explicit; arbitrary ffmpeg switches are never
/// forwarded to an external process.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum MediaKind { Audio, Video }

fn output_spec(target: &str) -> Result<(MediaKind, &'static str), String> {
    match target {
        "mp3" | "m4a" | "wav" | "flac" | "ogg" | "opus" | "aiff" | "wma" | "ac3" => Ok((MediaKind::Audio, target_extension(target))),
        "mp4" | "webm" | "mkv" | "mov" | "avi" | "wmv" | "gif" | "mp4_h265" => Ok((MediaKind::Video, target_extension(target))),
        _ => Err("Unsupported media destination format".into()),
    }
}

fn target_extension(target: &str) -> &'static str {
    match target {
        "mp3" => "mp3", "m4a" => "m4a", "wav" => "wav",
        "flac" => "flac", "ogg" => "ogg", "opus" => "opus",
        "aiff" => "aiff", "wma" => "wma", "ac3" => "ac3", "gif" => "gif", "wmv" => "wmv", "mp4_h265" => "mp4",\n        "mp4" => "mp4", "webm" => "webm", "mkv" => "mkv",
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
    args.extend([
        "-protocol_whitelist".into(), "file,pipe,data,crypto".into(),
        "-i".into(), input.as_os_str().to_os_string(),
    ]);
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
                "opus" => "libopus",\n                "aiff" => "pcm_s16be",\n                "wma" => "wmav2",\n                "ac3" => "ac3",
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
                "webm" => "libvpx-vp9",\n                "mp4_h265" => "libx265",\n                "wmv" => "wmv2",\n                "gif" => "gif",
                "avi" => "mpeg4",
                _ => "libx264",
            };
            args.extend(["-c:v".into(), codec.into()]);
            if job.target == "gif" {\n                args.extend(["-an".into(), "-vf".into(), "fps=12,scale=640:-1:flags=lanczos".into()]);\n            } else if job.target == "wmv" {\n                args.extend(["-b:v".into(), "2500k".into(), "-c:a".into(), "wmav2".into()]);\n            } else if job.target == "avi" {
                args.extend(["-q:v".into(), (match job.profile.as_str() {
                    "high" => "3", "small" => "8", _ => "5",
                }).into()]);
                args.extend(["-c:a".into(), "libmp3lame".into()]);
            } else {
                args.extend(["-crf".into(), (match job.profile.as_str() {
                    "small" => "32", "high" => "18", _ => "24",
                }).into()]);
                if job.target == "mp4_h265" {\n                    args.extend(["-preset".into(), "medium".into(), "-tag:v".into(), "hvc1".into(), "-pix_fmt".into(), "yuv420p".into(), "-c:a".into(), "aac".into(), "-movflags".into(), "+faststart".into()]);\n                } else if job.target == "webm" {
                    args.extend(["-b:v".into(), "0".into(), "-row-mt".into(), "1".into(), "-cpu-used".into(), "4".into(), "-c:a".into(), "libopus".into()]);
                } else {
                    args.extend([
                        "-preset".into(), "veryfast".into(),
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
        .args(["-v", "error", "-protocol_whitelist", "file,pipe,data,crypto",
            "-show_entries", "stream=codec_type", "-of", "csv=p=0"])
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

fn media_duration(input: &Path, ffprobe: &Path) -> Option<f64> {
    let output = Command::new(ffprobe).args([
        "-v", "error", "-protocol_whitelist", "file,pipe,data,crypto",
        "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
    ]).arg(input).output().ok()?;
    if !output.status.success() { return None; }
    String::from_utf8_lossy(&output.stdout).trim().parse::<f64>()
        .ok().filter(|d| d.is_finite() && *d > 0.0)
}
fn convert_with_monitor(job: MediaJob, cancellation: Option<Arc<AtomicBool>>,
    app: Option<AppHandle>) -> Result<String, String> {
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
    let flag = cancellation.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    let total = media_duration(&input, &ffprobe).map(|d| {
        let start = job.start_seconds.unwrap_or(0.0);
        job.duration_seconds.unwrap_or((d - start).max(0.0)).min((d - start).max(0.0))
    }).filter(|d| *d > 0.0);
    if let (Some(app), Some(id)) = (&app, &job.progress_id) {
        engine_progress::emit(app, id, None, "encoding");
    }
    engine_progress::run_ffmpeg(&ffmpeg, &args, total, &flag, |value| {
        if let (Some(app), Some(id)) = (&app, &job.progress_id) {
            engine_progress::emit(app, id, value, "encoding");
        }
    })?;
    if flag.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    if fs::metadata(&stage).map_err(|_| "FFmpeg did not produce an output file".to_owned())?.len() == 0 {
        return Err("FFmpeg produced an empty file".into());
    }
    probe(&stage, kind, &ffprobe)?;
    let original = format_name(&input)?;
    let output = publish(&stage, &directory, &original, target_extension(&job.target))
        .map(|p| p.to_string_lossy().into_owned())?;
    if let (Some(app),Some(id)) = (&app,&job.progress_id) {
        engine_progress::emit(app,id,Some(100),"completed");
    }
    Ok(output)
}

#[cfg(test)]
fn convert(job: MediaJob) -> Result<String, String> {
    convert_with_monitor(job,None,None)
}

#[tauri::command]
pub async fn media_convert(app: AppHandle, registry: State<'_,JobRegistry>,
    job: MediaJob) -> Result<String, String> {
    let id = job.progress_id.clone();
    let token = if let Some(ref id) = id {
        Some(registry.insert(id)?)
    } else { None };
    let result = tauri::async_runtime::spawn_blocking(move ||
        convert_with_monitor(job,token,Some(app))
    ).await.map_err(|_| "Media conversion worker exited unexpectedly".to_owned())?;
    if let Some(ref id) = id { registry.remove(id); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(target: &str) -> MediaJob {
        MediaJob { path: "C:\\input.mov".into(), target: target.into(),
            destination: None, profile: "standard".into(), start_seconds: None,
            duration_seconds: None, progress_id: None }
    }

    #[test]
    fn output_profiles_have_explicit_codec_mappings() {
        for target in ["mp3","m4a","wav","flac","ogg","opus","aiff","wma","ac3","mp4","mp4_h265","webm","mkv","mov","avi","wmv","gif"] {
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
            start_seconds: None, duration_seconds: None, progress_id: None,
        }).unwrap();
        assert!(Path::new(&output).is_file());
        assert!(fs::metadata(&output).unwrap().len() > 0);
    }

}
