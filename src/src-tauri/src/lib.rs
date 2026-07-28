//! GIT HUD — Tauri core.
//!
//! M1 exposes exactly one command: scan the project root. Everything the UI
//! knows about a project arrives as a struct from here, never as prose parsed
//! in the front end (D11).

pub mod agent;
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
    /// Lets a reattaching view discard what its replay already covered.
    seq: u64,
}

/// What `pty_open` gives back.
///
/// On a fresh shell `replay` is empty. On reattach it is the retained output,
/// so a new view repaints instead of showing an empty-but-working terminal.
#[derive(Clone, serde::Serialize)]
struct PtyOpened {
    /// Base64 of the retained output.
    replay: String,
    /// Everything at or below this number is already in `replay` and must not
    /// be written again.
    through_seq: u64,
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
) -> Result<PtyOpened, String> {
    use base64::Engine as _;
    use tauri::Emitter as _;

    let b64 = base64::engine::general_purpose::STANDARD;

    let Some(mut reader) = terminals.spawn(&id, std::path::Path::new(&cwd), cols, rows)? else {
        // Already running. Hand back what the shell has printed so a fresh view
        // repaints rather than showing an empty terminal that nonetheless works.
        let (bytes, through_seq) = terminals.snapshot(&id).unwrap_or_default();
        return Ok(PtyOpened {
            replay: b64.encode(bytes),
            through_seq,
        });
    };

    let terminals = (*terminals).clone();
    std::thread::spawn(move || {
        let b64 = base64::engine::general_purpose::STANDARD;
        let mut buf = vec![0u8; pty::read_buffer_size()];
        loop {
            match reader.read(&mut buf) {
                // EOF: the shell exited. Tell the UI, then drop the session so
                // a later open starts a fresh shell rather than reattaching to
                // a dead one.
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // Retain before emitting, so a snapshot taken concurrently
                    // either contains this chunk or the listener receives it —
                    // and `seq` resolves the case where both happen.
                    let Some(seq) = terminals.record(&id, &buf[..n]) else {
                        break; // Session gone.
                    };
                    let data = b64.encode(&buf[..n]);
                    if app
                        .emit(
                            "pty://output",
                            PtyOutput {
                                id: id.clone(),
                                data,
                                seq,
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

    // A shell that has just started has printed nothing yet.
    Ok(PtyOpened {
        replay: String::new(),
        through_seq: 0,
    })
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

// ── Channel 2: the agent (D1) ────────────────────────────────────────────────
//
// Normalized events only. The UI never sees a harness's own JSON — that is what
// lets a second adapter change nothing but its own mapping (D2).

#[derive(Clone, serde::Serialize)]
struct AgentEnvelope {
    id: String,
    event: agent::AgentEvent,
}

/// Start an agent session for a project, or reattach to the running one.
#[tauri::command]
fn agent_start(
    app: tauri::AppHandle,
    agents: tauri::State<'_, agent::Agents>,
    id: String,
    cwd: String,
    model: Option<String>,
) -> Result<(), String> {
    use tauri::Emitter as _;

    let adapter = agent::Adapter::ClaudeCode;
    let Some(stdout) = agents.start(&id, std::path::Path::new(&cwd), adapter, model.as_deref())?
    else {
        return Ok(()); // Already running.
    };

    let agents = (*agents).clone();
    let project = id.clone();
    std::thread::spawn(move || {
        use std::io::BufRead as _;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            for event in agents.map_line(&id, &project, &line) {
                if app
                    .emit(
                        "agent://event",
                        AgentEnvelope {
                            id: id.clone(),
                            event,
                        },
                    )
                    .is_err()
                {
                    return; // Window gone.
                }
            }
        }

        // stdout closed: the process is finished. This is the session ending,
        // which a per-turn `result` line deliberately does not do.
        let _ = app.emit(
            "agent://event",
            AgentEnvelope {
                id: id.clone(),
                event: agent::AgentEvent::SessionEnded {
                    reason: "the agent process exited".into(),
                },
            },
        );
        agents.stop(&id);
    });

    Ok(())
}

/// Send one turn. The session stays open afterwards.
#[tauri::command]
fn agent_send(
    agents: tauri::State<'_, agent::Agents>,
    id: String,
    text: String,
) -> Result<(), String> {
    agents.send(&id, &text)
}

/// STOP, and release on tab close. Both are a kill — this CLI exposes no
/// interrupt control message, so the contract's `interrupt()` degrades to it.
#[tauri::command]
fn agent_stop(agents: tauri::State<'_, agent::Agents>, id: String) {
    agents.stop(&id);
}

/// Is the adapter usable on this machine? Availability is a property of the
/// machine, not the project.
#[tauri::command]
fn agent_available() -> bool {
    agent::Adapter::ClaudeCode.available()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let terminals = pty::Terminals::new();
    let agents = agent::Agents::new();

    tauri::Builder::default()
        .manage(terminals.clone())
        .manage(agents.clone())
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
            agent_start,
            agent_send,
            agent_stop,
            agent_available,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            // No shell outlives the window. Without this, closing the app
            // leaves a login shell per project tab orphaned to init.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                terminals.kill_all();
                agents.stop_all();
            }
        });
}
