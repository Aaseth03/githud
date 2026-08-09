//! The `vrm` character type — reading a VRoid `.vrm`, and the `.vrma` clips
//! that move it.
//!
//! **A file is what its bytes say it is, not what its name says.** Filtering a
//! file picker on `*.vrm` is presentation; a renamed `.glb` sails straight
//! through it and fails later, in the renderer, as a blank stage with nothing
//! to explain it. So every import walks the GLB container here and requires the
//! VRM extension to actually be present before a single byte is stored.
//!
//! The spec version falls out of that same walk, which is the point: the
//! version is not a second pass and not a guess. VRM 0.x and VRM 1.0 are
//! genuinely different — 0.x faces +Z where 1.0 faces -Z, and a 0.x model
//! rendered without the compensating rotation faces away from the camera and
//! looks like a broken import rather than a spec difference. Storing what the
//! file declared is what lets the renderer do the right thing, and the card say
//! which it is without ever starting a GPU.
//!
//! Pure and Tauri-free apart from the two storage helpers, like the rest of
//! `character`.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// The imported model's filename inside a character's own library folder.
///
/// Fixed rather than derived from whatever the user picked: a character folder
/// holds exactly one model, and a name that could vary is a name that can
/// disagree with the `character.toml` beside it.
pub const MODEL_FILE: &str = "model.vrm";

/// The still preview baked once at import.
///
/// A card grid renders this as an `<img>` rather than a live scene — WebKit
/// caps concurrent WebGL contexts and silently drops the oldest, so N live
/// characters in a grid is a design that breaks at N.
pub const THUMBNAIL_FILE: &str = "thumbnail.png";

/// glTF's container magic, `"glTF"` little-endian.
const GLB_MAGIC: u32 = 0x4654_6C67;
/// The chunk type of the JSON chunk, `"JSON"` little-endian.
const CHUNK_JSON: u32 = 0x4E4F_534A;
/// The GLB container version this understands. glTF 2.0 is the only one VRM is
/// built on, and a `1` here is a file from a different decade.
const GLB_VERSION: u32 = 2;

/// What a `.vrm` turned out to be. Recorded at import, shown on the card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VrmInfo {
    /// The spec version the file declared — `"1.0"` or `"0.0"`.
    ///
    /// Taken from the file rather than inferred from which extension key was
    /// present, so a future `1.1` reports as `1.1` instead of being flattened
    /// into whatever this build happened to know about.
    pub spec: String,
    /// What the model calls itself, if it says.
    pub title: Option<String>,
    /// Author(s), joined — 0.x has one, 1.0 has a list.
    pub author: Option<String>,
    /// The tool that exported it, when it recorded one. Useful precisely when
    /// a model misbehaves and the question is which VRoid Studio made it.
    pub exporter: Option<String>,
    /// Size on disk. A VRoid model ranges from a few MB to tens of MB, and a
    /// heavy one should be visible as a choice rather than as lag.
    pub bytes: u64,
}

/// What a `.vrma` turned out to be.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VrmaInfo {
    /// `VRMC_vrm_animation`'s own `specVersion` — `"1.0"` today.
    pub spec: String,
    pub bytes: u64,
}

/// Pull the JSON chunk out of a GLB container.
///
/// Shared by both inspections because a `.vrm` and a `.vrma` are the same
/// container with different extensions inside it — splitting the walk in two
/// would be two places to get the padding arithmetic wrong.
fn gltf_json(bytes: &[u8]) -> Result<serde_json::Value, String> {
    if bytes.len() < 12 {
        return Err(format!(
            "not a glTF binary file — {} bytes is shorter than the 12-byte header",
            bytes.len()
        ));
    }

    let u32_at = |at: usize| -> u32 {
        u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
    };

    if u32_at(0) != GLB_MAGIC {
        return Err(
            "not a glTF binary file — the header does not start with `glTF`. A `.vrm` \
             is a GLB container; renaming another file to `.vrm` does not make one"
                .into(),
        );
    }
    let version = u32_at(4);
    if version != GLB_VERSION {
        return Err(format!(
            "glTF container version {version}, expected {GLB_VERSION} — VRM is built on glTF 2.0"
        ));
    }

    // The declared total length is advisory here: a file truncated in transit
    // reports a length longer than it is, and walking chunks against the real
    // buffer is what makes that a named error instead of a panic.
    let mut at = 12usize;
    while at + 8 <= bytes.len() {
        let len = u32_at(at) as usize;
        let kind = u32_at(at + 4);
        let start = at + 8;
        let end = start
            .checked_add(len)
            .ok_or_else(|| "glTF chunk length overflows".to_string())?;
        if end > bytes.len() {
            return Err(format!(
                "glTF chunk claims {len} bytes but only {} remain — the file is truncated",
                bytes.len().saturating_sub(start)
            ));
        }
        if kind == CHUNK_JSON {
            return serde_json::from_slice(&bytes[start..end])
                .map_err(|e| format!("the glTF JSON chunk is not valid JSON: {e}"));
        }
        // Chunks are 4-byte aligned; the padding is not part of the declared
        // length, so it has to be stepped over explicitly.
        at = end + (4 - end % 4) % 4;
    }

    Err("no JSON chunk in the glTF container".into())
}

/// A `serde_json` string field, if it is there and is a string.
fn str_at(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().map(str::to_string)
}

/// Validate a `.vrm` and report what it is.
///
/// The two shapes are checked in order of preference: `VRMC_vrm` is the 1.0
/// extension, `VRM` the 0.x one. A file carrying neither is a glTF model that
/// is not a VRM at all — a perfectly valid `.glb` with no humanoid rig, no
/// expressions and therefore nothing to lip-sync — and it is refused by name
/// rather than imported into a character that would never move.
pub fn inspect(bytes: &[u8]) -> Result<VrmInfo, String> {
    let root = gltf_json(bytes)?;
    let extensions = root.get("extensions");

    if let Some(vrm1) = extensions.and_then(|e| e.get("VRMC_vrm")) {
        let meta = vrm1.get("meta");
        return Ok(VrmInfo {
            // `specVersion` is required by the 1.0 spec, but a file that omits
            // it is still recognisably 1.0-shaped; saying so beats refusing.
            spec: str_at(vrm1, "specVersion").unwrap_or_else(|| "1.0".to_string()),
            title: meta.and_then(|m| str_at(m, "name")),
            author: meta
                .and_then(|m| m.get("authors"))
                .and_then(|a| a.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .filter(|s| !s.is_empty()),
            exporter: None,
            bytes: bytes.len() as u64,
        });
    }

    if let Some(vrm0) = extensions.and_then(|e| e.get("VRM")) {
        let meta = vrm0.get("meta");
        return Ok(VrmInfo {
            spec: str_at(vrm0, "specVersion").unwrap_or_else(|| "0.0".to_string()),
            title: meta.and_then(|m| str_at(m, "title")),
            author: meta.and_then(|m| str_at(m, "author")),
            exporter: str_at(vrm0, "exporterVersion"),
            bytes: bytes.len() as u64,
        });
    }

    Err(
        "this is a glTF model but not a VRM — it declares neither `VRMC_vrm` (VRM 1.0) \
         nor `VRM` (VRM 0.x). A plain `.glb` has no humanoid rig and no expressions, \
         so there is nothing to pose or lip-sync"
            .into(),
    )
}

/// Validate a `.vrma` and report what it is.
///
/// Deliberately strict about the extension being present: a VRM *model* is
/// also a GLB and would otherwise import happily as an animation that plays
/// nothing.
pub fn inspect_animation(bytes: &[u8]) -> Result<VrmaInfo, String> {
    let root = gltf_json(bytes)?;
    let ext = root
        .get("extensions")
        .and_then(|e| e.get("VRMC_vrm_animation"))
        .ok_or_else(|| {
            "not a VRM animation — no `VRMC_vrm_animation` extension. A `.vrm` model is \
             also a glTF binary, so check this is the animation file and not the character"
                .to_string()
        })?;

    Ok(VrmaInfo {
        spec: str_at(ext, "specVersion").unwrap_or_else(|| "1.0".to_string()),
        bytes: bytes.len() as u64,
    })
}

/// Where a character's model sits inside its own library folder.
pub fn model_path(entry_dir: &Path) -> PathBuf {
    entry_dir.join(MODEL_FILE)
}

/// Where its baked preview sits.
pub fn thumbnail_path(entry_dir: &Path) -> PathBuf {
    entry_dir.join(THUMBNAIL_FILE)
}

/// Copy a picked `.vrm` into a character's folder, after proving it is one.
///
/// **Validated before it is stored, never after.** A rejected file must leave
/// no trace, because a half-imported character that renders as nothing is the
/// state this whole module exists to prevent.
///
/// Takes a path rather than bytes on purpose: a VRoid model is routinely tens
/// of megabytes, and base64-ing that through the IPC boundary just to hand it
/// back to the filesystem is a copy the app can simply not make.
pub fn import(entry_dir: &Path, source: &Path) -> Result<VrmInfo, String> {
    let bytes = std::fs::read(source).map_err(|e| format!("{}: {e}", source.display()))?;
    let info = inspect(&bytes)?;

    std::fs::create_dir_all(entry_dir).map_err(|e| format!("{}: {e}", entry_dir.display()))?;
    let dest = model_path(entry_dir);
    std::fs::write(&dest, &bytes).map_err(|e| format!("{}: {e}", dest.display()))?;

    // A model replacing another leaves the old preview behind, and a card
    // showing the previous character is worse than a card showing none.
    let _ = std::fs::remove_file(thumbnail_path(entry_dir));

    Ok(info)
}

/// Read a stored model back for the renderer.
///
/// Returned as raw bytes to the caller, which hands them to the webview as an
/// `ArrayBuffer` — `GLTFLoader.parse` takes one directly, so the model never
/// becomes a URL and the CSP's `connect-src` is not involved at all.
pub fn read_model(entry_dir: &Path) -> Result<Vec<u8>, String> {
    let path = model_path(entry_dir);
    std::fs::read(&path).map_err(|e| {
        format!(
            "{}: {e} — this character declares `sprite.kind = \"vrm\"` but its model is \
             not on disk. Re-import it from the character's own suite",
            path.display()
        )
    })
}

/// Store the preview baked at import. `None` clears it.
pub fn save_thumbnail(entry_dir: &Path, png: Option<&[u8]>) -> Result<(), String> {
    let path = thumbnail_path(entry_dir);
    match png {
        Some(bytes) => {
            std::fs::create_dir_all(entry_dir)
                .map_err(|e| format!("{}: {e}", entry_dir.display()))?;
            std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))
        }
        None => {
            let _ = std::fs::remove_file(&path);
            Ok(())
        }
    }
}

/// The baked preview as a `data:` URI, or `None` if this character has none.
///
/// Absent is a state, not an error: a model imported on a machine whose webview
/// had no WebGL has no preview to show, and that is worth saying rather than
/// failing.
pub fn read_thumbnail(entry_dir: &Path) -> Result<Option<String>, String> {
    let path = thumbnail_path(entry_dir);
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(super::png_data_uri(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal GLB around a JSON payload, padding as the spec requires.
    fn glb(json: &str) -> Vec<u8> {
        let mut chunk = json.as_bytes().to_vec();
        while chunk.len() % 4 != 0 {
            chunk.push(b' ');
        }
        let mut out = Vec::new();
        out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
        out.extend_from_slice(&GLB_VERSION.to_le_bytes());
        out.extend_from_slice(&((12 + 8 + chunk.len()) as u32).to_le_bytes());
        out.extend_from_slice(&(chunk.len() as u32).to_le_bytes());
        out.extend_from_slice(&CHUNK_JSON.to_le_bytes());
        out.extend_from_slice(&chunk);
        out
    }

    #[test]
    fn reads_a_vrm_1_0() {
        let info = inspect(&glb(
            r#"{"extensions":{"VRMC_vrm":{"specVersion":"1.0","meta":{"name":"Mia","authors":["A","B"]}}}}"#,
        ))
        .unwrap();
        assert_eq!(info.spec, "1.0");
        assert_eq!(info.title.as_deref(), Some("Mia"));
        assert_eq!(info.author.as_deref(), Some("A, B"));
    }

    #[test]
    fn reads_a_vrm_0_x() {
        let info = inspect(&glb(
            r#"{"extensions":{"VRM":{"specVersion":"0.0","exporterVersion":"VRoidStudio-1.29.0","meta":{"title":"Old","author":"Someone"}}}}"#,
        ))
        .unwrap();
        assert_eq!(info.spec, "0.0");
        assert_eq!(info.title.as_deref(), Some("Old"));
        assert_eq!(info.exporter.as_deref(), Some("VRoidStudio-1.29.0"));
    }

    /// The whole reason this module parses bytes instead of trusting `.vrm`.
    #[test]
    fn a_plain_glb_is_not_a_vrm() {
        let err = inspect(&glb(r#"{"asset":{"version":"2.0"}}"#)).unwrap_err();
        assert!(err.contains("not a VRM"), "{err}");
    }

    #[test]
    fn a_renamed_file_is_refused_by_its_header() {
        let err = inspect(b"this is a png, honestly, all of it").unwrap_err();
        assert!(err.contains("does not start with `glTF`"), "{err}");
    }

    #[test]
    fn a_truncated_file_is_named_not_panicked() {
        let mut bytes = glb(r#"{"extensions":{"VRMC_vrm":{"specVersion":"1.0"}}}"#);
        bytes.truncate(bytes.len() - 8);
        let err = inspect(&bytes).unwrap_err();
        assert!(err.contains("truncated"), "{err}");
    }

    #[test]
    fn a_short_file_is_not_an_index_panic() {
        assert!(inspect(b"glTF").is_err());
        assert!(inspect(b"").is_err());
    }

    /// A future 1.1 must report as 1.1, not be flattened into what this build
    /// knew about — the version is read, not inferred from the key's presence.
    #[test]
    fn an_unknown_spec_version_is_reported_verbatim() {
        let info = inspect(&glb(r#"{"extensions":{"VRMC_vrm":{"specVersion":"1.1"}}}"#)).unwrap();
        assert_eq!(info.spec, "1.1");
    }

    #[test]
    fn reads_a_vrm_animation() {
        let info = inspect_animation(&glb(
            r#"{"extensions":{"VRMC_vrm_animation":{"specVersion":"1.0"}}}"#,
        ))
        .unwrap();
        assert_eq!(info.spec, "1.0");
    }

    /// A model and a clip are both GLBs; only the extension tells them apart,
    /// and importing one as the other yields an animation that plays nothing.
    #[test]
    fn a_model_is_not_an_animation() {
        let err = inspect_animation(&glb(r#"{"extensions":{"VRMC_vrm":{"specVersion":"1.0"}}}"#))
            .unwrap_err();
        assert!(err.contains("not a VRM animation"), "{err}");
    }

    #[test]
    fn a_rejected_import_stores_nothing() {
        let tmp = std::env::temp_dir().join(format!("githud-vrm-test-{}", std::process::id()));
        let src = tmp.join("src.vrm");
        let entry = tmp.join("entry");
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(&src, glb(r#"{"asset":{"version":"2.0"}}"#)).unwrap();

        assert!(import(&entry, &src).is_err());
        assert!(
            !model_path(&entry).exists(),
            "a refused import must leave no model behind"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
