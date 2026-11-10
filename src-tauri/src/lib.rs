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
mod system_volume;
mod portable_shell;

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
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use std::sync::atomic::{AtomicBool, Ordering};

/// A main-window UI preference. Never intercept Orbit or tool window closes.
struct CloseToTray(AtomicBool);

#[tauri::command]
fn set_close_to_tray(enabled: bool, state: tauri::State<'_, CloseToTray>) {
    state.0.store(enabled, Ordering::Release);
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}



/** Separate transparent native tool window. The file remains in OrbitLaunch's
 * process-local context; no untrusted path is put in the WebView URL. */
#[tauri::command]
async fn orbit_open_panel(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    if !matches!(kind.as_str(), "sign" | "watermark" | "split-pdf" |
        "arrange" | "extract-pages" | "password-zip" | "split-binary" | "rename" |
        "shred" | "more-tools" | "pdf-password") {
        return Err("Unsupported Orbit tool".into());
    }
    let wide = matches!(kind.as_str(), "sign" | "watermark" | "arrange" | "extract-pages");
    let label = format!("orbit-panel-{}-{}", kind, uuid::Uuid::new_v4().simple());
    let (width, height) = if wide { (1080.0, 760.0) } else { (720.0, 710.0) };
    // Avoid blocking the WebView IPC executor while creating a native window.
    tauri::async_runtime::spawn_blocking(move || {
        // Serialize native panel launches, so rapid double clicks cannot create
        // duplicated windows. A live panel of this kind is focused, not rebuilt.
        static PANEL_OPEN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _launch_guard = PANEL_OPEN_LOCK.lock()
            .map_err(|_| "Orbit panel launch lock is unavailable".to_owned())?;
        let prefix = format!("orbit-panel-{kind}-");
        let windows = app.webview_windows();
        if let Some(existing) = windows.values().find(|window| window.label().starts_with(&prefix)) {
            existing.unminimize().map_err(|error| error.to_string())?;
            existing.show().map_err(|error| error.to_string())?;
            existing.set_focus().map_err(|error| error.to_string())?;
            return Ok(());
        }
        drop(windows);
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
            .always_on_top(false)
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
    // Headless production probe: use only embedded engines, with a fresh
    // per-user cache, to prove this portable exe can truly encode offline.
    if command == "--portable-self-test" {
        let ffmpeg = external::find_binary("ffmpeg");
        let ffprobe = external::find_binary("ffprobe");
        let success = (|| -> Result<(), String> {
            let ffmpeg = ffmpeg.ok_or("Embedded FFmpeg missing")?;
            let ffprobe = ffprobe.ok_or("Embedded FFprobe missing")?;
            let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
            let audio = dir.path().join("portable-audio.wav");
            let mut encode = std::process::Command::new(&ffmpeg);
            external::hide_subprocess_window(&mut encode);
            let outcome = encode.args([
                "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                "anullsrc=r=44100:cl=mono", "-t", "0.2",
                "-c:a", "pcm_s16le", "-y",
            ]).arg(&audio).status().map_err(|e| e.to_string())?;
            if !outcome.success() || std::fs::metadata(&audio).map_or(true, |m| m.len() < 44) {
                return Err("Bundled FFmpeg could not encode actual WAV audio".into());
            }
            let mut probe = std::process::Command::new(&ffprobe);
            external::hide_subprocess_window(&mut probe);
            let outcome = probe.args(["-v", "error", "-show_entries",
                "stream=codec_name", "-of", "default=noprint_wrappers=1"])
                .arg(&audio).output().map_err(|e| e.to_string())?;
            if !outcome.status.success() || !String::from_utf8_lossy(&outcome.stdout).contains("pcm_s16le") {
                return Err("Bundled FFprobe could not inspect encoded audio".into());
            }
            Ok(())
        })();
        match success {
            Ok(()) => { println!("PASS: portable EXE encodes and probes real audio offline."); return; }
            Err(error) => { eprintln!("FAIL: portable EXE: {error}"); std::process::exit(1); }
        }
    }
    if command == "--portable-register-context" || command == "--portable-remove-context" {
        if let Err(error) = portable_shell::update(command == "--portable-register-context") {
            eprintln!("Portable Explorer integration failed: {error}");
            std::process::exit(1);
        }
        return;
    }
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
        .manage(CloseToTray(AtomicBool::new(true)))
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
            set_close_to_tray,
            system_volume::get_system_volume,
            system_volume::set_system_volume,
            portable_shell::portable_context_supported,
            portable_shell::set_portable_orbit_context,
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
                .inner_size(620.0, 680.0)
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
                if let Some(icon) = app.default_window_icon().cloned() {
                    let show = MenuItem::with_id(app, "show", "Open ReformANY", true, None::<&str>)?;
                    let quit = MenuItem::with_id(app, "quit", "Quit ReformANY", true, None::<&str>)?;
                    let menu = Menu::with_items(app, &[&show, &quit])?;
                    TrayIconBuilder::new()
                        .icon(icon)
                        .tooltip("ReformANY — running locally")
                        .menu(&menu)
                        .show_menu_on_left_click(false)
                        .on_menu_event(|app, event| {
                            if event.id().as_ref() == "show" { show_main(app); }
                            if event.id().as_ref() == "quit" { app.exit(0); }
                        })
                        .on_tray_icon_event(|tray, event| {
                            if let TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up, ..
                            } = event {
                                show_main(tray.app_handle());
                            }
                        })
                        .build(app)?;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "orbit" {
                // Dismiss the native wheel when Explorer or another window takes focus.
                // A separate tool transfers focus, so no stacked/doubled Orbit remains.
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = window.close();
                }
                return;
            }
            if window.label() != "main" { return; }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.app_handle().state::<CloseToTray>().0.load(Ordering::Acquire) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("ReformANY failed to start");
}
