//! Noter desktop (Tauri v2) — the Rust core that replaces the Electron main process.
//!
//! Migration status: Phase 0 — scaffold + the two security/foundation surfaces (secure store,
//! settings). The remaining Electron IPC channels (mlc, updater, dialogs, notifications, tray,
//! deep-link, print, find-in-page, …) are ported in subsequent phases per
//! `Doc/migrations/electron-to-tauri-runbook.md`. The shared Next.js static UI is reused unchanged.

mod deeplink;
mod mlc;
mod secure_store;
mod settings;
mod tray;
mod windows;

use settings::SettingsState;
use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;

/// The preload bridge (window.mlc / window.noterDesktop) injected before the app loads, so the shared
/// Next.js UI runs unchanged. Embedded at compile time.
const PRELOAD_BRIDGE: &str = include_str!("../bridge/preload-bridge.js");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance MUST be registered first: a second launch focuses the running window
        // instead of opening a duplicate app (parity with the Electron single-instance lock).
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
                let _ = w.unminimize();
            }
            // A second launch may carry a noter:// deep-link or a .noter file (Windows/Linux); route it.
            if let Some(route) = deeplink::find_deeplink_in_argv(&args) {
                let _ = app.emit("note:open", serde_json::json!({ "deeplink": route }));
            } else if let Some(path) = deeplink::find_noter_file_in_argv(&args) {
                let _ = app.emit("file:open", serde_json::json!({ "path": path }));
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // Seed the in-memory settings from disk once at startup.
            let handle = app.handle().clone();
            let initial = settings::load(&handle);
            app.manage(SettingsState(Mutex::new(initial)));

            // Stash any cold-start open (noter:// link / .noter file on the launch argv) for the main
            // window's UI to drain once it registers its handlers. Keyed by window label — note
            // windows (open_note_window) get their own entries.
            let argv: Vec<String> = std::env::args().collect();
            let mut pending = std::collections::HashMap::new();
            let main_pending = deeplink::pending_from_argv(&argv);
            if !main_pending.is_empty() {
                pending.insert("main".to_string(), main_pending);
            }
            app.manage(deeplink::PendingOpens(Mutex::new(pending)));

            // Build the main window ourselves so we can inject the preload bridge before page load.
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Noter")
                .inner_size(1200.0, 800.0)
                .min_inner_size(640.0, 480.0)
                .initialization_script(PRELOAD_BRIDGE)
                .build()?;

            // System-theme signal: mirror Electron's `theme:updated` { shouldUseDarkColors } so the
            // UI's dark-mode sync works unchanged. Emitted on OS theme changes.
            let emitter = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::ThemeChanged(theme) = event {
                    let dark = matches!(theme, tauri::Theme::Dark);
                    let _ = emitter.emit("theme:updated", serde_json::json!({ "shouldUseDarkColors": dark }));
                }
            });

            // Deep-link runtime handler: macOS delivers noter:// while running via `open_url`; parse it
            // through the trusted validator and emit only a validated internal route. Cold-start
            // file/link launch (app not yet running) is a follow-up — it needs a ready handshake so the
            // event isn't emitted before the UI subscribes.
            let dl_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for u in event.urls() {
                    if let Some(route) = deeplink::parse_deeplink(u.as_str()) {
                        let _ = dl_handle.emit("note:open", serde_json::json!({ "deeplink": route }));
                        break;
                    }
                }
            });

            // System tray (icon + menu + Tray-only). Non-fatal if it fails to build.
            if let Err(e) = tray::build(app.handle()) {
                eprintln!("tray init failed: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secure_store::secure_status,
            secure_store::secure_get,
            secure_store::secure_set,
            secure_store::secure_delete,
            secure_store::secure_clear,
            settings::settings_get,
            settings::settings_set,
            deeplink::take_pending_opens,
            mlc::mlc_get_models,
            mlc::mlc_delete_model,
            windows::open_note_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Noter (Tauri)");
}
