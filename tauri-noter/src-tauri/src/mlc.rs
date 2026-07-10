//! On-device model registry — the data layer of the mlc (on-device AI) surface.
//!
//! This is the Rust port of the *registry* half of `electron-noter/src/mlc.js`: the JSON model index
//! (`mlc_models/index.json`) that backs the `mlc_get_models` / `mlc_delete_model` commands. Fully
//! unit-tested, no external tools.
//!
//! The *subprocess* half (download GGUF → `mlc_llm convert` → `mlc_llm chat` token streaming, plus the
//! quantization mapping and per-model directory layout it needs) is a separate phase: it requires the
//! `mlc_llm` binary + an HTTP client + a GUI to validate end-to-end. It is intentionally NOT landed
//! here — landing unrunnable code (and the dead quant/dir helpers it would need) would be sloppy.
//! Model *discovery* (HuggingFace search) already works directly from the bridge. See the runbook.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// `<base>/mlc_models`
fn models_root(base: &Path) -> PathBuf {
    base.join("mlc_models")
}

/// `<base>/mlc_models/index.json`
fn index_path(base: &Path) -> PathBuf {
    models_root(base).join("index.json")
}

/// Read the model registry; a missing/corrupt file yields an empty list (never an error) — mirrors JS.
fn read_index(base: &Path) -> Vec<serde_json::Value> {
    match std::fs::read_to_string(index_path(base)) {
        Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(serde_json::Value::Array(arr)) => arr,
            _ => Vec::new(),
        },
        Err(_) => Vec::new(),
    }
}

/// Persist the registry (pretty JSON), creating the models dir if needed.
fn write_index(base: &Path, data: &[serde_json::Value]) -> std::io::Result<()> {
    std::fs::create_dir_all(models_root(base))?;
    let json = serde_json::to_string_pretty(&data).unwrap_or_else(|_| "[]".into());
    std::fs::write(index_path(base), json)
}

/// Delete a model by registry id: remove its package dir and its registry entry. Returns whether an
/// entry was found. A missing on-disk dir is not an error (the registry entry is still cleaned up).
fn delete_model_at(base: &Path, id: &str) -> std::io::Result<bool> {
    let models = read_index(base);
    let Some(entry) = models.iter().find(|m| m.get("id").and_then(|v| v.as_str()) == Some(id)) else {
        return Ok(false);
    };
    if let Some(path) = entry.get("path").and_then(|v| v.as_str()) {
        // best-effort: a missing dir must not fail the registry cleanup
        let _ = std::fs::remove_dir_all(path);
    }
    let remaining: Vec<serde_json::Value> = models
        .into_iter()
        .filter(|m| m.get("id").and_then(|v| v.as_str()) != Some(id))
        .collect();
    write_index(base, &remaining)?;
    Ok(true)
}

/// Resolve the app's data dir (where `mlc_models/` lives).
fn base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("no app data dir: {e}"))
}

/// List installed on-device models (empty until the subprocess phase can install any).
#[tauri::command]
pub fn mlc_get_models(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    Ok(read_index(&base_dir(&app)?))
}

/// Delete an installed model by registry id.
#[tauri::command]
pub fn mlc_delete_model(app: AppHandle, id: String) -> Result<bool, String> {
    delete_model_at(&base_dir(&app)?, &id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Isolated temp base dir per test (no external deps; uses the OS temp dir + the test name).
    fn temp_base(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("noter-mlc-test-{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_index_is_empty_for_missing_or_corrupt() {
        let base = temp_base("read");
        assert!(read_index(&base).is_empty());
        std::fs::create_dir_all(models_root(&base)).unwrap();
        std::fs::write(index_path(&base), "not json").unwrap();
        assert!(read_index(&base).is_empty());
    }

    #[test]
    fn write_then_read_round_trips() {
        let base = temp_base("roundtrip");
        let data = vec![serde_json::json!({ "id": "m:Q4_K_M", "modelId": "m", "path": "/x" })];
        write_index(&base, &data).unwrap();
        let back = read_index(&base);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0]["id"], "m:Q4_K_M");
    }

    #[test]
    fn delete_model_removes_dir_and_entry_and_reports_found() {
        let base = temp_base("delete");
        let pkg = models_root(&base).join("m").join("Q4_K_M");
        std::fs::create_dir_all(&pkg).unwrap();
        let data = vec![
            serde_json::json!({ "id": "m:Q4_K_M", "path": pkg.to_string_lossy() }),
            serde_json::json!({ "id": "other:Q4_K_M", "path": "/nonexistent" }),
        ];
        write_index(&base, &data).unwrap();

        assert!(delete_model_at(&base, "m:Q4_K_M").unwrap());
        assert!(!pkg.exists(), "package dir should be removed");
        let remaining = read_index(&base);
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0]["id"], "other:Q4_K_M");

        // deleting an unknown id reports not-found and leaves the registry intact
        assert!(!delete_model_at(&base, "missing").unwrap());
        assert_eq!(read_index(&base).len(), 1);
    }
}
