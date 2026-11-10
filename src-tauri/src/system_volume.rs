//! Real Windows default-render-endpoint volume, through Core Audio COM.
//! Not a simulated WebView slider and not a media-player-only gain setting.
#[cfg(windows)]
fn endpoint_volume(target: Option<u8>) -> Result<u8, String> {
    use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()
            .map_err(|error| format!("Cannot initialize Windows audio: {error}"))?;
        let result = (|| -> windows::core::Result<u8> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
            let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            if let Some(value) = target {
                volume.SetMasterVolumeLevelScalar(f32::from(value) / 100.0, std::ptr::null())?;
            }
            Ok((volume.GetMasterVolumeLevelScalar()? * 100.0).round().clamp(0.0, 100.0) as u8)
        })();
        CoUninitialize();
        result.map_err(|error| format!("Windows output volume unavailable: {error}"))
    }
}

#[tauri::command]
pub async fn get_system_volume() -> Result<u8, String> {
    #[cfg(windows)]
    { tauri::async_runtime::spawn_blocking(|| endpoint_volume(None)).await.map_err(|e| e.to_string())? }
    #[cfg(not(windows))]
    { Err("System volume control is available in the Windows desktop app only".into()) }
}

#[tauri::command]
pub async fn set_system_volume(level: u8) -> Result<u8, String> {
    if level > 100 { return Err("Volume must be between 0 and 100".into()); }
    #[cfg(windows)]
    { tauri::async_runtime::spawn_blocking(move || endpoint_volume(Some(level))).await.map_err(|e| e.to_string())? }
    #[cfg(not(windows))]
    { Err("System volume control is available in the Windows desktop app only".into()) }
}
