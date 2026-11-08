//! Local streaming file splitter/joiner. This does not create ZIP/7z archives.
//! Each numbered set has a small manifest with a full-file SHA-256 digest.
//! All output names are collision-safe; source files are never replaced.
use crate::external::{output_dir, verify_input};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MIB: u64 = 1024 * 1024;
const MAX_PARTS: usize = 999;
const MAX_TOTAL: u64 = 16 * 1024 * 1024 * 1024;
const BUFFER_SIZE: usize = 64 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartsManifest {
    version: u8,
    original_name: String,
    part_base: String,
    part_count: usize,
    part_size_bytes: u64,
    total_size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitResult {
    manifest_path: String,
    parts: Vec<String>,
}

fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 220
        && name != "." && name != ".."
        && !name.ends_with([' ', '.'])
        && !name.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        && Path::new(name).file_name().is_some_and(|v| v == name)
}

fn staged_publish(source: &Path, destination: &Path) -> Result<(), String> {
    // A hard link is an atomic, no-clobber publish on NTFS and other local
    // filesystems. Fall back to a staged copy for filesystems without links.
    match fs::hard_link(source, destination) {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err("Output name is already taken".into());
        }
        Err(_) => {}
    }
    let parent = destination.parent().ok_or("Output directory is unavailable")?;
    let mut staging = tempfile::Builder::new().prefix(".reformany-part-")
        .tempfile_in(parent).map_err(|e| e.to_string())?;
    std::io::copy(&mut File::open(source).map_err(|e| e.to_string())?, staging.as_file_mut())
        .map_err(|e| e.to_string())?;
    staging.as_file_mut().sync_all().map_err(|e| e.to_string())?;
    staging.persist_noclobber(destination).map_err(|e| format!("Could not save output: {}", e.error))?;
    Ok(())
}

fn split(input_path: &str, destination: Option<&str>, part_megabytes: u32) -> Result<SplitResult, String> {
    if !(1..=4096).contains(&part_megabytes) {
        return Err("Choose a part size between 1 MB and 4096 MB".into());
    }
    let input = Path::new(input_path);
    verify_input(input, false)?;
    let source_size = fs::metadata(input).map_err(|e| e.to_string())?.len();
    if source_size == 0 || source_size > MAX_TOTAL { return Err("File must be between 1 byte and 16 GB".into()); }
    let chunk_size = u64::from(part_megabytes) * MIB;
    let count = source_size.div_ceil(chunk_size) as usize;
    if count > MAX_PARTS { return Err("Too many parts. Choose a larger part size (maximum 999 parts).".into()); }
    let original_name = input.file_name().and_then(|v| v.to_str()).ok_or("Invalid source filename")?.to_owned();
    if !safe_name(&original_name) { return Err("Filename is not suitable for splitting".into()); }
    let folder = output_dir(input, destination)?;
    let stage = tempfile::Builder::new().prefix(".reformany-split-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let mut reader = File::open(input).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; BUFFER_SIZE];
    let mut staged_parts = Vec::with_capacity(count);
    let mut remaining = source_size;

    for index in 0..count {
        let staged = stage.path().join(format!("{:03}", index + 1));
        let mut output = File::create(&staged).map_err(|e| e.to_string())?;
        let mut part_left = remaining.min(chunk_size);
        while part_left > 0 {
            let max_read = part_left.min(BUFFER_SIZE as u64) as usize;
            let read = reader.read(&mut buffer[..max_read]).map_err(|e| e.to_string())?;
            if read == 0 { return Err("The source file changed while splitting".into()); }
            hasher.update(&buffer[..read]);
            output.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
            part_left -= read as u64;
            remaining -= read as u64;
        }
        output.sync_all().map_err(|e| e.to_string())?;
        staged_parts.push(staged);
    }
    if remaining != 0 || reader.read(&mut buffer[..1]).map_err(|e| e.to_string())? != 0 {
        return Err("The source file changed while splitting".into());
    }
    let digest = format!("{:x}", hasher.finalize());
    let manifest_stage = stage.path().join("parts.json");
    for suffix in 0..1000 {
        let base = if suffix == 0 { original_name.clone() } else { format!("{original_name} ({suffix})") };
        if !safe_name(&base) { return Err("The source filename is too long for part naming".into()); }
        let part_paths: Vec<PathBuf> = (1..=count)
            .map(|n| folder.join(format!("{base}.{n:03}"))).collect();
        let manifest_path = folder.join(format!("{base}.reformany.parts.json"));
        if manifest_path.exists() || part_paths.iter().any(|p| p.exists()) { continue; }

        let manifest = PartsManifest {
            version: 1, original_name: original_name.clone(), part_base: base,
            part_count: count, part_size_bytes: chunk_size,
            total_size_bytes: source_size, sha256: digest.clone(),
        };
        let serialized = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
        fs::write(&manifest_stage, serialized).map_err(|e| e.to_string())?;
        let mut created = Vec::new();
        let mut collision = false;
        for (source, target) in staged_parts.iter().zip(&part_paths) {
            match staged_publish(source, target) {
                Ok(()) => created.push(target.to_owned()),
                Err(error) if error == "Output name is already taken" => { collision = true; break; }
                Err(error) => {
                    for path in created { let _ = fs::remove_file(path); }
                    return Err(error);
                }
            }
        }
        if !collision {
            match staged_publish(&manifest_stage, &manifest_path) {
                Ok(()) => created.push(manifest_path.clone()),
                Err(error) if error == "Output name is already taken" => collision = true,
                Err(error) => {
                    for path in created { let _ = fs::remove_file(path); }
                    return Err(error);
                }
            }
        }
        if collision {
            for path in created { let _ = fs::remove_file(path); }
            continue;
        }
        return Ok(SplitResult {
            manifest_path: manifest_path.to_string_lossy().into_owned(),
            parts: part_paths.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        });
    }
    Err("Too many existing part sets have the same name".into())
}

fn join(manifest_path: &str, destination: Option<&str>) -> Result<String, String> {
    let source = Path::new(manifest_path);
    verify_input(source, false)?;
    if !source.file_name().and_then(|v| v.to_str())
        .is_some_and(|n| n.ends_with(".reformany.parts.json")) {
        return Err("Choose a ReformANY parts manifest (.reformany.parts.json)".into());
    }
    let meta = fs::metadata(source).map_err(|e| e.to_string())?;
    if meta.len() > 64 * 1024 { return Err("Parts manifest is too large".into()); }
    let manifest: PartsManifest = serde_json::from_slice(
        &fs::read(source).map_err(|e| e.to_string())?
    ).map_err(|_| "Parts manifest is invalid".to_owned())?;
    if manifest.version != 1 || !safe_name(&manifest.original_name)
        || !safe_name(&manifest.part_base)
        || manifest.part_count == 0 || manifest.part_count > MAX_PARTS
        || manifest.part_size_bytes < MIB || manifest.part_size_bytes > 4096 * MIB
        || manifest.total_size_bytes == 0 || manifest.total_size_bytes > MAX_TOTAL
        || manifest.total_size_bytes.div_ceil(manifest.part_size_bytes) as usize != manifest.part_count
        || manifest.sha256.len() != 64
        || !manifest.sha256.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Parts manifest contains unsupported or unsafe values".into());
    }
    let expected_manifest_name = format!("{}.reformany.parts.json", manifest.part_base);
    if source.file_name().and_then(|n| n.to_str()) != Some(expected_manifest_name.as_str()) {
        return Err("Parts manifest name does not match the numbered set".into());
    }
    let source_folder = source.parent().ok_or("Cannot locate numbered parts")?;
    let folder = output_dir(source, destination)?;
    let stage = tempfile::Builder::new().prefix(".reformany-join-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let target = stage.path().join("joined");
    let mut output = File::create(&target).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; BUFFER_SIZE];
    let mut total = 0u64;
    for index in 1..=manifest.part_count {
        let part = source_folder.join(format!("{}.{index:03}", manifest.part_base));
        verify_input(&part, false)?;
        let part_length = fs::metadata(&part).map_err(|e| e.to_string())?.len();
        let expected = (manifest.total_size_bytes - total).min(manifest.part_size_bytes);
        if part_length != expected { return Err(format!("Part {index:03} has an unexpected size")); }
        let mut reader = File::open(&part).map_err(|e| e.to_string())?;
        let mut read_total = 0u64;
        loop {
            let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            hasher.update(&buffer[..n]);
            output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            read_total += n as u64;
        }
        if read_total != expected { return Err(format!("Part {index:03} changed during joining")); }
        total += read_total;
    }
    if total != manifest.total_size_bytes || format!("{:x}", hasher.finalize()) != manifest.sha256 {
        return Err("Part checksum mismatch; no combined file was saved".into());
    }
    output.sync_all().map_err(|e| e.to_string())?;
    // Publish without clobbering the original file, including files without extensions.
    let source_name = Path::new(&manifest.original_name);
    let stem = source_name.file_stem().and_then(|n| n.to_str()).ok_or("Invalid output filename")?;
    let extension = source_name.extension().and_then(|e| e.to_str());
    for suffix in 0..1000 {
        let name = if suffix == 0 { manifest.original_name.clone() }
            else if let Some(ext) = extension { format!("{stem} ({suffix}).{ext}") }
            else { format!("{stem} ({suffix})") };
        let final_path = folder.join(name);
        match staged_publish(&target, &final_path) {
            Ok(()) => return Ok(final_path.to_string_lossy().into_owned()),
            Err(error) if error == "Output name is already taken" => continue,
            Err(error) => return Err(error),
        }
    }
    Err("Too many files already have this name".into())
}

#[tauri::command]
pub async fn file_split(
    path: String, destination: Option<String>, part_megabytes: u32,
) -> Result<SplitResult, String> {
    tauri::async_runtime::spawn_blocking(move || split(&path, destination.as_deref(), part_megabytes))
        .await.map_err(|_| "File splitting worker failed".to_owned())?
}

#[tauri::command]
pub async fn file_join(manifest_path: String, destination: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || join(&manifest_path, destination.as_deref()))
        .await.map_err(|_| "File joining worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, String, Vec<u8>) {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("example.bin");
        let bytes: Vec<u8> = (0..(2 * 1024 * 1024 + 19)).map(|n| (n % 251) as u8).collect();
        fs::write(&path, &bytes).unwrap();
        (folder, path.to_string_lossy().into_owned(), bytes)
    }

    #[test]
    fn split_and_join_roundtrip_without_overwriting_original() {
        let (_folder, path, bytes) = fixture();
        let split_result = split(&path, None, 1).unwrap();
        assert_eq!(split_result.parts.len(), 3);
        let restored = join(&split_result.manifest_path, None).unwrap();
        assert_ne!(restored, path);
        assert_eq!(fs::read(restored).unwrap(), bytes);
        assert_eq!(fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn rejects_missing_part_without_creating_output() {
        let (_folder, path, _) = fixture();
        let result = split(&path, None, 1).unwrap();
        fs::remove_file(&result.parts[1]).unwrap();
        assert!(join(&result.manifest_path, None).is_err());
    }

    #[test]
    fn rejects_tampered_part_using_sha256() {
        let (_folder, path, _) = fixture();
        let result = split(&path, None, 1).unwrap();
        let mut bytes = fs::read(&result.parts[0]).unwrap();
        bytes[5] ^= 0xff;
        fs::write(&result.parts[0], bytes).unwrap();
        assert!(join(&result.manifest_path, None).is_err());
    }

    #[test]
    fn rejects_unsafe_manifest_filename() {
        let (_folder, path, _) = fixture();
        let result = split(&path, None, 1).unwrap();
        let mut data: PartsManifest = serde_json::from_slice(
            &fs::read(&result.manifest_path).unwrap()).unwrap();
        data.original_name = "../escaped.bin".into();
        fs::write(&result.manifest_path, serde_json::to_vec(&data).unwrap()).unwrap();
        assert!(join(&result.manifest_path, None).is_err());
    }
}
