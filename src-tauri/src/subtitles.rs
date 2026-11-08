//! Bounded SRT and WebVTT conversion without a network or web renderer.
//! Preserves timing and cue text. Unsupported WebVTT STYLE/REGION/NOTE blocks
//! and cue settings are rejected rather than being silently lost.
use crate::external::{output_dir, publish, verify_input};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleJob {
    path: String,
    target: String,
    destination: Option<String>,
}
#[derive(Debug, PartialEq)]
struct Cue { start: u64, end: u64, lines: Vec<String> }

fn parse_time(input: &str) -> Result<u64, String> {
    let value = input.trim();
    let (time, ms) = value.rsplit_once([',', '.'])
        .ok_or("Subtitle timestamp must contain milliseconds")?;
    if ms.len() != 3 || !ms.bytes().all(|c| c.is_ascii_digit()) {
        return Err("Subtitle milliseconds must contain exactly three digits".into());
    }
    let parts: Vec<&str> = time.split(':').collect();
    if !matches!(parts.len(), 2 | 3) || parts.iter().any(|p| p.len() != 2 || !p.bytes().all(|c| c.is_ascii_digit())) {
        return Err("Invalid subtitle timestamp".into());
    }
    let numbers: Vec<u64> = parts.iter().map(|p| p.parse::<u64>().unwrap_or(0)).collect();
    let (hours, minutes, seconds) = if numbers.len() == 3 {
        (numbers[0], numbers[1], numbers[2])
    } else { (0, numbers[0], numbers[1]) };
    if minutes > 59 || seconds > 59 || hours > 1000 { return Err("Subtitle timestamp out of range".into()); }
    Ok(((hours * 3600 + minutes * 60 + seconds) * 1000) + ms.parse::<u64>().unwrap_or(0))
}

fn output_time(ms: u64, separator: char) -> String {
    let seconds = ms / 1000;
    format!("{:02}:{:02}:{:02}{separator}{:03}",
        seconds / 3600, (seconds / 60) % 60, seconds % 60, ms % 1000)
}

fn parse_cues(input: &str, from_webvtt: bool) -> Result<Vec<Cue>, String> {
    let normalized = input.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let mut blocks = normalized.split("\n\n");
    if from_webvtt {
        let head = blocks.next().ok_or("Missing WebVTT header")?;
        if !head.trim_start().starts_with("WEBVTT") { return Err("Missing WEBVTT header".into()); }
        if head.lines().skip(1).any(|line| !line.trim().is_empty()) {
            return Err("WebVTT metadata is not supported for lossless conversion".into());
        }
    }
    let blocks: Vec<&str> = if from_webvtt { blocks.collect() } else { normalized.split("\n\n").collect() };
    let mut cues = Vec::new();
    for block in blocks {
        if block.trim().is_empty() { continue; }
        let mut lines = block.lines().filter(|l| !l.trim().is_empty());
        let first = lines.next().ok_or("Empty subtitle cue")?;
        if first.starts_with("NOTE") || first.starts_with("STYLE") || first.starts_with("REGION") {
            return Err("WebVTT notes/styles/regions cannot be represented safely in SRT".into());
        }
        let times = if first.contains("-->") { first } else {
            lines.next().ok_or("Subtitle cue missing a timing line")?
        };
        let (start, end) = times.split_once("-->")
            .ok_or("Subtitle cue missing timing arrow")?;
        let end = end.trim();
        if end.contains([' ', '\t']) {
            return Err("WebVTT cue positioning settings are not supported by SRT".into());
        }
        let start_ms = parse_time(start)?;
        let end_ms = parse_time(end)?;
        if end_ms <= start_ms { return Err("Subtitle cue ends before it starts".into()); }
        let payload: Vec<String> = lines.map(str::to_owned).collect();
        if payload.is_empty() { return Err("Subtitle cue has no text".into()); }
        cues.push(Cue { start: start_ms, end: end_ms, lines: payload });
        if cues.len() > 20_000 { return Err("Too many subtitle cues".into()); }
    }
    if cues.is_empty() { return Err("No subtitle cues found".into()); }
    Ok(cues)
}
fn render(cues: &[Cue], webvtt: bool) -> String {
    let mut output = if webvtt { "WEBVTT\n\n".to_owned() } else { String::new() };
    for (index, cue) in cues.iter().enumerate() {
        if !webvtt { output.push_str(&format!("{}\n", index + 1)); }
        let separator = if webvtt { '.' } else { ',' };
        output.push_str(&format!("{} --> {}\n",
            output_time(cue.start, separator), output_time(cue.end, separator)));
        output.push_str(&cue.lines.join("\n"));
        output.push_str("\n\n");
    }
    output
}

fn convert(job: SubtitleJob) -> Result<String, String> {
    let input = PathBuf::from(&job.path);
    verify_input(&input, false)?;
    let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(ext.as_str(), "srt" | "vtt") || !matches!(job.target.as_str(), "srt" | "vtt") {
        return Err("Subtitle conversion supports SRT and VTT".into());
    }
    if ext == job.target { return Err("Choose a different subtitle output format".into()); }
    let size = fs::metadata(&input).map_err(|e| e.to_string())?.len();
    if size > 4 * 1024 * 1024 { return Err("Subtitle files must be smaller than 4 MB".into()); }
    let contents = fs::read_to_string(&input)
        .map_err(|_| "Subtitle text is not valid UTF-8".to_owned())?;
    let cues = parse_cues(&contents, ext == "vtt")?;
    let rendered = render(&cues, job.target == "vtt");
    let reparsed = parse_cues(&rendered, job.target == "vtt")?;
    if reparsed != cues { return Err("Subtitle validation failed after conversion".into()); }
    let folder = output_dir(&input, job.destination.as_deref())?;
    let stage = tempfile::Builder::new().prefix(".reformany-sub-").tempdir_in(&folder)
        .map_err(|e| e.to_string())?;
    let file = stage.path().join(format!("output.{}", job.target));
    fs::write(&file, rendered).map_err(|e| e.to_string())?;
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("Subtitles");
    publish(&file, &folder, stem, &job.target)
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn subtitle_convert(job: SubtitleJob) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || convert(job))
        .await.map_err(|_| "Subtitle worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_srt_vtt_timing_and_unicode_text() {
        let srt = "1\n00:00:01,000 --> 00:00:03,120\nمرحبا بالعالم\n\n2\n00:01:03,030 --> 00:01:04,900\nHello\n";
        let cues = parse_cues(srt, false).unwrap();
        let vtt = render(&cues, true);
        assert!(vtt.starts_with("WEBVTT\n"));
        assert_eq!(parse_cues(&vtt, true).unwrap(), cues);
        assert_eq!(parse_cues(&render(&cues, false), false).unwrap(), cues);
    }
    #[test]
    fn rejects_unsupported_cue_settings_and_metadata() {
        assert!(parse_cues("WEBVTT\n\n00:01.000 --> 00:02.000 line:30%\nHi\n",true).is_err());
        assert!(parse_cues("WEBVTT\n\nNOTE note\nSome data\n",true).is_err());
        assert!(parse_time("00:61:00,000").is_err());
    }
    #[test]
    fn creates_real_vtt_without_overwriting_source() {
        let d=tempfile::tempdir().unwrap();
        let input=d.path().join("captions.srt");
        fs::write(&input,"1\n00:00:00,000 --> 00:00:01,500\nHello\n").unwrap();
        let target=convert(SubtitleJob {path:input.to_string_lossy().into_owned(),
            target:"vtt".into(),destination:None}).unwrap();
        assert!(fs::read_to_string(target).unwrap().contains("WEBVTT"));
        assert!(input.exists());
    }
}
