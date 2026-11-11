use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct JobRegistry {
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineProgress {
    pub id: String,
    pub percent: Option<u8>,
    pub phase: &'static str,
}

impl JobRegistry {
    pub fn insert(&self, id: &str) -> Result<Arc<AtomicBool>, String> {
        if id.is_empty() || id.len() > 80 ||
            !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
            return Err("Invalid job ID".into());
        }
        let mut jobs = self.jobs.lock().map_err(|_| "Job state locked")?;
        if jobs.len() >= 2 { return Err("Only two long-running conversions can run simultaneously".into()); }
        if jobs.contains_key(id) { return Err("Job ID already active".into()); }
        let token = Arc::new(AtomicBool::new(false));
        jobs.insert(id.to_owned(), token.clone());
        Ok(token)
    }
    pub fn remove(&self, id: &str) {
        if let Ok(mut lock) = self.jobs.lock() { lock.remove(id); }
    }
}
#[tauri::command]
pub fn cancel_engine_job(state: State<'_, JobRegistry>, id: String) -> Result<(), String> {
    let lock = state.jobs.lock().map_err(|_| "Job state unavailable")?;
    let token = lock.get(&id).ok_or("Job already finished")?;
    token.store(true, Ordering::Relaxed);
    Ok(())
}
pub fn emit(app: &AppHandle, id: &str, percent: Option<u8>, phase: &'static str) {
    let _ = app.emit("reformany:engine-progress",
        EngineProgress { id: id.to_owned(), percent, phase });
}

pub fn parse_percent(line: &str, duration: f64) -> Option<u8> {
    if !duration.is_finite() || duration <= 0.0 { return None; }
    let encoded = line.strip_prefix("out_time_us=")
        .or_else(|| line.strip_prefix("out_time_ms="))?;
    let micros: f64 = encoded.trim().parse().ok()?;
    let percent = (micros / (duration * 1_000_000.0) * 100.0).floor();
    if !percent.is_finite() { return None; }
    Some(percent.clamp(0.0, 98.0) as u8)
}

/// Spawn FFmpeg with a progress channel. Only FFmpeg time-based media progress
/// is shown numerically. Formats with no duration remain indeterminate.
/// Cancellation terminates and reaps the child before a staged output is saved.
pub fn run_ffmpeg(
    program: &Path, args: &[OsString], duration: Option<f64>,
    cancelled: &AtomicBool, mut progress: impl FnMut(Option<u8>),
) -> Result<(), String> {
    if cancelled.load(Ordering::Relaxed) { return Err("cancelled".into()); }
    let stderr = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut command = Command::new(program);
    crate::external::hide_subprocess_window(&mut command);
    command.args(["-progress", "pipe:1", "-nostats"])
        .args(args).stdin(Stdio::null()).stdout(Stdio::piped())
        .stderr(stderr.try_clone().map_err(|e| e.to_string())?);
    let mut child = command.spawn().map_err(|e| format!("Cannot start FFmpeg: {e}"))?;
    let stdout = child.stdout.take().ok_or("Cannot read FFmpeg progress")?;
    let (tx, rx) = mpsc::sync_channel::<String>(64);
    let reader = thread::spawn(move || {
        for line in std::io::BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if tx.try_send(line).is_err() { /* Slow readers need only the latest updates. */ }
        }
    });
    let mut last = None;
    let finished = loop {
        while let Ok(line) = rx.try_recv() {
            if let Some(value) = duration.and_then(|d| parse_percent(&line, d)) {
                if last != Some(value) {
                    last = Some(value);
                    progress(Some(value));
                }
            }
        }
        if cancelled.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("cancelled".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(75)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err(format!("Cannot monitor FFmpeg: {error}"));
            }
        }
    };
    let _ = reader.join();
    if finished.success() {
        return Ok(());
    }
    let mut log = stderr;
    log.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut reason = String::new();
    log.take(2400).read_to_string(&mut reason).map_err(|e| e.to_string())?;
    Err(if reason.trim().is_empty() {
        format!("FFmpeg failed ({finished})")
    } else { format!("FFmpeg failed: {}", reason.trim()) })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ffmpeg_progress_is_timestamp_based_not_an_estimate() {
        assert_eq!(parse_percent("out_time_us=2500000",10.0),Some(25));
        assert_eq!(parse_percent("out_time_ms=10000000",10.0),Some(98));
        assert_eq!(parse_percent("frame=12",10.0),None);
        assert_eq!(parse_percent("out_time_us=5000000",0.0),None);
    }
    #[test]
    fn cancellation_tokens_are_bounded_and_unique() {
        let r=JobRegistry::default();
        let item=r.insert("test-job").unwrap();
        assert!(r.insert("test-job").is_err());
        item.store(true,Ordering::Relaxed);
        assert!(item.load(Ordering::Relaxed));
        r.remove("test-job");
        assert!(r.insert("test-job").is_ok());
    }
}
