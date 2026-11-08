//! Narrow, explicit extensions for static vector/ICO and optional specialist
//! photo decoding. Each route is visible only as a specific operation; this is
//! not a claim of universal HEIC/camera-RAW support.
use crate::external::{find_binary, output_dir, publish, verify_input};
use image::{DynamicImage, GenericImageView, ImageFormat, ImageReader};
use serde::Deserialize;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

const MAX_IMAGE_BYTES: u64 = 150 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;
const MAX_SVG_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedImageJob {
    path: String,
    target: String,
    destination: Option<String>,
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

fn route(source: &str, target: &str) -> Result<&'static str, String> {
    match (source, target) {
        ("svg", "png") => Ok("svg-raster"),
        ("ico", "png") => Ok("ico-read"),
        ("png" | "jpg" | "jpeg" | "webp" | "bmp", "ico") => Ok("ico-write"),
        ("png" | "jpg" | "jpeg" | "webp", "avif") => Ok("ffmpeg-avif"),
        ("avif" | "heic" | "heif" | "dng" | "cr2" | "nef" | "arw", "png") => Ok("ffmpeg-photo"),
        _ => Err("This image route is not available. RAW/HEIC decoding depends on your installed FFmpeg codecs.".into()),
    }
}

fn open_raster(input: &Path) -> Result<DynamicImage, String> {
    let dims = ImageReader::open(input).map_err(|e| e.to_string())?
        .with_guessed_format().map_err(|e| e.to_string())?
        .into_dimensions().map_err(|e| format!("Cannot inspect dimensions: {e}"))?;
    if dims.0 as u64 * dims.1 as u64 > MAX_PIXELS {
        return Err("Image exceeds the 40 MP safety limit".into());
    }
    ImageReader::open(input).map_err(|e| e.to_string())?
        .with_guessed_format().map_err(|e| e.to_string())?
        .decode().map_err(|e| format!("Cannot decode image: {e}"))
}

fn write_icon(source: &Path, output: &Path) -> Result<(), String> {
    let image = open_raster(source)?;
    let image = if image.width() > 256 || image.height() > 256 {
        image.thumbnail(256, 256)
    } else { image };
    let (width, height) = image.dimensions();
    let mut cursor = Cursor::new(Vec::<u8>::new());
    image.write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| format!("Could not encode icon image: {e}"))?;
    let bytes = cursor.into_inner();
    let length = u32::try_from(bytes.len()).map_err(|_| "Icon output is too large")?;
    let mut ico = Vec::with_capacity(bytes.len() + 22);
    ico.extend_from_slice(&[0, 0, 1, 0, 1, 0]); // ICO header
    ico.push(if width == 256 { 0 } else { width as u8 });
    ico.push(if height == 256 { 0 } else { height as u8 });
    ico.extend_from_slice(&[0, 0, 1, 0, 32, 0]); // 1 plane, 32 bpp
    ico.extend_from_slice(&length.to_le_bytes());
    ico.extend_from_slice(&22u32.to_le_bytes());
    ico.extend_from_slice(&bytes);
    fs::write(output, ico).map_err(|e| e.to_string())
}

fn render_svg(source: &Path, output: &Path) -> Result<(), String> {
    let contents = fs::read(source).map_err(|e| e.to_string())?;
    if contents.len() as u64 > MAX_SVG_BYTES {
        return Err("SVG exceeds the 4 MB safety limit".into());
    }
    let lower = String::from_utf8_lossy(&contents).to_ascii_lowercase();
    // SVG is user-supplied XML. Never permit external file/URL references,
    // XML entities, scripts, foreignObject or CSS imports into the renderer.
    for blocked in ["<!doctype", "<!entity", "<script", "<foreignobject",
        "javascript:", "file:", "@import", "xlink:href=\"/",
        "href=\"/", "href='../", "href=\"../"] {
        if lower.contains(blocked) {
            return Err("SVG includes external or executable content that cannot be safely rendered".into());
        }
    }
    let options = resvg::usvg::Options {
        resources_dir: None,
        ..resvg::usvg::Options::default()
    };
    let tree = resvg::usvg::Tree::from_data(&contents, &options)
        .map_err(|e| format!("Invalid SVG: {e}"))?;
    let size = tree.size();
    let width = size.width();
    let height = size.height();
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err("SVG dimensions are invalid".into());
    }
    let scale = (2048.0 / width.max(height)).min(1.0);
    let actual_width = (width * scale).ceil() as u32;
    let actual_height = (height * scale).ceil() as u32;
    if actual_width == 0 || actual_height == 0 ||
        actual_width as u64 * actual_height as u64 > MAX_PIXELS {
        return Err("SVG raster dimensions are outside safe bounds".into());
    }
    let mut pixels = resvg::tiny_skia::Pixmap::new(actual_width, actual_height)
        .ok_or("Cannot allocate SVG drawing surface")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(scale, scale), &mut pixels.as_mut());
    pixels.save_png(output).map_err(|e| format!("Unable to save SVG raster: {e}"))
}

fn external_photo_convert(source: &Path, target: &Path, action: &str) -> Result<(), String> {
    let ffmpeg = find_binary("ffmpeg")
        .ok_or("FFmpeg and the required AVIF/HEIC/RAW codec must be installed locally")?;
    let mut args: Vec<std::ffi::OsString> = vec![
        "-hide_banner".into(), "-loglevel".into(), "error".into(),
        "-nostdin".into(), "-n".into(),
        "-protocol_whitelist".into(), "file,pipe,data,crypto".into(),
        "-i".into(), source.as_os_str().to_os_string(),
        "-map".into(), "0:v:0".into(), "-frames:v".into(), "1".into(),
    ];
    if action == "ffmpeg-avif" {
        args.extend(["-c:v".into(), "libaom-av1".into(), "-still-picture".into(),
            "1".into(), "-pix_fmt".into(), "yuv420p".into()]);
    }
    args.push(target.as_os_str().to_os_string());
    crate::external::run(&ffmpeg, &args, None)
        .map_err(|e| format!("Image codec unavailable or conversion failed: {e}"))
}

fn convert(job: AdvancedImageJob) -> Result<String, String> {
    let source = PathBuf::from(&job.path);
    verify_input(&source, false)?;
    if fs::metadata(&source).map_err(|e| e.to_string())?.len() > MAX_IMAGE_BYTES {
        return Err("Image exceeds the 150 MB source limit".into());
    }
    let ext = extension(&source);
    let action = route(&ext, &job.target)?;
    let folder = output_dir(&source, job.destination.as_deref())?;
    let stage = tempfile::Builder::new().prefix(".reformany-advanced-image-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let staging = stage.path().join(format!("converted.{}", job.target));
    match action {
        "svg-raster" => render_svg(&source, &staging)?,
        "ico-write" => write_icon(&source, &staging)?,
        "ico-read" => {
            let image = open_raster(&source)?;
            image.save_with_format(&staging, ImageFormat::Png)
                .map_err(|e| e.to_string())?;
        },
        "ffmpeg-avif" | "ffmpeg-photo" =>
            external_photo_convert(&source, &staging, action)?,
        _ => unreachable!(),
    }
    if !staging.is_file() || fs::metadata(&staging).map_err(|e| e.to_string())?.len() == 0 {
        return Err("Advanced image engine created no output".into());
    }
    if job.target == "png" || job.target == "ico" {
        let verified = open_raster(&staging)?;
        if verified.width() == 0 || verified.height() == 0 {
            return Err("Advanced image result failed dimension verification".into());
        }
    } else {
        let bytes = fs::read(&staging).map_err(|e| e.to_string())?;
        if bytes.len() < 16 || !bytes.windows(8).take(32).any(|x| x == b"ftypavif") {
            return Err("FFmpeg output did not contain the expected AVIF signature".into());
        }
    }
    let stem = source.file_stem().and_then(|s| s.to_str()).ok_or("Invalid image filename")?;
    publish(&staging, &folder, stem, &job.target)
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn advanced_image_convert(job: AdvancedImageJob) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || convert(job))
        .await.map_err(|_| "Advanced image worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ico_round_trip_uses_actual_icon_container() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("image.png");
        DynamicImage::new_rgba8(300, 200).save(&source).unwrap();
        let ico = convert(AdvancedImageJob {
            path: source.to_string_lossy().into_owned(), target: "ico".into(), destination: None,
        }).unwrap();
        assert_eq!(image::image_dimensions(&ico).unwrap(), (256, 171));
        let png = convert(AdvancedImageJob { path: ico, target: "png".into(), destination: None }).unwrap();
        assert_eq!(image::image_dimensions(png).unwrap(), (256, 171));
    }

    #[test]
    fn svg_raster_is_real_and_rejects_external_documents() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("shape.svg");
        fs::write(&good, r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 40"><rect width="50" height="40" fill="#2288ff"/></svg>"##).unwrap();
        // The root namespace URI is structural, not an external fetch.
        let output = convert(AdvancedImageJob { path: good.to_string_lossy().into_owned(),
            target: "png".into(), destination: None }).unwrap();
        assert_eq!(image::image_dimensions(output).unwrap(), (50, 40));
        let malicious = dir.path().join("external.svg");
        fs::write(&malicious, r#"<svg><image href="file:///etc/passwd"/></svg>"#).unwrap();
        assert!(render_svg(&malicious, &dir.path().join("bad.png")).is_err());
    }

    #[test]
    fn unsupported_routes_are_explicit_errors() {
        assert!(route("heic", "png").is_ok()); // Decoder availability is checked at runtime
        assert!(route("svg", "ico").is_err());
        assert!(route("raw", "exe").is_err());
    }
}
