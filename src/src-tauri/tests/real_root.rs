//! The M1 validation, as a test rather than a squint at the UI.
//!
//! This one is environment-dependent — it scans the real `~/github` and this
//! machine's real local config (D24) — so it is `#[ignore]`d and does not run
//! in a normal `cargo test`. Run it deliberately:
//!
//! ```text
//! cargo test --test real_root -- --ignored --nocapture
//! ```

use githud_lib::local::{AgentAccess, ProjectKind};
use githud_lib::scan::{self, DEFAULT_MAX_DEPTH};

#[test]
#[ignore = "scans the real ~/github and this machine's local config; run explicitly with --ignored"]
fn finds_every_repo_under_the_real_root_including_the_nested_vault() {
    let root = dirs::home_dir().expect("home dir").join("github");
    // Mirrors `local_projects_dir()`'s default resolution — this test has no
    // access to `lib.rs`'s private function, so it replicates the same path.
    let local_dir = dirs::data_local_dir()
        .expect("data dir")
        .join("githud/projects");

    let result = scan::scan_with(&root, DEFAULT_MAX_DEPTH, Some(&local_dir));
    let found = result.projects;

    println!("\nscan root: {}", root.display());
    println!("local config: {}", local_dir.display());
    println!("{} repo(s) found:\n", found.len());
    for p in &found {
        println!(
            "  {:<24} depth {}  L0:{}  L1:{}  {:<11} {:<10} {}",
            p.rel_path,
            p.depth,
            if p.icm.layer0 { "y" } else { "n" },
            if p.icm.layer1 { "y" } else { "n" },
            p.kind.to_string(),
            if p.agent == AgentAccess::ReadOnly {
                "read-only"
            } else {
                ""
            },
            if p.should_flag_icm() { "<- badged" } else { "" },
        );
    }
    println!();

    assert!(
        result.local_errors.is_empty(),
        "committed real_root against this machine's local config: {:?}",
        result.local_errors
    );

    assert!(
        found.len() >= 5,
        "expected at least five repos under {}, found {}",
        root.display(),
        found.len()
    );

    // The vault sits directly under the root, not nested under `Obsidian/` —
    // moved there so its `rel_path` is stable across machines, and every
    // machine's own local config addresses it by that exact path (D24).
    let vault = found
        .iter()
        .find(|p| p.rel_path == "HOME_AI_VAULT")
        .expect("the vault must be found");
    assert_eq!(vault.depth, 1);
    assert!(vault.icm.layer0, "the vault has AGENTS.md");
    assert!(
        vault.has_local_character,
        "the vault's own character.toml must resolve against the real scan"
    );

    // GIT HUD itself must be conformant — it is the reference for the badge.
    let githud = found
        .iter()
        .find(|p| p.name == "githud")
        .expect("githud must be found");
    assert!(
        githud.icm.is_conformant(),
        "githud has both AGENTS.md and CONTEXT.md"
    );
    assert!(
        githud.has_local_character,
        "githud's own character.toml must resolve against the real scan"
    );

    // Professor keeps Layer 1 *inside* AGENTS.md. If the fallback chain is
    // wrong, this is where it shows up as a false badge.
    if let Some(professor) = found.iter().find(|p| p.name == "Professor") {
        assert!(
            professor.icm.is_conformant(),
            "Professor's routing lives inside AGENTS.md and must satisfy Layer 1"
        );
    }

    // voicebox is third-party. Detection must still tell the truth about it,
    // but it must not be badged for it (D18) — this is the case that motivated
    // the whole decision.
    let voicebox = found
        .iter()
        .find(|p| p.name == "voicebox")
        .expect("voicebox must be found");
    assert_eq!(voicebox.kind, ProjectKind::External);
    assert_eq!(voicebox.agent, AgentAccess::ReadOnly);
    assert!(!voicebox.icm.layer0, "detection still reports the truth");
    assert!(
        !voicebox.should_flag_icm(),
        "a third-party repo must never be flagged for missing ICM"
    );
    assert!(
        voicebox.note.is_some(),
        "the reason travels with the local declaration"
    );

    // The vault is yours and genuinely lacks Layer 1, so it stays flagged.
    assert!(
        vault.should_flag_icm(),
        "an own project missing a layer is still worth flagging"
    );

    // No duplicates — one repo, one entry.
    let mut keys: Vec<&str> = found.iter().map(|p| p.rel_path.as_str()).collect();
    keys.sort_unstable();
    let before = keys.len();
    keys.dedup();
    assert_eq!(before, keys.len(), "the scan returned a duplicate repo");
}
