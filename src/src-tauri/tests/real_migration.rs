//! Proves D26's migration against this machine's *real* local config — on a
//! copy, never the original. `hud` (`githud`) is `sprite.kind = "layered"`
//! with a real art directory; `mia` (`HOME_AI_VAULT`) is procedural. Losing
//! either on this machine, or losing `hud`'s art specifically, is exactly
//! the risk `governance.md`'s newest lesson is about.
//!
//! Environment-dependent, so `#[ignore]`d like `real_root.rs`. Run
//! deliberately:
//!
//! ```text
//! cargo test --test real_migration -- --ignored --nocapture
//! ```

use githud_lib::character::migrate::migrate_embedded;
use githud_lib::local::ProjectLocal;

#[test]
#[ignore = "copies this machine's real local config; run explicitly with --ignored"]
fn migrating_a_copy_of_this_machine_s_real_local_config_loses_nothing() {
    let real_local = dirs::data_local_dir()
        .expect("data dir")
        .join("githud/projects");
    assert!(
        real_local.is_dir(),
        "no real local config at {} — nothing to prove against",
        real_local.display()
    );

    let scratch = std::env::temp_dir().join(format!(
        "githud-real-migration-proof-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&scratch);
    let copied_local = scratch.join("projects");
    let library = scratch.join("characters");
    copy_dir(&real_local, &copied_local);
    std::fs::create_dir_all(&library).unwrap();

    println!("copied real local config: {} -> {}", real_local.display(), copied_local.display());

    let migrated = migrate_embedded(&copied_local, &library).expect("migration must not error");
    println!("migrated project keys: {migrated:?}");

    for key in ["githud", "HOME_AI_VAULT"] {
        let project_toml = copied_local.join(key).join("project.toml");
        if !copied_local.join(key).is_dir() {
            println!("{key}: not on this machine, skipping");
            continue;
        }
        let declared = ProjectLocal::load(&project_toml).expect("project.toml must still parse");
        let id = declared
            .character_id
            .unwrap_or_else(|| panic!("{key} did not get a character_id pointer"));
        println!("{key} -> character_id = {id}");

        let entry_toml = library.join(&id).join("character.toml");
        assert!(entry_toml.is_file(), "{key}: no library entry at {}", entry_toml.display());

        let profile_text = std::fs::read_to_string(&entry_toml).unwrap();
        let profile = githud_lib::character::Profile::parse(&id, &profile_text)
            .unwrap_or_else(|e| panic!("{key}'s migrated character.toml no longer parses: {e}"));
        println!("  display={} sprite={:?}", profile.display, profile.sprite);

        assert!(
            !copied_local.join(key).join("character.toml").exists(),
            "{key}: embedded character.toml should be gone after migration"
        );

        // `hud`'s own real shape: layered, with a real art directory that
        // must have moved, not just the text naming it.
        if let githud_lib::character::Sprite::Layered { dir, .. } = &profile.sprite {
            let moved_art = library.join(&id).join(dir);
            assert!(
                moved_art.is_dir(),
                "{key}: layered art directory {} did not move into the library entry",
                moved_art.display()
            );
            let png_count = std::fs::read_dir(&moved_art)
                .unwrap()
                .flatten()
                .filter(|e| e.path().extension().is_some_and(|x| x == "png"))
                .count();
            println!("  moved art dir has {png_count} PNG(s)");
            assert!(png_count > 0, "{key}: art directory moved but is empty");
            assert!(
                !copied_local.join(key).join(dir).exists(),
                "{key}: the old art directory should be gone from the project's own folder"
            );
        }
    }

    // Idempotent: running it again on the same (now-migrated) copy changes
    // nothing further.
    let second = migrate_embedded(&copied_local, &library).expect("re-run must not error");
    assert!(second.is_empty(), "a second run should have nothing left to migrate: {second:?}");

    std::fs::remove_dir_all(&scratch).ok();
    println!("\nPASS — migration proven against a copy of the real local config; the original was never touched.");
}

fn copy_dir(src: &std::path::Path, dst: &std::path::Path) {
    std::fs::create_dir_all(dst).unwrap();
    for entry in std::fs::read_dir(src).unwrap().flatten() {
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir(&path, &target);
        } else {
            std::fs::copy(&path, &target).unwrap();
        }
    }
}
