// No automatic network access: this opens the fixed project URL in an external
// browser only after the user explicitly clicks the Check for Updates control.
#[tauri::command]
pub fn open_manual_updates() -> Result<(), String> {
    const URL: &str = "https://github.com/p4yy/ReformANY/releases";
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(URL)
            .spawn()
            .map_err(|e| format!("Unable to open update page: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = URL;
        Err("Manual update link is currently supported on Windows".into())
    }
}
