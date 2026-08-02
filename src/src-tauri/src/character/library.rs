//! The character library (D26) — every character that exists, independent of
//! any project, keyed by id.
//!
//! `~/.local/share/githud/characters/<id>/` — one folder per character,
//! holding `character.toml` and, once a character has one, `background.<ext>`
//! alongside it. Resolved by the caller (`lib.rs`'s `characters_library_dir`);
//! this module takes a directory and does not know or care where it lives on
//! disk, the same posture `character::load_all` already has for the shipped
//! registry.

use std::path::{Path, PathBuf};

use super::{seed_toml, Characters, Palette, Profile, ProfileError, Sprite, Temperament};

/// A library id names a folder, and only a folder — the same boundary
/// `validate_frames_dir` already enforces for a sprite's art directory,
/// applied here because an id can arrive from a Tauri command argument, not
/// only from a directory listing this module itself produced.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && !id.contains('/') && !id.contains('\\') && !id.contains("..")
}

/// The path to one library entry's `character.toml`.
pub fn character_path(dir: &Path, id: &str) -> PathBuf {
    entry_dir(dir, id).join("character.toml")
}

/// The folder one library entry's own files (`character.toml`, background,
/// any future art) live in.
pub fn entry_dir(dir: &Path, id: &str) -> PathBuf {
    dir.join(id)
}

/// Load every character in the library.
///
/// One level of subdirectories, each holding its own `character.toml` — the
/// nested-folder counterpart of `character::load_all`'s flat-file walk, so a
/// library entry has room for a background image and art beside its profile.
/// A missing library directory is not an error (no characters is a state,
/// the same as a missing `characters/profiles/`); one malformed entry does
/// not take the others down; a subfolder with no `character.toml` is not a
/// character folder and is silently skipped, the same tolerance the flat
/// loader already has for a non-`.toml` file.
pub fn load_all(dir: &Path) -> Characters {
    let mut out = Characters::default();

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return out,
        Err(e) => {
            out.errors.push(ProfileError {
                name: dir.display().to_string(),
                error: e.to_string(),
            });
            return out;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(id) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };

        match std::fs::read_to_string(path.join("character.toml")) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => out.errors.push(ProfileError {
                name: id.to_string(),
                error: e.to_string(),
            }),
            Ok(text) => match Profile::parse(id, &text) {
                Ok(p) => out.profiles.push(p),
                Err(error) => out.errors.push(ProfileError {
                    name: id.to_string(),
                    error,
                }),
            },
        }
    }

    out.profiles.sort_by(|a, b| a.name.cmp(&b.name));
    out.errors.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Every character id currently in the library, sorted — the enumerate-only
/// counterpart of [`load_all`], for callers (`bundle::build`) that just need
/// to know what exists without reading and parsing each one.
pub fn known_ids(dir: &Path) -> Result<Vec<String>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("{}: {e}", dir.display())),
    };
    let mut ids: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .collect();
    ids.sort();
    Ok(ids)
}

/// Create a new procedural character with considered defaults, the same
/// `seed_toml` shape a project's first-ever embedded character used to be
/// seeded with. Returns the new id.
///
/// The id is a slug of `display` plus a short suffix for uniqueness — legible
/// in a directory listing, the same instinct that keeps `hud`/`mia` as
/// filenames rather than opaque ids today.
pub fn create(dir: &Path, display: &str) -> Result<String, String> {
    let id = unique_id(dir, display)?;
    let entry = entry_dir(dir, &id);
    std::fs::create_dir_all(&entry).map_err(|e| format!("{}: {e}", entry.display()))?;

    let text = seed_toml(display, Palette::default(), Sprite::default(), Temperament::default())?;
    let path = character_path(dir, &id);
    std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(id)
}

/// Remove a library entry outright.
///
/// **The caller clears every project pointer that named this id first** —
/// this function only ever touches the library itself, the same division
/// `lib.rs`'s command layer already keeps between "write this one file" and
/// "and now update everything that referenced it."
pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("`{id}` is not a valid character id"));
    }
    let entry = entry_dir(dir, id);
    match std::fs::remove_dir_all(&entry) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", entry.display())),
    }
}

fn slugify(display: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = true; // suppresses a leading dash
    for c in display.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "character".to_string()
    } else {
        slug
    }
}

fn unique_id(dir: &Path, display: &str) -> Result<String, String> {
    let base = slugify(display);
    for attempt in 0u32..8 {
        let id = format!("{base}-{}", short_suffix(attempt));
        if !entry_dir(dir, &id).exists() {
            return Ok(id);
        }
    }
    Err("could not generate a unique character id — try again".to_string())
}

/// Four hex digits from the current time, perturbed by `attempt` so a retry
/// loop cannot repeat itself even on a coarse clock. Not a security token —
/// only uniqueness against this library's own folder names is asked of it.
fn short_suffix(attempt: u32) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("{:04x}", (nanos.wrapping_add(attempt.wrapping_mul(2_654_435_761))) & 0xffff)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_library_directory_is_not_an_error() {
        let missing = std::env::temp_dir().join("githud-no-such-library-dir");
        assert_eq!(load_all(&missing), Characters::default());
    }

    #[test]
    fn creating_writes_a_loadable_procedural_character() {
        let dir = temp_dir("githud-library-create");
        let id = create(&dir, "Ada").unwrap();

        assert!(id.starts_with("ada-"), "{id}");
        let loaded = load_all(&dir);
        assert_eq!(loaded.profiles.len(), 1);
        assert_eq!(loaded.profiles[0].name, id);
        assert_eq!(loaded.profiles[0].display, "Ada");
        assert!(matches!(loaded.profiles[0].sprite, Sprite::Procedural { .. }));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn creating_twice_with_the_same_display_gets_two_distinct_ids() {
        let dir = temp_dir("githud-library-create-twice");
        let a = create(&dir, "Ada").unwrap();
        let b = create(&dir, "Ada").unwrap();
        assert_ne!(a, b);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_non_alphanumeric_display_still_slugs_to_something() {
        let dir = temp_dir("githud-library-create-blank");
        let id = create(&dir, "!!!").unwrap();
        assert!(id.starts_with("character-"), "{id}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn one_bad_entry_does_not_take_the_others_down() {
        let dir = temp_dir("githud-library-mixed");
        let good = create(&dir, "Ada").unwrap();
        std::fs::create_dir_all(dir.join("broken")).unwrap();
        std::fs::write(dir.join("broken/character.toml"), "[palette]\naccent = \"blue\"\n").unwrap();
        // A subfolder with no character.toml at all is not a character folder.
        std::fs::create_dir_all(dir.join("not-a-character")).unwrap();

        let loaded = load_all(&dir);
        assert_eq!(loaded.profiles.len(), 1);
        assert_eq!(loaded.profiles[0].name, good);
        assert_eq!(loaded.errors.len(), 1);
        assert_eq!(loaded.errors[0].name, "broken");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn known_ids_lists_every_entry_sorted() {
        let dir = temp_dir("githud-library-known-ids");
        create(&dir, "Zed").unwrap();
        create(&dir, "Ada").unwrap();
        std::fs::write(dir.join("not-a-dir.toml"), "").unwrap();

        let ids = known_ids(&dir).unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids[0] < ids[1], "sorted: {ids:?}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn known_ids_on_a_missing_directory_is_empty_not_an_error() {
        let missing = std::env::temp_dir().join("githud-no-such-library-known-ids");
        assert_eq!(known_ids(&missing).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn deleting_removes_the_entry_and_is_idempotent() {
        let dir = temp_dir("githud-library-delete");
        let id = create(&dir, "Ada").unwrap();
        assert!(entry_dir(&dir, &id).is_dir());

        delete(&dir, &id).unwrap();
        assert!(!entry_dir(&dir, &id).exists());
        // Deleting again (a raced double-click, say) is not an error.
        delete(&dir, &id).unwrap();

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn deleting_cannot_escape_the_library_directory() {
        let dir = temp_dir("githud-library-escape");
        for bad in ["../../etc", "a/b", "..", ""] {
            let err = delete(&dir, bad).unwrap_err();
            assert!(err.contains("valid"), "{bad}: {err}");
        }

        std::fs::remove_dir_all(&dir).ok();
    }
}
