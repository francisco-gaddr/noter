//! Noter desktop (Tauri v2) — the Rust core that replaces the Electron main process.
//!
//! Migration status: Phase 0 — scaffold + the two security/foundation surfaces (secure store,
//! settings). The remaining Electron IPC channels (mlc, updater, dialogs, notifications, tray,
//! deep-link, print, find-in-page, …) are ported in subsequent phases per
//! `Doc/migrations/electron-to-tauri-runbook.md`. The shared Next.js static UI is reused unchanged.

mod secure_store;
mod settings;

use settings::SettingsState;
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// The preload bridge (window.mlc / window.noterDesktop) injected before the app loads, so the shared
/// Next.js UI runs unchanged. Embedded at compile time.
const PRELOAD_BRIDGE: &str = include_str!("../bridge/preload-bridge.js");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Seed the in-memory settings from disk once at startup.
            let handle = app.handle().clone();
            let initial = settings::load(&handle);
            app.manage(SettingsState(Mutex::new(initial)));

            // Build the main window ourselves so we can inject the preload bridge before page load.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Noter")
                .inner_size(1200.0, 800.0)
                .min_inner_size(640.0, 480.0)
                .initialization_script(PRELOAD_BRIDGE)
                .build()?;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Noter (Tauri)");
}
