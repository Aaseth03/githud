//! The default-deny suite.
//!
//! M4 ships on green only: **every denied operation attempted and blocked,
//! every allowed operation attempted and passing.** Asserting the argv is not
//! enough — a floor you have not stood on is a floor you are guessing about.
//! These run real `bwrap` (Linux) or real `sandbox-exec` (macOS, D27) and the
//! real generated shim.
//!
//! ```text
//! cargo test --test guardrails
//! ```

use std::path::{Path, PathBuf};
use std::process::Command;

use githud_lib::guard::shim;

const BLOCKED: i32 = 97;

fn scratch(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("githud-guard-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}

// ── The floor: bwrap (Linux) ─────────────────────────────────────────────────

#[cfg(target_os = "linux")]
mod linux_floor {
    use super::scratch;
    use std::path::Path;
    use std::process::Command;

    use githud_lib::guard::{self, Access};

    /// Run a shell command inside the sandbox, returning (exit code, stderr).
    fn in_sandbox(project: &Path, home: &Path, access: Access, script: &str) -> (i32, String) {
        let mut args = guard::sandbox(project, home, access);
        args.extend(["/bin/bash".into(), "-c".into(), script.into()]);

        let out = Command::new("bwrap")
            .args(&args)
            .current_dir(project)
            .output()
            .expect("bwrap should run");

        (
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        )
    }

    include!("guardrails_support/floor_cases.rs");
}

// ── The floor: Seatbelt (macOS, D27) ─────────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos_floor {
    use super::scratch;
    use std::path::Path;
    use std::process::Command;

    use githud_lib::guard::{self, macos, Access};

    /// Run a shell command inside the sandbox, returning (exit code, stderr).
    /// Unlike the agent's own invocation (`agent::sandbox_command`), this
    /// skips the `exec -a` mark spoof — these tests exercise the filesystem
    /// floor, not the reap mechanism, so plain `bash -c` is enough.
    fn in_sandbox(project: &Path, home: &Path, access: Access, script: &str) -> (i32, String) {
        // Nested under `project`, which every caller already makes unique via
        // `scratch()` — keeps each test's profile file isolated from every
        // other test running in parallel, without a new uniqueness scheme.
        let data_home = project.join(".githud-sandbox-data");
        let profile_text = macos::profile(home, access);
        let profile_path =
            macos::install(&data_home, &profile_text).expect("profile should install");
        let defines = macos::define_args(project, home, access).expect("paths should resolve");

        let mut args = vec![
            "-f".to_string(),
            profile_path.to_string_lossy().into_owned(),
        ];
        for kv in defines {
            args.push("-D".to_string());
            args.push(kv);
        }
        args.push("--".to_string());
        args.push("/bin/bash".to_string());
        args.push("-c".to_string());
        args.push(script.to_string());

        let out = Command::new("sandbox-exec")
            .args(&args)
            .current_dir(project)
            .output()
            .expect("sandbox-exec should run");

        (
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        )
    }

    include!("guardrails_support/floor_cases.rs");

    /// Regression test for a real bug: the first profile denied writes to
    /// the Darwin per-user cache dir (`getconf DARWIN_USER_CACHE_DIR`), which
    /// broke `security`(1)'s Keychain lock file and made Claude Code's OAuth
    /// token — stored in the Keychain — permanently unreadable, reporting
    /// "not logged in" no matter how valid the token was. Caught by actually
    /// invoking `claude` under the real profile, not by asserting argv.
    #[test]
    fn the_system_cache_dir_is_writable_so_keychain_access_works() {
        let out = std::process::Command::new("getconf")
            .arg("DARWIN_USER_CACHE_DIR")
            .output()
            .expect("getconf should run");
        let cache_dir = String::from_utf8_lossy(&out.stdout).trim().to_string();

        let project = scratch("cache-dir");
        let home = dirs::home_dir().unwrap();

        let (code, err) = in_sandbox(
            &project,
            &home,
            Access::ReadWrite,
            &format!(
                "echo probe > '{cache_dir}/githud-cache-dir-probe.txt' && \
                 rm -f '{cache_dir}/githud-cache-dir-probe.txt'"
            ),
        );

        assert_eq!(code, 0, "the system cache dir must be writable: {err}");
    }
}

// ── The guard: the PATH shim ─────────────────────────────────────────────────

/// Run a shim wrapper directly with the given arguments.
fn shim_run(dir: &Path, cmd: &str, args: &[&str], cwd: &Path) -> i32 {
    let path = format!(
        "{}:{}",
        dir.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    Command::new(dir.join(cmd))
        .args(args)
        .current_dir(cwd)
        .env("PATH", path)
        .output()
        .expect("shim should run")
        .status
        .code()
        .unwrap_or(-1)
}

fn installed_shim(tag: &str) -> (PathBuf, PathBuf) {
    let data = scratch(tag);
    let dir = shim::install(&data).expect("shim should install");
    let repo = scratch(&format!("{tag}-repo"));
    // A real repo with a commit, so `git` can answer what branch it is on.
    for args in [
        vec!["init", "-q", "-b", "main"],
        vec!["config", "user.email", "test@example.invalid"],
        vec!["config", "user.name", "Test"],
    ] {
        Command::new("git")
            .args(&args)
            .current_dir(&repo)
            .output()
            .unwrap();
    }
    std::fs::write(repo.join("seed.txt"), "seed").unwrap();
    for args in [vec!["add", "seed.txt"], vec!["commit", "-qm", "seed"]] {
        Command::new("git")
            .args(&args)
            .current_dir(&repo)
            .output()
            .unwrap();
    }
    (dir, repo)
}

#[test]
fn denied_git_operations_are_blocked() {
    let (dir, repo) = installed_shim("git-deny");

    for args in [
        vec!["push", "--force"],
        vec!["push", "origin", "main"],
        vec!["push", "origin", "dev"],
        vec!["push", "origin", "HEAD:main"],
        vec!["merge", "other"],
        vec!["rebase", "main"],
        vec!["reset", "--hard"],
        vec!["commit", "--amend", "-m", "x"],
        vec!["branch", "-D", "something"],
        vec!["config", "--global", "user.name", "x"],
    ] {
        let code = shim_run(&dir, "git", &args, &repo);
        assert_eq!(
            code, BLOCKED,
            "git {} should have been blocked, exited {code}",
            args.join(" ")
        );
    }
}

#[test]
fn allowed_git_operations_pass_through() {
    let (dir, repo) = installed_shim("git-allow");
    std::fs::write(repo.join("a.txt"), "hello").unwrap();

    for args in [
        vec!["status", "--porcelain"],
        vec!["add", "a.txt"],
        vec!["checkout", "-b", "agent/work"],
        vec!["log", "--oneline"],
        vec!["diff"],
    ] {
        let code = shim_run(&dir, "git", &args, &repo);
        assert_ne!(
            code, BLOCKED,
            "git {} should have been allowed",
            args.join(" ")
        );
    }
}

#[test]
fn a_bare_push_from_a_shared_branch_is_blocked() {
    // `git push` with no refspec inherits the current branch.
    let (dir, repo) = installed_shim("git-bare-push");

    let code = shim_run(&dir, "git", &["push"], &repo);

    assert_eq!(code, BLOCKED, "a bare push from main should be blocked");
}

#[test]
fn denied_gh_operations_are_blocked() {
    let (dir, repo) = installed_shim("gh-deny");

    for args in [
        vec!["pr", "merge"],
        vec!["pr", "close"],
        vec!["repo", "delete"],
        vec!["auth", "token"],
        vec!["secret", "set", "X"],
    ] {
        let code = shim_run(&dir, "gh", &args, &repo);
        assert_eq!(
            code, BLOCKED,
            "gh {} should have been blocked",
            args.join(" ")
        );
    }
}

#[test]
fn gh_pr_create_is_allowed() {
    // D6, reaffirmed at D19 with its cost documented.
    let (dir, repo) = installed_shim("gh-allow");

    let code = shim_run(&dir, "gh", &["pr", "create", "--help"], &repo);

    assert_ne!(code, BLOCKED, "gh pr create must not be blocked");
}

#[test]
fn sudo_is_refused_outright() {
    let (dir, repo) = installed_shim("sudo");

    assert_eq!(shim_run(&dir, "sudo", &["true"], &repo), BLOCKED);
    assert_eq!(shim_run(&dir, "sudo", &["-i"], &repo), BLOCKED);
}

#[test]
fn reckless_rm_is_blocked_but_ordinary_rm_is_not() {
    let (dir, repo) = installed_shim("rm");
    std::fs::write(repo.join("scratch.txt"), "x").unwrap();

    assert_eq!(
        shim_run(&dir, "rm", &["-rf", "something"], &repo),
        BLOCKED,
        "rm -rf should be blocked"
    );
    assert_eq!(
        shim_run(&dir, "rm", &["/etc/hosts"], &repo),
        BLOCKED,
        "rm outside the project should be blocked"
    );
    assert_ne!(
        shim_run(&dir, "rm", &["scratch.txt"], &repo),
        BLOCKED,
        "an ordinary rm inside the project should pass"
    );
}

#[test]
fn the_shim_never_shadows_itself_into_a_loop() {
    // The wrapper must resolve the *real* binary, not re-enter itself.
    let (dir, repo) = installed_shim("loop");

    let code = shim_run(&dir, "git", &["--version"], &repo);

    assert_eq!(code, 0, "the shim failed to reach the real git");
}

// ── Branch isolation ─────────────────────────────────────────────────────────

use githud_lib::guard::branch;

fn seeded_repo(tag: &str, on: &str) -> PathBuf {
    let repo = scratch(tag);
    for args in [
        vec!["init", "-q", "-b", on],
        vec!["config", "user.email", "t@example.invalid"],
        vec!["config", "user.name", "T"],
    ] {
        Command::new("git").args(&args).current_dir(&repo).output().unwrap();
    }
    std::fs::write(repo.join("seed.txt"), "seed").unwrap();
    for args in [vec!["add", "-A"], vec!["commit", "-qm", "seed"]] {
        Command::new("git").args(&args).current_dir(&repo).output().unwrap();
    }
    repo
}

#[test]
fn a_clean_shared_branch_is_isolated_onto_an_agent_branch() {
    let repo = seeded_repo("iso-clean", "main");
    assert_eq!(branch::current(&repo).as_deref(), Some("main"));

    let moved = branch::isolate(&repo, "Professor").expect("isolation should succeed");

    let now = branch::current(&repo).unwrap();
    assert!(moved.is_some(), "expected a switch");
    assert_eq!(moved.unwrap().carried, 0, "a clean tree carries nothing");
    assert!(now.starts_with("agent/professor-"), "on {now}");
    assert!(!branch::is_shared(&now));
}

#[test]
fn a_feature_branch_is_left_where_it_is() {
    let repo = seeded_repo("iso-feature", "my-work");

    let moved = branch::isolate(&repo, "Proj").expect("should not error");

    assert_eq!(moved, None, "it should not have switched");
    assert_eq!(branch::current(&repo).as_deref(), Some("my-work"));
}

#[test]
fn uncommitted_work_comes_along_and_is_reported() {
    // Refusing was tried first and made the agent unusable in any repo with
    // work in progress. `git checkout -b` loses nothing; the obligation is to
    // report what moved.
    let repo = seeded_repo("iso-dirty", "main");
    std::fs::write(repo.join("wip.txt"), "half-finished").unwrap();
    std::fs::write(repo.join("seed.txt"), "edited").unwrap();

    let moved = branch::isolate(&repo, "Proj")
        .expect("should switch, not refuse")
        .expect("expected a switch");

    assert!(moved.branch.starts_with("agent/proj-"));
    assert_eq!(moved.from, "main");
    assert_eq!(moved.carried, 2, "both changed paths should be counted");

    // The work is still there, still uncommitted, on the new branch.
    assert_eq!(
        std::fs::read_to_string(repo.join("wip.txt")).unwrap(),
        "half-finished"
    );
    assert!(branch::is_dirty(&repo), "changes remain uncommitted");
    assert!(branch::current(&repo).unwrap().starts_with("agent/"));
}

#[test]
fn switching_back_is_one_command() {
    // The claim made in the UI notice, checked.
    let repo = seeded_repo("iso-back", "main");
    std::fs::write(repo.join("wip.txt"), "wip").unwrap();

    branch::isolate(&repo, "Proj").unwrap().unwrap();
    Command::new("git")
        .args(["switch", "-"])
        .current_dir(&repo)
        .output()
        .unwrap();

    assert_eq!(branch::current(&repo).as_deref(), Some("main"));
    assert!(repo.join("wip.txt").is_file(), "the work followed back");
}

#[test]
fn isolating_twice_reuses_the_branch_rather_than_failing() {
    // Opening a project again the same day must not error on an existing branch.
    let repo = seeded_repo("iso-twice", "main");

    let first = branch::isolate(&repo, "Proj").unwrap().unwrap().branch;
    Command::new("git")
        .args(["checkout", "-q", "main"])
        .current_dir(&repo)
        .output()
        .unwrap();
    let second = branch::isolate(&repo, "Proj").unwrap().unwrap().branch;

    assert_eq!(first, second);
    assert_eq!(branch::current(&repo).as_deref(), Some(second.as_str()));
}

#[test]
fn a_repo_with_no_commits_is_left_alone_rather_than_guessed_at() {
    let repo = scratch("iso-empty");
    Command::new("git")
        .args(["init", "-q", "-b", "main"])
        .current_dir(&repo)
        .output()
        .unwrap();

    // An unborn HEAD reports a branch name but has nothing to switch from.
    let result = branch::isolate(&repo, "Proj");

    assert!(result.is_ok(), "must not error: {result:?}");
}
