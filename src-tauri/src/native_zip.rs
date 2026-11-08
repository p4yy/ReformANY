use crate::external::{output_dir, publish, verify_input};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{AesMode, CompressionMethod, ZipArchive, ZipWriter};

const MAX_ENTRIES: usize = 20_000;
const MAX_EXPANDED: u64 = 4 * 1024 * 1024 * 1024;

fn zip_options<'a>(password: Option<&'a str>, level: u8) -> zip::write::FileOptions<'a, ()> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(i64::from(level)));
    if let Some(password) = password {
        options.with_aes_encryption(AesMode::Aes256, password)
    } else {
        options
    }
}

pub fn create_native_zip(
    paths: &[String], name: &str, destination: Option<&str>,
    password: Option<&str>, level: u8,
) -> Result<String, String> {
    if paths.is_empty() || paths.len() > 300 {
        return Err("Select between 1 and 300 sources".into());
    }
    if !(1..=9).contains(&level) { return Err("Invalid compression level".into()); }
    for path in paths { verify_input(Path::new(path), true)?; }
    let output_dir = output_dir(Path::new(&paths[0]), destination)?;
    let staging = tempfile::Builder::new().prefix(".reformany-zip-")
        .tempdir_in(&output_dir).map_err(|e| e.to_string())?;
    let archive_path = staging.path().join("archive.zip");
    let mut writer = ZipWriter::new(File::create(&archive_path).map_err(|e| e.to_string())?);
    let mut entry_count = 0usize;
    let mut total_bytes = 0u64;
    for source in paths {
        let path = Path::new(source);
        let base = path.file_name().and_then(|s| s.to_str()).ok_or("Invalid input name")?;
        let files: Vec<PathBuf> = if path.is_dir() {
            WalkDir::new(path).follow_links(false).max_depth(32)
                .into_iter().map(|e| e.map(|entry| entry.into_path())
                    .map_err(|error| format!("Cannot scan folder: {error}")))
                .collect::<Result<Vec<_>,_>>()?
        } else {
            vec![path.to_path_buf()]
        };
        for item in files {
            let metadata = fs::symlink_metadata(&item).map_err(|e| e.to_string())?;
            if metadata.file_type().is_symlink() {
                return Err("Symlinks are not included in ZIP packages".into());
            }
            if !metadata.is_file() { continue; }
            entry_count += 1;
            total_bytes = total_bytes.saturating_add(metadata.len());
            if entry_count > MAX_ENTRIES || total_bytes > MAX_EXPANDED {
                return Err("Archive exceeds the 20,000-file / 4 GB preview limit".into());
            }
            let name = if path.is_dir() {
                let inside = item.strip_prefix(path).map_err(|e| e.to_string())?;
                Path::new(base).join(inside).to_string_lossy().replace('\\', "/")
            } else {
                base.to_owned()
            };
            super::archives::validate_member_name(&name)?;
            writer.start_file(name, zip_options(password, level))
                .map_err(|e| format!("Cannot add file to ZIP: {e}"))?;
            std::io::copy(&mut File::open(&item).map_err(|e| e.to_string())?, &mut writer)
                .map_err(|e| format!("Cannot compress file: {e}"))?;
        }
    }
    if entry_count == 0 { return Err("No regular files were found to archive".into()); }
    writer.finish().map_err(|e| format!("Cannot finalize ZIP: {e}"))?;
    publish(&archive_path, &output_dir, name, "zip")
        .map(|path| path.to_string_lossy().into_owned())
}

pub fn extract_native_zip(
    path: &str, destination: Option<&str>, password: Option<&str>,
) -> Result<String, String> {
    let input = Path::new(path);
    verify_input(input, false)?;
    let folder = output_dir(input, destination)?;
    let archive = File::open(input).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(archive).map_err(|e| format!("ZIP is unreadable: {e}"))?;
    if zip.len() > MAX_ENTRIES { return Err("Too many archive entries".into()); }
    let stage = tempfile::Builder::new().prefix(".reformany-native-extract-")
        .tempdir_in(&folder).map_err(|e| e.to_string())?;
    let mut bytes = 0u64;
    for index in 0..zip.len() {
        let mut member = if let Some(password) = password {
            zip.by_index_decrypt(index, password.as_bytes())
        } else {
            zip.by_index(index)
        }.map_err(|e| format!("Cannot read ZIP entry (password may be wrong): {e}"))?;
        let entry = member.enclosed_name().ok_or("Unsafe path in ZIP")?.to_path_buf();
        super::archives::validate_member_name(&entry.to_string_lossy())?;
        if member.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err("Symbolic links in ZIP archives are blocked".into());
        }
        bytes = bytes.saturating_add(member.size());
        if bytes > MAX_EXPANDED { return Err("Archive exceeds the 4 GB limit".into()); }
        let target = stage.path().join(&entry);
        if member.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            fs::create_dir_all(target.parent().ok_or("Invalid ZIP entry path")?)
                .map_err(|e| e.to_string())?;
            let mut output = File::create(&target).map_err(|e| e.to_string())?;
            let copied = std::io::copy(&mut member, &mut output)
                .map_err(|e| format!("Failed to extract ZIP entry: {e}"))?;
            if copied > member.size() { return Err("Archive entry exceeded its declared size".into()); }
            output.flush().map_err(|e| e.to_string())?;
        }
    }
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("Archive");
    for suffix in 0..1000 {
        let target = folder.join(if suffix == 0 {
            format!("{stem} extracted")
        } else {
            format!("{stem} extracted ({suffix})")
        });
        match fs::create_dir(&target) {
            Ok(_) => {
                let outcome = (|| -> Result<(), String> {
                    for entry in fs::read_dir(stage.path()).map_err(|e| e.to_string())? {
                        let entry = entry.map_err(|e| e.to_string())?;
                        fs::rename(entry.path(), target.join(entry.file_name()))
                            .map_err(|e| e.to_string())?;
                    }
                    Ok(())
                })();
                if let Err(error) = outcome {
                    let _ = fs::remove_dir_all(&target);
                    return Err(error);
                }
                return Ok(target.to_string_lossy().into_owned());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Cannot create extraction folder: {e}")),
        }
    }
    Err("Too many extraction folders".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_aes_zip_and_roundtrips_without_installed_7zip() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("hello.txt");
        fs::write(&input, b"Some important content").unwrap();
        let path = create_native_zip(&[input.to_string_lossy().to_string()],
            "Encrypted", Some(&dir.path().to_string_lossy()), Some("CorrectHorseBattery"), 5).unwrap();
        let extracted = extract_native_zip(&path, Some(&dir.path().to_string_lossy()), Some("CorrectHorseBattery")).unwrap();
        assert_eq!(fs::read(Path::new(&extracted).join("hello.txt")).unwrap(), b"Some important content");
        assert_eq!(fs::read(input).unwrap(), b"Some important content");
    }

    #[test]
    fn refuses_missing_password_for_encrypted_zip() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("doc.txt");
        fs::write(&input, b"Private").unwrap();
        let output = create_native_zip(&[input.to_string_lossy().to_string()],
            "Private", Some(&dir.path().to_string_lossy()), Some("GoodPassword"), 5).unwrap();
        assert!(extract_native_zip(&output, None, None).is_err());
    }
}
