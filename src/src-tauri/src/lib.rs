//! GIT HUD — Tauri core.
//!
//! M1 exposes exactly one command: scan the project root. Everything the UI
//! knows about a project arrives as a struct from here, never as prose parsed
//! in the front end (D11).

pub mod agent;
pub mod audio;
pub mod bundle;
pub mod card;
pub mod character;
pub mod git;
pub mod guard;
pub mod local;
pub mod machine;
pub mod mic;
pub mod parse;
pub mod pty;
pub mod reap;
pub mod scan;
pub mod theme;
pub mod voice;

use std::path::PathBuf;

use scan::{ScanResult, DEFAULT_MAX_DEPTH};

/// Where machine-local settings live (D8) — never `config/`, because this is
/// per-machine and must not sync.
fn machine_dir() -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("GITHUD_MACHINE_DIR") {
        return Ok(PathBuf::from(explicit));
    }
    let data_home = dirs::data_local_dir().ok_or("could not resolve the data directory")?;
    Ok(data_home.join("githud"))
}

fn machine_toml_path() -> Result<PathBuf, String> {
    Ok(machine_dir()?.join("machine.toml"))
}

/// Read `machine.toml`, degrading to defaults on a parse failure rather than
/// failing the caller outright — the same "surface, don't swallow, don't take
/// the whole thing down" posture `Overrides::load` uses for `projects.toml`.
fn load_machine_config() -> (machine::MachineConfig, Option<String>) {
    let path = match machine_toml_path() {
        Ok(p) => p,
        Err(e) => return (machine::MachineConfig::default(), Some(e)),
    };
    match machine::MachineConfig::load(&path) {
        Ok(c) => (c, None),
        Err(e) => (machine::MachineConfig::default(), Some(e)),
    }
}

/// The effective scan root, resolved fresh on every call so a folder that
/// moved or vanished since the last run is never trusted blindly.
struct ResolvedRoot {
    path: PathBuf,
    is_custom: bool,
    /// A saved custom root that turned out unusable, or a malformed
    /// `machine.toml` — either way the app fell back to the default rather
    /// than failing, but that fallback must not be silent.
    warning: Option<String>,
}

/// Where projects live: the machine's own choice if one is set and still
/// valid, else `~/github`.
///
/// A saved folder that no longer exists — moved, deleted, an unplugged
/// external drive — must not break the whole registry, the same reasoning
/// `scan()` already applies to a root that does not exist at all. It falls
/// back to the default and reports why, rather than either crashing or
/// silently scanning the wrong thing.
fn resolve_root() -> Result<ResolvedRoot, String> {
    let default_root = dirs::home_dir()
        .map(|h| h.join("github"))
        .ok_or("could not resolve the home directory")?;

    let (config, warning) = load_machine_config();

    let Some(saved) = config.project_root else {
        return Ok(ResolvedRoot {
            path: default_root,
            is_custom: false,
            warning,
        });
    };

    match machine::resolve_project_root(&saved) {
        Ok(path) => Ok(ResolvedRoot {
            path,
            is_custom: true,
            warning,
        }),
        Err(e) => {
            let msg =
                format!("the saved project folder is unusable, using the default instead: {e}");
            let warning = Some(match warning {
                Some(w) => format!("{w}; {msg}"),
                None => msg,
            });
            Ok(ResolvedRoot {
                path: default_root,
                is_custom: false,
                warning,
            })
        }
    }
}

/// Scan the project root and return everything found — repos, plus root-level
/// folders that are not repos yet.
///
/// Returns an empty result rather than an error when the root does not exist —
/// a machine without a scannable root has no projects, which is a state, not a
/// failure.
#[tauri::command]
fn scan_projects() -> Result<ScanResult, String> {
    let root = resolve_root()?.path;
    let local_dir = local_projects_dir()?;
    Ok(scan::scan_with(&root, DEFAULT_MAX_DEPTH, Some(&local_dir)))
}

/// Where character profiles that ship with the app live (D9) — today, only
/// `default.toml`, the required fallback. Nothing else here is committed any
/// longer (D24); a project's own character lives in its local folder instead.
fn characters_dir() -> PathBuf {
    if let Ok(explicit) = std::env::var("GITHUD_CHARACTERS_DIR") {
        return PathBuf::from(explicit);
    }
    // src-tauri/ → src/ → repo root → characters/profiles/
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../characters/profiles")
}

/// Where every project's personal, local declaration lives (D24) —
/// gitignored, never shipped, one folder per customized project.
///
/// The independent `GITHUD_*` override follows the same convention
/// `machine_dir()` and `characters_dir()` already use, for the same
/// test-isolation reason: a test pointing this elsewhere must not also move
/// `machine.toml`.
fn local_projects_dir() -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("GITHUD_PROJECTS_DIR") {
        return Ok(PathBuf::from(explicit));
    }
    let data_home = dirs::data_local_dir().ok_or("could not resolve the data directory")?;
    Ok(data_home.join("githud/projects"))
}

/// One project's own local folder — `project.toml`, `character.toml`, its
/// art if any, and its background image, all colocated (D24).
fn project_local_dir(project: &str) -> Result<PathBuf, String> {
    Ok(local::project_dir(&local_projects_dir()?, project))
}

fn project_character_path(project: &str) -> Result<PathBuf, String> {
    Ok(project_local_dir(project)?.join("character.toml"))
}

/// Read, apply, and write back one project's `project.toml` — the temp-file-
/// then-rename dance every writer here needs, so a crash mid-write cannot
/// leave a truncated declaration. That file decides whether the agent may
/// write in this project (D18); a half-written one is the worst thing any of
/// these commands could produce.
fn update_project_local(
    project: &str,
    apply: impl FnOnce(local::ProjectLocal) -> local::ProjectLocal,
) -> Result<(), String> {
    let path = project_local_dir(project)?.join("project.toml");
    let current = local::ProjectLocal::load(&path)?;
    apply(current).save(&path)
}

/// Read, apply, and write back one project's `character.toml` — the same
/// temp-file-then-rename dance, so a crash cannot leave a half-written
/// character. `apply` is one of `character::set_display` /
/// `set_palette_field` / `set_voice`, the same pure text-transforms used
/// everywhere else, applied here to the file's new location rather than the
/// old shared registry's.
fn update_character_local(
    project: &str,
    apply: impl FnOnce(&str) -> Result<String, String>,
) -> Result<(), String> {
    let path = project_character_path(project)?;
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let updated = apply(&text)?;

    let temp = path.with_extension("toml.tmp");
    std::fs::write(&temp, &updated).map_err(|e| format!("{}: {e}", temp.display()))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("{}: {e}", path.display()))
}

/// The absolute path being scanned, whether it is a custom choice or the
/// default, and any problem that fell back silently otherwise — so Settings
/// can show the truth rather than a guess.
#[derive(Clone, serde::Serialize)]
struct ScanRootInfo {
    path: String,
    is_custom: bool,
    warning: Option<String>,
}

#[tauri::command]
fn scan_root() -> Result<ScanRootInfo, String> {
    let resolved = resolve_root()?;
    Ok(ScanRootInfo {
        path: resolved.path.to_string_lossy().into_owned(),
        is_custom: resolved.is_custom,
        warning: resolved.warning,
    })
}

/// Set the folder to scan for projects.
///
/// The path is never trusted as given — `machine::resolve_project_root`
/// canonicalizes it (resolving `..` and symlinks) and confirms it is a real
/// directory before anything is written, so a stale or malformed string can
/// at worst be refused, never silently accepted. Returns the canonicalized
/// path so the caller can show exactly what was saved.
#[tauri::command]
fn set_project_root(path: String) -> Result<String, String> {
    let resolved = machine::resolve_project_root(std::path::Path::new(&path))?;
    let (mut config, _) = load_machine_config();
    config.project_root = Some(resolved.clone());
    config.save(&machine_toml_path()?)?;
    Ok(resolved.to_string_lossy().into_owned())
}

/// Clear the custom folder, reverting to the default (`~/github`).
#[tauri::command]
fn reset_project_root() -> Result<(), String> {
    let (mut config, _) = load_machine_config();
    config.project_root = None;
    config.save(&machine_toml_path()?)
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

// ── The project card and panels (M5) ────────────────────────────────────────
//
// No agent involved: opening a project cold and seeing its state is the whole
// point (D13 — mechanical work is core code, never a prompt).

/// The cached card. Reads disk on first request, then serves the struct (D11).
#[tauri::command]
fn project_card(
    cards: tauri::State<'_, card::Cards>,
    id: String,
    cwd: String,
    refresh: Option<bool>,
) -> card::Card {
    let path = std::path::Path::new(&cwd);
    if refresh.unwrap_or(false) {
        cards.refresh(&id, path)
    } else {
        cards.get(&id, path)
    }
}

/// Working-tree changes for the Diff panel.
#[tauri::command]
fn project_diff(cwd: String) -> git::Diff {
    git::diff(std::path::Path::new(&cwd))
}

// ── Voice (M6) ───────────────────────────────────────────────────────────────
//
// All Voicebox traffic goes through Rust because the webview cannot reach it —
// see `voice/mod.rs`. Local only; no cloud endpoint is reachable from here.

#[tauri::command]
async fn voice_health() -> voice::Health {
    let health = voice::health().await;
    if let voice::Health::Down { reason } | voice::Health::Impaired { reason } = &health {
        log::warn!("voicebox {}: {reason}", voice::BASE);
    }
    health
}

/// Whether the speech model is loaded.
///
/// Separate from `voice_health` on purpose: Voicebox is perfectly healthy while
/// its Whisper model is cold, and a cold model returns an empty transcript with
/// a 200. Folding that into the health pill would call a working server broken.
#[tauri::command]
async fn voice_readiness() -> Result<voice::Readiness, String> {
    voice::readiness()
        .await
        .inspect_err(|e| log::warn!("voice_readiness: {e}"))
}

#[tauri::command]
async fn voice_voices() -> Result<Vec<voice::Voice>, String> {
    voice::voices()
        .await
        .inspect_err(|e| log::warn!("voice_voices: {e}"))
}

/// Every voice failure is logged verbatim as well as returned.
///
/// M6 produced a report of "voicebox unreachable" from the UI while the exact
/// same call from a test returned playable audio, and nothing on disk could
/// settle which was true. A message shown once in a corner of a chat pane is
/// not a record; this is.
#[tauri::command]
async fn voice_speak(
    text: String,
    voice_id: String,
    engine: Option<String>,
) -> Result<voice::Speech, String> {
    voice::speak(&text, &voice_id, engine.as_deref())
        .await
        .inspect_err(|e| log::warn!("voice_speak (voice {voice_id}, engine {engine:?}): {e}"))
}

/// What audio hardware this machine actually has.
///
/// Deliberately separate from the webview's own device list: that one is what
/// `getUserMedia` honours, this one is what exists. Showing both is what makes
/// "the microphone captured nothing" a question with an answer.
#[tauri::command]
fn audio_devices() -> audio::Devices {
    audio::devices()
}

/// Push-to-talk: recorded audio in, text out.
#[tauri::command]
async fn voice_transcribe(audio: String, mime: String) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio)
        .map_err(|e| format!("bad audio encoding: {e}"))?;
    log::info!("transcribing {} bytes of {mime}", bytes.len());
    voice::transcribe(&bytes, &mime)
        .await
        .inspect_err(|e| log::warn!("voice_transcribe: {e}"))
}

/// What is actually running for a project.
///
/// Principle 5: nothing is hidden. The Activity panel should be able to say
/// whether a shell and an agent are alive without guessing from the UI's own
/// state, which can drift from the processes it is describing.
#[derive(Clone, serde::Serialize)]
struct Sessions {
    terminal: bool,
    agent: bool,
    /// The conversation a stopped agent would resume, if there is one.
    resumable: bool,
}

#[tauri::command]
fn project_sessions(
    terminals: tauri::State<'_, pty::Terminals>,
    agents: tauri::State<'_, agent::Agents>,
    id: String,
) -> Sessions {
    Sessions {
        terminal: terminals.has(&id),
        agent: agents.has(&id),
        resumable: agents.resumable_session(&id).is_some(),
    }
}

/// One file's contents, for the viewer. Bounded, and refuses to leave the
/// project.
#[tauri::command]
fn read_file(cwd: String, path: String) -> Result<git::FileContents, String> {
    git::read_file(std::path::Path::new(&cwd), &path)
}

/// One directory of the file tree. Lazy: a huge repo is never walked eagerly.
#[tauri::command]
fn project_tree(cwd: String, path: Option<String>) -> Result<Vec<git::TreeEntry>, String> {
    git::list_dir(
        std::path::Path::new(&cwd),
        path.as_deref().unwrap_or_default(),
    )
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
    read_only: Option<bool>,
) -> Result<Option<guard::branch::Isolated>, String> {
    use tauri::Emitter as _;

    let adapter = agent::Adapter::ClaudeCode;
    // D18 becomes enforcement here: a read-only project is bound read-only in
    // the sandbox, so the declaration is a guarantee rather than a label.
    let access = if read_only.unwrap_or(false) {
        guard::Access::ReadOnly
    } else {
        guard::Access::ReadWrite
    };
    // D6: the agent works on a branch of its own, so the whole session is
    // reversible and per-action approval is unnecessary. Only off a shared
    // branch — moving someone off their own feature branch would be worse than
    // the problem being solved. Read-only projects are never switched.
    let isolated = if read_only.unwrap_or(false) {
        None
    } else {
        guard::branch::isolate(std::path::Path::new(&cwd), &id)?
    };

    let Some(stdout) = agents.start(
        &id,
        std::path::Path::new(&cwd),
        adapter,
        model.as_deref(),
        access,
    )?
    else {
        return Ok(isolated); // Already running.
    };

    let agents = (*agents).clone();
    let project = id.clone();
    std::thread::spawn(move || {
        use std::io::BufRead as _;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            agent::debug_log(&line);
            for event in agents.map_line(&id, &project, &line) {
                // Keep the session id so STOP is recoverable: the next start
                // resumes this conversation instead of losing it.
                if let agent::AgentEvent::SessionStarted { session_id, .. } = &event {
                    agents.remember_session(&id, session_id);
                }
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

    Ok(isolated)
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

// ── Characters (D9) ──────────────────────────────────────────────────────────

/// Every profile in `characters/profiles/`, and every one that failed to load.
///
/// Both halves cross together. A profile that vanished because of a typo would
/// otherwise look exactly like a profile nobody wrote — and the config screen is
/// the only place that difference can be seen.
#[tauri::command]
fn characters_list() -> character::Characters {
    character::load_all(&characters_dir())
}

/// The PNG frame set a profile points at, in mouth order.
#[tauri::command]
fn character_frames(dir: String) -> Result<Vec<character::Frame>, String> {
    character::load_frames(&characters_dir(), &dir)
}

/// A layered character's parts, in draw order and validated against the spec.
#[tauri::command]
fn character_parts(dir: String) -> Result<Vec<character::Part>, String> {
    character::load_layers(&characters_dir(), &dir)
}

/// Set or clear a project's own note or accent colour (M8, D24) — the note
/// explaining a declaration, and the tab rail / glass tint, independent of
/// whatever character the project has.
///
/// Accent is validated here, at the boundary, rather than in
/// `ProjectLocal`'s own (de)serialization: a bad value should refuse to be
/// *written*, the same way a bad `kind` refuses to be *read* — but a
/// hand-edited `project.toml` with a stray bad accent must still load, the
/// same way a hand-edited bad `character` name always has.
#[tauri::command]
fn project_note_set(project: String, note: Option<String>) -> Result<(), String> {
    update_project_local(&project, |current| local::ProjectLocal { note, ..current })
}

#[tauri::command]
fn project_accent_set(project: String, accent: Option<String>) -> Result<(), String> {
    if let Some(hex) = &accent {
        if !theme::valid_hex_color(hex) {
            return Err(format!("not a hex colour: {hex} — expected #rrggbb"));
        }
    }
    update_project_local(&project, |current| local::ProjectLocal {
        accent,
        ..current
    })
}

/// Upload or clear a project's background image (M8), inside its own local
/// folder now (D24) rather than a flat machine-wide directory — the folder
/// itself disambiguates the project, so there is no filename left to record.
///
/// `image_base64` and `ext` travel together — a base64 payload with no
/// extension has nowhere to be written, and one without the other means
/// "clear" rather than a malformed upload, so both are `None` for that case
/// rather than the frontend sending an empty string it would have to invent.
#[tauri::command]
fn project_background_set(
    project: String,
    image_base64: Option<String>,
    ext: Option<String>,
) -> Result<(), String> {
    let dir = project_local_dir(&project)?;
    match (image_base64, ext) {
        (Some(b64), Some(ext)) => {
            use base64::Engine as _;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&b64)
                .map_err(|e| format!("bad image encoding: {e}"))?;
            theme::save_background(&dir, &bytes, &ext)
        }
        _ => {
            theme::clear_background(&dir);
            Ok(())
        }
    }
}

/// A project's stored background image, as a data URI — the same convention
/// `character_frames` already uses, so the front end never resolves a
/// filesystem path itself.
#[tauri::command]
fn project_background_image(project: String) -> Result<Option<String>, String> {
    theme::read_background(&project_local_dir(&project)?)
}

/// This project's own character, if it has one (D24) — `None` when
/// unconfigured, which resolves to the house character in `ui/character.ts`.
/// There is no name to look up any more; presence is the whole fact.
#[tauri::command]
fn project_character(project: String) -> Result<Option<character::Profile>, String> {
    let path = project_character_path(&project)?;
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    character::Profile::parse(&project, &text).map(Some)
}

/// The PNG frame set a project's own character points at, in mouth order.
#[tauri::command]
fn project_character_frames(project: String, dir: String) -> Result<Vec<character::Frame>, String> {
    character::load_frames(&project_local_dir(&project)?, &dir)
}

/// A project's own layered character parts, in draw order and validated
/// against the spec.
#[tauri::command]
fn project_character_parts(project: String, dir: String) -> Result<Vec<character::Part>, String> {
    character::load_layers(&project_local_dir(&project)?, &dir)
}

/// Give this project its own character, seeded from `default`'s palette,
/// sprite and temperament — a freshly enabled character starts considered
/// rather than blank (the same reasoning D9 already applies to the house
/// character's own defaults). Refuses to overwrite one that already exists;
/// clear it first to start over.
#[tauri::command]
fn character_local_enable(project: String) -> Result<(), String> {
    let path = project_character_path(&project)?;
    if path.is_file() {
        return Err(format!("{project} already has its own character"));
    }

    let house_path = character::profile_path(&characters_dir(), character::HOUSE);
    let house_text = std::fs::read_to_string(&house_path)
        .map_err(|e| format!("{}: {e}", house_path.display()))?;
    let house = character::Profile::parse(character::HOUSE, &house_text)?;

    let toml = character::seed_toml(&project, house.palette, house.sprite, house.temperament)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let temp = path.with_extension("toml.tmp");
    std::fs::write(&temp, &toml).map_err(|e| format!("{}: {e}", temp.display()))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Remove this project's own character. Leaves any hand-added art directory
/// alone — deleting art on a toggle would be a surprising way to lose work;
/// only the pointer that makes it the assignment goes away.
#[tauri::command]
fn character_local_disable(project: String) -> Result<(), String> {
    let path = project_character_path(&project)?;
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(())
}

#[tauri::command]
fn character_local_set_display(project: String, display: Option<String>) -> Result<(), String> {
    update_character_local(&project, |text| {
        character::set_display(text, display.as_deref())
    })
}

#[tauri::command]
fn character_local_set_palette(
    project: String,
    field: String,
    value: Option<String>,
) -> Result<(), String> {
    if let Some(hex) = &value {
        if !theme::valid_hex_color(hex) {
            return Err(format!("not a hex colour: {hex} — expected #rrggbb"));
        }
    }
    update_character_local(&project, |text| {
        character::set_palette_field(text, &field, value.as_deref())
    })
}

/// Give this project's character a voice, or clear it.
///
/// Unlike before D24, a voice no longer needs to belong to a *named*
/// character shared across projects — each project has at most one character
/// now, so the voice simply lives in that character's own file.
#[tauri::command]
fn character_local_set_voice(project: String, voice: Option<String>) -> Result<(), String> {
    update_character_local(&project, |text| {
        character::set_voice(text, voice.as_deref())
    })
}

// ── Export and import (D24) ─────────────────────────────────────────────────
//
// Moving config between machines is explicit, not automatic sync — see
// `bundle`'s own module doc for why.

/// Bundle every local project into one file at `dest_path`. Returns the
/// project keys that made it in; one project's files failing to read is
/// logged and skipped rather than failing the whole export.
#[tauri::command]
fn export_config(dest_path: String) -> Result<Vec<String>, String> {
    let (b, failed) = bundle::build(&local_projects_dir()?);
    if !failed.is_empty() {
        log::warn!(
            "export_config skipped {} project(s): {failed:?}",
            failed.len()
        );
    }
    bundle::write(&b, std::path::Path::new(&dest_path))?;
    Ok(b.projects.keys().cloned().collect())
}

/// Unpack a bundle at `src_path` into the local store. Every project it names
/// overwrites that project's local folder wholesale; every other local
/// project is untouched.
#[tauri::command]
fn import_config(src_path: String) -> Result<bundle::ImportSummary, String> {
    let b = bundle::read(std::path::Path::new(&src_path))?;
    Ok(bundle::apply(&b, &local_projects_dir()?))
}

/// Can this webview give a GPU canvas?
///
/// Asked from the front end, reported here only so Settings has one place to show
/// it. Whether Live2D or Rive could ever run in this webview turns on it
/// (`planning/specs/character-renderers_spec.md`), and the app runs with
/// `WEBKIT_DISABLE_DMABUF_RENDERER=1` because of the black-window bug — so this
/// has never actually been established.
#[tauri::command]
fn webview_notes() -> Vec<String> {
    let mut notes = Vec::new();
    for var in [
        "WEBKIT_DISABLE_DMABUF_RENDERER",
        "WEBKIT_DISABLE_COMPOSITING_MODE",
    ] {
        if let Ok(v) = std::env::var(var) {
            notes.push(format!("{var}={v}"));
        }
    }
    if notes.is_empty() {
        notes.push("no WebKit rendering overrides set".into());
    }
    notes
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let terminals = pty::Terminals::new();
    let agents = agent::Agents::new();
    let cards = card::Cards::new();

    // `ExitRequested` fires when a window closes — never when the process is
    // signalled. Every `pkill` during development therefore skipped teardown
    // entirely, which is how orphaned sandboxes accumulated. Catchable signals
    // now run the same cleanup; `SIGKILL` cannot be caught by anything, and is
    // what the startup sweep is for.
    reap::on_signal({
        let terminals = terminals.clone();
        let agents = agents.clone();
        move || {
            terminals.kill_all();
            agents.stop_all();
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(terminals.clone())
        .manage(agents.clone())
        .manage(cards)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Anything a previous run failed to take with it. The floor, not
            // the first line: it depends on nothing the dying process managed
            // to do, which is what makes it work after a SIGKILL or a crash.
            let reaped = reap::sweep();
            if reaped > 0 {
                log::warn!("reaped {reaped} orphaned agent sandbox(es) from a previous run");
            }

            // Push-to-talk is dead without this, and fails in a way that
            // blames the user for a prompt they were never shown.
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                mic::enable(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_projects,
            scan_root,
            set_project_root,
            reset_project_root,
            pty_open,
            pty_write,
            pty_resize,
            pty_close,
            agent_start,
            agent_send,
            agent_stop,
            agent_available,
            project_card,
            project_diff,
            project_tree,
            read_file,
            project_sessions,
            voice_health,
            voice_readiness,
            voice_voices,
            voice_speak,
            voice_transcribe,
            audio_devices,
            characters_list,
            character_frames,
            character_parts,
            project_character,
            project_character_frames,
            project_character_parts,
            character_local_enable,
            character_local_disable,
            character_local_set_display,
            character_local_set_palette,
            character_local_set_voice,
            project_note_set,
            project_accent_set,
            project_background_set,
            project_background_image,
            export_config,
            import_config,
            webview_notes,
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
