//! Proves the orphan sweep against a real process, not against a string.
//!
//! The unit tests in `reap` assert the *decision* — marked, and no longer held
//! by a `githud`. This asserts the *mechanism*: that a genuinely reparented
//! sandbox is found in `/proc` and actually dies. Those are different claims,
//! and the one that matters is only provable against a real orphan.
//!
//! Environment-dependent, so `#[ignore]`d. It spawns a marked `bwrap` holding a
//! `sleep`, from a shell that exits immediately so the sandbox is reparented —
//! the exact shape of the leak that produced five of these over two days.
//!
//! ```text
//! cargo test --test sweep_proof -- --ignored --nocapture
//! ```

use std::process::{Command, Stdio};

#[test]
#[ignore = "spawns a real orphaned sandbox; run explicitly with --ignored"]
fn a_real_orphan_is_found_and_reaped() {
    let argv = githud_lib::guard::sandbox(
        std::path::Path::new("/tmp"),
        std::path::Path::new(&std::env::var("HOME").expect("HOME")),
        // Read-only: this sandbox exists to be killed, not to touch anything.
        githud_lib::guard::Access::ReadOnly,
    );

    // `& disown` is what makes it an orphan rather than a child of this test.
    let quoted: Vec<String> = argv.iter().map(|a| format!("'{a}'")).collect();
    Command::new("sh")
        .arg("-c")
        .arg(format!("bwrap {} sleep 300 & disown", quoted.join(" ")))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("could not spawn the orphan");

    std::thread::sleep(std::time::Duration::from_millis(700));

    let before = count_marked();
    assert!(before > 0, "the orphan should exist before the sweep");

    let reaped = githud_lib::reap::sweep();
    std::thread::sleep(std::time::Duration::from_millis(300));
    let after = count_marked();

    println!("  marked before: {before} · reaped: {reaped} · after: {after}");

    assert!(reaped > 0, "the sweep found nothing to reap");
    assert_eq!(after, 0, "a marked sandbox survived the sweep");
}

/// How many marked sandboxes exist right now, counted the way the sweep counts.
fn count_marked() -> usize {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| {
            std::fs::read(e.path().join("cmdline"))
                .map(|raw| String::from_utf8_lossy(&raw).contains("GITHUD_AGENT"))
                .unwrap_or(false)
        })
        .count()
}
