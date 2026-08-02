//! One-time migration from an embedded project character (D24) to a library
//! entry with a pointer (D26).
//!
//! [`embed_to_library`] is also the exact transform a v1 bundle upgrades
//! through on import (`bundle::read`) — one function, two callers, so an
//! on-disk machine and an imported export can never disagree about what
//! "upgrade" means.

use std::collections::BTreeMap;
use std::path::Path;

use super::library;

/// Best-effort peek at a character's `sprite.dir`, if it names one —
/// tolerant of text that does not fully parse as a `Profile`. A file that
/// fails validation is still moved as raw text (`embed_to_library` never
/// validates either); `library::load_all` is what reports the failure once
/// it lives in the library, the same posture `character::load_all` already
/// has for one malformed profile among many good ones.
fn sprite_art_dir(character_toml: &str) -> Option<String> {
    let value: toml::Value = toml::from_str(character_toml).ok()?;
    value.get("sprite")?.get("dir")?.as_str().map(str::to_string)
}

/// Splits a v1 bundle's `other_files` (everything in a project's local
/// folder that is not `project.toml`/`character.toml`) into "belongs to the
/// embedded character" — its art directory, if `sprite.dir` names one — and
/// "stays with the project" — a background image, or anything else. Both
/// keep their original relative-path keys: a library entry's own folder uses
/// the same `sprite.dir` name a project's folder did, so nothing needs
/// rewriting, only regrouping.
pub fn split_embedded_character_files(
    character_toml: Option<&str>,
    other_files: &BTreeMap<String, String>,
) -> (BTreeMap<String, String>, BTreeMap<String, String>) {
    let Some(dir) = character_toml.and_then(sprite_art_dir) else {
        return (BTreeMap::new(), other_files.clone());
    };
    let prefix = format!("{dir}/");

    let mut character_files = BTreeMap::new();
    let mut project_files = BTreeMap::new();
    for (path, data) in other_files {
        if path.starts_with(&prefix) {
            character_files.insert(path.clone(), data.clone());
        } else {
            project_files.insert(path.clone(), data.clone());
        }
    }
    (character_files, project_files)
}

/// If `character_text` is `Some`, write it into the library under a fresh
/// entry keyed by `project_key` and return that id. `None` in, `None` out —
/// a project with no embedded character needs no library entry and gets no
/// pointer.
///
/// Keyed by the *project's own* local-folder key rather than a generated
/// slug, so `githud/character.toml` becomes library entry `githud` —
/// legible, and stable across repeated runs (idempotent: see
/// `migrate_embedded`, which relies on that stability to detect "already
/// migrated").
///
/// Pure with respect to the project side: it never touches `project.toml` or
/// removes the embedded file. The caller writes the returned id into the
/// pointer field and removes the embedded copy, in whatever order fits its
/// own atomic-write convention (an on-disk migration and a bundle import
/// each have a different one).
pub fn embed_to_library(
    library_dir: &Path,
    project_key: &str,
    character_text: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(text) = character_text else {
        return Ok(None);
    };

    let id = project_key.to_string();
    let entry = library::entry_dir(library_dir, &id);
    std::fs::create_dir_all(&entry).map_err(|e| format!("{}: {e}", entry.display()))?;
    let path = library::character_path(library_dir, &id);
    std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Some(id))
}

/// Migrate every project in `local_projects_dir` that still has an embedded
/// `character.toml` and no `character_id` pointer: move the file into the
/// library, keyed by that project's own key, and report which project keys
/// moved.
///
/// **Idempotent.** A project already migrated (pointer set) is left alone on
/// a second run, whether or not its embedded file also happens to still be
/// there — re-running this after a crash between "pointer written" and
/// "embedded file removed" must not attempt the write again.
pub fn migrate_embedded(local_projects_dir: &Path, library_dir: &Path) -> Result<Vec<String>, String> {
    let keys = crate::local::known_keys(local_projects_dir)?;
    let mut migrated = Vec::new();

    for key in keys {
        let project_dir = local_projects_dir.join(&key);
        let project_toml_path = project_dir.join("project.toml");
        let character_toml_path = project_dir.join("character.toml");

        let mut declared = crate::local::ProjectLocal::load(&project_toml_path)?;
        if declared.character_id.is_some() {
            continue;
        }

        let text = match std::fs::read_to_string(&character_toml_path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("{}: {e}", character_toml_path.display())),
        };

        let id = embed_to_library(library_dir, &key, Some(&text))?
            .expect("Some(text) in implies Some(id) out");

        // A `frames`/`layered` character's art directory sits beside its
        // `character.toml` in the project's own folder today — it has to
        // move too, or the library entry parses fine but has nothing to
        // render. Guarded by `is_dir()` so a second run (the art already
        // moved, the pointer not yet saved — see below) is a no-op rather
        // than an error.
        if let Some(art_dir) = sprite_art_dir(&text) {
            let from = project_dir.join(&art_dir);
            if from.is_dir() {
                let to = library::entry_dir(library_dir, &id).join(&art_dir);
                std::fs::rename(&from, &to).map_err(|e| format!("{}: {e}", from.display()))?;
            }
        }

        // Pointer written and saved *last*, after every file has already
        // moved: a crash before this line leaves `character_id` still
        // `None`, so the next run retries the whole migration for this
        // project — safely, since both the text write and the art rename
        // above are already idempotent. A crash after this line leaves the
        // pointer set and an orphaned but harmless duplicate `character.toml`
        // on disk, never a project that loses its character.
        declared.character_id = Some(id);
        declared.save(&project_toml_path)?;
        std::fs::remove_file(&character_toml_path)
            .map_err(|e| format!("{}: {e}", character_toml_path.display()))?;

        migrated.push(key);
    }

    Ok(migrated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local::ProjectLocal;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn embed_to_library_with_no_text_does_nothing() {
        let dir = temp_dir("githud-migrate-none");
        assert_eq!(embed_to_library(&dir, "githud", None).unwrap(), None);
        assert!(!library::entry_dir(&dir, "githud").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn embed_to_library_writes_a_loadable_entry_keyed_by_the_project() {
        let dir = temp_dir("githud-migrate-embed");
        let id = embed_to_library(&dir, "githud", Some("display = \"HUD\"\n"))
            .unwrap()
            .unwrap();

        assert_eq!(id, "githud");
        let loaded = library::load_all(&dir);
        assert_eq!(loaded.profiles.len(), 1);
        assert_eq!(loaded.profiles[0].display, "HUD");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn migrating_moves_an_embedded_character_and_sets_the_pointer() {
        let local = temp_dir("githud-migrate-local");
        let library = temp_dir("githud-migrate-library");

        let project_dir = local.join("githud");
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("character.toml"), "display = \"HUD\"\n").unwrap();

        let migrated = migrate_embedded(&local, &library).unwrap();
        assert_eq!(migrated, vec!["githud"]);

        let declared = ProjectLocal::load(&project_dir.join("project.toml")).unwrap();
        assert_eq!(declared.character_id.as_deref(), Some("githud"));
        assert!(
            !project_dir.join("character.toml").exists(),
            "the embedded file is removed once it lives in the library"
        );

        let loaded = super::library::load_all(&library);
        assert_eq!(loaded.profiles.len(), 1);
        assert_eq!(loaded.profiles[0].display, "HUD");

        std::fs::remove_dir_all(&local).ok();
        std::fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn migrating_a_project_with_nothing_embedded_is_a_no_op() {
        let local = temp_dir("githud-migrate-empty-local");
        let library = temp_dir("githud-migrate-empty-library");
        std::fs::create_dir_all(local.join("githud")).unwrap();

        let migrated = migrate_embedded(&local, &library).unwrap();
        assert!(migrated.is_empty());

        std::fs::remove_dir_all(&local).ok();
        std::fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn migrating_twice_is_idempotent() {
        let local = temp_dir("githud-migrate-twice-local");
        let library = temp_dir("githud-migrate-twice-library");
        let project_dir = local.join("githud");
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("character.toml"), "display = \"HUD\"\n").unwrap();

        let first = migrate_embedded(&local, &library).unwrap();
        assert_eq!(first, vec!["githud"]);
        let second = migrate_embedded(&local, &library).unwrap();
        assert!(second.is_empty(), "already migrated, nothing left to do");

        std::fs::remove_dir_all(&local).ok();
        std::fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn migrating_a_layered_character_moves_its_art_directory_too() {
        // The real shape of `hud` on this machine: `sprite.dir = "character"`,
        // a real PNG art folder beside `character.toml`. Losing this on
        // migration would leave a library entry that parses fine and renders
        // nothing.
        let local = temp_dir("githud-migrate-art-local");
        let library = temp_dir("githud-migrate-art-library");
        let project_dir = local.join("githud");
        std::fs::create_dir_all(project_dir.join("character")).unwrap();
        std::fs::write(
            project_dir.join("character.toml"),
            "display = \"HUD\"\n\n[sprite]\nkind = \"layered\"\ndir = \"character\"\n",
        )
        .unwrap();
        std::fs::write(project_dir.join("character/body.png"), b"pngbytes").unwrap();

        let migrated = migrate_embedded(&local, &library).unwrap();
        assert_eq!(migrated, vec!["githud"]);

        assert!(
            !project_dir.join("character").exists(),
            "the art directory moved, not just the toml"
        );
        assert_eq!(
            std::fs::read(library.join("githud/character/body.png")).unwrap(),
            b"pngbytes"
        );
    }

    #[test]
    fn split_embedded_character_files_separates_art_from_project_files() {
        let toml = "display = \"HUD\"\n\n[sprite]\nkind = \"layered\"\ndir = \"character\"\n";
        let other_files = BTreeMap::from([
            ("character/body.png".to_string(), "aaa".to_string()),
            ("character/head.png".to_string(), "bbb".to_string()),
            ("background.jpg".to_string(), "ccc".to_string()),
        ]);

        let (character_files, project_files) =
            split_embedded_character_files(Some(toml), &other_files);

        assert_eq!(character_files.len(), 2);
        assert!(character_files.contains_key("character/body.png"));
        assert_eq!(project_files.len(), 1);
        assert!(project_files.contains_key("background.jpg"));
    }

    #[test]
    fn split_embedded_character_files_with_no_art_dir_keeps_everything_with_the_project() {
        let toml = "display = \"MIA\"\n\n[sprite]\nkind = \"procedural\"\n";
        let other_files = BTreeMap::from([("background.jpg".to_string(), "ccc".to_string())]);

        let (character_files, project_files) =
            split_embedded_character_files(Some(toml), &other_files);

        assert!(character_files.is_empty());
        assert_eq!(project_files.len(), 1);
    }

    #[test]
    fn an_already_pointered_project_with_a_stray_embedded_file_is_left_alone() {
        // The crash-window case: pointer already written, embedded file
        // somehow still present (an interrupted first run). Must not
        // overwrite the library entry a second time or touch the pointer.
        let local = temp_dir("githud-migrate-stray-local");
        let library = temp_dir("githud-migrate-stray-library");
        let project_dir = local.join("githud");
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("character.toml"), "display = \"stale\"\n").unwrap();
        ProjectLocal {
            character_id: Some("githud".into()),
            ..Default::default()
        }
        .save(&project_dir.join("project.toml"))
        .unwrap();
        std::fs::create_dir_all(library.join("githud")).unwrap();
        std::fs::write(library.join("githud/character.toml"), "display = \"real\"\n").unwrap();

        let migrated = migrate_embedded(&local, &library).unwrap();
        assert!(migrated.is_empty());

        let loaded = super::library::load_all(&library);
        assert_eq!(loaded.profiles[0].display, "real", "the library entry is untouched");

        std::fs::remove_dir_all(&local).ok();
        std::fs::remove_dir_all(&library).ok();
    }
}
