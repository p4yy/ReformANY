mod conversion;
mod orbit;
mod scan;
mod external;
mod media;
mod archives;
mod actions;
mod native_zip;
mod documents;
mod ebooks;
mod media_tools;
mod preview;
mod update;
mod svg_image;
mod subtitles;
mod spreadsheets;
mod engine_progress;
mod file_parts;
mod pdf_split;
mod pdf_ops;
mod pdf_raster;
mod pdf_images;
mod pdf_marks;
mod pdf_arrange;
mod pdf_security;
mod shred;
mod job_settings;
mod auto_convert;
mod shake;
mod pdf_docx;
mod qr;
mod text_convert;
mod ui_bridge;

use conversion::{cancel_batch, convert_batch, inspect_files, BatchRegistry};
use orbit::{image_thumbnail, orbit_context, orbit_set_context, orbit_open_workspace, orbit_launch_file, orbit_initial_tab, orbit_was_shaken, orbit_preview, reveal_output, OrbitLaunch};
use scan::expand_inputs;
use external::engine_status;
use media::{media_convert,media_details};
use archives::{archive_create, archive_extract, archive_repack};
use actions::{rename_file, open_terminal, send_bluetooth, hover_file, hover_file_context, copy_file_to, HoveRRegistry};
use documents::{images_to_pdf, pdf_to_text, pdf_to_text_format, office_to_pdf, office_available};
use text_convert::text_convert;
use ui_bridge::{ui_file_stat,ui_file_read,ui_save_output,ui_shred,ui_destination,media_thumbnail};
use ebooks::{ebook_convert_file, ebook_engine_available};
use media_tools::media_edit;
use preview::document_preview;
use update::open_manual_updates;
use subtitles::subtitle_convert;
use spreadsheets::spreadsheet_convert;
use engine_progress::{cancel_engine_job, JobRegistry};
use file_parts::{file_split, file_join};
use pdf_split::pdf_split;
use pdf_ops::{pdf_page_count, pdf_extract_pages, pdf_rotate_pages};
use pdf_raster::pdf_save_rendered_pages;
use pdf_images::pdf_extract_images;
use pdf_marks::pdf_add_mark;
use pdf_arrange::pdf_arrange_pages;
use pdf_security::{pdf_protect,pdf_unlock};
use shred::{shred_preview,shred_confirm};
use job_settings::{get_queue_policy,set_queue_policy};
use shake::{set_orbit_sound_preferences,orbit_play_sound};
use auto_convert::{WatchRegistry,get_watch_rules,add_watch_rule,remove_watch_rule};
use shake::{get_shake_settings,set_shake_settings};
use pdf_docx::{pdf_docx_editable,pdf_docx_layout};
use qr::{qr_svg, qr_save_svg};
use tauri::{WebviewUrl, WebviewWindowBuilder};


/** Separate transparent native tool window. The file remains in OrbitLaunch's
 * process-local context; no untrusted path is put in the WebView URL. */
#[tauri::command]
async fn orbit_open_panel(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    if !matches!(kind.as_str(), "sign" | "watermark" | "split-pdf" |
        "arrange" | "password-zip" | "split-binary" | "rename" |
        "shred" | "more-tools" | "pdf-password") {
        return Err("Unsupported Orbit tool".into());
    }
    let wide = matches!(kind.as_str(), "sign" | "watermark" | "arrange");
    let label = format!("orbit-panel-{}-{}", kind, uuid::Uuid::new_v4().simple());
    let (width, height) = if wide { (1080.0, 760.0) } else { (720.0, 710.0) };
    // Avoid blocking the WebView IPC executor while creating a native window.
    tauri::async_runtime::spawn_blocking(move || {
        WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
            .title("ReformANY Orbit tool")
            .inner_size(width, height)
            .min_inner_size(500.0, 480.0)
            .resizable(true)
            .decorations(false)
            .shadow(false)
            // Only the circular Orbit window is transparent. Tool windows
            // must be fully opaque to prevent Windows compositor ghost frames.
            .transparent(false)
            .always_on_top(true)
            .center()
            .focused(true)
            .build()
            .map_err(|error| format!("Could not create Orbit tool window: {error}"))
            .map(|_| ())
    }).await.map_err(|error| format!("Orbit panel task failed: {error}"))??;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Background gesture watcher has no WebView, console, or main window.
    // A separate user-session process can remain active after the UI exits.
    let command = std::env::args_os().nth(1)
        .map(|arg| arg.to_string_lossy().into_owned()).unwrap_or_default();
    if command == "--shake-listener" { shake::run_listener(); return; }
    if command == "--shake-stop" { shake::stop_listener(); return; }
    let orbit_args = std::env::args_os().skip(1).collect::<Vec<_>>();
    let orbit_path = orbit::parse_orbit_args(orbit_args.iter().cloned());
    let orbit_tab = orbit::parse_orbit_tab(orbit_args.iter().cloned());
    let from_shake = orbit::parse_orbit_from_shake(orbit_args);
    let orbit_mode = orbit_path.is_some();

    tauri::Builder::default()
        .manage(BatchRegistry::default())
        .manage(JobRegistry::default())
        .manage(WatchRegistry::default())
        .manage(OrbitLaunch::new_with_tab(orbit_path, orbit_tab, from_shake))
        .manage(HoveRRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            inspect_files,
            expand_inputs,
            convert_batch,
            cancel_batch,
            orbit_context,
            orbit_set_context,
            orbit_preview,
            image_thumbnail,
            orbit_open_workspace,
            orbit_launch_file,
            orbit_initial_tab,
            orbit_was_shaken,
            set_orbit_sound_preferences,
            orbit_play_sound,
            reveal_output,
            engine_status,
            media_convert,
            media_details,
            archive_create,
            archive_extract,
            archive_repack,
            rename_file,
            open_terminal,
            send_bluetooth,
            hover_file,
            hover_file_context,
            copy_file_to,
            images_to_pdf,
            text_convert,
            ui_file_stat,
            ui_file_read,
            ui_save_output,
            ui_shred,
            ui_destination,
            media_thumbnail,
            orbit_open_panel,
            pdf_to_text,
            pdf_to_text_format,
            office_to_pdf,
            office_available,
            ebook_convert_file,
            ebook_engine_available,
            media_edit,
            document_preview,
            open_manual_updates,
            file_split,
            file_join,
            pdf_split,
            pdf_page_count,
            pdf_extract_pages,
            pdf_rotate_pages,
            pdf_save_rendered_pages,
            pdf_extract_images,
            pdf_add_mark,
            pdf_arrange_pages,
            pdf_protect,
            pdf_unlock,
            shred_preview,
            shred_confirm,
            get_queue_policy,
            set_queue_policy,
            get_watch_rules,
            add_watch_rule,
            remove_watch_rule,
            get_shake_settings,
            set_shake_settings,
            pdf_docx_editable,
            pdf_docx_layout,
            qr_svg,
            qr_save_svg,
            subtitle_convert,
            spreadsheet_convert,
            cancel_engine_job
        ])
        .setup(move |app| {
            if orbit_mode {
                let window = WebviewWindowBuilder::new(
                    app,
                    "orbit",
                    WebviewUrl::App("index.html".into()),
                )
                .title("ReformANY Orbit")
                .inner_size(580.0, 580.0)
                .resizable(false)
                .decorations(false)
                // Windows 11 draws a square native shadow around transparent, undecorated windows.
                // Orbit provides its own circular CSS shadow instead.
                .shadow(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(true)
                .build()?;
                orbit::position_near_cursor(&window);
            } else {
                auto_convert::restore(app.handle());
                shake::start_when_enabled();
                WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::App("index.html".into()),
                )
                .title("ReformANY")
                .inner_size(1280.0, 820.0)
                .min_inner_size(960.0, 640.0)
                .decorations(false)
                .shadow(false)
                .center()
                .build()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ReformANY failed to start");
}
