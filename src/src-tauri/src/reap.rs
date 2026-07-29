//! Reaping agent sandboxes the app failed to take with it.
//!
//! **`--die-with-parent` is not enough, and this is why.** It sets
//! `PR_SET_PDEATHSIG`, which the kernel delivers when the *thread* that created
//! the process exits — not when the parent process does. Agent sessions are
//! spawned from Tauri worker threads and, in the live tests, from test threads;
//! those come and go, so the signal either fires at the wrong time or, as
//! observed here, never fires at all. Five sandboxes accumulated across two
//! days that way, each holding a live Claude session, reparented to
//! `systemd --user` and answering to nobody.
//!
//! The second gap is the app's own exit path. `stop_all()` runs on Tauri's
//! `ExitRequested`, which fires when a window closes — **not** when the process
//! is signalled. Every `pkill` during development skipped teardown entirely.
//!
//! So there are two mechanisms here rather than one promise: teardown on the
//! signals that can be caught, and a sweep at startup that cleans up after the
//! one that cannot (`SIGKILL`) and after a crash. The sweep is the floor,
//! because it depends on nothing the dying process managed to do.

use std::path::Path;

/// Is this process one of ours, and has it outlived the app that started it?
///
/// Both halves matter. The mark alone would match a *live* sibling — a second
/// GIT HUD, which M9's parallel sessions make a real case — and killing that
/// would be far worse than the leak. An orphan is a marked process whose parent
/// is no longer a `githud`: on this machine they reparent to `systemd --user`
/// rather than to pid 1, so the test is what the parent *is*, never its pid.
pub fn is_orphan(cmdline: &str, parent_comm: Option<&str>) -> bool {
    cmdline.contains(crate::guard::MARK) && parent_comm != Some(APP)
}

/// What our own process is called, as `/proc/<pid>/comm` spells it.
const APP: &str = "githud";

/// Kill every agent sandbox left behind by a previous run.
///
/// Returns how many were reaped. Never fails the caller: a `/proc` that cannot
/// be read is a machine this cannot help, not a reason to refuse to start.
pub fn sweep() -> usize {
    let mut reaped = 0;

    let Ok(entries) = std::fs::read_dir("/proc") else {
        return 0;
    };

    for entry in entries.flatten() {
        let Some(pid) = entry.file_name().to_str().and_then(|n| n.parse::<i32>().ok()) else {
            continue;
        };
        // Never our own tree — this runs at startup, but a future caller might
        // not, and reaping the sandbox of a session in progress would be a
        // spectacular way to "fix" a leak.
        if pid == std::process::id() as i32 {
            continue;
        }

        let dir = entry.path();
        let Some(cmdline) = read_cmdline(&dir) else {
            continue;
        };
        if !cmdline.contains(crate::guard::MARK) {
            continue;
        }

        let parent = parent_comm(&dir);
        if !is_orphan(&cmdline, parent.as_deref()) {
            continue;
        }

        if kill(pid) {
            log::warn!("reaped an orphaned agent sandbox (pid {pid})");
            reaped += 1;
        }
    }

    reaped
}

/// `/proc/<pid>/cmdline`, with its NUL separators turned into spaces.
fn read_cmdline(dir: &Path) -> Option<String> {
    let raw = std::fs::read(dir.join("cmdline")).ok()?;
    Some(
        raw.split(|b| *b == 0)
            .filter(|part| !part.is_empty())
            .map(String::from_utf8_lossy)
            .collect::<Vec<_>>()
            .join(" "),
    )
}

/// The `comm` of this process's parent, read out of `/proc/<pid>/status`.
///
/// `status` rather than `stat`: a process name containing a space or a bracket
/// makes `stat` genuinely ambiguous to parse, and this decides whether to send
/// a `SIGKILL`.
fn parent_comm(dir: &Path) -> Option<String> {
    let status = std::fs::read_to_string(dir.join("status")).ok()?;
    let ppid: i32 = status
        .lines()
        .find_map(|l| l.strip_prefix("PPid:"))?
        .trim()
        .parse()
        .ok()?;
    std::fs::read_to_string(format!("/proc/{ppid}/comm"))
        .ok()
        .map(|c| c.trim().to_string())
}

/// Set by the signal handler, read by the thread that does the actual work.
static SIGNALLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Run `teardown` when the process is asked to stop.
///
/// The handler itself only sets a flag, because almost nothing is safe to do
/// inside one — killing children and taking locks certainly are not. A watcher
/// thread does the work and then exits the process, which is ordinary code with
/// no such restriction.
///
/// `SIGKILL` is deliberately absent: it cannot be caught, by design. That case
/// belongs to [`sweep`], which is why the sweep is the floor and this is not.
#[cfg(unix)]
pub fn on_signal(teardown: impl Fn() + Send + 'static) {
    use std::sync::atomic::Ordering;

    extern "C" fn handler(_signal: i32) {
        SIGNALLED.store(true, Ordering::SeqCst);
    }

    for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
        // SAFETY: the handler stores to an atomic and does nothing else, which
        // is async-signal-safe.
        unsafe {
            libc::signal(signal, handler as *const () as libc::sighandler_t);
        }
    }

    std::thread::spawn(move || loop {
        if SIGNALLED.load(Ordering::SeqCst) {
            teardown();
            std::process::exit(130);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    });
}

#[cfg(not(unix))]
pub fn on_signal(_teardown: impl Fn() + Send + 'static) {}

/// Send `SIGKILL`. `SIGTERM` would be politer and is pointless here: the target
/// is a `bwrap` whose whole purpose is to hold a sandbox open.
#[cfg(unix)]
fn kill(pid: i32) -> bool {
    // SAFETY: `kill` is async-signal-safe and takes no pointers. A pid that has
    // already exited returns ESRCH, which is reported as "not reaped" rather
    // than treated as an error.
    unsafe { libc::kill(pid, libc::SIGKILL) == 0 }
}

#[cfg(not(unix))]
fn kill(_pid: i32) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    const OURS: &str = "bwrap --ro-bind / / --setenv GITHUD_AGENT 1 --die-with-parent -- claude";

    #[test]
    fn a_marked_sandbox_whose_parent_is_gone_is_an_orphan() {
        // The real one: reparented to `systemd --user`, not to pid 1.
        assert!(is_orphan(OURS, Some("systemd")));
        assert!(is_orphan(OURS, None));
    }

    #[test]
    fn a_marked_sandbox_still_held_by_a_running_app_is_left_alone() {
        // This is the case that must never be got wrong. A second GIT HUD is a
        // real scenario at M9, and reaping its live session would be far worse
        // than the leak this exists to fix.
        assert!(!is_orphan(OURS, Some("githud")));
    }

    #[test]
    fn somebody_elses_sandbox_is_never_touched() {
        // Vivaldi and every flatpak on the machine run under bwrap too.
        let theirs = "/usr/bin/bwrap --args 74 -- vivaldi";
        assert!(!is_orphan(theirs, Some("systemd")));
        assert!(!is_orphan(theirs, None));
    }

    #[test]
    fn the_mark_is_the_one_the_sandbox_actually_carries() {
        // If `guard::MARK` and the argv ever drift apart, every orphan becomes
        // invisible and this whole module quietly does nothing.
        let argv = crate::guard::sandbox(
            Path::new("/tmp/p"),
            Path::new("/tmp/h"),
            crate::guard::Access::ReadWrite,
        );

        assert!(argv.contains(&crate::guard::MARK.to_string()), "{argv:?}");
        assert!(is_orphan(&argv.join(" "), Some("systemd")));
    }

    #[test]
    fn a_sweep_on_a_machine_with_no_orphans_kills_nothing() {
        // It reads /proc for real; the assertion is that it is safe to run and
        // does not panic on whatever is currently alive.
        let _ = sweep();
    }
}
