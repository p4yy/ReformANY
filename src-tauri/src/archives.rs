use crate::external::{find_binary, output_dir, seven_zip, verify_input};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use walkdir::WalkDir;

const MAX_ARCHIVE_ENTRIES: usize = 20000;
const MAX_UNPACKED_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_LISTING_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCreate {
    paths: Vec<String>,
    destination: Option<String>,
    name: String,
    format: String,
    password: Option<String>,
    split_megabytes: Option<u32>,
    level: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveExtract {
    path: String,
    destination: Option<String>,
    password: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCreated {
    output_paths: Vec<String>,
    format: String,
}

fn validate_archive_name(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 90 || value == "." || value == ".."
        || value.ends_with('.') || value.ends_with(' ') ||
        value.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
    {
        return Err("Use a short archive name without path separators or reserved characters".into());
    }
    Ok(())
}

fn archive_format(value: &str) -> Result<&'static str, String> {
    match value {
        "7z" => Ok("7z"), "zip" => Ok("zip"), "tar" => Ok("tar"),
        "gzip" => Ok("gz"), "bzip2" => Ok("bz2"), "xz" => Ok("xz"),
        "wim" => Ok("wim"), "rar" => Ok("rar"),
        _ => Err("This archive format cannot be created here".into()),
    }
}

fn validate_password(password: &Option<String>) -> Result<(), String> {
    if password.as_deref().is_some_and(|p| p.is_empty() || p.len() > 256 || p.contains('\0') || p.contains('\n')) {
        return Err("Password must be 1–256 characters with no line breaks".into());
    }
    Ok(())
}

fn creation_args(job: &ArchiveCreate, output: &Path) -> Result<(PathBuf, Vec<OsString>), String> {
    let _ = archive_format(&job.format)?;
    validate_archive_name(&job.name)?;
    validate_password(&job.password)?;
    if job.paths.is_empty() || job.paths.len() > 300 {
        return Err("Choose between 1 and 300 files or folders".into());
    }
    if !(1..=9).contains(&job.level) {
        return Err("Compression level must be between 1 and 9".into());
    }
    if let Some(size) = job.split_megabytes {
        if !(1..=4096).contains(&size) {
            return Err("Volume size must be 1–4096 MB".into());
        }
        if !matches!(job.format.as_str(), "7z" | "zip" | "rar") {
            return Err("Split volumes are available for 7z, ZIP and RAR".into());
        }
    }
    if job.password.is_some() && !matches!(job.format.as_str(), "7z" | "zip" | "rar") {
        return Err("Password encryption is available for 7z, ZIP and RAR".into());
    }
    if matches!(job.format.as_str(), "gzip" | "bzip2" | "xz") &&
        (job.paths.len() != 1 || !Path::new(&job.paths[0]).is_file())
    {
        return Err("GZip, BZip2 and XZ need exactly one source file".into());
    }
    let tool = if job.format == "rar" {
        find_binary("rar").ok_or("Creating RAR files requires WinRAR (Rar.exe) installed on Windows")?
    } else {
        seven_zip().ok_or("7-Zip is required. Install 7-Zip and retry.")?
    };
    let mut args: Vec<OsString> = vec!["a".into()];
    if job.format == "rar" {
        args.extend(["-ma5".into(), format!("-m{}", u32::from(job.level).div_ceil(2)).into()]);
    } else {
        args.extend([
            format!("-t{}", job.format).into(),
            format!("-mx={}", job.level).into(),
        ]);
        if job.format == "zip" && job.password.is_some() {
            args.push("-mem=AES256".into());
        }
        if job.format == "7z" && job.password.is_some() {
            args.push("-mhe=on".into());
        }
    }
    if let Some(password) = &job.password {
        // This is a limitation of external CLI integrations: passwords may
        // appear in local process arguments. Never log, persist or echo them.
        args.push(if job.format == "rar" {
            format!("-hp{password}").into()
        } else {
            format!("-p{password}").into()
        });
    }
    if let Some(size) = job.split_megabytes {
        args.push(format!("-v{size}m").into());
    }
    args.push(output.as_os_str().to_os_string());
    for path in &job.paths {
        args.push(OsString::from(path));
    }
    Ok((tool, args))
}

fn create(job: ArchiveCreate) -> Result<ArchiveCreated, String> {
    let format = archive_format(&job.format)?;
    if job.format == "zip" && job.split_megabytes.is_none() {
        validate_archive_name(&job.name)?;
        validate_password(&job.password)?;
        let zip = crate::native_zip::create_native_zip(
            &job.paths, &job.name, job.destination.as_deref(), job.password.as_deref(), job.level)?;
        return Ok(ArchiveCreated { output_paths: vec![zip], format: "zip".into() });
    }
    for source in &job.paths { verify_input(Path::new(source), true)?; }
    let first = Path::new(&job.paths[0]);
    let directory = output_dir(first, job.destination.as_deref())?;
    let staging = tempfile::Builder::new().prefix(".reformany-archive-")
        .tempdir_in(&directory).map_err(|e| e.to_string())?;
    let internal = staging.path().join(format!("payload.{format}"));
    let (tool, args) = creation_args(&job, &internal)?;
    crate::external::run(&tool, &args, Some(staging.path()))?;
    let mut staged: Vec<PathBuf> = fs::read_dir(staging.path())
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok).map(|entry| entry.path())
        .filter(|path| path.is_file())
        .collect();
    staged.sort();
    if staged.is_empty() {
        return Err("Archive engine created no output".into());
    }
    let total: u64 = staged.iter().map(|p| fs::metadata(p).map(|m| m.len()).unwrap_or(0)).sum();
    if total == 0 { return Err("Archive engine created empty outputs".into()); }
    // Ensure every part shares one collision-free base name. Each created file
    // is published exclusively; a conflict rolls back all parts from this job.
    for attempt in 0..1000 {
        let base = if attempt == 0 { job.name.clone() } else { format!("{} ({attempt})", job.name) };
        let tails: Vec<String> = staged.iter().map(|p| {
            p.file_name().unwrap_or_default().to_string_lossy()
                .strip_prefix("payload").unwrap_or("").to_owned()
        }).collect();
        if tails.iter().any(|x| x.is_empty()) {
            return Err("Unexpected archive output filename".into());
        }
        let paths: Vec<PathBuf> = tails.iter().map(|x| directory.join(format!("{base}{x}"))).collect();
        if paths.iter().any(|p| p.exists()) { continue; }
        let mut created = Vec::new();
        let mut conflict = false;
        for (source, final_path) in staged.iter().zip(&paths) {
            let mut temp = tempfile::Builder::new().prefix(".reformany-")
                .tempfile_in(&directory).map_err(|e| e.to_string())?;
            std::io::copy(&mut File::open(source).map_err(|e| e.to_string())?, temp.as_file_mut())
                .map_err(|e| e.to_string())?;
            temp.as_file_mut().sync_all().map_err(|e| e.to_string())?;
            match temp.persist_noclobber(final_path) {
                Ok(_) => created.push(final_path.to_owned()),
                Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {
                    conflict = true;
                    break;
                }
                Err(e) => {
                    for path in created { let _ = fs::remove_file(path); }
                    return Err(format!("Archive could not be saved: {}", e.error));
                }
            }
        }
        if conflict {
            for path in created { let _ = fs::remove_file(path); }
            continue;
        }
        return Ok(ArchiveCreated {
            output_paths: paths.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
            format: job.format,
        });
    }
    Err("Too many existing archives have the same name".into())
}

#[tauri::command]
pub async fn archive_create(job: ArchiveCreate) -> Result<ArchiveCreated, String> {
    tauri::async_runtime::spawn_blocking(move || create(job))
        .await.map_err(|_| "Archive worker failed".to_owned())?
}

pub(crate) fn validate_member_name(name: &str) -> Result<(), String> {
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains(':') || normalized.contains('\0') {
        return Err("Archive contains an unsafe absolute or alternate-stream path".into());
    }
    let path = Path::new(&normalized);
    if path.components().any(|p| matches!(p, Component::ParentDir | Component::Prefix(_) | Component::RootDir)) {
        return Err("Archive contains a path escaping its destination".into());
    }
    if path.components().count() > 32 {
        return Err("Archive nesting is too deep".into());
    }
    Ok(())
}

fn check_listing(binary: &Path, source: &Path, password: Option<&str>) -> Result<(), String> {
    let mut command = Command::new(binary);
    command.args(["l", "-slt", "-bd", "-y"]);
    if let Some(password) = password {
        command.arg(format!("-p{password}"));
    }
    command.arg(source).stdin(Stdio::null()).stderr(Stdio::null()).stdout(Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("Cannot inspect archive: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("Could not read archive listing")?;
    let mut listing = Vec::new();
    // Bound output, including malicious archives with millions of entries.
    stdout.by_ref().take(MAX_LISTING_BYTES + 1).read_to_end(&mut listing)
        .map_err(|e| e.to_string())?;
    if listing.len() as u64 > MAX_LISTING_BYTES {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Archive listing exceeds safety limits".into());
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() { return Err("Cannot list archive contents. Check the password or format.".into()); }

    let listing = String::from_utf8_lossy(&listing);
    let mut content = false;
    let mut count = 0usize;
    let mut total = 0u64;
    for line in listing.lines() {
        if line.starts_with("----------") {
            content = true;
            continue;
        }
        if !content { continue; }
        if let Some(name) = line.strip_prefix("Path = ") {
            count += 1;
            if count > MAX_ARCHIVE_ENTRIES { return Err("Too many files in archive".into()); }
            validate_member_name(name)?;
        }
        if let Some(size) = line.strip_prefix("Size = ") {
            let size = size.trim().parse::<u64>().map_err(|_| "Invalid archive size field")?;
            total = total.saturating_add(size);
            if total > MAX_UNPACKED_BYTES { return Err("Archive exceeds the 4 GB extraction limit".into()); }
        }
        if line.starts_with("Symbolic Link = ") || line.starts_with("Hard Link = ") {
            return Err("Links in archives are blocked to protect the destination".into());
        }
        if let Some(attributes) = line.strip_prefix("Attributes = ") {
            if attributes.contains("L") && attributes.trim() != "LZ" {
                return Err("Archive contains a link-like entry and cannot be safely extracted".into());
            }
        }
    }
    if count == 0 { return Err("Archive appears empty or unsupported".into()); }
    Ok(())
}

fn verify_extracted(dir: &Path) -> Result<(), String> {
    let mut count = 0;
    let mut size = 0u64;
    for entry in WalkDir::new(dir).follow_links(false).max_depth(32) {
        let entry = entry.map_err(|e| format!("Cannot inspect extracted files: {e}"))?;
        if entry.depth() == 0 { continue; }
        count += 1;
        if count > MAX_ARCHIVE_ENTRIES { return Err("Archive exceeds file-count limits".into()); }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("Archive contains a link; extraction was discarded".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("Archive contains an unsafe reparse point".into());
            }
        }
        if metadata.is_file() {
            size = size.saturating_add(metadata.len());
            if size > MAX_UNPACKED_BYTES { return Err("Archive expands beyond 4 GB".into()); }
        }
    }
    Ok(())
}

fn native_zip_container(path: &Path) -> bool {
    // These formats are ZIP containers. Other archive formats still require 7-Zip.
    path.extension().and_then(|x| x.to_str()).is_some_and(|ext|
        matches!(ext.to_ascii_lowercase().as_str(),
            "zip" | "jar" | "war" | "ear" | "cbz" | "epub"))
}

fn extract(job: ArchiveExtract) -> Result<String, String> {
    validate_password(&job.password)?;
    let input = PathBuf::from(&job.path);
    if native_zip_container(&input) {
        return crate::native_zip::extract_native_zip(
            &job.path, job.destination.as_deref(), job.password.as_deref());
    }
    let sevenzip = seven_zip().ok_or("7-Zip is required for this extraction. Install 7-Zip and retry.")?;
    verify_input(&input, false)?;
    let directory = output_dir(&input, job.destination.as_deref())?;
    check_listing(&sevenzip, &input, job.password.as_deref())?;
    let stage = tempfile::Builder::new().prefix(".reformany-extract-")
        .tempdir_in(&directory).map_err(|e| e.to_string())?;
    let mut args: Vec<OsString> = vec!["x".into(), "-y".into(), "-bd".into(), "-aoa".into()];
    args.push(format!("-o{}", stage.path().to_string_lossy()).into());
    if let Some(password) = &job.password { args.push(format!("-p{password}").into()); }
    args.push(input.as_os_str().to_os_string());
    crate::external::run(&sevenzip, &args, None)?;
    verify_extracted(stage.path())?;
    let name = input.file_stem().and_then(|s| s.to_str()).unwrap_or("Archive");
    let safe_name: String = name.chars().filter(|ch| !"/\\:*?\"<>|".contains(*ch)).take(90).collect();
    let safe_name = if safe_name.is_empty() { "Archive" } else { &safe_name };
    // Never extract directly over existing user folders.
    for suffix in 0..1000 {
        let folder = if suffix == 0 {
            format!("{safe_name} extracted")
        } else {
            format!("{safe_name} extracted ({suffix})")
        };
        let destination = directory.join(folder);
        match fs::create_dir(&destination) {
            Ok(_) => {
                // Moving from staging into a newly created private folder ensures
                // existing user files are not overwritten.
                let result = (|| -> Result<(), String> {
                    for item in fs::read_dir(stage.path()).map_err(|e| e.to_string())? {
                        let item = item.map_err(|e| e.to_string())?;
                        fs::rename(item.path(), destination.join(item.file_name()))
                            .map_err(|e| format!("Cannot move extracted item: {e}"))?;
                    }
                    Ok(())
                })();
                if let Err(error) = result {
                    let _ = fs::remove_dir_all(&destination);
                    return Err(error);
                }
                return Ok(destination.to_string_lossy().into_owned());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Cannot create extraction folder: {e}")),
        }
    }
    Err("Too many existing extraction folders".into())
}

#[tauri::command]
pub async fn archive_extract(job: ArchiveExtract) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || extract(job))
        .await.map_err(|_| "Archive extraction worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_java_and_book_zip_containers_without_7zip() {
        for ext in ["zip", "ZIP", "jar", "WAR", "ear", "cbz", "epub"] {
            assert!(native_zip_container(Path::new(&format!("package.{ext}"))), "{ext}");
        }
        for ext in ["7z", "rar", "tar", "iso", "exe"] {
            assert!(!native_zip_container(Path::new(&format!("archive.{ext}"))), "{ext}");
        }
    }

    #[test]
    fn extracts_ear_using_native_zip_engine() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("enterprise.ear");
        let file = File::create(&input).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        use std::io::Write;
        writer.start_file("META-INF/application.xml", zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(b"<application/>").unwrap();
        writer.finish().unwrap();
        let extracted = extract(ArchiveExtract {
            path: input.to_string_lossy().into_owned(), destination: None, password: None,
        }).unwrap();
        assert_eq!(
            fs::read(Path::new(&extracted).join("META-INF/application.xml")).unwrap(),
            b"<application/>"
        );
    }

    fn sample(format: &str) -> ArchiveCreate {
        ArchiveCreate { paths: vec!["C:\\example\\doc.txt".into()],
            destination: None, name: "Backup".into(), format: format.into(),
            password: None, split_megabytes: None, level: 5 }
    }

    #[test]
    fn refuses_path_traversal_and_ntfs_streams() {
        for unsafe_path in ["../data.txt", "C:/Windows/system.ini", "/etc/passwd",
            "..\\secret", "folder/../../../secret", "photo.txt:payload"] {
            assert!(validate_member_name(unsafe_path).is_err(), "{unsafe_path}");
        }
        assert!(validate_member_name("images/photo.png").is_ok());
    }

    #[test]
    fn validates_format_and_password_split_policy() {
        assert!(archive_format("rar").is_ok());
        assert!(archive_format("zip").is_ok());
        assert!(archive_format("arj").is_err()); // read-only
        assert!(validate_password(&Some("secure pass".into())).is_ok());
        assert!(validate_password(&Some("".into())).is_err());
        let mut job = sample("tar");
        job.split_megabytes = Some(100);
        assert!(!matches!(job.format.as_str(), "7z" | "zip" | "rar"));
        job.split_megabytes = None;
        assert!(validate_archive_name(&job.name).is_ok());
        assert!(validate_archive_name("../bad").is_err());
    }

    #[test]
    fn source_folders_are_not_destroyed_by_validation() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.png"), b"test").unwrap();
        assert!(verify_input(dir.path(), true).is_ok());
        assert!(dir.path().join("a.png").exists());
    }
    #[test]
    fn encrypted_split_7z_roundtrip_when_seven_zip_is_installed() {
        if seven_zip().is_none() {
            eprintln!("7-Zip not installed; integration smoke test skipped");
            return;
        }
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("hello.txt");
        fs::write(&file, b"Original contents remain untouched").unwrap();
        let output = create(ArchiveCreate {
            paths: vec![file.to_string_lossy().into_owned()],
            destination: Some(temp.path().to_string_lossy().into_owned()),
            name: "Encrypted test".into(), format: "7z".into(),
            password: Some("A non-trivial test passphrase!".into()),
            split_megabytes: Some(1), level: 1,
        }).unwrap();
        assert!(!output.output_paths.is_empty());
        assert!(output.output_paths[0].ends_with(".7z.001"));
        let folder = extract(ArchiveExtract {
            path: output.output_paths[0].clone(),
            destination: Some(temp.path().to_string_lossy().into_owned()),
            password: Some("A non-trivial test passphrase!".into()),
        }).unwrap();
        let files: Vec<_> = WalkDir::new(&folder).into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file()).collect();
        assert!(!files.is_empty());
        assert_eq!(fs::read(&file).unwrap(), b"Original contents remain untouched");
    }

}
