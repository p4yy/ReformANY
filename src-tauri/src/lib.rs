mod conversion;
mod orbit;
mod scan;

use conversion::{cancel_batch, convert_batch, inspect_files, BatchRegistry};
use orbit::{image_thumbnail, orbit_context, orbit_open_workspace, orbit_preview, reveal_output, OrbitLaunch};
use scan::expand_inputs;
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let orbit_path = orbit::parse_orbit_args(std::env::args_os().skip(1));
    let orbit_mode = orbit_path.is_some();

    tauri::Builder::default()
        .manage(BatchRegistry::default())
        .manage(OrbitLaunch::new(orbit_path))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            inspect_files,
            expand_inputs,
            convert_batch,
            cancel_batch,
            orbit_context,
            orbit_preview,
            image_thumbnail,
            orbit_open_workspace,
            reveal_output
        ])
        .setup(move |app| {
            if orbit_mode {
                let window = WebviewWindowBuilder::new(
                    app,
                    "orbit",
                    WebviewUrl::App("index.html".into()),
                )
                .title("ReformANY Orbit")
                .inner_size(400.0, 400.0)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(true)
                .build()?;
                orbit::position_near_cursor(&window);
            } else {
                WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::App("index.html".into()),
                )
                .title("ReformANY")
                .inner_size(1120.0, 760.0)
                .min_inner_size(750.0, 580.0)
                .center()
                .build()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ReformANY failed to start");
}
