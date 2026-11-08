mod conversion;

use conversion::{cancel_batch, convert_batch, inspect_files, BatchRegistry};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BatchRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            inspect_files,
            convert_batch,
            cancel_batch
        ])
        .run(tauri::generate_context!())
        .expect("ReformANY failed to start");
}
