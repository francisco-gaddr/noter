// Prevents an extra console window on Windows in release builds (parity with the Electron app).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    noter_tauri_lib::run()
}
