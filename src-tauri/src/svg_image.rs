//! Offline SVG rasterizing. External URL/file references and active XML content
//! are not accepted; output is bounded by the same pixel budget as raster images.
use image::{DynamicImage, GenericImageView};
use resvg::{tiny_skia, usvg};
use std::fs;
use std::path::Path;

const MAX_SVG_BYTES: u64 = 5 * 1024 * 1024;
const MAX_SVG_PIXELS: u64 = 40_000_000;

pub fn is_svg(path: &Path) -> bool {
    path.extension().and_then(|x| x.to_str())
        .is_some_and(|x| x.eq_ignore_ascii_case("svg"))
}

fn parse(data: &[u8]) -> Result<usvg::Tree, String> {
    let content = std::str::from_utf8(data).map_err(|_| "SVG must be UTF-8".to_owned())?;
    let lowercase = content.to_ascii_lowercase().replace(
        "http://www.w3.org/2000/svg", "builtin-svg-namespace"
    ).replace("http://www.w3.org/1999/xlink", "builtin-xlink-namespace");
    // Reject SVG documents that might rely on files, network resources or
    // active content; embedded base64 images are handled locally by resvg.
    for pattern in ["<!doctype", "<!entity", "<script", "<foreignobject", "http:", "https:", "file:", "ftp:", "javascript:"] {
        if lowercase.contains(pattern) {
            return Err("SVG contains external or active content; only self-contained SVG is allowed".into());
        }
    }
    let options = usvg::Options::default();
    let tree = usvg::Tree::from_data(data, &options)
        .map_err(|e| format!("Cannot parse SVG: {e}"))?;
    let size = tree.size();
    let width = size.width().ceil() as u64;
    let height = size.height().ceil() as u64;
    if width == 0 || height == 0 || width > 16384 || height > 16384
        || width.saturating_mul(height) > MAX_SVG_PIXELS {
        return Err("SVG canvas exceeds 40 megapixels or has invalid dimensions".into());
    }
    Ok(tree)
}
pub fn inspect_svg(path: &Path) -> Result<u64, String> {
    if !is_svg(path) { return Err("Not an SVG file".into()); }
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_SVG_BYTES {
        return Err("SVG must be a regular file smaller than 5 MB".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    parse(&bytes)?;
    Ok(meta.len())
}
pub fn rasterize_svg(path: &Path) -> Result<DynamicImage, String> {
    inspect_svg(path)?;
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let tree = parse(&data)?;
    let size = tree.size();
    let width = size.width().ceil() as u32;
    let height = size.height().ceil() as u32;
    let mut pixmap = tiny_skia::Pixmap::new(width, height)
        .ok_or("Could not allocate SVG rendering surface")?;
    resvg::render(&tree, tiny_skia::Transform::identity(), &mut pixmap.as_mut());
    // PNG serialization un-premultiplies tiny-skia's pixels correctly.
    let png = pixmap.encode_png().map_err(|e| format!("SVG render failed: {e}"))?;
    image::load_from_memory_with_format(&png, image::ImageFormat::Png)
        .map_err(|e| format!("SVG decoding failed: {e}"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_svg_renders_and_remote_content_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("vector.svg");
        fs::write(&file, r##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="15"><rect width="20" height="15" fill="#3267cc"/></svg>"##).unwrap();
        // XML namespace URI is a declaration, not an external resource. The
        // parser should allow the standard SVG namespace while blocking URLs
        // in resource attributes.
        let result = rasterize_svg(&file);
        assert_eq!(result.unwrap().dimensions(), (20, 15));
        fs::write(&file, r#"<svg><image href="https://remote.example/asset.png"/></svg>"#).unwrap();
        assert!(rasterize_svg(&file).is_err());
    }
}
