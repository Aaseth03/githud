//! GIT HUD — Tauri core.
//!
//! M1 exposes exactly one command: scan the project root. Everything the UI
//! knows about a project arrives as a struct from here, never as prose parsed
//! in the front end (D11).

pub mod overrides;
pub mod pty;
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

// ── Channel 1: the terminal (D1) ─────────────────────────────────────────────
//
// Raw bytes both ways. Nothing here parses anything, and nothing here emits an
// `AgentEvent` — Channel 2's stream is separate by design.

/// Payload for `pty://output`. `data` is base64 because PTY output is arbitrary
/// bytes and a read can split a UTF-8 or escape sequence in half.
#[derive(Clone, serde::Serialize)]
struct PtyOutput {
    id: String,
    data: String,
}

/// Start a shell for a project, or reattach to the one already running.
///
/// The reader owns a dedicated thread because reading a PTY blocks. It emits
/// chunks rather than single reads so a `yes` flood does not become an IPC
/// flood.
#[tauri::command]
fn pty_open(
    app: tauri::AppHandle,
    terminals: tauri::State<'_, pty::Terminals>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    use base64::Engine as _;
    use tauri::Emitter as _;

    let Some(mut reader) = terminals.spawn(&id, std::path::Path::new(&cwd), cols, rows)? else {
        // Already running — the UI reattaches to the existing scrollback.
        return Ok(());
    };

    let terminals = (*terminals).clone();
    std::thread::spawn(move || {
        let mut buf = vec![0u8; pty::read_buffer_size()];
        loop {
            match reader.read(&mut buf) {
                // EOF: the shell exited. Tell the UI, then drop the session so
                // a later open starts a fresh shell rather than reattaching to
                // a dead one.
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    if app
                        .emit(
                            "pty://output",
                            PtyOutput {
                                id: id.clone(),
                                data,
                            },
                        )
                        .is_err()
                    {
                        // The window is gone; nothing left to emit to.
                        break;
                    }
                }
            }
        }
        let _ = app.emit("pty://closed", id.clone());
        terminals.kill(&id);
    });

    Ok(())
}

/// Keystrokes, verbatim.
#[tauri::command]
fn pty_write(
    terminals: tauri::State<'_, pty::Terminals>,
    id: String,
    data: String,
) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("bad pty input encoding: {e}"))?;
    terminals.write(&id, &bytes)
}

#[tauri::command]
fn pty_resize(
    terminals: tauri::State<'_, pty::Terminals>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    terminals.resize(&id, cols, rows)
}

/// Close a project's terminal. Closing one that was never opened is fine.
#[tauri::command]
fn pty_close(terminals: tauri::State<'_, pty::Terminals>, id: String) {
    terminals.kill(&id);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let terminals = pty::Terminals::new();

    tauri::Builder::default()
        .manage(terminals.clone())
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
        .invoke_handler(tauri::generate_handler![
            scan_projects,
            scan_root,
            pty_open,
            pty_write,
            pty_resize,
            pty_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            // No shell outlives the window. Without this, closing the app
            // leaves a login shell per project tab orphaned to init.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                terminals.kill_all();
            }
        });
}
