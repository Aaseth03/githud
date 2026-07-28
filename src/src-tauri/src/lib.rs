//! GIT HUD — Tauri core.
//!
//! M1 exposes exactly one command: scan the project root. Everything the UI
//! knows about a project arrives as a struct from here, never as prose parsed
//! in the front end (D11).

pub mod overrides;
pub mod scan;

use std::path::PathBuf;

use overrides::Overrides;
use scan::{ScanResult, DEFAULT_MAX_DEPTH};

/// Where projects live.
///
/// Hard-coded to `~/github` for M1. It becomes configurable when there is a
/// settings surface to configure it from; inventing one now would be
/// speculative.
fn project_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join("github"))
}

/// Scan the project root and return everything found — repos, plus root-level
/// folders that are not repos yet.
///
/// Returns an empty result rather than an error when the root does not exist —
/// a machine without `~/github` has no projects, which is a state, not a
/// failure.
#[tauri::command]
fn scan_projects() -> Result<ScanResult, String> {
    let root = project_root().ok_or_else(|| "could not resolve the home directory".to_string())?;

    // A malformed overrides file must not take the whole scan down — but it
    // must also not pass unnoticed, because a typo that silently reverts a
    // project to `own` + read-write is the failure this cannot have (D18).
    let (overrides, error) = match Overrides::load(&overrides_path()) {
        Ok(o) => (o, None),
        Err(e) => (Overrides::default(), Some(e)),
    };

    Ok(scan::scan_with(&root, DEFAULT_MAX_DEPTH, &overrides, error))
}

/// `config/projects.toml`, the committed half of the split store (D8).
///
/// Resolved relative to the repo during development. It becomes a bundled
/// resource path when the app ships; that belongs with packaging, not here.
fn overrides_path() -> PathBuf {
    if let Ok(explicit) = std::env::var("GITHUD_CONFIG_DIR") {
        return PathBuf::from(explicit).join("projects.toml");
    }
    // src-tauri/ → src/ → repo root → config/
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../config/projects.toml")
}

/// The absolute path being scanned, so the UI can show it rather than guess.
#[tauri::command]
fn scan_root() -> Result<String, String> {
    project_root()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "could not resolve the home directory".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![scan_projects, scan_root])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
