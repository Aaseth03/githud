//! Per-project theme: an accent colour and a background image (M8).
//!
//! Both are a fact about a *room*, not a *resident* — deliberately separate
//! from `character::Palette`, which stays scoped to `--accent`/`--accent-glow`/
//! `--accent-field` on the character itself (D21). A project may have a
//! character with its own accent and a theme of its own; this module only
//! ever touches the theme half.
//!
//! Background images live inside a project's own local folder (D24) —
//! `local::project_dir`'s directory, the same one holding `project.toml` and
//! `character.toml`. Never committed: an upload is the user's own file, and
//! `local` is the gitignored half of the split (D8) that never reaches a
//! public clone.

use std::path::{Path, PathBuf};

/// A phone photo, not a movie. Generous enough for a real photo, small enough
/// that a mis-click cannot fill the machine-local data dir.
pub const MAX_BYTES: usize = 8 * 1024 * 1024;

/// Is this a hex colour of the shape every CSS custom property here expects?
///
/// `#rrggbb` only — no shorthand, no alpha, no named colours. The colour wheel
/// this feeds only ever produces this shape, so anything else arrived by hand
/// and should fail loudly rather than resolve to something nobody chose.
pub fn valid_hex_color(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(u8::is_ascii_hexdigit)
}

/// The MIME type a stored file is served back as, from its extension.
fn mime_for_ext(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// A project's `rel_path` made safe as a filename.
///
/// Nested paths use `/` (`Obsidian/HOME_AI_VAULT`), which no filesystem here
/// accepts as a single path component — `__` keeps the key readable and, since
/// `/` cannot occur in a folder name, cannot collide with a real one.
///
/// This is `local`'s project-folder identity, not just a background's — kept
/// here rather than moved because it predates `local` and every other module
/// that now depends on it imports it from this one place.
pub fn key_for(rel_path: &str) -> String {
    rel_path.replace('/', "__")
}

/// Every background file that could belong to this project's directory,
/// regardless of which extension it was last uploaded as.
///
/// An upload that changes format — a `.png` re-uploaded as `.jpg` — must not
/// leave the old one behind to be read back alongside, or worse, instead of,
/// the new one depending on which extension a future reader guesses first.
fn existing_backgrounds(project_dir: &Path) -> Vec<PathBuf> {
    ["png", "jpg", "jpeg", "webp"]
        .iter()
        .map(|ext| project_dir.join(format!("background.{ext}")))
        .filter(|p| p.exists())
        .collect()
}

/// Does this project have a background image at all? Cheap — a handful of
/// `exists()` calls, not a read — so `local::load_summary` can call it for
/// every scanned project without it costing anything.
pub fn has_background(project_dir: &Path) -> bool {
    !existing_backgrounds(project_dir).is_empty()
}

/// Save an uploaded image into a project's own directory, replacing whatever
/// it had before. The filename is fixed (`background.<ext>`) — the directory
/// itself is what disambiguates the project now, so there is nothing left for
/// a filename to encode.
pub fn save_background(project_dir: &Path, bytes: &[u8], ext: &str) -> Result<(), String> {
    let ext = ext.to_ascii_lowercase();
    if mime_for_ext(&ext).is_none() {
        return Err(format!(
            "unsupported image type: .{ext} — use PNG, JPEG or WebP"
        ));
    }
    if bytes.len() > MAX_BYTES {
        return Err(format!(
            "image is {} bytes, over the {}-byte limit",
            bytes.len(),
            MAX_BYTES
        ));
    }
    if bytes.is_empty() {
        return Err("image has no data".to_string());
    }

    std::fs::create_dir_all(project_dir).map_err(|e| format!("{}: {e}", project_dir.display()))?;
    for stale in existing_backgrounds(project_dir) {
        let _ = std::fs::remove_file(stale);
    }

    let path = project_dir.join(format!("background.{ext}"));
    std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

/// Remove whatever background image this project has, if any. Removing one
/// that was never uploaded is fine — the same tolerance every clear in this
/// app has.
pub fn clear_background(project_dir: &Path) {
    for stale in existing_backgrounds(project_dir) {
        let _ = std::fs::remove_file(stale);
    }
}

/// Read a project's stored background back as a data URI, the same
/// convention `character::load_frames` already uses for PNG parts — the
/// front end never resolves a filesystem path itself.
///
/// `Ok(None)` — not an error — when this project has no background, which is
/// the ordinary case for a project nobody has themed.
pub fn read_background(project_dir: &Path) -> Result<Option<String>, String> {
    let Some(path) = existing_backgrounds(project_dir).into_iter().next() else {
        return Ok(None);
    };
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();
    let Some(mime) = mime_for_ext(ext) else {
        return Err(format!("unsupported image type: {}", path.display()));
    };

    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    use base64::Engine as _;
    Ok(Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("githud-theme-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_real_hex_colour_is_valid() {
        assert!(valid_hex_color("#52d9a8"));
        assert!(valid_hex_color("#000000"));
        assert!(valid_hex_color("#FFFFFF"));
    }

    #[test]
    fn shorthand_and_named_colours_are_not_valid() {
        assert!(!valid_hex_color("#fff"));
        assert!(!valid_hex_color("teal"));
        assert!(!valid_hex_color("52d9a8"));
        assert!(!valid_hex_color("#52d9a"));
        assert!(!valid_hex_color("#52d9a8ff"));
        assert!(!valid_hex_color("#gggggg"));
    }

    #[test]
    fn a_nested_rel_path_becomes_a_flat_key() {
        assert_eq!(key_for("Obsidian/HOME_AI_VAULT"), "Obsidian__HOME_AI_VAULT");
        assert_eq!(key_for("githud"), "githud");
    }

    #[test]
    fn a_project_with_no_background_reports_none() {
        let dir = tmp_dir("absent");
        assert!(!has_background(&dir));
        assert_eq!(read_background(&dir).unwrap(), None);
    }

    #[test]
    fn saving_writes_a_readable_fixed_filename() {
        let dir = tmp_dir("save");
        save_background(&dir, b"\x89PNG-ish", "png").unwrap();
        assert!(dir.join("background.png").exists());
        assert!(has_background(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unsupported_extension_is_refused() {
        let dir = tmp_dir("badext");
        let err = save_background(&dir, b"data", "gif").unwrap_err();
        assert!(err.contains("gif"), "{err}");
        assert!(!dir.join("background.gif").exists());
    }

    #[test]
    fn an_oversized_image_is_refused() {
        let dir = tmp_dir("toobig");
        let bytes = vec![0u8; MAX_BYTES + 1];
        let err = save_background(&dir, &bytes, "png").unwrap_err();
        assert!(err.contains("limit"), "{err}");
    }

    #[test]
    fn re_uploading_in_a_new_format_removes_the_old_file() {
        let dir = tmp_dir("reupload");
        save_background(&dir, b"first", "png").unwrap();
        assert!(dir.join("background.png").exists());

        save_background(&dir, b"second", "jpg").unwrap();
        assert!(
            !dir.join("background.png").exists(),
            "the stale png should be gone"
        );
        assert!(dir.join("background.jpg").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reading_a_saved_file_gives_back_a_data_uri() {
        let dir = tmp_dir("read");
        save_background(&dir, b"\x89PNG-ish", "png").unwrap();
        let uri = read_background(&dir).unwrap().unwrap();
        assert!(uri.starts_with("data:image/png;base64,"), "{uri}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clearing_removes_whichever_extension_is_actually_there() {
        let dir = tmp_dir("clear");
        save_background(&dir, b"data", "webp").unwrap();
        clear_background(&dir);
        assert!(!dir.join("background.webp").exists());
        assert!(!has_background(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clearing_something_never_uploaded_does_not_error() {
        let dir = tmp_dir("clear-nothing");
        clear_background(&dir);
    }
}
