//! The M1 validation, as a test rather than a squint at the UI.
//!
//! This one is environment-dependent — it scans the real `~/github` — so it is
//! `#[ignore]`d and does not run in a normal `cargo test`. Run it deliberately:
//!
//! ```text
//! cargo test --test real_root -- --ignored --nocapture
//! ```

use githud_lib::scan::{self, DEFAULT_MAX_DEPTH};

#[test]
#[ignore = "scans the real ~/github; run explicitly with --ignored"]
fn finds_every_repo_under_the_real_root_including_the_nested_vault() {
    let root = dirs::home_dir().expect("home dir").join("github");
    let found = scan::walk(&root, DEFAULT_MAX_DEPTH);

    println!("\nscan root: {}", root.display());
    println!("{} repo(s) found:\n", found.len());
    for p in &found {
        println!(
            "  {:<28} depth {}  L0:{}  L1:{}  {}",
            p.rel_path,
            p.depth,
            if p.icm.layer0 { "y" } else { "n" },
            if p.icm.layer1 { "y" } else { "n" },
            if p.icm.is_conformant() { "" } else { "<- badged" },
        );
    }
    println!();

    assert!(
        found.len() >= 5,
        "expected at least five repos under {}, found {}",
        root.display(),
        found.len()
    );

    // The specific case that makes a naive depth-1 scan wrong.
    let vault = found
        .iter()
        .find(|p| p.rel_path == "Obsidian/HOME_AI_VAULT")
        .expect("the vault at depth 2 must be found");
    assert_eq!(vault.depth, 2);
    assert!(vault.icm.layer0, "the vault has AGENTS.md");

    // GIT HUD itself must be conformant — it is the reference for the badge.
    let githud = found
        .iter()
        .find(|p| p.name == "githud")
        .expect("githud must be found");
    assert!(
        githud.icm.is_conformant(),
        "githud has both AGENTS.md and CONTEXT.md"
    );

    // Professor keeps Layer 1 *inside* AGENTS.md. If the fallback chain is
    // wrong, this is where it shows up as a false badge.
    if let Some(professor) = found.iter().find(|p| p.name == "Professor") {
        assert!(
            professor.icm.is_conformant(),
            "Professor's routing lives inside AGENTS.md and must satisfy Layer 1"
        );
    }

    // No duplicates — one repo, one entry.
    let mut keys: Vec<&str> = found.iter().map(|p| p.rel_path.as_str()).collect();
    keys.sort_unstable();
    let before = keys.len();
    keys.dedup();
    assert_eq!(before, keys.len(), "the scan returned a duplicate repo");
}
