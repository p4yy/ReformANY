//! Offline, validated timed-text conversion. Deliberately limited to SRT and
//! WebVTT cues: ASS formatting, WebVTT STYLE/REGION and embedded media are not
//! silently represented as if their formatting had been preserved.
use crate::external::{output_dir, publish, verify_input};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_SUBTITLE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_CUES: usize = 25_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleJob {
    path: String,
    target: String,
    destination: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Cue {
    start_ms: u64,
    end_ms: u64,
    text: String,
}

fn timestamp(input: &str) -> Result<u64, String> {
    let normalized = input.trim().replace(',', ".");
    let (clock, ms) = normalized.rsplit_once('.').ok_or("Timestamp needs milliseconds")?;
    if ms.len() != 3 || !ms.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Timestamp milliseconds must have three digits".into());
    }
    let sections: Vec<&str> = clock.split(':').collect();
    if sections.len() < 2 || sections.len() > 3 {
        return Err("Timestamp must use MM:SS.mmm or HH:MM:SS.mmm".into());
    }
    if sections.iter().any(|v| v.is_empty() || !v.bytes().all(|b| b.is_ascii_digit())) {
        return Err("Timestamp contains invalid characters".into());
    }
    let (hours, minutes, seconds) = if sections.len() == 3 {
        (sections[0].parse::<u64>().map_err(|_| "Hours out of range")?,
         sections[1].parse::<u64>().map_err(|_| "Minutes out of range")?,
         sections[2].parse::<u64>().map_err(|_| "Seconds out of range")?)
    } else {
        (0, sections[0].parse::<u64>().map_err(|_| "Minutes out of range")?,
            sections[1].parse::<u64>().map_err(|_| "Seconds out of range")?)
    };
    if seconds >= 60 || (sections.len() == 3 && minutes >= 60) || hours > 999 {
        return Err("Timestamp is outside supported range".into());
    }
    (hours * 3600 + minutes * 60 + seconds)
        .checked_mul(1000)
        .and_then(|value| value.checked_add(ms.parse::<u64>().ok()?))
        .ok_or_else(|| "Timestamp overflows".into())
}

fn format_timestamp(ms: u64, vtt: bool) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms / 60_000) % 60;
    let seconds = (ms / 1000) % 60;
    let fractions = ms % 1000;
    if vtt {
        format!("{hours:02}:{minutes:02}:{seconds:02}.{fractions:03}")
    } else {
        format!("{hours:02}:{minutes:02}:{seconds:02},{fractions:03}")
    }
}

fn parse(text: &str, source: &str) -> Result<Vec<Cue>, String> {
    let normalized = text.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = if source == "vtt" {
        let value = normalized.trim_start();
        if !value.starts_with("WEBVTT") ||
            !value[6..].chars().next().is_none_or(|c| c.is_whitespace()) {
            return Err("Invalid WebVTT header".into());
        }
        // Skip initial header line and optional metadata, but reject styling
        // blocks rather than stripping visual information without warning.
        value.lines().skip(1).collect::<Vec<_>>().join("\n")
    } else {
        normalized
    };
    if trimmed.lines().any(|line| {
        let t = line.trim();
        t == "STYLE" || t == "REGION" || t.starts_with("NOTE")
    }) {
        return Err("WebVTT notes, regions or styles require a richer converter".into());
    }

    let mut cues = Vec::new();
    for block in trimmed.split("\n\n").map(str::trim).filter(|s| !s.is_empty()) {
        let mut lines = block.lines();
        let first = lines.next().ok_or("Empty cue")?;
        let timing_line = if first.contains("-->") {
            first
        } else {
            lines.next().ok_or("Cue has no timing line")?
        };
        let (from, to) = timing_line.split_once("-->").ok_or("Cue is missing --> timing marker")?;
        let to = to.trim();
        // VTT position/align settings are not preserved, so reject them.
        let after: Vec<_> = to.split_whitespace().collect();
        if after.len() != 1 {
            return Err("Cue settings cannot be faithfully converted".into());
        }
        let start_ms = timestamp(from)?;
        let end_ms = timestamp(after[0])?;
        if end_ms <= start_ms {
            return Err("Cue end time must be later than its start".into());
        }
        let body = lines.collect::<Vec<_>>().join("\n");
        if body.trim().is_empty() { return Err("Cue has no text".into()); }
        cues.push(Cue { start_ms, end_ms, text: body });
        if cues.len() > MAX_CUES { return Err("Too many subtitle cues".into()); }
    }
    if cues.is_empty() { return Err("No subtitle cues were found".into()); }
    Ok(cues)
}

fn serialize(cues: &[Cue], target: &str) -> String {
    let mut result = if target == "vtt" { "WEBVTT\n\n".to_string() } else { String::new() };
    for (i, cue) in cues.iter().enumerate() {
        if target == "srt" { result.push_str(&format!("{}\n", i + 1)); }
        result.push_str(&format!(
            "{} --> {}\n{}\n\n",
            format_timestamp(cue.start_ms, target == "vtt"),
            format_timestamp(cue.end_ms, target == "vtt"),
            cue.text
        ));
    }
    result
}

fn convert(job: SubtitleJob) -> Result<String, String> {
    if !matches!(job.target.as_str(), "srt" | "vtt") {
        return Err("Subtitle output must be SRT or WebVTT".into());
    }
    let input = PathBuf::from(&job.path);
    verify_input(&input, false)?;
    let source = input.extension().and_then(|e| e.to_str())
        .unwrap_or("").to_ascii_lowercase();
    if !matches!(source.as_str(), "srt" | "vtt") {
        return Err("Choose a .srt or .vtt subtitle file".into());
    }
    if fs::metadata(&input).map_err(|e| e.to_string())?.len() > MAX_SUBTITLE_BYTES {
        return Err("Subtitles exceed the 10 MB preview limit".into());
    }
    let bytes = fs::read(&input).map_err(|e| e.to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "Subtitles must be UTF-8".to_owned())?;
    let cues = parse(&text, &source)?;
    let destination = output_dir(&input, job.destination.as_deref())?;
    let stage = tempfile::Builder::new().prefix(".reformany-subtitles-")
        .tempdir_in(&destination).map_err(|e| e.to_string())?;
    let staging = stage.path().join(format!("output.{}", job.target));
    fs::write(&staging, serialize(&cues, &job.target)).map_err(|e| e.to_string())?;
    let stem = input.file_stem().and_then(|s| s.to_str()).ok_or("Invalid subtitle filename")?;
    publish(&staging, &destination, stem, &job.target)
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn subtitle_convert(job: SubtitleJob) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || convert(job))
        .await.map_err(|_| "Subtitle conversion worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_srt_to_vtt_and_back_without_losing_timing() {
        let input = "1\r\n00:00:01,002 --> 00:00:04,230\r\nHello, world!\r\nمرحبا\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,010\r\nNext cue\r\n";
        let cues = parse(input, "srt").unwrap();
        assert_eq!(cues.len(), 2);
        let vtt = serialize(&cues, "vtt");
        assert!(vtt.starts_with("WEBVTT\n\n"));
        let round = parse(&vtt, "vtt").unwrap();
        assert_eq!(cues, round);
        assert!(serialize(&round, "srt").contains("00:00:01,002"));
    }

    #[test]
    fn rejects_inaccurate_or_unsupported_timed_text() {
        assert!(parse("1\n00:00:05,000 --> 00:00:02,000\nBroken\n", "srt").is_err());
        assert!(parse("WEBVTT\n\nSTYLE\n::cue { color: red; }\n", "vtt").is_err());
        assert!(parse("WEBVTT\n\n00:01.000 --> 00:03.000 align:start\nHi", "vtt").is_err());
    }

    #[test]
    fn output_never_overwrites_original() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("demo.srt");
        let original = "1\n00:00:01,000 --> 00:00:02,000\nHello\n";
        fs::write(&source, original).unwrap();
        let destination = convert(SubtitleJob { path: source.to_string_lossy().into_owned(),
            target: "srt".into(), destination: None }).unwrap();
        assert_ne!(source.to_string_lossy(), destination);
        assert_eq!(fs::read_to_string(source).unwrap(), original);
    }
}
