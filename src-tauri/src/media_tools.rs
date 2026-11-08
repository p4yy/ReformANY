use crate::external::{find_binary, format_name, output_dir, publish, verify_input};
use serde::Deserialize;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaToolJob {
    paths: Vec<String>,
    action: String,
    destination: Option<String>,
}
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum StreamKind { Audio, Video }

fn spec(action: &str) -> Result<(StreamKind, &'static str, bool), String> {
    match action {
        "compress-video" | "rotate-video" | "flip-video" | "flip-vertical" => Ok((StreamKind::Video, "mp4", false)),
        "compress-audio" | "merge-audio" => Ok((StreamKind::Audio, "mp3", action == "merge-audio")),
        "normalize-audio" => Ok((StreamKind::Audio, "wav", false)),
        "merge-video" => Ok((StreamKind::Video, "mp4", true)),
        "strip-metadata" => Ok((StreamKind::Audio, "", false)),
        _ => Err("Unsupported media editing tool".into()),
    }
}
fn validate(job: &MediaToolJob) -> Result<(), String> {
    let (_, _, merging) = spec(&job.action)?;
    if merging {
        if !(2..=12).contains(&job.paths.len()) {
            return Err("Merge requires 2 to 12 files".into());
        }
    } else if job.paths.len() != 1 {
        return Err("This editing action requires exactly one file".into());
    }
    for source in &job.paths {
        verify_input(Path::new(source), false)?;
    }
    Ok(())
}
fn has_stream(file: &Path, kind: StreamKind, ffprobe: &Path) -> Result<bool, String> {
    let result = Command::new(ffprobe)
        .args(["-v", "error", "-protocol_whitelist", "file,pipe,data,crypto",
            "-show_entries", "stream=codec_type", "-of", "csv=p=0"])
        .arg(file).output().map_err(|e| format!("FFprobe unavailable: {e}"))?;
    if !result.status.success() { return Err("Cannot inspect source media".into()); }
    let expected = if kind == StreamKind::Audio {"audio"} else {"video"};
    Ok(String::from_utf8_lossy(&result.stdout).lines().any(|line| line.trim() == expected))
}
fn media_tool(job: MediaToolJob) -> Result<String, String> {
    validate(&job)?;
    let ffmpeg = find_binary("ffmpeg").ok_or("FFmpeg is not installed")?;
    let ffprobe = find_binary("ffprobe").ok_or("FFprobe is not installed")?;
    let (kind, ext, _merging) = spec(&job.action)?;
    let inputs: Vec<PathBuf> = job.paths.iter().map(PathBuf::from).collect();
    if job.action != "strip-metadata" {
        for input in &inputs {
            if !has_stream(input, kind, &ffprobe)? {
                return Err("A selected file is missing the required media stream".into());
            }
            if job.action == "merge-video" && !has_stream(input, StreamKind::Audio, &ffprobe)? {
                return Err("Video merging requires an audio track in every clip".into());
            }
        }
    }
    let actual_ext = if job.action == "strip-metadata" {
        let source_ext = inputs[0].extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
        if !matches!(source_ext.as_str(), "mp4" | "mov" | "mkv" | "webm" | "avi" |
            "mp3" | "m4a" | "wav" | "flac" | "ogg" | "opus") {
            return Err("This container is not supported for metadata stripping".into());
        }
        source_ext
    } else { ext.to_owned() };
    let dir = output_dir(&inputs[0], job.destination.as_deref())?;
    let stage = tempfile::Builder::new().prefix(".reformany-edit-")
        .tempdir_in(&dir).map_err(|e| e.to_string())?;
    let temporary = stage.path().join(format!("result.{actual_ext}"));
    let mut args: Vec<OsString> = vec![
        "-hide_banner".into(), "-loglevel".into(), "error".into(),
        "-nostdin".into(), "-n".into(),
    ];
    for input in &inputs {
        // Prevent referenced network streams within local playlist files.
        args.push("-protocol_whitelist".into());
        args.push("file,pipe,data,crypto".into());
        args.push("-i".into());
        args.push(input.as_os_str().to_os_string());
    }
    match job.action.as_str() {
        "compress-video" => {
            args.extend([
                "-map".into(), "0:v:0".into(), "-map".into(), "0:a:0?".into(),
                "-c:v".into(), "libx264".into(), "-preset".into(), "medium".into(),
                "-crf".into(), "30".into(), "-pix_fmt".into(), "yuv420p".into(),
                "-c:a".into(), "aac".into(), "-b:a".into(), "96k".into(),
                "-movflags".into(), "+faststart".into(),
            ]);
        }
        "compress-audio" => {
            args.extend(["-map".into(), "0:a:0".into(), "-vn".into(),
                "-c:a".into(), "libmp3lame".into(), "-b:a".into(), "96k".into()]);
        }
        "normalize-audio" => {
            args.extend(["-map".into(), "0:a:0".into(), "-vn".into(),
                "-af".into(), "loudnorm=I=-16:TP=-1.5:LRA=11".into(),
                "-ar".into(), "48000".into(), "-c:a".into(), "pcm_s16le".into()]);
        }
        "rotate-video" | "flip-video" | "flip-vertical" => {
            let filter = match job.action.as_str() {
                "rotate-video" => "transpose=clock",
                "flip-video" => "hflip",
                _ => "vflip",
            };
            args.extend(["-map".into(), "0:v:0".into(), "-map".into(), "0:a:0?".into(),
                "-vf".into(), filter.into(), "-c:v".into(), "libx264".into(),
                "-crf".into(), "23".into(), "-preset".into(), "medium".into(),
                "-pix_fmt".into(), "yuv420p".into(), "-c:a".into(), "aac".into(),
                "-movflags".into(), "+faststart".into()]);
        }
        "strip-metadata" => {
            args.extend(["-map".into(), "0".into(), "-map_metadata".into(), "-1".into(),
                "-map_chapters".into(), "-1".into(), "-c".into(), "copy".into()]);
        }
        "merge-audio" => {
            let mut tags = String::new();
            for i in 0..inputs.len() { tags.push_str(&format!("[{i}:a:0]")); }
            tags.push_str(&format!("concat=n={}:v=0:a=1[a]", inputs.len()));
            args.extend(["-filter_complex".into(), tags.into(), "-map".into(), "[a]".into(),
                "-c:a".into(), "libmp3lame".into(), "-b:a".into(), "192k".into()]);
        }
        "merge-video" => {
            // Normalize dimensions/fps for concat. No hidden audio loss:
            // every source needs video AND audio. Output is a new 720p file.
            let mut filters = String::new();
            for i in 0..inputs.len() {
                filters.push_str(&format!(
                    "[{i}:v:0]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[v{i}];"
                ));
                filters.push_str(&format!("[{i}:a:0]aresample=48000[a{i}];"));
            }
            for i in 0..inputs.len() { filters.push_str(&format!("[v{i}][a{i}]")); }
            filters.push_str(&format!("concat=n={}:v=1:a=1[v][a]", inputs.len()));
            args.extend(["-filter_complex".into(), filters.into(), "-map".into(), "[v]".into(),
                "-map".into(), "[a]".into(), "-c:v".into(), "libx264".into(),
                "-preset".into(), "medium".into(), "-crf".into(), "24".into(),
                "-pix_fmt".into(), "yuv420p".into(), "-c:a".into(), "aac".into(),
                "-b:a".into(), "160k".into(), "-movflags".into(), "+faststart".into()]);
        }
        _ => unreachable!(),
    }
    args.push(temporary.as_os_str().to_os_string());
    crate::external::run(&ffmpeg, &args, None)?;
    if !temporary.is_file() || fs::metadata(&temporary).map_err(|e| e.to_string())?.len() == 0 {
        return Err("FFmpeg produced no output".into());
    }
    let verification = Command::new(&ffprobe)
        .args(["-v", "error", "-protocol_whitelist", "file,pipe,data,crypto",
            "-show_entries", "format=format_name",
            "-of", "default=nw=1"])
        .arg(&temporary).output().map_err(|e| e.to_string())?;
    if !verification.status.success() || verification.stdout.is_empty() {
        return Err("Could not verify resulting media file".into());
    }
    let stem = format_name(&inputs[0])?;
    let label = match job.action.as_str() {
        "compress-video" | "compress-audio" => "compressed",
        "normalize-audio" => "normalized",
        "rotate-video" => "rotated",
        "flip-video" | "flip-vertical" => "flipped",
        "merge-video" | "merge-audio" => "merged",
        "strip-metadata" => "cleaned",
        _ => "result",
    };
    publish(&temporary, &dir, &format!("{stem} {label}"), &actual_ext)
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn media_edit(job: MediaToolJob) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || media_tool(job))
        .await.map_err(|_| "Media editing worker ended unexpectedly".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn editing_options_are_an_explicit_allowlist() {
        for action in ["compress-video", "compress-audio", "normalize-audio",
            "merge-audio", "merge-video", "rotate-video", "flip-video",
            "flip-vertical", "strip-metadata"] {
            assert!(spec(action).is_ok(), "{action}");
        }
        assert!(spec("exec-command").is_err());
    }
    #[test]
    fn merging_is_always_explicit() {
        assert!(spec("merge-audio").unwrap().2);
        assert!(spec("merge-video").unwrap().2);
        assert!(!spec("compress-video").unwrap().2);
    }
}
