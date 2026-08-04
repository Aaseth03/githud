// Shared floor test bodies, spliced by `include!` into both `linux_floor`
// (real `bwrap`) and `macos_floor` (real `sandbox-exec`, D27) — same
// assertions against the real filesystem, against whichever mechanism is the
// floor on this platform. Not a standalone module: relies on `scratch`,
// `in_sandbox`, `guard`, and `Access` already being in scope from whichever
// module includes it.

#[test]
fn writing_inside_the_project_is_allowed() {
    if !guard::available() {
        panic!("the sandbox floor is required — the agent must not start without it");
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
