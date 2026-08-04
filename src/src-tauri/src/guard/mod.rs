//! The guardrails.
//!
//! Two layers, and they are not equivalent:
//!
//! - **The sandbox is the floor** (D16, D19, D27). On Linux it is `bwrap`; on
//!   macOS, which cannot run `bwrap` at all (it wraps Linux kernel user
//!   namespaces — see D27), it is Seatbelt (`sandbox-exec`). The two give
//!   different-shaped guarantees — D27 states the macOS gap plainly rather
//!   than pretending parity — but both mean a process cannot write outside
//!   its granted paths regardless of which binary is called or by what path.
//! - **The PATH shim is a guard.** It catches accidents and gives a legible
//!   error. It is bypassable by absolute path, and saying otherwise would be
//!   the exact dishonesty this design exists to avoid.
//!
//! Both are applied to the **agent** process only. The terminal is the user's
//! and is never touched (D7).

pub mod branch;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod shim;

#[cfg(target_os = "linux")]
use std::path::Path;
use std::path::PathBuf;

/// Is the sandbox available on this machine?
///
/// If not, the agent must not start. A floor that silently is not there is
/// worse than no floor, because you would act as though it were.
#[cfg(target_os = "linux")]
pub fn available() -> bool {
    which("bwrap").is_some()
}

/// Is the sandbox available on this machine?
///
/// `sandbox-exec` ships with every macOS install, so this should always be
/// true in practice — checked anyway so a stripped-down environment fails
/// with the same legible message as a genuinely missing floor, rather than
/// crashing deeper inside `agent::start`.
#[cfg(target_os = "macos")]
pub fn available() -> bool {
    which("sandbox-exec").is_some()
}

fn which(binary: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(binary))
        .find(|c| c.is_file())
}

/// How much the agent may touch inside a project.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    ReadWrite,
    /// D18: a third-party or superseded project. The declaration becomes
    /// enforcement here, by binding the project directory read-only.
    ReadOnly,
}

/// The environment variable that marks a sandbox as this app's.
///
/// On Linux it appears in the sandbox's own `/proc/<pid>/cmdline`, because it
/// is passed as a `bwrap` argument. On macOS, where there is no persistent
/// supervisor process to carry it (D27), the mark instead rides in the
/// argv[0] of the exec'd agent process itself — see `reap.rs`. Either way,
/// it is what makes an orphan identifiable from outside without keeping a
/// pid file that a crash would leave stale.
pub const MARK: &str = "GITHUD_AGENT";

/// Directories under `$HOME` that must stay writable inside the sandbox — the
/// harness's own state. Deny these and the agent cannot run at all. Shared
/// across platforms: the paths are the same, only how each sandbox mechanism
/// grants write access to them differs.
pub const HARNESS_STATE_DIRS: &[&str] = &[".claude", ".cache", ".config/gh"];

/// Build the `bwrap` argv that wraps a command.
///
/// Pure, so the scope in D19 can be asserted rather than trusted. The returned
/// vector is everything up to and including `--`; the command follows.
#[cfg(target_os = "linux")]
pub fn sandbox(project: &Path, home: &Path, access: Access) -> Vec<String> {
    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }
    fn push(a: &mut Vec<String>, args: &[&str]) {
        a.extend(args.iter().map(|x| (*x).to_string()));
    }

    let mut a: Vec<String> = Vec::new();

    // Everything readable, nothing writable, unless granted below.
    push(&mut a, &["--ro-bind", "/", "/"]);
    push(&mut a, &["--dev", "/dev"]);
    push(&mut a, &["--proc", "/proc"]);
    // Scratch that cannot outlive the session or leak into the real /tmp.
    push(&mut a, &["--tmpfs", "/tmp"]);

    // The harness's own state must be writable or it cannot run at all.
    for dir in HARNESS_STATE_DIRS {
        let p = home.join(dir);
        a.extend(["--bind-try".into(), s(&p), s(&p)]);
    }

    // An identity to commit with, but not one to rewrite.
    let gitconfig = home.join(".gitconfig");
    a.extend(["--ro-bind-try".into(), s(&gitconfig), s(&gitconfig)]);

    // Masked with an empty tmpfs: present so tools do not error, empty so there
    // is nothing to read. Only when it exists — bwrap cannot create a mount
    // point on a read-only `/`, and a directory that is absent has nothing to
    // hide anyway.
    let ssh = home.join(".ssh");
    if ssh.exists() {
        a.extend(["--tmpfs".into(), s(&ssh)]);
    }

    // D19: D-Bus is bound on purpose, so `gh` can reach the keyring token.
    // The cost — everything else `gh` can do — is recorded in that decision.
    if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") {
        let bus = PathBuf::from(runtime).join("bus");
        a.extend(["--bind-try".into(), s(&bus), s(&bus)]);
    }

    // The one place work happens — or does not, for a read-only project.
    match access {
        Access::ReadWrite => a.extend(["--bind".into(), s(project), s(project)]),
        Access::ReadOnly => a.extend(["--ro-bind".into(), s(project), s(project)]),
    }

    // A mark, so an agent sandbox left behind by a dead app can be found and
    // reaped. `--die-with-parent` below is not sufficient on its own — see
    // `crate::reap` for why — and an unkillable-because-unidentifiable process
    // is how five of these accumulated over two days.
    push(&mut a, &["--setenv", MARK, "1"]);

    // No sandbox outlives the app, and no keystroke injection into the tty.
    push(&mut a, &["--die-with-parent", "--new-session"]);
    push(&mut a, &["--"]);

    a
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    /// A home that actually exists, so the conditional masks are exercised
    /// rather than skipped.
    fn fake_home(tag: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!(
            "githud-guard-home-{tag}-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::fs::write(home.join(".gitconfig"), "[user]\n").unwrap();
        home
    }

    fn args_for(access: Access) -> Vec<String> {
        let home = fake_home("args");
        sandbox(Path::new("/home/u/github/Proj"), &home, access)
    }

    /// Does `args` contain this exact consecutive sequence?
    fn has(args: &[String], seq: &[&str]) -> bool {
        args.windows(seq.len()).any(|w| w == seq)
    }

    #[test]
    fn everything_is_read_only_before_anything_is_granted() {
        let a = args_for(Access::ReadWrite);
        assert!(has(&a, &["--ro-bind", "/", "/"]), "{a:?}");
    }

    #[test]
    fn the_project_is_the_one_writable_place() {
        let a = args_for(Access::ReadWrite);
        assert!(has(&a, &["--bind", "/home/u/github/Proj", "/home/u/github/Proj"]));
    }

    #[test]
    fn a_read_only_project_is_bound_read_only() {
        // D18 becomes enforcement here rather than a label.
        let a = args_for(Access::ReadOnly);

        assert!(has(
            &a,
            &["--ro-bind", "/home/u/github/Proj", "/home/u/github/Proj"]
        ));
        assert!(
            !has(&a, &["--bind", "/home/u/github/Proj", "/home/u/github/Proj"]),
            "a read-only project must never be bound writable"
        );
    }

    #[test]
    fn ssh_keys_are_masked_rather_than_merely_unbound() {
        // `--ro-bind /` would otherwise expose them: readable is enough to steal.
        let home = fake_home("ssh");
        let a = sandbox(Path::new("/p"), &home, Access::ReadWrite);

        let expected = home.join(".ssh").to_string_lossy().into_owned();
        assert!(
            a.windows(2).any(|w| w[0] == "--tmpfs" && w[1] == expected),
            "{a:?}"
        );
    }

    #[test]
    fn a_home_without_ssh_needs_no_mask_and_must_not_fail_to_build() {
        // bwrap cannot create a mount point on a read-only `/`, so masking a
        // directory that does not exist breaks the sandbox outright.
        let home = std::env::temp_dir().join(format!(
            "githud-guard-nossh-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&home).unwrap();
        let _ = std::fs::remove_dir_all(home.join(".ssh"));

        let a = sandbox(Path::new("/p"), &home, Access::ReadWrite);
        let ssh = home.join(".ssh").to_string_lossy().into_owned();

        assert!(!a.contains(&ssh), "nothing to mask, so no mount");
    }

    #[test]
    fn gitconfig_is_readable_but_not_writable() {
        // git commit needs an identity; it does not need to rewrite one.
        let home = fake_home("gitcfg");
        let a = sandbox(Path::new("/p"), &home, Access::ReadWrite);
        let cfg = home.join(".gitconfig").to_string_lossy().into_owned();

        assert!(a
            .windows(3)
            .any(|w| w[0] == "--ro-bind-try" && w[1] == cfg && w[2] == cfg));
    }

    #[test]
    fn the_harness_can_write_its_own_state() {
        // Deny this and the agent cannot run at all.
        let home = fake_home("state");
        let a = sandbox(Path::new("/p"), &home, Access::ReadWrite);
        let claude = home.join(".claude").to_string_lossy().into_owned();

        assert!(a
            .windows(3)
            .any(|w| w[0] == "--bind-try" && w[1] == claude && w[2] == claude));
    }

    #[test]
    fn tmp_is_a_fresh_tmpfs() {
        let a = args_for(Access::ReadWrite);
        assert!(has(&a, &["--tmpfs", "/tmp"]));
    }

    #[test]
    fn the_sandbox_dies_with_the_app_and_detaches_from_the_tty() {
        let a = args_for(Access::ReadWrite);
        assert!(a.contains(&"--die-with-parent".to_string()));
        // Without --new-session the agent could inject keystrokes via TIOCSTI.
        assert!(a.contains(&"--new-session".to_string()));
    }

    #[test]
    fn the_network_is_not_severed() {
        // The API call is the entire point; --unshare-net would break it.
        let a = args_for(Access::ReadWrite);
        assert!(!a.iter().any(|x| x == "--unshare-net"));
    }

    #[test]
    fn the_argv_ends_with_the_separator_so_a_command_can_follow() {
        let a = args_for(Access::ReadWrite);
        assert_eq!(a.last().map(String::as_str), Some("--"));
    }
}
