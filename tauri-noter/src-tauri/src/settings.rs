//! App settings — the Tauri equivalent of the Electron `settings:get/set` IPC. A small JSON key-value
//! store cached in memory (Mutex) and persisted to `settings.json` in the OS app-config dir. These are
//! non-secret preferences (theme, openAtLogin, trayOnly, …); secrets go through `secure_store`.

use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct SettingsState(pub Mutex<Map<String, Value>>);

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| {
        let _ = std::fs::create_dir_all(&dir);
        dir.join("settings.json")
    })
}

/// Load the persisted settings from disk (called once at startup to seed the state).
pub fn load(app: &AppHandle) -> Map<String, Value> {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn persist(app: &AppHandle, map: &Map<String, Value>) {
    if let Some(p) = settings_path(app) {
        // Best-effort + never leaks: settings are non-secret. Pretty-print for human debuggability.
        let _ = std::fs::write(p, serde_json::to_string_pretty(&Value::Object(map.clone())).unwrap_or_default());
    }
}

#[tauri::command]
pub fn settings_get(state: tauri::State<'_, SettingsState>, key: String) -> Option<Value> {
    state.0.lock().ok().and_then(|m| m.get(&key).cloned())
}

/// Set (or remove, when the value is null) a setting and persist. Shared by the `settings_set` command
/// and internal callers (e.g. the tray's Tray-only toggle) so the write path is not duplicated.
pub fn set_value(app: &AppHandle, state: &SettingsState, key: &str, value: Value) {
    if let Ok(mut map) = state.0.lock() {
        if value.is_null() {
            map.remove(key);
        } else {
            map.insert(key.to_string(), value);
        }
        persist(app, &map);
    }
}

/// Read a boolean setting (defaulting to `false` when absent/other-typed). Used by the tray.
pub fn get_bool(state: &SettingsState, key: &str) -> bool {
    state.0.lock().ok().and_then(|m| m.get(key).and_then(Value::as_bool)).unwrap_or(false)
}

#[tauri::command]
pub fn settings_set(app: AppHandle, state: tauri::State<'_, SettingsState>, key: String, value: Value) {
    set_value(&app, &state, &key, value);
}
