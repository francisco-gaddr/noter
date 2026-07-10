//! System tray — parity with the Electron `Tray`: an icon + tooltip, left-click shows/focuses the
//! window, and a menu with Show / Tray-only / Quit. "Tray-only" persists via `settings` and, on macOS,
//! hides the app from the Dock (accessory mode) — matching Electron's `applyTrayOnlyMode`.
//!
//! The tray icon reuses the bundled app icon (`default_window_icon`), so there is no separate asset.

use crate::settings::{self, SettingsState};
use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const KEY_TRAY_ONLY: &str = "trayOnly";

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn read_tray_only(app: &AppHandle) -> bool {
    app.try_state::<SettingsState>()
        .map(|s| settings::get_bool(&s, KEY_TRAY_ONLY))
        .unwrap_or(false)
}

fn set_tray_only(app: &AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<SettingsState>() {
        settings::set_value(app, &state, KEY_TRAY_ONLY, serde_json::Value::Bool(enabled));
    }
    apply_dock_visibility(app, enabled);
}

/// macOS: Tray-only ⇒ hide from the Dock (accessory activation policy). No-op elsewhere (mirrors
/// Electron, whose Tray-only Dock-hiding was darwin-only).
#[cfg(target_os = "macos")]
fn apply_dock_visibility(app: &AppHandle, tray_only: bool) {
    let policy = if tray_only {
        tauri::ActivationPolicy::Accessory
    } else {
        tauri::ActivationPolicy::Regular
    };
    let _ = app.set_activation_policy(policy);
}
#[cfg(not(target_os = "macos"))]
fn apply_dock_visibility(_app: &AppHandle, _tray_only: bool) {}

/// Build the tray icon + menu and apply the persisted Tray-only state. Called once at startup.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let tray_only = read_tray_only(app);

    let show = MenuItemBuilder::with_id("show", "Visa Noter").build(app)?;
    let tray_only_item = CheckMenuItemBuilder::with_id("trayonly", "Tray-only (dölj i Dock)")
        .checked(tray_only)
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Avsluta Noter").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &tray_only_item])
        .separator()
        .item(&quit)
        .build()?;

    // Keep the checkbox visual in sync when toggled from the menu.
    let check_handle = tray_only_item.clone();
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Noter")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            "trayonly" => {
                let next = !read_tray_only(app);
                set_tray_only(app, next);
                let _ = check_handle.set_checked(next);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    // Reuse the bundled app icon as the tray icon (no separate asset needed).
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;

    // Apply the persisted Dock visibility on launch.
    apply_dock_visibility(app, tray_only);
    Ok(())
}
