//! The shared `.vrma` animation library (D28).
//!
//! `~/.local/share/githud/vrm-animations/<id>.vrma` — one flat folder, shared
//! by **every** `vrm` character rather than copied into each one.
//!
//! That sharing is not a storage optimization, it is what the format already
//! guarantees: `VRMC_vrm_animation` is authored against the standard humanoid
//! bone set and matches expressions by name, so one clip retargets onto any
//! VRM. Copying a clip per character would produce five identical files and,
//! worse, five that could drift.
//!
//! **A clip is identified by its filename and nothing else.** There is no
//! sidecar metadata file, because a name that lives in two places is a name
//! that can disagree with itself — the same reasoning that keeps `Profile`'s
//! `name` out of `character.toml`.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::vrm;

/// One clip in the shared library.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Clip {
    /// The file stem — what a character's `sprite.clips` names.
    pub id: String,
    /// What a human reads: the id with its dashes opened up.
    pub display: String,
    /// `VRMC_vrm_animation`'s declared `specVersion`.
    pub spec: String,
    pub bytes: u64,
}

/// A clip that is on disk but could not be read, and why. Errors surface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ClipError {
    pub id: String,
    pub error: String,
}

/// The library, and everything in it that failed — both halves, always, the
/// same shape `Characters` uses for exactly the same reason.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Clips {
    pub clips: Vec<Clip>,
    pub errors: Vec<ClipError>,
}

/// A clip id names one file in one folder, and only that.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && !id.contains('/') && !id.contains('\\') && !id.contains("..")
}

pub fn clip_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.vrma"))
}

/// Turn an arbitrary filename into an id safe to be a filename again.
///
/// Lowercased, non-alphanumerics collapsed to single dashes, trimmed. A user
/// picking `Idle Breathing (final v2).vrma` should get `idle-breathing-final-v2`
/// rather than a refusal — the alternative is asking someone to rename a file
/// before an app will read it.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

/// What a human reads for an id.
fn display_of(id: &str) -> String {
    id.replace('-', " ")
}

/// Every clip in the library.
///
/// A missing directory is not an error — no animations is a state, the same as
/// no characters. One unreadable clip does not take the others down.
pub fn load_all(dir: &Path) -> Clips {
    let mut out = Clips::default();

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return out,
        Err(e) => {
            out.errors.push(ClipError {
                id: dir.display().to_string(),
                error: e.to_string(),
            });
            return out;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("vrma") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };

        match std::fs::read(&path) {
            Err(e) => out.errors.push(ClipError {
                id: id.to_string(),
                error: e.to_string(),
            }),
            // Re-validated on every load rather than trusted because it got in
            // once: a folder the user can open is a folder the user can drop a
            // renamed file into, and a clip that fails here is named instead of
            // failing later as an animation that plays nothing.
            Ok(bytes) => match vrm::inspect_animation(&bytes) {
                Ok(info) => out.clips.push(Clip {
                    id: id.to_string(),
                    display: display_of(id),
                    spec: info.spec,
                    bytes: info.bytes,
                }),
                Err(error) => out.errors.push(ClipError {
                    id: id.to_string(),
                    error,
                }),
            },
        }
    }

    out.clips.sort_by(|a, b| a.id.cmp(&b.id));
    out.errors.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// Copy a picked `.vrma` into the shared library, after proving it is one.
///
/// Validated before stored, like `vrm::import`, and for the same reason: a
/// rejected file must leave nothing behind for the next load to complain about.
pub fn import(dir: &Path, source: &Path) -> Result<Clip, String> {
    let bytes = std::fs::read(source).map_err(|e| format!("{}: {e}", source.display()))?;
    let info = vrm::inspect_animation(&bytes)?;

    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("animation");
    let id = slug(stem);
    if id.is_empty() {
        return Err(format!(
            "`{stem}` has no characters that can be part of a filename — rename it and try again"
        ));
    }

    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let dest = clip_path(dir, &id);
    if dest.exists() {
        return Err(format!(
            "`{id}` is already in the animation library — delete it first, or rename the file. \
             Overwriting would silently change every character using it"
        ));
    }
    std::fs::write(&dest, &bytes).map_err(|e| format!("{}: {e}", dest.display()))?;

    Ok(Clip {
        display: display_of(&id),
        id,
        spec: info.spec,
        bytes: info.bytes,
    })
}

/// Store bytes the app generated itself, under a chosen id.
///
/// The other way into this library. `import` copies a file somebody else
/// authored; this takes a clip the VRM suite's generator just baked, and the
/// two are deliberately the same afterwards — a generated `.vrma` is validated
/// on the way in, listed the same, played the same, and can be deleted or
/// copied out and opened in Blender. Nothing downstream can tell them apart,
/// which is the property that keeps the generator an authoring tool rather than
/// a second kind of character.
///
/// **Validated even though this app wrote it.** A bug in the writer that
/// produced an unloadable file would otherwise surface much later as an
/// animation that plays nothing, at which point the generator is the last place
/// anyone would look. It costs one JSON parse.
///
/// `replace` is the caller's explicit decision, never a default: overwriting
/// silently changes every character already using the id, which is the exact
/// thing `import` refuses to do. The suite asks first.
pub fn save(dir: &Path, id: &str, bytes: &[u8], replace: bool) -> Result<Clip, String> {
    if !valid_id(id) {
        return Err(format!(
            "`{id}` is not a usable clip name — no slashes, and not `..`"
        ));
    }
    let info = vrm::inspect_animation(bytes).map_err(|e| {
        format!("the generated animation did not come out as a valid `.vrma`: {e}")
    })?;

    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let dest = clip_path(dir, id);
    if dest.exists() && !replace {
        return Err(format!(
            "`{id}` is already in the animation library — save under another name, or \
             replace it deliberately. Replacing changes it for every character using it"
        ));
    }
    std::fs::write(&dest, bytes).map_err(|e| format!("{}: {e}", dest.display()))?;

    Ok(Clip {
        id: id.to_string(),
        display: display_of(id),
        spec: info.spec,
        bytes: info.bytes,
    })
}

/// Remove a clip. Characters naming it keep the name; the renderer reports the
/// gap rather than the library rewriting somebody else's profile behind them.
pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("`{id}` is not a clip id"));
    }
    let path = clip_path(dir, id);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Read a clip back for the renderer, as raw bytes for `GLTFLoader.parse`.
pub fn read_clip(dir: &Path, id: &str) -> Result<Vec<u8>, String> {
    if !valid_id(id) {
        return Err(format!("`{id}` is not a clip id"));
    }
    let path = clip_path(dir, id);
    std::fs::read(&path).map_err(|e| {
        format!(
            "{}: {e} — a character names this clip but the animation library no longer \
             has it. Re-import it, or pick another in the character's suite",
            path.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_a_human_filename() {
        assert_eq!(slug("Idle Breathing (final v2)"), "idle-breathing-final-v2");
        assert_eq!(slug("already-fine"), "already-fine");
        assert_eq!(slug("  spaced  out  "), "spaced-out");
    }

    #[test]
    fn a_slug_is_always_a_safe_filename() {
        for hostile in ["../../etc/passwd", "a/b\\c", "..", "///"] {
            let s = slug(hostile);
            assert!(s.is_empty() || valid_id(&s), "{hostile} -> {s}");
        }
    }

    #[test]
    fn an_id_may_not_escape_its_folder() {
        assert!(!valid_id("../thing"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(""));
        assert!(valid_id("idle-breathing"));
    }

    #[test]
    fn a_missing_library_is_not_an_error() {
        let out = load_all(Path::new("/nonexistent/githud/vrm-animations"));
        assert!(out.clips.is_empty());
        assert!(out.errors.is_empty());
    }

    #[test]
    fn display_opens_up_the_id() {
        assert_eq!(display_of("idle-breathing"), "idle breathing");
    }

    /// The generator's own output, baked by `src/ui/glb.test.ts` on every
    /// `npm test` run.
    ///
    /// **This is the two-sided fixture for the clip generator**, the same
    /// arrangement `fixtures/characters.json` makes for the profile boundary
    /// and for the same reason: the TypeScript writes the bytes, the Rust
    /// validates them, and neither can drift without the other failing. A
    /// writer bug would otherwise surface as an animation that plays nothing,
    /// which is the symptom least likely to send anyone to the writer.
    fn generated_fixture() -> Vec<u8> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../ui/fixtures/generated-idle.vrma");
        std::fs::read(&path).unwrap_or_else(|e| {
            panic!(
                "{}: {e} — run `npm test` in `src/` to bake it",
                path.display()
            )
        })
    }

    #[test]
    fn the_generator_produces_a_valid_vrma() {
        let info = vrm::inspect_animation(&generated_fixture())
            .expect("the clip generator's own output must pass the library's validation");
        assert_eq!(info.spec, "1.0");
        assert!(info.bytes > 0);
    }

    #[test]
    fn a_generated_clip_lands_in_the_library_like_any_other() {
        let dir = std::env::temp_dir().join(format!("githud-vrma-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let bytes = generated_fixture();

        let clip = save(&dir, "idle-breathing", &bytes, false).expect("first save");
        assert_eq!(clip.id, "idle-breathing");
        assert_eq!(clip.display, "idle breathing");

        // Indistinguishable from an imported one, once stored — that is the
        // whole point of baking a file rather than inventing a second path.
        let listed = load_all(&dir);
        assert!(listed.errors.is_empty(), "{:?}", listed.errors);
        assert_eq!(listed.clips.len(), 1);
        assert_eq!(listed.clips[0].id, "idle-breathing");

        // Overwriting is refused unless it is asked for by name.
        assert!(save(&dir, "idle-breathing", &bytes, false).is_err());
        assert!(save(&dir, "idle-breathing", &bytes, true).is_ok());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_generated_clip_may_not_escape_the_library() {
        let dir = std::env::temp_dir().join("githud-vrma-escape");
        for hostile in ["../outside", "a/b", "..", ""] {
            assert!(
                save(&dir, hostile, &generated_fixture(), true).is_err(),
                "{hostile} was accepted"
            );
        }
    }

    #[test]
    fn bytes_that_are_not_a_vrma_are_refused_even_from_our_own_writer() {
        let dir = std::env::temp_dir().join("githud-vrma-bad");
        assert!(save(&dir, "broken", b"not a glb at all", true).is_err());
    }
}
