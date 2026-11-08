use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const MAX_FILES: usize = 300;
const MAX_ENTRIES: usize = 20_000;
const MAX_FOLDER_DEPTH: usize = 10;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandedInputs {
    paths: Vec<String>,
    truncated: bool,
}

fn is_supported_image_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "tif" | "tiff" | "ico" | "tga" | "qoi" | "svg"
            )
        })
}

fn collect_inputs(paths: Vec<String>) -> ExpandedInputs {
    let mut files = Vec::new();
    let mut seen = HashSet::<PathBuf>::new();
    let mut scanned = 0;
    let mut truncated = false;

    'outer: for path in paths {
        let root = PathBuf::from(path);
        if root.is_dir() {
            for item in WalkDir::new(&root).follow_links(false).max_depth(MAX_FOLDER_DEPTH) {
                scanned += 1;
                if scanned > MAX_ENTRIES {
                    truncated = true;
                    break 'outer;
                }
                let Ok(entry) = item else { continue };
                if !entry.file_type().is_file() || !is_supported_image_extension(entry.path()) {
                    continue;
                }
                let path = entry.into_path();
                if seen.insert(path.clone()) {
                    files.push(path.to_string_lossy().into_owned());
                    if files.len() >= MAX_FILES {
                        truncated = true;
                        break 'outer;
                    }
                }
            }
        } else if seen.insert(root.clone()) {
            // Preserve unsupported individual paths so inspection can report a
            // clear error, rather than silently dropping an explicitly picked file.
            files.push(root.to_string_lossy().into_owned());
            if files.len() >= MAX_FILES {
                truncated = true;
                break;
            }
        }
    }
    ExpandedInputs { paths: files, truncated }
}

#[tauri::command]
pub async fn expand_inputs(paths: Vec<String>) -> Result<ExpandedInputs, String> {
    if paths.len() > MAX_FILES {
        return Err("Select no more than 300 files or folders at once".into());
    }
    tauri::async_runtime::spawn_blocking(move || collect_inputs(paths))
        .await
        .map_err(|_| "Could not scan the selected folder".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_nested_images_and_ignores_unrelated_folder_contents() {
        let temp = tempfile::tempdir().unwrap();
        let nested = temp.path().join("Summer Photos");
        std::fs::create_dir(&nested).unwrap();
        std::fs::write(nested.join("image.JPEG"), b"test").unwrap();
        std::fs::write(nested.join("cover.tif"), b"test").unwrap();
        std::fs::write(nested.join("notes.txt"), b"test").unwrap();
        let result = collect_inputs(vec![temp.path().to_string_lossy().into()]);
        assert_eq!(result.paths.len(), 2);
        assert!(!result.truncated);
        assert!(result.paths.iter().all(|p| p.contains("Summer Photos")));
    }

    #[test]
    fn preserves_explicit_unsupported_files_for_explained_errors() {
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("report.pdf");
        std::fs::write(&input, b"pdf").unwrap();
        let result = collect_inputs(vec![input.to_string_lossy().into()]);
        assert_eq!(result.paths, vec![input.to_string_lossy().into_owned()]);
    }

    #[test]
    fn scanning_is_capped_at_300_files() {
        let temp = tempfile::tempdir().unwrap();
        for i in 0..305 {
            std::fs::write(temp.path().join(format!("{i:04}.png")), b"invalid").unwrap();
        }
        let result = collect_inputs(vec![temp.path().to_string_lossy().into()]);
        assert_eq!(result.paths.len(), 300);
        assert!(result.truncated);
    }
}
