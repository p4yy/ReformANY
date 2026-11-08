use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageFormat, ImageReader, Rgb, RgbImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;
use uuid::Uuid;

const MAX_INPUT_BYTES: u64 = 150 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;
const MAX_BATCH: usize = 300;
const MAX_WORKERS: usize = 2;

#[derive(Default)]
pub struct BatchRegistry {
    batches: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    path: String,
    name: String,
    bytes: u64,
    detected: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionItem {
    id: String,
    path: String,
    target: String,
    quality: u8,
    matte: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    id: String,
    status: &'static str,
    output_path: Option<String>,
    error: Option<String>,
}

fn describe(path: &Path) -> Result<(u64, ImageFormat), String> {
    let metadata = std::fs::metadata(path).map_err(|_| "File could not be opened".to_owned())?;
    if !metadata.is_file() {
        return Err("This path is not a regular file".into());
    }
    if metadata.len() > MAX_INPUT_BYTES {
        return Err("File exceeds the 150 MB input limit".into());
    }
    let mut file = File::open(path).map_err(|_| "File could not be read".to_owned())?;
    let mut header = [0u8; 64];
    let len = file.read(&mut header).map_err(|_| "File could not be read".to_owned())?;
    let format = image::guess_format(&header[..len])
        .map_err(|_| "Unrecognized image signature".to_owned())?;
    if !matches!(format, ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP | ImageFormat::Bmp) {
        return Err("This image format is not supported yet".into());
    }
    Ok((metadata.len(), format))
}

fn format_name(format: ImageFormat) -> &'static str {
    match format {
        ImageFormat::Png => "PNG",
        ImageFormat::Jpeg => "JPEG",
        ImageFormat::WebP => "WebP",
        ImageFormat::Bmp => "BMP",
        _ => "Unsupported",
    }
}

#[tauri::command]
pub fn inspect_files(paths: Vec<String>) -> Vec<FileInfo> {
    paths.into_iter().take(MAX_BATCH).map(|value| {
        let path = PathBuf::from(&value);
        let name = path.file_name().map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| value.clone());
        match describe(&path) {
            Ok((bytes, format)) => FileInfo {
                path: value, name, bytes, detected: Some(format_name(format).into()), error: None,
            },
            Err(error) => FileInfo {
                path: value, name, bytes: 0, detected: None, error: Some(error),
            },
        }
    }).collect()
}

fn output_format(target: &str) -> Result<(ImageFormat, &'static str), String> {
    match target {
        "png" => Ok((ImageFormat::Png, "png")),
        "jpeg" => Ok((ImageFormat::Jpeg, "jpg")),
        "webp" => Ok((ImageFormat::WebP, "webp")),
        "bmp" => Ok((ImageFormat::Bmp, "bmp")),
        _ => Err("Requested output format is not supported".into()),
    }
}

fn flatten(image: &DynamicImage, dark: bool) -> RgbImage {
    let source = image.to_rgba8();
    let background = if dark { 0u32 } else { 255u32 };
    RgbImage::from_fn(source.width(), source.height(), |x, y| {
        let p = source.get_pixel(x, y).0;
        let alpha = p[3] as u32;
        let mix = |channel: u8| {
            ((channel as u32 * alpha + background * (255 - alpha) + 127) / 255) as u8
        };
        Rgb([mix(p[0]), mix(p[1]), mix(p[2])])
    })
}

fn convert_one(item: &ConversionItem, destination: Option<&str>, cancelled: &AtomicBool) -> Result<PathBuf, String> {
    if cancelled.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    let input = Path::new(&item.path);
    let _ = describe(input)?;
    let (target_format, ext) = output_format(&item.target)?;
    let directory = match destination {
        Some(path) => PathBuf::from(path),
        None => input.parent().ok_or("Input folder could not be determined")?.to_path_buf(),
    };
    if !directory.is_dir() {
        return Err("Output folder is not accessible".into());
    }

    let (width, height) = ImageReader::open(input)
        .map_err(|e| format!("Cannot open image: {e}"))?
        .with_guessed_format().map_err(|e| format!("Cannot inspect image: {e}"))?
        .into_dimensions().map_err(|e| format!("Cannot read image dimensions: {e}"))?;
    if width as u64 * height as u64 > MAX_PIXELS {
        return Err("Image exceeds the 40-megapixel processing limit".into());
    }
    let image = ImageReader::open(input).map_err(|e| e.to_string())?
        .with_guessed_format().map_err(|e| e.to_string())?
        .decode().map_err(|e| format!("Unable to decode image: {e}"))?;
    if cancelled.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }

    let mut temp = tempfile::Builder::new().prefix(".reformany-")
        .tempfile_in(&directory).map_err(|e| format!("Cannot create output: {e}"))?;
    if matches!(target_format, ImageFormat::Jpeg | ImageFormat::Bmp) {
        let flattened = DynamicImage::ImageRgb8(flatten(&image, item.matte == "black"));
        if target_format == ImageFormat::Jpeg {
            flattened.write_with_encoder(JpegEncoder::new_with_quality(
                temp.as_file_mut(), item.quality.clamp(1, 100)
            )).map_err(|e| format!("JPEG encoding failed: {e}"))?;
        } else {
            flattened.write_to(temp.as_file_mut(), target_format)
                .map_err(|e| format!("BMP encoding failed: {e}"))?;
        }
    } else {
        image.write_to(temp.as_file_mut(), target_format)
            .map_err(|e| format!("Image encoding failed: {e}"))?;
    }
    temp.as_file_mut().sync_all().map_err(|e| format!("Cannot flush output: {e}"))?;
    if cancelled.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    let verified = ImageReader::open(temp.path()).map_err(|e| e.to_string())?
        .with_guessed_format().map_err(|e| e.to_string())?
        .into_dimensions().map_err(|e| format!("Output verification failed: {e}"))?;
    if verified != (width, height) {
        return Err("Output dimensions failed verification".into());
    }
    let stem = input.file_stem().ok_or("Invalid input filename")?.to_string_lossy();
    // 'persist_noclobber' never replaces an existing file, even with concurrent workers.
    for suffix in 0..1000 {
        let name = if suffix == 0 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem} ({suffix}).{ext}")
        };
        let candidate = directory.join(name);
        match temp.persist_noclobber(&candidate) {
            Ok(_) => return Ok(candidate),
            Err(err) if err.error.kind() == std::io::ErrorKind::AlreadyExists => {
                temp = err.file;
            }
            Err(err) => return Err(format!("Cannot save output: {}", err.error)),
        }
    }
    Err("Too many files with the same output name".into())
}

fn emit(app: &AppHandle, id: &str, status: &'static str, output_path: Option<String>, error: Option<String>) {
    let _ = app.emit("reformany:conversion", ProgressEvent {
        id: id.to_owned(), status, output_path, error,
    });
}

#[tauri::command]
pub async fn convert_batch(
    app: AppHandle,
    state: State<'_, BatchRegistry>,
    files: Vec<ConversionItem>,
    destination: Option<String>,
) -> Result<String, String> {
    if files.is_empty() || files.len() > MAX_BATCH {
        return Err("Select between 1 and 300 files".into());
    }
    if let Some(ref dir) = destination {
        if !Path::new(dir).is_dir() { return Err("Choose an existing output folder".into()); }
    }
    for file in &files {
        if file.id.is_empty() { return Err("A conversion item is missing its ID".into()); }
        output_format(&file.target)?;
        if file.matte != "white" && file.matte != "black" {
            return Err("Unsupported transparency background".into());
        }
    }

    let batch_id = Uuid::new_v4().to_string();
    let cancelled = Arc::new(AtomicBool::new(false));
    state.batches.lock().map_err(|_| "Batch state is unavailable")?
        .insert(batch_id.clone(), cancelled.clone());

    let id_to_remove = batch_id.clone();
    let app_for_job = app.clone();
    let flags = cancelled.clone();

    // The registry is cleaned up by a finishing event handler below; no unbounded worker pool.
    tauri::async_runtime::spawn(async move {
        let semaphore = Arc::new(Semaphore::new(MAX_WORKERS));
        let mut handles = Vec::new();
        for item in files {
            let permit = match semaphore.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => break,
            };
            let app = app_for_job.clone();
            let flag = flags.clone();
            let dest = destination.clone();
            handles.push(tauri::async_runtime::spawn(async move {
                let _permit = permit;
                if flag.load(Ordering::Relaxed) {
                    emit(&app, &item.id, "cancelled", None, None);
                    return;
                }
                emit(&app, &item.id, "processing", None, None);
                let request = item.clone();
                let work_flag = flag.clone();
                let output = tauri::async_runtime::spawn_blocking(move ||
                    convert_one(&request, dest.as_deref(), &work_flag)
                ).await;
                match output {
                    Ok(Ok(path)) => emit(&app, &item.id, "completed", Some(path.to_string_lossy().to_string()), None),
                    Ok(Err(error)) if error == "cancelled" => emit(&app, &item.id, "cancelled", None, None),
                    Ok(Err(error)) => emit(&app, &item.id, "failed", None, Some(error)),
                    Err(error) => emit(&app, &item.id, "failed", None, Some(format!("Worker failed: {error}"))),
                }
            }));
        }
        for handle in handles { let _ = handle.await; }
        if let Ok(mut registry) = app_for_job.state::<BatchRegistry>().batches.lock() {
            registry.remove(&id_to_remove);
        }
        emit(&app_for_job, &id_to_remove, "batch-finished", None, None);
    });
    Ok(batch_id)
}

#[tauri::command]
pub fn cancel_batch(state: State<'_, BatchRegistry>, batch_id: String) -> Result<(), String> {
    let map = state.batches.lock().map_err(|_| "Batch state is unavailable")?;
    let flag = map.get(&batch_id).ok_or("Batch is no longer active")?;
    flag.store(true, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_without_overwriting_original() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("photo.png");
        DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(3, 2, image::Rgba([12, 23, 34, 100])))
            .save_with_format(&path, ImageFormat::Png).unwrap();
        let task = ConversionItem { id: "one".into(), path: path.to_string_lossy().into(),
            target: "jpeg".into(), quality: 83, matte: "white".into() };
        let flag = AtomicBool::new(false);
        let a = convert_one(&task, None, &flag).unwrap();
        let b = convert_one(&task, None, &flag).unwrap();
        assert_ne!(a, b);
        assert_eq!(image::image_dimensions(a).unwrap(), (3, 2));
        assert!(path.exists());
    }

    #[test]
    fn refuses_unsupported_format() {
        assert!(output_format("pdf").is_err());
    }
}
