use crate::external::{output_dir, publish, verify_input};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{AesMode, CompressionMethod, ZipArchive, ZipWriter};

const MAX_ENTRIES: usize = 20_000;
const MAX_EXPANDED: u64 = 4 * 1024 * 1024 * 1024;

fn zip_options<'a>(password: Option<&'a str>, level: u8) -> zip::write::FileOptions<'a, 'a, ()> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(i64::from(level)));
    if let Some(password) = password {
        options.with_aes_encryption(AesMode::Aes256, password)
    } else {
        options
    }
}

/// ZIP DOS timestamps cannot represent years outside 1980–2107.
/// Preserve valid source modified timestamps, otherwise use 1980 as a
/// standards-compatible fallback (never the Windows 1899 epoch).
fn safe_modified_time(metadata: &fs::Metadata) -> zip::DateTime {
    metadata.modified().ok()
        .and_then(|modified| {
            let utc = time::OffsetDateTime::from(modified).to_offset(time::UtcOffset::UTC);
            let plain = time::PrimitiveDateTime::new(utc.date(), utc.time());
            zip::DateTime::try_from(plain).ok()
        })
        .unwrap_or(zip::DateTime::DEFAULT)
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
    let mut seen = HashSet::new();
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
            if !metadata.is_file() && !metadata.is_dir() { continue; }
            entry_count += 1;
            if metadata.is_file() {
                total_bytes = total_bytes.saturating_add(metadata.len());
            }
            if entry_count > MAX_ENTRIES || total_bytes > MAX_EXPANDED {
                return Err("Archive exceeds the 20,000-entry / 4 GB safety limit".into());
            }
            let name = if path.is_dir() {
                let inside = item.strip_prefix(path).map_err(|e| e.to_string())?;
                Path::new(base).join(inside).to_string_lossy().replace('\\', "/")
            } else {
                base.to_owned()
            };
            super::archives::validate_member_name(&name)?;
            if !seen.insert(name.to_lowercase()) {
                return Err(format!("Duplicate archive entry name: {name}"));
            }
            if metadata.is_dir() {
                writer.add_directory(format!("{name}/"), zip_options(None, level)
                    .last_modified_time(safe_modified_time(&metadata)))
                    .map_err(|e| format!("Cannot add ZIP directory: {e}"))?;
                continue;
            }
            writer.start_file(name, zip_options(password, level)
                .last_modified_time(safe_modified_time(&metadata)))
                .map_err(|e| format!("Cannot add file to ZIP: {e}"))?;
            let copied = std::io::copy(
                &mut File::open(&item).map_err(|e| e.to_string())?
                    .take(metadata.len().saturating_add(1)),
                &mut writer,
            ).map_err(|e| format!("Cannot compress file: {e}"))?;
            if copied != metadata.len() {
                return Err("A source file changed while creating the ZIP".into());
            }
        }
    }
    if entry_count == 0 { return Err("No regular files were found to archive".into()); }
    writer.finish().map_err(|e| format!("Cannot finalize ZIP: {e}"))?;
    verify_native_zip(&archive_path, password)?;
    publish(&archive_path, &output_dir, name, "zip")
        .map(|path| path.to_string_lossy().into_owned())
}


/** Fully read every entry before publication so corrupt data or an invalid
 * encryption password never produces a misleading completed notification. */
fn verify_native_zip(path: &Path, password: Option<&str>) -> Result<(), String> {
    let mut archive = ZipArchive::new(File::open(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("ZIP verification failed: {e}"))?;
    if archive.len() > MAX_ENTRIES {
        return Err("ZIP contains too many entries".into());
    }
    let mut expanded = 0u64;
    for index in 0..archive.len() {
        let mut item = if let Some(password) = password {
            archive.by_index_decrypt(index, password.as_bytes())
        } else {
            archive.by_index(index)
        }.map_err(|e| format!("ZIP verification cannot open entry: {e}"))?;
        expanded = expanded.saturating_add(item.size());
        if expanded > MAX_EXPANDED {
            return Err("ZIP verification exceeded 4 GB safety limit".into());
        }
        if !item.is_dir() {
            let expected = item.size();
            let copied = std::io::copy(&mut item, &mut std::io::sink())
                .map_err(|e| format!("ZIP entry failed integrity verification: {e}"))?;
            if copied != expected {
                return Err("ZIP entry content differs from its recorded size".into());
            }
        }
    }
    Ok(())
}

/** Encrypt the existing ZIP's actual members rather than creating a ZIP
 * containing another ZIP. The input is never modified or unpacked to disk. */
pub fn repack_native_zip(
    source: &str, name: &str, destination: Option<&str>,
    password: &str, level: u8,
) -> Result<String, String> {
    if password.len() < 8 || password.len() > 1024 {
        return Err("Choose a ZIP password between 8 and 1024 characters".into());
    }
    if !(1..=9).contains(&level) {
        return Err("Invalid ZIP compression level".into());
    }
    let input = Path::new(source);
    verify_input(input, false)?;
    let output = output_dir(input, destination)?;
    let stage = tempfile::Builder::new().prefix(".reformany-repack-")
        .tempdir_in(&output).map_err(|e| e.to_string())?;
    let staged_path = stage.path().join("protected.zip");
    let mut input_zip = ZipArchive::new(File::open(input).map_err(|e| e.to_string())?)
        .map_err(|e| format!("The existing ZIP is invalid: {e}"))?;
    if input_zip.is_empty() || input_zip.len() > MAX_ENTRIES {
        return Err("ZIP must contain between 1 and 20,000 entries".into());
    }
    let mut writer = ZipWriter::new(File::create(&staged_path).map_err(|e| e.to_string())?);
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for index in 0..input_zip.len() {
        // A separately encrypted source needs its original password first.
        // Do not silently repackage encrypted bytes as if they were plaintext.
        let mut member = input_zip.by_index(index)
            .map_err(|e| format!("Cannot read source ZIP member (an encrypted source must be unlocked first): {e}"))?;
        let path = member.enclosed_name().ok_or("Unsafe path in source ZIP")?.to_path_buf();
        let path_string = path.to_string_lossy().replace('\\', "/");
        super::archives::validate_member_name(&path_string)?;
        if member.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err("Symlinks in ZIP files are not repackaged".into());
        }
        if !seen.insert(path_string.to_lowercase()) {
            return Err("Source ZIP contains duplicate names".into());
        }
        if member.is_dir() {
            writer.add_directory(format!("{}/", path_string.trim_end_matches('/')),
                zip_options(None, level).last_modified_time(member.last_modified().unwrap_or(zip::DateTime::DEFAULT)))
                .map_err(|e| format!("Cannot preserve ZIP folder: {e}"))?;
        } else {
            total = total.saturating_add(member.size());
            if total > MAX_EXPANDED {
                return Err("Source ZIP exceeds the 4 GB expanded-size limit".into());
            }
            writer.start_file(path_string, zip_options(Some(password), level)
                .last_modified_time(member.last_modified().unwrap_or(zip::DateTime::DEFAULT)))
                .map_err(|e| format!("Cannot encrypt ZIP entry: {e}"))?;
            let expected = member.size();
            let copied = std::io::copy(&mut member, &mut writer)
                .map_err(|e| format!("Source ZIP entry is corrupt: {e}"))?;
            if copied != expected {
                return Err("Source ZIP entry size mismatch".into());
            }
        }
    }
    writer.finish().map_err(|e| format!("Cannot finalize protected ZIP: {e}"))?;
    verify_native_zip(&staged_path, Some(password))?;
    publish(&staged_path, &output, name, "zip")
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
    let mut seen = HashSet::new();
    for index in 0..zip.len() {
        let mut member = if let Some(password) = password {
            zip.by_index_decrypt(index, password.as_bytes())
        } else {
            zip.by_index(index)
        }.map_err(|e| format!("Cannot read ZIP entry (password may be wrong): {e}"))?;
        let entry = member.enclosed_name().ok_or("Unsafe path in ZIP")?.to_path_buf();
        super::archives::validate_member_name(&entry.to_string_lossy())?;
        if !seen.insert(entry.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase()) {
            return Err("ZIP contains duplicate paths which may overwrite each other".into());
        }
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
    fn repacks_existing_zip_members_not_the_zip_file() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("source.zip");
        let mut plain = ZipWriter::new(File::create(&source).unwrap());
        plain.add_directory("nested/", SimpleFileOptions::default()).unwrap();
        plain.start_file("nested/hello.txt", SimpleFileOptions::default()).unwrap();
        plain.write_all(b"hello from source").unwrap();
        plain.finish().unwrap();
        let output = repack_native_zip(&source.to_string_lossy(), "protected",
            Some(&folder.path().to_string_lossy()), "SecretPassword!", 5).unwrap();
        let unwrapped = extract_native_zip(&output,
            Some(&folder.path().to_string_lossy()), Some("SecretPassword!")).unwrap();
        assert_eq!(fs::read(Path::new(&unwrapped).join("nested/hello.txt")).unwrap(),
            b"hello from source");
        assert!(!Path::new(&unwrapped).join("source.zip").exists());
        assert!(source.exists(), "Original ZIP must remain unchanged");
    }

    #[test]
    fn preserves_empty_folders_in_password_zip() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("Pictures");
        fs::create_dir_all(source.join("empty/child")).unwrap();
        fs::write(source.join("portrait.txt"), b"file data").unwrap();
        let output = create_native_zip(&[source.to_string_lossy().to_string()],
            "all-pictures", Some(&folder.path().to_string_lossy()),
            Some("SecretPassword!"), 5).unwrap();
        let unwrapped = extract_native_zip(&output,
            Some(&folder.path().to_string_lossy()), Some("SecretPassword!")).unwrap();
        assert!(Path::new(&unwrapped).join("Pictures/empty/child").is_dir());
        assert_eq!(fs::read(Path::new(&unwrapped).join("Pictures/portrait.txt")).unwrap(),
            b"file data");
    }
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

    #[cfg(windows)]
    #[test]
    fn normal_zip_extracts_using_windows_explorer_engine() {
        // Expand-Archive is PowerShell's Windows ZIP extraction path; unlike
        // AES-enabled 7-Zip, it must consume ordinary ReformANY ZIPs.
        use sha2::{Digest,Sha256};
        let temp=tempfile::tempdir().unwrap();
        let source=temp.path().join("vid.mp4");
        let data=(0..131_073usize).map(|i| (i % 251) as u8).collect::<Vec<_>>();
        fs::write(&source,&data).unwrap();
        let empty=temp.path().join("empty.txt");
        fs::write(&empty,[]).unwrap();
        let archive=create_native_zip(&[
            source.to_string_lossy().into_owned(),
            empty.to_string_lossy().into_owned(),
        ],"Normal",Some(&temp.path().to_string_lossy()),None,5).unwrap();
        let extracted=temp.path().join("WindowsExtract");
        let mut cmd=std::process::Command::new("powershell.exe");
        cmd.args(["-NoProfile","-NonInteractive","-Command",
            "Expand-Archive -LiteralPath $env:REFORMANY_TEST_ZIP -DestinationPath $env:REFORMANY_TEST_OUT -Force"])
            .env("REFORMANY_TEST_ZIP",&archive)
            .env("REFORMANY_TEST_OUT",&extracted);
        let result=cmd.output().unwrap();
        assert!(result.status.success(),"Windows ZIP extractor rejected normal archive: {}",
            String::from_utf8_lossy(&result.stderr));
        let copy=fs::read(extracted.join("vid.mp4")).unwrap();
        assert_eq!(Sha256::digest(&copy),Sha256::digest(&data));
        assert_eq!(fs::metadata(extracted.join("empty.txt")).unwrap().len(),0);
        let source_metadata=fs::metadata(&source).unwrap();
        let expected=safe_modified_time(&source_metadata);
        let zip=ZipArchive::new(File::open(&archive).unwrap()).unwrap();
        assert_eq!(zip.file_names().count(),2);
        assert!(expected.year()>=1980);
    }

    #[test]
    fn zip_entries_never_have_invalid_dos_timestamps() {
        let folder=tempfile::tempdir().unwrap();
        let source=folder.path().join("data.txt");
        fs::write(&source,b"date test").unwrap();
        let archive=create_native_zip(&[source.to_string_lossy().into_owned()],
            "datecheck",Some(&folder.path().to_string_lossy()),None,5).unwrap();
        let mut zip=ZipArchive::new(File::open(&archive).unwrap()).unwrap();
        let stamp=zip.by_index(0).unwrap().last_modified().unwrap();
        assert!((1980..=2107).contains(&stamp.year()));
    }

    #[test]
    fn refuses_two_sources_with_the_same_archive_name() {
        let folder = tempfile::tempdir().unwrap();
        let first = folder.path().join("first");
        let second = folder.path().join("second");
        fs::create_dir(&first).unwrap();
        fs::create_dir(&second).unwrap();
        fs::write(first.join("report.txt"), b"one").unwrap();
        fs::write(second.join("report.txt"), b"two").unwrap();
        let inputs = vec![
            first.join("report.txt").to_string_lossy().into_owned(),
            second.join("report.txt").to_string_lossy().into_owned(),
        ];
        let result = create_native_zip(&inputs, "Reports", Some(&folder.path().to_string_lossy()), None, 5);
        assert!(result.is_err());
        assert!(!folder.path().join("Reports.zip").exists());
    }

    #[test]
    fn refuses_duplicate_names_inside_a_zip() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("duplicate.zip");
        let mut writer = ZipWriter::new(File::create(&source).unwrap());
        for (name, data) in [("Duplicate.txt", b"first" as &[u8]), ("duplicate.txt", b"second" as &[u8])] {
            writer.start_file(name, SimpleFileOptions::default()).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
        assert!(extract_native_zip(&source.to_string_lossy(), None, None).is_err());
    }

    #[test]
    fn refuses_missing_password_for_encrypted_zip() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("doc.txt");
        fs::write(&input, b"Private").unwrap();
        let output = create_native_zip(&[input.to_string_lossy().to_string()],
            "Private", Some(&dir.path().to_string_lossy()), Some("GoodPassword"), 5).unwrap();
        assert!(extract_native_zip(&output, None, None).is_err());
        assert!(extract_native_zip(&output, None, Some("IncorrectPassword")).is_err());
        assert!(extract_native_zip(&output, None, Some("GoodPassword")).is_ok());
    }
}
