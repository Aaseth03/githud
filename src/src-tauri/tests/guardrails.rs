//! The default-deny suite.
//!
//! M4 ships on green only: **every denied operation attempted and blocked,
//! every allowed operation attempted and passing.** Asserting the argv is not
//! enough — a floor you have not stood on is a floor you are guessing about.
//! These run real `bwrap` and the real generated shim.
//!
//! ```text
//! cargo test --test guardrails
//! ```

use std::path::{Path, PathBuf};
use std::process::Command;

use githud_lib::guard::{self, shim, Access};

const BLOCKED: i32 = 97;

fn scratch(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("githud-guard-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}

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

// ── The floor: bwrap ─────────────────────────────────────────────────────────

#[test]
fn writing_inside_the_project_is_allowed() {
    if !guard::available() {
        panic!("bwrap is required — the agent must not start without the floor");
    }
    let project = scratch("write-in");
    let home = dirs::home_dir().unwrap();

    let (code, err) = in_sandbox(
        &project,
        &home,
        Access::ReadWrite,
        "echo hello > allowed.txt && cat allowed.txt",
    );

    assert_eq!(code, 0, "an allowed write failed: {err}");
    assert!(project.join("allowed.txt").is_file());
}

#[test]
fn writing_outside_the_project_is_impossible() {
    let project = scratch("write-out");
    let home = dirs::home_dir().unwrap();
    let outside = scratch("outside");

    let (code, _) = in_sandbox(
        &project,
        &home,
        Access::ReadWrite,
        &format!("echo pwned > {}/escaped.txt", outside.display()),
    );

    assert_ne!(code, 0, "the sandbox let a write escape the project");
    assert!(
        !outside.join("escaped.txt").exists(),
        "a file was created outside the project — the floor does not hold"
    );
}

#[test]
fn a_read_only_project_cannot_be_written() {
    // D18 becomes enforcement here rather than a label.
    let project = scratch("ro");
    let home = dirs::home_dir().unwrap();

    let (code, _) = in_sandbox(&project, &home, Access::ReadOnly, "echo x > nope.txt");

    assert_ne!(code, 0, "a read-only project accepted a write");
    assert!(!project.join("nope.txt").exists());
}

#[test]
fn ssh_keys_are_masked_when_they_exist() {
    // Readable is enough to steal, so masking matters more than write denial.
    // On a machine with no ~/.ssh there is nothing to assert, and saying the
    // test passed would be claiming a guarantee that was never exercised.
    let real_home = dirs::home_dir().unwrap();
    if !real_home.join(".ssh").exists() {
        eprintln!("skipped: no ~/.ssh on this machine, nothing to mask");
        return;
    }

    let project = scratch("ssh");
    let (code, _) = in_sandbox(
        &project,
        &real_home,
        Access::ReadWrite,
        "ls -A ~/.ssh | grep -q .",
    );

    assert_ne!(code, 0, "~/.ssh had readable contents inside the sandbox");
}

#[test]
fn a_planted_ssh_directory_is_masked() {
    // The guarantee itself, exercised against a home that definitely has keys —
    // so it is proven rather than skipped on this particular machine.
    let home = scratch("ssh-home");
    std::fs::create_dir_all(home.join(".ssh")).unwrap();
    std::fs::write(home.join(".ssh/id_ed25519"), "PRIVATE KEY").unwrap();
    let project = scratch("ssh-proj");

    let (code, _) = in_sandbox(
        &project,
        &home,
        Access::ReadWrite,
        &format!("cat {}/.ssh/id_ed25519", home.display()),
    );

    assert_ne!(code, 0, "a private key was readable inside the sandbox");
}

#[test]
fn the_home_directory_cannot_be_written() {
    let project = scratch("home-write");
    let home = dirs::home_dir().unwrap();

    let (code, _) = in_sandbox(
        &project,
        &home,
        Access::ReadWrite,
        "echo x > ~/githud-should-not-exist.txt",
    );

    assert_ne!(code, 0, "the sandbox allowed a write to $HOME");
    assert!(!home.join("githud-should-not-exist.txt").exists());
}

#[test]
fn gitconfig_is_readable_but_not_writable() {
    let project = scratch("gitcfg");
    let home = dirs::home_dir().unwrap();
    if !home.join(".gitconfig").is_file() {
        return; // Nothing to assert on this machine.
    }

    let (read, _) = in_sandbox(&project, &home, Access::ReadWrite, "cat ~/.gitconfig >/dev/null");
    assert_eq!(read, 0, "git needs to read an identity to commit");

    let (write, _) = in_sandbox(&project, &home, Access::ReadWrite, "echo x >> ~/.gitconfig");
    assert_ne!(write, 0, "the agent must not be able to rewrite git identity");
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
fn uncommitted_work_on_a_shared_branch_stops_the_session() {
    // Git would carry the changes across and lose nothing, but they would land
    // on a branch the user never chose. Surface instead.
    let repo = seeded_repo("iso-dirty", "main");
    std::fs::write(repo.join("wip.txt"), "half-finished").unwrap();
    assert!(branch::is_dirty(&repo));

    let err = branch::isolate(&repo, "Proj").expect_err("should refuse");

    assert!(err.contains("uncommitted"), "{err}");
    assert_eq!(
        branch::current(&repo).as_deref(),
        Some("main"),
        "it must not have moved anything"
    );
    assert!(repo.join("wip.txt").is_file(), "the work is untouched");
}

#[test]
fn isolating_twice_reuses_the_branch_rather_than_failing() {
    // Opening a project again the same day must not error on an existing branch.
    let repo = seeded_repo("iso-twice", "main");

    let first = branch::isolate(&repo, "Proj").unwrap().unwrap();
    Command::new("git")
        .args(["checkout", "-q", "main"])
        .current_dir(&repo)
        .output()
        .unwrap();
    let second = branch::isolate(&repo, "Proj").unwrap().unwrap();

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
