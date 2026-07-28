//! Channel 1 — the raw terminal.
//!
//! D1: this is a real PTY with **zero parsing**. Bytes go out to xterm.js
//! exactly as the program wrote them, and keystrokes go back exactly as typed.
//! Nothing here understands ANSI, and nothing here emits an `AgentEvent` — if
//! it ever does, Channel 1 and Channel 2 have merged and the design is lost.
//!
//! The agent's PATH shim (M4) is deliberately **not** applied here. This is the
//! user's shell (D7).

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};

/// Bytes read from the PTY before a chunk is emitted.
///
/// Emitting per read would turn `yes` into an IPC flood; buffering too long
/// makes typing feel laggy. 8 KiB is one comfortable screen of dense output.
const READ_BUF: usize = 8 * 1024;

/// How much recent output to retain per session, for repainting a fresh view.
///
/// The shell outlives any one view of it, so a new xterm attaching to a live
/// session starts empty and looks wiped even though everything works. 256 KiB
/// is several screens including a full-screen TUI redraw, and is bounded per
/// session.
const SCROLLBACK_CAP: usize = 256 * 1024;

/// A live shell, keyed by the project it belongs to.
struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// Recent output, oldest first, as whole chunks exactly as read.
    scrollback: VecDeque<(u64, Vec<u8>)>,
    scrollback_bytes: usize,
    /// Monotonic chunk counter.
    ///
    /// This is what makes reattach exact rather than approximate. Output can
    /// arrive between taking a snapshot and the view applying it; without a
    /// sequence number those chunks are written twice.
    next_seq: u64,
}

impl Session {
    /// Retain a chunk and return the sequence number assigned to it.
    fn record(&mut self, data: &[u8]) -> u64 {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.wrapping_add(1);

        self.scrollback.push_back((seq, data.to_vec()));
        self.scrollback_bytes += data.len();

        // Drop whole chunks, never split one. Cutting mid-escape-sequence
        // would corrupt the replay worse than losing a little history does.
        while self.scrollback_bytes > SCROLLBACK_CAP && self.scrollback.len() > 1 {
            if let Some((_, dropped)) = self.scrollback.pop_front() {
                self.scrollback_bytes -= dropped.len();
            }
        }

        seq
    }

    /// Everything retained, and the highest sequence number it covers.
    fn snapshot(&self) -> (Vec<u8>, u64) {
        let mut out = Vec::with_capacity(self.scrollback_bytes);
        let mut through = 0;
        for (seq, chunk) in &self.scrollback {
            out.extend_from_slice(chunk);
            through = *seq;
        }
        (out, through)
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }
}

/// All live terminals.
///
/// One per project tab. The registry owns the lifecycle: a session that is
/// removed is also killed, because a leaked shell per closed tab is invisible
/// until there are forty of them.
#[derive(Clone, Default)]
pub struct Terminals {
    inner: Arc<Mutex<HashMap<String, Session>>>,
}

impl Terminals {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn has(&self, id: &str) -> bool {
        self.lock().contains_key(id)
    }

    pub fn count(&self) -> usize {
        self.lock().len()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        // A panic in another thread must not make the terminal registry
        // permanently unusable — recover the guard rather than propagating.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Spawn a shell in `cwd`, returning a reader for its output.
    ///
    /// Returns `Ok(None)` if a session already exists for `id` — reopening the
    /// Terminal sub-tab must reattach, never spawn a second shell.
    pub fn spawn(
        &self,
        id: &str,
        cwd: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<Option<Box<dyn Read + Send>>, String> {
        if self.has(id) {
            return Ok(None);
        }

        if !cwd.is_dir() {
            return Err(format!("not a directory: {}", cwd.display()));
        }

        let pair = NativePtySystem::default()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("could not open a pty: {e}"))?;

        let mut cmd = CommandBuilder::new(user_shell());
        cmd.cwd(cwd);
        // Tell the shell what it is talking to. Without this, curses programs
        // fall back to a dumb terminal and `htop` refuses to draw.
        cmd.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("could not start a shell: {e}"))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("could not read the pty: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("could not write to the pty: {e}"))?;

        self.lock().insert(
            id.to_string(),
            Session {
                writer,
                master: pair.master,
                child,
                scrollback: VecDeque::new(),
                scrollback_bytes: 0,
                next_seq: 0,
            },
        );

        Ok(Some(reader))
    }

    /// Retain a chunk of output and return its sequence number.
    ///
    /// Returns `None` if the session is gone, which tells the reader thread to
    /// stop.
    pub fn record(&self, id: &str, data: &[u8]) -> Option<u64> {
        self.lock().get_mut(id).map(|s| s.record(data))
    }

    /// Recent output for repainting a fresh view, with the sequence number it
    /// covers through. Anything at or below that number has already been
    /// replayed and must not be written again.
    pub fn snapshot(&self, id: &str) -> Option<(Vec<u8>, u64)> {
        self.lock().get(id).map(|s| s.snapshot())
    }

    pub fn write(&self, id: &str, bytes: &[u8]) -> Result<(), String> {
        let mut sessions = self.lock();
        let session = sessions.get_mut(id).ok_or_else(|| no_session(id))?;
        session.writer.write_all(bytes).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        // Zero would make programs divide by it. Clamp rather than reject: a
        // transient 0 during a window drag is not worth an error dialog.
        let cols = cols.max(1);
        let rows = rows.max(1);
        self.lock().get(id).ok_or_else(|| no_session(id))?.resize(cols, rows)
    }

    /// Kill a session and forget it. Killing an unknown id is not an error —
    /// closing a tab that never opened its terminal is the normal case.
    pub fn kill(&self, id: &str) {
        if let Some(mut session) = self.lock().remove(id) {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
    }

    /// Kill everything. Called on app exit so no shell outlives the window.
    pub fn kill_all(&self) {
        let ids: Vec<String> = self.lock().keys().cloned().collect();
        for id in ids {
            self.kill(&id);
        }
    }
}

fn no_session(id: &str) -> String {
    format!("no terminal session for {id}")
}

/// The user's login shell, falling back to something that certainly exists.
fn user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
}

/// How much to read before handing a chunk on. Exposed so the reader thread and
/// its tests agree on one number.
pub const fn read_buffer_size() -> usize {
    READ_BUF
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("githud-pty-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Read until `needle` appears or we run out of patience. A shell takes a
    /// moment to print its first prompt, so this cannot be a single read.
    fn read_until(reader: &mut Box<dyn Read + Send>, needle: &str, secs: u64) -> String {
        let deadline = Instant::now() + Duration::from_secs(secs);
        let mut seen = String::new();
        let mut buf = [0u8; 1024];
        while Instant::now() < deadline {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    seen.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if seen.contains(needle) {
                        return seen;
                    }
                }
                Err(_) => break,
            }
        }
        seen
    }

    #[test]
    fn spawns_a_shell_and_runs_a_command_in_the_given_cwd() {
        let dir = temp_dir("cwd");
        let terminals = Terminals::new();

        let mut reader = terminals
            .spawn("proj", &dir, 80, 24)
            .unwrap()
            .expect("a new session yields a reader");

        terminals.write("proj", b"echo GITHUD_$((6*7))\n").unwrap();
        let out = read_until(&mut reader, "GITHUD_42", 10);

        assert!(out.contains("GITHUD_42"), "shell did not run the command: {out:?}");
        terminals.kill_all();
    }

    #[test]
    fn a_second_spawn_reattaches_rather_than_starting_another_shell() {
        // Reopening the Terminal sub-tab must not leave a second shell behind.
        let dir = temp_dir("reattach");
        let terminals = Terminals::new();

        assert!(terminals.spawn("proj", &dir, 80, 24).unwrap().is_some());
        assert!(
            terminals.spawn("proj", &dir, 80, 24).unwrap().is_none(),
            "an existing session must not be replaced"
        );
        assert_eq!(terminals.count(), 1);

        terminals.kill_all();
    }

    #[test]
    fn killing_removes_the_session() {
        let dir = temp_dir("kill");
        let terminals = Terminals::new();
        terminals.spawn("proj", &dir, 80, 24).unwrap();

        terminals.kill("proj");

        assert!(!terminals.has("proj"));
        assert_eq!(terminals.count(), 0, "a closed tab must not leak a shell");
    }

    #[test]
    fn killing_an_unknown_session_is_not_an_error() {
        // Closing a tab whose terminal was never opened is the normal case.
        Terminals::new().kill("never-existed");
    }

    #[test]
    fn kill_all_empties_the_registry() {
        let dir = temp_dir("killall");
        let terminals = Terminals::new();
        terminals.spawn("a", &dir, 80, 24).unwrap();
        terminals.spawn("b", &dir, 80, 24).unwrap();
        assert_eq!(terminals.count(), 2);

        terminals.kill_all();

        assert_eq!(terminals.count(), 0);
    }

    #[test]
    fn writing_to_an_unknown_session_errors_by_name() {
        let err = Terminals::new().write("ghost", b"x").unwrap_err();
        assert!(err.contains("ghost"), "error should name the session: {err}");
    }

    #[test]
    fn resizing_an_unknown_session_errors_by_name() {
        let err = Terminals::new().resize("ghost", 80, 24).unwrap_err();
        assert!(err.contains("ghost"), "error should name the session: {err}");
    }

    #[test]
    fn resize_clamps_zero_instead_of_failing() {
        // A window drag can momentarily report 0 columns. Programs divide by
        // that; an error dialog for it would be worse than clamping.
        let dir = temp_dir("resize");
        let terminals = Terminals::new();
        terminals.spawn("proj", &dir, 80, 24).unwrap();

        terminals.resize("proj", 0, 0).expect("zero must clamp, not error");
        terminals.resize("proj", 120, 40).unwrap();

        terminals.kill_all();
    }

    #[test]
    fn spawning_in_a_missing_directory_errors_rather_than_panicking() {
        let missing = std::env::temp_dir().join("githud-no-such-dir-xyz");

        // `unwrap_err` needs the Ok type to be Debug, and a boxed reader is not.
        match Terminals::new().spawn("p", &missing, 80, 24) {
            Err(e) => assert!(e.contains("not a directory"), "{e}"),
            Ok(_) => panic!("spawning in a missing directory must fail"),
        }
    }

    #[test]
    fn recorded_output_replays_with_the_sequence_it_covers() {
        let dir = temp_dir("replay");
        let terminals = Terminals::new();
        terminals.spawn("proj", &dir, 80, 24).unwrap();

        let a = terminals.record("proj", b"first ").unwrap();
        let b = terminals.record("proj", b"second").unwrap();
        let (bytes, through) = terminals.snapshot("proj").unwrap();

        assert_eq!(bytes, b"first second");
        assert!(b > a, "sequence numbers must advance");
        assert_eq!(through, b, "snapshot covers through the newest chunk");

        terminals.kill_all();
    }

    #[test]
    fn a_fresh_session_replays_nothing() {
        let dir = temp_dir("replay-empty");
        let terminals = Terminals::new();
        terminals.spawn("proj", &dir, 80, 24).unwrap();

        let (bytes, through) = terminals.snapshot("proj").unwrap();

        assert!(bytes.is_empty());
        assert_eq!(through, 0);

        terminals.kill_all();
    }

    #[test]
    fn scrollback_is_bounded_and_drops_whole_chunks() {
        // Splitting a chunk could cut an escape sequence in half, which would
        // corrupt the replay worse than losing old history does.
        let dir = temp_dir("replay-cap");
        let terminals = Terminals::new();
        terminals.spawn("proj", &dir, 80, 24).unwrap();

        let chunk = vec![b'x'; 64 * 1024];
        for _ in 0..12 {
            terminals.record("proj", &chunk).unwrap();
        }

        let (bytes, _) = terminals.snapshot("proj").unwrap();

        assert!(
            bytes.len() <= SCROLLBACK_CAP,
            "retained {} bytes, cap is {SCROLLBACK_CAP}",
            bytes.len()
        );
        assert_eq!(
            bytes.len() % chunk.len(),
            0,
            "only whole chunks may be dropped"
        );

        terminals.kill_all();
    }

    #[test]
    fn one_oversized_chunk_is_kept_rather_than_leaving_nothing() {
        let dir = temp_dir("replay-huge");
        let terminals = Terminals::new();
        terminals.spawn("proj", &dir, 80, 24).unwrap();

        terminals
            .record("proj", &vec![b'y'; SCROLLBACK_CAP * 2])
            .unwrap();

        let (bytes, _) = terminals.snapshot("proj").unwrap();

        assert!(!bytes.is_empty(), "never trim down to nothing");

        terminals.kill_all();
    }

    #[test]
    fn recording_against_a_dead_session_reports_it_rather_than_panicking() {
        // The reader thread uses this to know when to stop.
        assert!(Terminals::new().record("ghost", b"x").is_none());
        assert!(Terminals::new().snapshot("ghost").is_none());
    }

    #[test]
    fn scrollback_dies_with_the_session() {
        let dir = temp_dir("replay-kill");
        let terminals = Terminals::new();
        terminals.spawn("proj", &dir, 80, 24).unwrap();
        terminals.record("proj", b"history").unwrap();

        terminals.kill("proj");

        assert!(
            terminals.snapshot("proj").is_none(),
            "a killed session leaves no history to replay into a new shell"
        );
    }

    #[test]
    fn sessions_keep_separate_scrollback() {
        let dir = temp_dir("replay-split");
        let terminals = Terminals::new();
        terminals.spawn("a", &dir, 80, 24).unwrap();
        terminals.spawn("b", &dir, 80, 24).unwrap();

        terminals.record("a", b"aaa").unwrap();
        terminals.record("b", b"bbb").unwrap();

        assert_eq!(terminals.snapshot("a").unwrap().0, b"aaa");
        assert_eq!(terminals.snapshot("b").unwrap().0, b"bbb");

        terminals.kill_all();
    }

    #[test]
    fn sessions_are_independent() {
        let dir = temp_dir("independent");
        let terminals = Terminals::new();
        let mut a = terminals.spawn("a", &dir, 80, 24).unwrap().unwrap();
        terminals.spawn("b", &dir, 80, 24).unwrap();

        terminals.write("a", b"echo ONLY_A\n").unwrap();
        let out = read_until(&mut a, "ONLY_A", 10);

        assert!(out.contains("ONLY_A"));
        terminals.kill("a");
        assert!(terminals.has("b"), "killing one must not affect the other");

        terminals.kill_all();
    }
}
