//! OS-keychain secret store — the Tauri equivalent of the Electron `safeStorage` module.
//!
//! SECURITY: this holds ONLY small secrets (the auth token + the v3 `dataKey`), never note/task
//! content (that stays E2E-encrypted by `@repo/shared`). Secrets live in the OS secret service:
//! macOS Keychain, Windows Credential Manager, Linux libsecret — never in plaintext on disk.
//!
//! `clear()` needs to enumerate keys, but the OS APIs don't list them, so we keep a small index
//! (a JSON array of KEY NAMES only — no secret values) under its own keychain entry.

use keyring::Entry;
use std::fmt;

const SERVICE: &str = "com.noter.desktop";
const INDEX_KEY: &str = "__noter_secure_index";

/// A command error that serialises to a readable message for the frontend.
#[derive(Debug)]
pub struct SecureError(String);
impl fmt::Display for SecureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "{}", self.0) }
}
impl std::error::Error for SecureError {}
impl serde::Serialize for SecureError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> { s.serialize_str(&self.0) }
}
fn err(e: impl fmt::Display) -> SecureError { SecureError(e.to_string()) }

fn entry(key: &str) -> Result<Entry, SecureError> {
    Entry::new(SERVICE, key).map_err(err)
}

fn read_index() -> Vec<String> {
    entry(INDEX_KEY)
        .ok()
        .and_then(|e| e.get_password().ok())
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

fn write_index(keys: &[String]) {
    if let Ok(e) = entry(INDEX_KEY) {
        let _ = e.set_password(&serde_json::to_string(keys).unwrap_or_else(|_| "[]".into()));
    }
}

/// Is a real OS secret service usable? (Probe by attempting an entry handle + a read.)
#[tauri::command]
pub fn secure_status() -> bool {
    match entry("__noter_probe__") {
        Ok(e) => {
            // get_password on a missing key returns NoEntry (not an availability failure); either way
            // constructing + querying the entry proves the backend is reachable.
            matches!(e.get_password(), Ok(_) | Err(keyring::Error::NoEntry))
        }
        Err(_) => false,
    }
}

/// Decrypt-and-return a secret, or None if missing / unavailable.
#[tauri::command]
pub fn secure_get(key: String) -> Option<String> {
    entry(&key).ok().and_then(|e| e.get_password().ok())
}

#[tauri::command]
pub fn secure_set(key: String, value: String) -> Result<(), SecureError> {
    if key.is_empty() || key == INDEX_KEY {
        return Err(err("invalid key"));
    }
    entry(&key)?.set_password(&value).map_err(err)?;
    let mut idx = read_index();
    if !idx.iter().any(|k| k == &key) {
        idx.push(key);
        write_index(&idx);
    }
    Ok(())
}

#[tauri::command]
pub fn secure_delete(key: String) -> Result<(), SecureError> {
    if let Ok(e) = entry(&key) {
        let _ = e.delete_credential(); // absence is fine
    }
    let mut idx = read_index();
    idx.retain(|k| k != &key);
    write_index(&idx);
    Ok(())
}

/// Wipe every tracked secret (used on sign-out). Best-effort per key; always clears the index.
#[tauri::command]
pub fn secure_clear() -> Result<(), SecureError> {
    for k in read_index() {
        if let Ok(e) = entry(&k) {
            let _ = e.delete_credential();
        }
    }
    if let Ok(e) = entry(INDEX_KEY) {
        let _ = e.delete_credential();
    }
    Ok(())
}
