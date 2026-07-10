//! Multi-window — parity with Electron's `note:open-window`: open a note in its own window. The new
//! window loads the same frontend with the same preload bridge; its note route is delivered through
//! the per-window `PendingOpens` queue, which the window's UI drains once its handlers are registered
//! (same no-race handshake as cold-start deep-links). Closing a note window never affects the main one.

use crate::deeplink::{self, PendingOpens};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

/// Monotonic suffix so every note window gets a unique label (labels must be unique in Tauri).
static NEXT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

const PRELOAD_BRIDGE: &str = include_str!("../bridge/preload-bridge.js");

/// Open the given note in a new window. Mirrors Electron's `{ ok, reason }` result shape.
#[tauri::command]
pub fn open_note_window(
    app: AppHandle,
    state: tauri::State<'_, PendingOpens>,
    id: String,
) -> Result<serde_json::Value, String> {
    // Same trust boundary as deep-links: only a validated id may become a route.
    if !deeplink::is_valid_id(&id) {
        return Ok(serde_json::json!({ "ok": false, "reason": "invalid-note-id" }));
    }

    let label = format!("note-{}", NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed));

    // Queue the route for THIS window before it exists — its UI drains it on handler registration.
    state
        .0
        .lock()
        .unwrap()
        .insert(label.clone(), vec![serde_json::json!({
            "event": "note:open",
            "payload": { "deeplink": format!("/note/{id}") }
        })]);

    match WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .title("Noter")
        .inner_size(1000.0, 700.0)
        .min_inner_size(480.0, 360.0)
        .initialization_script(PRELOAD_BRIDGE)
        .build()
    {
        Ok(_) => Ok(serde_json::json!({ "ok": true })),
        Err(e) => {
            // The window never came up — remove its queued entry so nothing leaks.
            state.0.lock().unwrap().remove(&label);
            Ok(serde_json::json!({ "ok": false, "reason": e.to_string() }))
        }
    }
}
