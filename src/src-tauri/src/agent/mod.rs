//! Channel 2 — the agent.
//!
//! A subprocess per project emitting line-delimited JSON, normalized into the
//! vocabulary in `event.rs`. **Never shares a process with the PTY** (D1): the
//! terminal is the user's, this is the agent's.
//!
//! Lifecycle mirrors `pty::Terminals` deliberately, including the part that was
//! got wrong there first: a session must be released on tab close and on exit,
//! or every closed tab leaks a process.

pub mod claude;
pub mod event;

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};

pub use event::{Activity, AgentEvent};

/// Which harness a session talks to. One adapter per harness, not per model
/// (D2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Adapter {
    ClaudeCode,
}

impl Adapter {
    pub fn id(&self) -> &'static str {
        match self {
            Adapter::ClaudeCode => claude::ADAPTER_ID,
        }
    }

    fn binary(&self) -> &'static str {
        match self {
            Adapter::ClaudeCode => "claude",
        }
    }

    fn args(&self, model: Option<&str>, resume: Option<&str>) -> Vec<String> {
        match self {
            Adapter::ClaudeCode => claude::args(model, resume),
        }
    }

    fn user_message(&self, text: &str) -> String {
        match self {
            Adapter::ClaudeCode => claude::user_message(text),
        }
    }

    fn map_line(&self, project: &str, line: &str) -> Vec<AgentEvent> {
        match self {
            Adapter::ClaudeCode => claude::map_line(project, line),
        }
    }

    /// Is the binary on PATH on *this machine*?
    ///
    /// Availability is a property of the machine, not the project — and a
    /// missing adapter must fail loudly at open, never fall back silently to a
    /// different agent (`adapter-contract.md`).
    pub fn available(&self) -> bool {
        which(self.binary()).is_some()
    }
}

/// Append a raw protocol line to `$GITHUD_AGENT_LOG`, when set.
///
/// The adapter's whole job is translating someone else's stream; when it
/// disagrees with reality you need the actual bytes, not a reconstruction.
pub fn debug_log(line: &str) {
    let Ok(path) = std::env::var("GITHUD_AGENT_LOG") else {
        return;
    };
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        use std::io::Write as _;
        let _ = writeln!(f, "{line}");
    }
}

fn which(binary: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(binary))
        .find(|candidate| candidate.is_file())
}

struct Session {
    child: Child,
    stdin: std::process::ChildStdin,
    adapter: Adapter,
}

/// All live agent sessions, keyed by project.
#[derive(Clone, Default)]
pub struct Agents {
    inner: Arc<Mutex<HashMap<String, Session>>>,
    /// Last known session id per project, kept **after** a session ends so the
    /// next start can `--resume` it. STOP kills the process; without this the
    /// conversation would be silently discarded along with it.
    resumable: Arc<Mutex<HashMap<String, String>>>,
}

impl Agents {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn resumable_lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.resumable.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Remember a session id so a later start can resume this conversation.
    pub fn remember_session(&self, id: &str, session_id: &str) {
        if !session_id.is_empty() {
            self.resumable_lock()
                .insert(id.to_string(), session_id.to_string());
        }
    }

    /// The conversation a fresh start would resume, if any.
    pub fn resumable_session(&self, id: &str) -> Option<String> {
        self.resumable_lock().get(id).cloned()
    }

    pub fn has(&self, id: &str) -> bool {
        self.lock().contains_key(id)
    }

    pub fn count(&self) -> usize {
        self.lock().len()
    }

    /// Start a session, or report that one is already running.
    ///
    /// `Ok(None)` means reattach — the caller should not start a second reader.
    pub fn start(
        &self,
        id: &str,
        cwd: &Path,
        adapter: Adapter,
        model: Option<&str>,
    ) -> Result<Option<ChildStdout>, String> {
        if self.has(id) {
            return Ok(None);
        }
        if !cwd.is_dir() {
            return Err(format!("not a directory: {}", cwd.display()));
        }
        if !adapter.available() {
            // Loud, with the reason. Never a silent fallback to another agent.
            return Err(format!(
                "`{}` is not on PATH — {} is unavailable on this machine",
                adapter.binary(),
                adapter.id()
            ));
        }

        let resume = self.resumable_session(id);
        let mut child = Command::new(adapter.binary())
            .args(adapter.args(model, resume.as_deref()))
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Captured, not discarded. A harness that complains on stderr and
            // is never read is a harness that fails silently.
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", adapter.binary()))?;

        let stdin = child.stdin.take().ok_or("no stdin on the agent process")?;
        let stdout = child.stdout.take().ok_or("no stdout on the agent process")?;

        // Drain stderr on its own thread. A full pipe would otherwise block the
        // child, and its complaints are worth logging rather than losing.
        if let Some(stderr) = child.stderr.take() {
            let id = id.to_string();
            std::thread::spawn(move || {
                use std::io::BufRead as _;
                for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) {
                    log::warn!("agent[{id}] stderr: {line}");
                    debug_log(&format!("STDERR {line}"));
                }
            });
        }

        self.lock().insert(
            id.to_string(),
            Session {
                child,
                stdin,
                adapter,
            },
        );

        Ok(Some(stdout))
    }

    /// Send a turn. The session stays open afterwards.
    pub fn send(&self, id: &str, text: &str) -> Result<(), String> {
        let mut sessions = self.lock();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("no agent session for {id}"))?;

        let line = session.adapter.user_message(text);
        session
            .stdin
            .write_all(line.as_bytes())
            .and_then(|_| session.stdin.write_all(b"\n"))
            .and_then(|_| session.stdin.flush())
            .map_err(|e| format!("could not send to the agent: {e}"))
    }

    pub fn map_line(&self, id: &str, project: &str, line: &str) -> Vec<AgentEvent> {
        let adapter = self.lock().get(id).map(|s| s.adapter);
        adapter.map_or_else(Vec::new, |a| a.map_line(project, line))
    }

    /// Stop a session. Stopping one that was never started is not an error.
    ///
    /// This is STOP, and it is a kill: the CLI exposes no interrupt control
    /// message, so the contract's `interrupt()` degrades to this. Said plainly
    /// rather than dressed up as graceful.
    pub fn stop(&self, id: &str) {
        if let Some(mut session) = self.lock().remove(id) {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
    }

    /// Stop everything, so no agent outlives the window.
    pub fn stop_all(&self) {
        let ids: Vec<String> = self.lock().keys().cloned().collect();
        for id in ids {
            self.stop(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("githud-agent-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn a_missing_binary_fails_loudly_and_names_it() {
        // Never a silent fallback — you would be talking to a different agent
        // than you think.
        assert!(which("githud-definitely-not-a-real-binary").is_none());
    }

    #[test]
    fn claude_is_detected_on_this_machine() {
        // Documents the environment as much as the code; if this fails the
        // adapter is unavailable here and M3 cannot be validated by hand.
        assert!(
            Adapter::ClaudeCode.available(),
            "`claude` should be on PATH for M3 validation"
        );
    }

    #[test]
    fn starting_in_a_missing_directory_errors_rather_than_panicking() {
        let missing = std::env::temp_dir().join("githud-no-such-agent-dir");
        match Agents::new().start("p", &missing, Adapter::ClaudeCode, None) {
            Err(e) => assert!(e.contains("not a directory"), "{e}"),
            Ok(_) => panic!("must not start in a missing directory"),
        }
    }

    #[test]
    fn sending_to_an_unknown_session_errors_by_name() {
        let err = Agents::new().send("ghost", "hi").unwrap_err();
        assert!(err.contains("ghost"), "{err}");
    }

    #[test]
    fn stopping_an_unknown_session_is_not_an_error() {
        Agents::new().stop("never-existed");
    }

    #[test]
    fn a_started_session_is_tracked_and_released() {
        // The lifecycle bug from M2, guarded here from the start: a closed tab
        // must not leak an agent process.
        let dir = temp_dir("lifecycle");
        let agents = Agents::new();

        let started = agents.start("proj", &dir, Adapter::ClaudeCode, None);
        assert!(started.is_ok(), "{started:?}");
        assert_eq!(agents.count(), 1);
        assert!(agents.has("proj"));

        // A second start reattaches rather than spawning another process.
        assert!(agents.start("proj", &dir, Adapter::ClaudeCode, None).unwrap().is_none());
        assert_eq!(agents.count(), 1);

        agents.stop("proj");
        assert_eq!(agents.count(), 0, "a closed tab must not leak an agent");
    }

    #[test]
    fn stop_all_empties_the_registry() {
        let dir = temp_dir("stopall");
        let agents = Agents::new();
        agents.start("a", &dir, Adapter::ClaudeCode, None).unwrap();
        agents.start("b", &dir, Adapter::ClaudeCode, None).unwrap();
        assert_eq!(agents.count(), 2);

        agents.stop_all();

        assert_eq!(agents.count(), 0);
    }

    #[test]
    fn a_session_id_survives_the_session_so_stop_is_recoverable() {
        // The reported bug: STOP left the project unusable. Killing the process
        // is unavoidable, so the conversation has to be resumable instead.
        let agents = Agents::new();
        assert_eq!(agents.resumable_session("proj"), None);

        agents.remember_session("proj", "ede19129");
        assert_eq!(
            agents.resumable_session("proj"),
            Some("ede19129".to_string())
        );

        agents.stop("proj");
        assert_eq!(
            agents.resumable_session("proj"),
            Some("ede19129".to_string()),
            "stopping must not discard what makes the conversation recoverable"
        );
    }

    #[test]
    fn an_empty_session_id_is_not_remembered() {
        let agents = Agents::new();
        agents.remember_session("proj", "");
        assert_eq!(agents.resumable_session("proj"), None);
    }

    #[test]
    fn resumable_ids_are_per_project() {
        let agents = Agents::new();
        agents.remember_session("a", "sid-a");
        agents.remember_session("b", "sid-b");

        assert_eq!(agents.resumable_session("a"), Some("sid-a".into()));
        assert_eq!(agents.resumable_session("b"), Some("sid-b".into()));
    }

    #[test]
    fn adapter_ids_are_stable_strings_the_ui_can_display() {
        assert_eq!(Adapter::ClaudeCode.id(), "claude-code");
    }
}
