//! The macOS floor — Seatbelt (`sandbox-exec`), because `bwrap` cannot exist
//! here at all (D27). It wraps Linux kernel user/mount namespaces; macOS has
//! no equivalent and no port is possible.
//!
//! **This floor is narrower than the Linux one, and that gap is deliberate,
//! not hidden (D27).** Seatbelt's `(deny default)` mode needs a large,
//! empirically-derived allowlist to run any real binary at all (mach-lookups
//! for system services, sysctl reads, TLS-adjacent daemons — see D27 for the
//! evidence this was checked, not assumed). So this profile starts from
//! `(allow default)` and denies only what matters: writes outside the
//! project and the harness's own state, and reads of `~/.ssh`. Concretely: on
//! macOS the agent *can* read arbitrary files elsewhere on disk, which the
//! Linux floor's `--ro-bind / /` makes impossible. It cannot write outside
//! its granted paths or read SSH keys, which is the guarantee that matters
//! most.

use std::io;
use std::path::{Path, PathBuf};

use super::{Access, HARNESS_STATE_DIRS, MARK};

/// Where the generated profile is written. Local state, never committed —
/// regenerated every start, same as the PATH shim, so a stale checkout can
/// never leave an out-of-date profile behind.
///
/// The filename embeds `MARK` on purpose: `sandbox-exec` execs into its
/// target in place rather than staying alive as a supervisor the way `bwrap`
/// does, so there is no outer process whose argv could carry the mark the
/// way `bwrap --setenv GITHUD_AGENT 1` does on Linux. Passing this path as
/// `sandbox-exec`'s `-f` argument puts the mark in the process's own argv
/// instead, which is what `reap::sweep` looks for (see `reap.rs`).
pub fn profile_path(data_home: &Path) -> PathBuf {
    data_home.join(format!("githud/sandbox/agent-{MARK}.sb"))
}

/// Write the profile, replacing any that exists.
pub fn install(data_home: &Path, profile_text: &str) -> io::Result<PathBuf> {
    let path = profile_path(data_home);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, profile_text)?;
    Ok(path)
}

/// Which harness-state directories actually exist right now, paired with
/// their `-D` parameter name.
///
/// `canonicalize` (needed below) errors on a path that doesn't exist yet, and
/// unlike bwrap's `--bind-try` there is no "bind if present, else silently
/// skip" primitive here — so both `profile` and `define_args` call this and
/// only ever reference a param when it is actually present, rather than one
/// creating directories the other didn't ask for. Matches Linux's existing,
/// already-accepted gap: a harness-state dir that doesn't exist yet gets no
/// write exception on either platform, until whatever creates it runs once
/// outside the sandbox.
fn present_harness_dirs(home: &Path) -> Vec<(&'static str, PathBuf)> {
    HARNESS_PARAMS
        .iter()
        .zip(HARNESS_STATE_DIRS)
        .map(|(param, dir)| (*param, home.join(dir)))
        .filter(|(_, p)| p.exists())
        .collect()
}

/// Build the Seatbelt profile text.
///
/// Checks for `~/.ssh`, `~/.gitconfig`, and the harness-state dirs the same
/// way the Linux `sandbox()` does, and only emits the corresponding line —
/// and the `(param ...)` it references — when the path actually exists. A
/// profile that references a param nothing supplies at invocation fails to
/// load outright, so `define_args` must agree with this about which
/// parameters are present.
pub fn profile(home: &Path, access: Access) -> String {
    let mut p = String::from("(version 1)\n(allow default)\n");

    // Nothing may write anywhere by default...
    p.push_str("(deny file-write* (subpath \"/\"))\n");

    // ...except a working `/dev` — bwrap's equivalent is `--dev /dev`, a
    // fresh minimal device tree. Seatbelt has no such mount to hand out, so
    // this allows the real one instead; proven necessary rather than
    // optional, since a plain `> /dev/null` fails outright without it.
    p.push_str("(allow file-write* (subpath \"/dev\"))\n");

    // ...and the per-user system cache directory (`getconf
    // DARWIN_USER_CACHE_DIR`, e.g. `/var/folders/.../C`) — proven necessary,
    // not optional: `security`(1) needs to write a lock file under
    // `<cache>/mds/mds.lock` for even a plain keychain *read*, and Claude
    // Code's OAuth token lives in the Keychain. Without this the agent looks
    // permanently logged out no matter how valid the token actually is —
    // caught by actually invoking `claude` inside the real profile, not
    // guessed at. Distinct from `$TMPDIR` (`.../T`): same per-boot ephemeral
    // shape, different directory, needed for a different reason.
    p.push_str("(allow file-write* (subpath (param \"SYSTEM_CACHE_DIR\")))\n");

    if access == Access::ReadWrite {
        p.push_str("(allow file-write* (subpath (param \"PROJECT\")))\n");
    }

    for (param, _) in present_harness_dirs(home) {
        p.push_str(&format!(
            "(allow file-write* (subpath (param \"{param}\")))\n"
        ));
    }

    // Scratch space: one app-owned directory under the real `$TMPDIR`, not
    // the whole temp tree. Granting the entire OS temp directory was tried
    // first and is wrong — proven live: a file anywhere under `$TMPDIR`
    // became writable, which is a far bigger hole than "the agent needs
    // scratch space" ever called for. Unlike bwrap's `--tmpfs /tmp`, this
    // still isn't an ephemeral, private mount — Seatbelt has no such
    // primitive, so files here outlive the session and sit alongside every
    // other app's temp files, just confined to this one subdirectory rather
    // than all of them. A real, stated reduction versus the Linux floor
    // (D27).
    p.push_str("(allow file-write* (subpath (param \"SCRATCH_DIR\")))\n");

    // Claude Code's own internal Bash-tool sandbox — a second, inner
    // sandbox layered under this one — needs its own scratch directory,
    // outside every path granted above. Narrowed to this project's own
    // subdirectory, not the shared tree every project uses; see
    // `claude_scratch_dir`.
    p.push_str("(allow file-write* (subpath (param \"CLAUDE_SCRATCH_DIR\")))\n");

    // Claude Code's persistent Bash-tool shell also tracks its own working
    // directory in a small file directly under `/tmp` — `claude-<hex>-cwd`.
    // Unlike the scratch directory above, the `<hex>` is random per shell,
    // not derived from anything known before launch (verified: two
    // consecutive sessions in the same project produced different values),
    // so there is no exact path to compute and grant. Matched by pattern
    // instead of by value — proven narrow, not assumed: a differently-named
    // path sharing the same `claude-...` prefix was tried against this exact
    // rule and denied. That keeps it well short of the shared
    // `claude-<uid>` tree, which holds every project's actual scratchpad
    // *contents*; this only ever matches one small directory-tracking file
    // per session.
    p.push_str(
        "(allow file-write* (regex #\"^/private/tmp/claude-[0-9a-f]+-cwd$\"))\n",
    );

    // Masked by denying reads specifically, not by making the rest of the
    // filesystem unreadable the way `--ro-bind /` does — that asymmetry is
    // the headline difference from the Linux floor, stated in D27.
    if home.join(".ssh").exists() {
        p.push_str("(deny file-read* (subpath (param \"SSH_DIR\")))\n");
    }

    // An identity to commit with, but not one to rewrite. Read stays allowed
    // via the `(allow default)` base.
    if home.join(".gitconfig").is_file() {
        p.push_str("(deny file-write* (literal (param \"GITCONFIG\")))\n");
    }

    p
}

/// The name of the one app-owned scratch directory granted under the real
/// `$TMPDIR` — not the whole temp tree. See `profile`'s `SCRATCH_DIR` comment
/// for why the broader form was tried first and rejected.
const SCRATCH_DIR_NAME: &str = "githud-agent-scratch";

/// Where Claude Code's own internal Bash-tool sandbox puts its per-project
/// scratch directory: `/private/tmp/claude-<uid>/<project path, '/' -> '-'>`.
/// It writes there *before* this profile's own sandbox even engages, so
/// without an exception for it, the agent cannot write anywhere — including
/// its own working notes to itself.
///
/// Undocumented and reverse-engineered from observed behavior, not a
/// supported contract: `CLAUDE_CODE_TMPDIR` looks like it should redirect
/// this and does not — the request to make it do so
/// (github.com/anthropics/claude-code/issues/17936) was closed unresolved,
/// and this machine's own `$TMPDIR` does not match where the directory
/// actually lands, confirming the variable is not consulted for this path.
/// If Claude Code's internal scheme ever changes, this stops matching and
/// its scratch-dir write fails the same way it does today — the exception
/// can only become too narrow again, never silently too wide.
///
/// Scoped to this one project's own subdirectory, not the shared
/// `claude-<uid>` tree every project on the machine writes into — granting
/// the whole tree would let this project's agent reach scratch files left
/// behind by every other project ever run through this tool, which is
/// exactly the isolation the sandbox exists to hold.
fn claude_scratch_dir(project: &Path) -> io::Result<PathBuf> {
    let uid = unsafe { libc::getuid() };
    let real = std::fs::canonicalize(project)?;
    let sanitized = real.to_string_lossy().replace('/', "-");
    Ok(PathBuf::from("/private/tmp")
        .join(format!("claude-{uid}"))
        .join(sanitized))
}

/// `getconf DARWIN_USER_CACHE_DIR` — no `std` API exposes this (it is not
/// `dirs::cache_dir()`, which is the stable `~/Library/Caches`; this is the
/// ephemeral, per-boot `/var/folders/.../C` that system services use for
/// exactly the kind of lock file that broke Keychain access here). Shelling
/// out matches how this codebase already reaches `git`/`gh`/`ps`/`bwrap`
/// rather than reimplementing a `confstr(3)` binding for one path.
fn darwin_user_cache_dir() -> io::Result<PathBuf> {
    let out = std::process::Command::new("getconf")
        .arg("DARWIN_USER_CACHE_DIR")
        .output()?;
    if !out.status.success() {
        return Err(io::Error::other("getconf DARWIN_USER_CACHE_DIR failed"));
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        return Err(io::Error::other("getconf DARWIN_USER_CACHE_DIR returned nothing"));
    }
    Ok(PathBuf::from(s))
}

/// The `-D KEY=value` pairs `profile` expects to be supplied at invocation.
///
/// Every path is canonicalized before it goes in: `$TMPDIR` on macOS is a
/// symlink (`/var` -> `/private/var`), and Seatbelt's `subpath` matches the
/// resolved path, not the string handed to it — an uncanonicalized path here
/// silently breaks the agent's own scratch-file writes rather than merely
/// widening a guarantee. Proven empirically during design; not a
/// theoretical concern.
pub fn define_args(project: &Path, home: &Path, access: Access) -> io::Result<Vec<String>> {
    let mut out = Vec::new();

    let mut define = |key: &str, path: &Path| -> io::Result<()> {
        let real = std::fs::canonicalize(path)?;
        out.push(format!("{key}={}", real.to_string_lossy()));
        Ok(())
    };

    if access == Access::ReadWrite {
        define("PROJECT", project)?;
    }

    for (param, dir) in present_harness_dirs(home) {
        define(param, &dir)?;
    }

    let scratch = std::env::temp_dir().join(SCRATCH_DIR_NAME);
    std::fs::create_dir_all(&scratch)?;
    define("SCRATCH_DIR", &scratch)?;

    let claude_scratch = claude_scratch_dir(project)?;
    std::fs::create_dir_all(&claude_scratch)?;
    define("CLAUDE_SCRATCH_DIR", &claude_scratch)?;

    define("SYSTEM_CACHE_DIR", &darwin_user_cache_dir()?)?;

    let ssh = home.join(".ssh");
    if ssh.exists() {
        define("SSH_DIR", &ssh)?;
    }

    let gitconfig = home.join(".gitconfig");
    if gitconfig.is_file() {
        define("GITCONFIG", &gitconfig)?;
    }

    Ok(out)
}

/// One `-D` parameter name per entry in `HARNESS_STATE_DIRS`, in the same
/// order — kept as a fixed-size array so a mismatch between the two is a
/// compile error, not a silent profile/args drift.
const HARNESS_PARAMS: [&str; 3] = ["CLAUDE_HOME", "CACHE_HOME", "GH_CONFIG_HOME"];

#[cfg(test)]
mod tests {
    use super::*;

    /// A home that actually exists, with `.ssh`, `.gitconfig`, and every
    /// harness-state dir already present, so the conditional lines are
    /// exercised rather than skipped.
    fn fake_home(tag: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!(
            "githud-guard-macos-home-{tag}-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::fs::write(home.join(".gitconfig"), "[user]\n").unwrap();
        for dir in HARNESS_STATE_DIRS {
            std::fs::create_dir_all(home.join(dir)).unwrap();
        }
        home
    }

    #[test]
    fn everything_is_denied_write_before_anything_is_granted() {
        let home = fake_home("base");
        let p = profile(&home, Access::ReadWrite);
        assert!(p.contains("(deny file-write* (subpath \"/\"))"), "{p}");
    }

    #[test]
    fn a_read_write_project_gets_a_write_exception() {
        let home = fake_home("rw");
        let p = profile(&home, Access::ReadWrite);
        assert!(p.contains("(allow file-write* (subpath (param \"PROJECT\")))"));
    }

    #[test]
    fn a_read_only_project_gets_no_write_exception() {
        // D18 becomes enforcement here rather than a label.
        let home = fake_home("ro");
        let p = profile(&home, Access::ReadOnly);
        assert!(
            !p.contains("\"PROJECT\""),
            "a read-only project must never get a write exception: {p}"
        );
    }

    #[test]
    fn the_harness_state_dirs_are_writable() {
        let home = fake_home("state");
        let p = profile(&home, Access::ReadWrite);
        for param in HARNESS_PARAMS {
            assert!(
                p.contains(&format!("(allow file-write* (subpath (param \"{param}\")))")),
                "{param} missing from {p}"
            );
        }
    }

    #[test]
    fn tmp_is_writable() {
        let home = fake_home("tmp");
        let p = profile(&home, Access::ReadWrite);
        assert!(p.contains("\"SCRATCH_DIR\""));
    }

    #[test]
    fn dev_is_writable() {
        // A plain `> /dev/null` fails outright without this — proven live,
        // not theoretical: bwrap gets a fresh `/dev` via `--dev /dev`, and
        // Seatbelt has no equivalent primitive to hand out instead.
        let home = fake_home("dev");
        let p = profile(&home, Access::ReadWrite);
        assert!(p.contains("(allow file-write* (subpath \"/dev\"))"), "{p}");
    }

    #[test]
    fn the_system_cache_dir_is_writable() {
        // `security`(1) needs to write a lock file here for even a plain
        // Keychain *read* — Claude Code's OAuth token lives in the Keychain,
        // so without this the agent looks permanently logged out. Caught by
        // actually invoking `claude` inside the real profile, not guessed.
        let home = fake_home("keychain");
        let p = profile(&home, Access::ReadWrite);
        assert!(p.contains("(allow file-write* (subpath (param \"SYSTEM_CACHE_DIR\")))"), "{p}");
    }

    #[test]
    fn define_args_resolves_the_real_system_cache_dir() {
        let home = fake_home("cache-dir-args");
        let project = std::env::temp_dir();
        let args = define_args(&project, &home, Access::ReadWrite).unwrap();

        let cache = args
            .iter()
            .find(|a| a.starts_with("SYSTEM_CACHE_DIR="))
            .expect("SYSTEM_CACHE_DIR must be defined")
            .split_once('=')
            .unwrap()
            .1
            .to_string();

        assert_eq!(
            cache,
            std::fs::canonicalize(darwin_user_cache_dir().unwrap())
                .unwrap()
                .to_string_lossy()
        );
    }

    #[test]
    fn ssh_keys_are_denied_read_when_they_exist() {
        let home = fake_home("ssh");
        let p = profile(&home, Access::ReadWrite);
        assert!(p.contains("(deny file-read* (subpath (param \"SSH_DIR\")))"));
    }

    #[test]
    fn a_home_without_ssh_needs_no_mask_and_must_not_reference_an_unset_param() {
        let home = std::env::temp_dir().join(format!(
            "githud-guard-macos-nossh-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&home).unwrap();
        let _ = std::fs::remove_dir_all(home.join(".ssh"));

        let p = profile(&home, Access::ReadWrite);
        assert!(!p.contains("SSH_DIR"), "nothing to mask, so no reference: {p}");
    }

    #[test]
    fn gitconfig_is_denied_write_but_not_blanket_denied_read() {
        // A profile can (and does, for `.ssh`) contain other `file-read*`
        // lines — the assertion is that none of them names GITCONFIG.
        let home = fake_home("gitcfg");
        let p = profile(&home, Access::ReadWrite);
        assert!(p.contains("(deny file-write* (literal (param \"GITCONFIG\")))"));
        assert!(
            !p.contains("(deny file-read* (subpath (param \"GITCONFIG\")))"),
            "{p}"
        );
    }

    #[test]
    fn the_network_is_not_denied() {
        let home = fake_home("net");
        let p = profile(&home, Access::ReadWrite);
        assert!(!p.contains("network"), "{p}");
    }

    #[test]
    fn define_args_only_includes_ssh_when_it_exists() {
        let home = fake_home("args-ssh");
        let project = std::env::temp_dir();
        let args = define_args(&project, &home, Access::ReadWrite).unwrap();
        assert!(args.iter().any(|a| a.starts_with("SSH_DIR=")), "{args:?}");
    }

    #[test]
    fn define_args_canonicalizes_every_path() {
        // A raw symlinked TMPDIR silently breaks the agent's own scratch
        // writes — proven during design, not theoretical.
        let home = fake_home("canon");
        let project = std::env::temp_dir();
        let args = define_args(&project, &home, Access::ReadWrite).unwrap();

        let scratch = args
            .iter()
            .find(|a| a.starts_with("SCRATCH_DIR="))
            .expect("SCRATCH_DIR must be defined");
        let value = scratch.split_once('=').unwrap().1;
        assert_eq!(
            value,
            std::fs::canonicalize(std::env::temp_dir().join(SCRATCH_DIR_NAME))
                .unwrap()
                .to_string_lossy()
        );
    }

    #[test]
    fn the_scratch_dir_is_one_subdirectory_not_the_whole_temp_tree() {
        // Granting the entire OS temp directory was tried first: a file
        // anywhere under `$TMPDIR` — including something that has nothing to
        // do with this session — became writable. Proven live, not assumed.
        let home = fake_home("scratch-narrow");
        let project = std::env::temp_dir();
        let args = define_args(&project, &home, Access::ReadWrite).unwrap();

        let scratch = args
            .iter()
            .find(|a| a.starts_with("SCRATCH_DIR="))
            .unwrap()
            .split_once('=')
            .unwrap()
            .1
            .to_string();

        assert_ne!(
            scratch,
            std::fs::canonicalize(std::env::temp_dir())
                .unwrap()
                .to_string_lossy(),
            "the scratch exception must not be the whole temp directory"
        );
        assert!(scratch.ends_with(SCRATCH_DIR_NAME), "{scratch}");
    }

    #[test]
    fn the_cwd_tracker_pattern_is_present() {
        let home = fake_home("cwd-tracker-pattern");
        let p = profile(&home, Access::ReadWrite);
        assert!(
            p.contains(r#"(regex #"^/private/tmp/claude-[0-9a-f]+-cwd$")"#),
            "{p}"
        );
    }

    #[test]
    fn claude_scratch_dir_is_writable() {
        let home = fake_home("claude-scratch");
        let p = profile(&home, Access::ReadWrite);
        assert!(p.contains("\"CLAUDE_SCRATCH_DIR\""), "{p}");
    }

    #[test]
    fn define_args_scopes_the_claude_scratch_dir_to_this_project() {
        // The fix for the EPERM Claude Code's own inner sandbox hits when
        // wrapped: grant its scratch write only within *this* project's own
        // subdirectory of the shared `claude-<uid>` tree, never the whole
        // tree — that tree holds every project's scratch files, not just
        // this one's.
        let home = fake_home("claude-scratch-args");
        let project = std::env::temp_dir();
        let args = define_args(&project, &home, Access::ReadWrite).unwrap();

        let value = args
            .iter()
            .find(|a| a.starts_with("CLAUDE_SCRATCH_DIR="))
            .expect("CLAUDE_SCRATCH_DIR must be defined")
            .split_once('=')
            .unwrap()
            .1
            .to_string();

        let uid = unsafe { libc::getuid() };
        let shared_root = format!("/private/tmp/claude-{uid}");
        assert_ne!(
            value, shared_root,
            "must not grant the whole shared claude-<uid> tree, only this project's own subdirectory within it"
        );
        assert!(
            value.starts_with(&format!("{shared_root}/")),
            "expected {value} under {shared_root}"
        );

        let real_project = std::fs::canonicalize(&project).unwrap();
        let sanitized = real_project.to_string_lossy().replace('/', "-");
        assert!(value.ends_with(&sanitized), "{value}");
    }

    #[test]
    fn two_projects_get_different_claude_scratch_dirs() {
        // Isolation is the entire point: project A's agent must not land in
        // project B's Claude-Code-internal scratch directory just because
        // both share the same uid-scoped parent tree.
        let home = fake_home("claude-scratch-iso");
        let project_a = std::env::temp_dir();
        let project_b = home.clone();

        let args_a = define_args(&project_a, &home, Access::ReadWrite).unwrap();
        let args_b = define_args(&project_b, &home, Access::ReadWrite).unwrap();

        let val = |args: &[String]| {
            args.iter()
                .find(|a| a.starts_with("CLAUDE_SCRATCH_DIR="))
                .unwrap()
                .clone()
        };

        assert_ne!(val(&args_a), val(&args_b));
    }

    #[test]
    fn a_read_only_project_defines_no_project_param() {
        let home = fake_home("args-ro");
        let project = std::env::temp_dir();
        let args = define_args(&project, &home, Access::ReadOnly).unwrap();
        assert!(!args.iter().any(|a| a.starts_with("PROJECT=")), "{args:?}");
    }
}
