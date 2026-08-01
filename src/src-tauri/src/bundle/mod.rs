//! Export and import a machine's local project config (D24).
//!
//! Moving config between machines is **explicit**, not automatic sync — a
//! user exports a single file and imports it elsewhere. A real zip/tar
//! archive would be more "correct" for a folder of files, but this app has
//! never needed one, and the codebase's own established convention for
//! moving binary bytes across a boundary is already base64-in-JSON
//! (`character::png_data_uri`, `theme::read_background`'s data URIs) — a
//! bundle file is the same convention applied to disk instead of IPC. The
//! amount of data (a handful of small TOML files and a few images,
//! base64-inflated ~33%) is trivial for an occasional manual export; the
//! explicit non-goal here is automatic sync, so file size is not a design
//! pressure.
//!
//! Pure and Tauri-free, like every other module here, so the rules are
//! testable without a running app.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Bumped whenever the shape below changes. A future format change adds a
/// match arm to `read`, not a breaking change to every export ever made.
pub const VERSION: u32 = 1;

/// One project's local folder, bundled into portable text.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct BundledProject {
    pub project_toml: Option<String>,
    pub character_toml: Option<String>,
    /// Every other file in this project's local folder, by path relative to
    /// it (`"background.jpg"`, `"character/head.png"`) — background images
    /// and character art alike, base64-encoded. Generic on purpose: bundling
    /// "everything that is not the two known text files" needs no second
    /// reader kept in sync with `local`'s or `theme`'s file-naming
    /// conventions.
    pub other_files: BTreeMap<String, String>,
}

/// The whole export.
///
/// Keyed the same way the local store already is — `theme::key_for(rel_path)`
/// — rather than by the true `rel_path`. `key_for` is lossy in principle (a
/// literal `__` in a path segment could collide with a flattened `/`, a
/// pre-existing edge case inherited from `theme.rs`, not introduced here),
/// but recovering the true `rel_path` on export would need a second identity
/// stored somewhere, and a project whose relative path differs between two
/// machines is exactly the case this app now avoids by construction (the
/// vault moved rather than the key scheme changing, D24) — not a case worth
/// building new plumbing for.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Bundle {
    pub version: u32,
    /// Unix seconds. Not a calendar type — this crate carries no date/time
    /// dependency, and the frontend can format a number into whatever it
    /// likes.
    pub exported_at: u64,
    pub projects: BTreeMap<String, BundledProject>,
}

/// What happened importing a bundle: which projects were written, and which
/// failed and why. Every named project's local folder is overwritten
/// wholesale — merge semantics would be surprising for "mirror this
/// machine's config elsewhere," and are not asked for. Every other project
/// already on the importing machine is left untouched.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ImportSummary {
    pub imported: Vec<String>,
    pub failed: Vec<ImportFailure>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportFailure {
    pub key: String,
    pub error: String,
}

fn now_unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn is_reserved(rel: &str) -> bool {
    rel == "project.toml" || rel == "character.toml"
}

fn read_optional_text(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Every file under `dir` that is not one of the two reserved names, by path
/// relative to `dir`, base64-encoded. Recurses, so `character/`'s contents
/// are captured regardless of what a character's own `sprite.dir` names it.
fn collect_other_files(dir: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    collect_into(dir, dir, &mut out)?;
    Ok(out)
}

fn collect_into(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) -> Result<(), String> {
    use base64::Engine as _;
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("{}: {e}", dir.display())),
    };

    for entry in entries {
        let entry = entry.map_err(|e| format!("{}: {e}", dir.display()))?;
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        if path.is_dir() {
            collect_into(root, &path, out)?;
            continue;
        }
        if is_reserved(&rel) {
            continue;
        }
        let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        out.insert(rel, base64::engine::general_purpose::STANDARD.encode(bytes));
    }
    Ok(())
}

fn read_bundled_project(dir: &Path) -> Result<BundledProject, String> {
    Ok(BundledProject {
        project_toml: read_optional_text(&dir.join("project.toml"))?,
        character_toml: read_optional_text(&dir.join("character.toml"))?,
        other_files: collect_other_files(dir)?,
    })
}

/// Build a bundle from every project in the local store.
///
/// A project whose folder fails to read (permissions, a file removed mid-walk)
/// is skipped and named in the second return value rather than failing the
/// whole export — the same tolerance `local::load_all` already has for one
/// bad `project.toml`. A missing `local_root` bundles zero projects, not an
/// error: no local config at all is the state a fresh install starts in.
pub fn build(local_root: &Path) -> (Bundle, Vec<String>) {
    let keys = crate::local::known_keys(local_root).unwrap_or_default();
    let mut projects = BTreeMap::new();
    let mut failed = Vec::new();

    for key in keys {
        match read_bundled_project(&local_root.join(&key)) {
            Ok(bundled) => {
                projects.insert(key, bundled);
            }
            Err(e) => failed.push(format!("{key}: {e}")),
        }
    }

    (
        Bundle {
            version: VERSION,
            exported_at: now_unix_seconds(),
            projects,
        },
        failed,
    )
}

/// Write a bundle to disk, via a temporary file then rename — the same dance
/// every writer here uses, so a crash mid-write cannot leave a truncated
/// export somebody later tries to import.
pub fn write(bundle: &Bundle, dest: &Path) -> Result<(), String> {
    let text = serde_json::to_string_pretty(bundle).map_err(|e| e.to_string())?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let temp = dest.with_extension("json.tmp");
    fs::write(&temp, &text).map_err(|e| format!("{}: {e}", temp.display()))?;
    fs::rename(&temp, dest).map_err(|e| format!("{}: {e}", dest.display()))
}

/// Read a bundle from disk. A version this binary does not understand fails
/// loudly rather than half-applying — a partially-imported project is worse
/// than a refused import.
pub fn read(src: &Path) -> Result<Bundle, String> {
    let text = fs::read_to_string(src).map_err(|e| format!("{}: {e}", src.display()))?;
    let bundle: Bundle =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", src.display()))?;
    if bundle.version != VERSION {
        return Err(format!(
            "{}: export format version {} is not one this app understands (expected {VERSION})",
            src.display(),
            bundle.version
        ));
    }
    Ok(bundle)
}

/// Apply every project in a bundle to the local store, overwriting each
/// named project's folder wholesale.
///
/// **Written to a temporary directory then renamed into place**, the same
/// atomic-swap the rest of this app uses for a single file — a crash
/// mid-import must not leave a project's folder half-overwritten, empty when
/// it used to have a character.
pub fn apply(bundle: &Bundle, local_root: &Path) -> ImportSummary {
    let mut imported = Vec::new();
    let mut failed = Vec::new();

    for (key, project) in &bundle.projects {
        match apply_one(local_root, key, project) {
            Ok(()) => imported.push(key.clone()),
            Err(error) => failed.push(ImportFailure {
                key: key.clone(),
                error,
            }),
        }
    }

    ImportSummary { imported, failed }
}

fn apply_one(local_root: &Path, key: &str, project: &BundledProject) -> Result<(), String> {
    use base64::Engine as _;

    let temp = local_root.join(format!("{key}.import-tmp"));
    // A leftover from a previous failed import must not be mistaken for
    // partial data belonging to this one.
    let _ = fs::remove_dir_all(&temp);
    fs::create_dir_all(&temp).map_err(|e| format!("{}: {e}", temp.display()))?;

    if let Some(text) = &project.project_toml {
        fs::write(temp.join("project.toml"), text)
            .map_err(|e| format!("{}: {e}", temp.display()))?;
    }
    if let Some(text) = &project.character_toml {
        fs::write(temp.join("character.toml"), text)
            .map_err(|e| format!("{}: {e}", temp.display()))?;
    }
    for (rel, encoded) in &project.other_files {
        let path = temp.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|e| format!("{rel}: bad encoding: {e}"))?;
        fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    }

    let dir = local_root.join(key);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    fs::rename(&temp, &dir).map_err(|e| format!("{}: {e}", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new(tag: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "githud-bundle-test-{}-{}",
                tag,
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn file(&self, rel: &str, contents: &[u8]) {
            let p = self.root.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, contents).unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn building_an_empty_root_bundles_nothing() {
        let fx = Fixture::new("empty");
        let (bundle, failed) = build(&fx.root);
        assert!(bundle.projects.is_empty());
        assert!(failed.is_empty());
    }

    #[test]
    fn a_missing_root_bundles_nothing_not_an_error() {
        let missing = std::env::temp_dir().join("githud-bundle-no-such-root");
        let (bundle, failed) = build(&missing);
        assert!(bundle.projects.is_empty());
        assert!(failed.is_empty());
    }

    #[test]
    fn building_captures_every_file_in_a_project() {
        let fx = Fixture::new("build");
        fx.file("githud/project.toml", b"accent = \"#692323\"\n");
        fx.file("githud/character.toml", b"display = \"HUD\"\n");
        fx.file("githud/character/head.png", b"\x89PNG-ish");
        fx.file("githud/background.jpg", b"jpeg-bytes");

        let (bundle, failed) = build(&fx.root);
        assert!(failed.is_empty());

        let p = &bundle.projects["githud"];
        assert_eq!(p.project_toml.as_deref(), Some("accent = \"#692323\"\n"));
        assert_eq!(p.character_toml.as_deref(), Some("display = \"HUD\"\n"));
        assert!(p.other_files.contains_key("character/head.png"));
        assert!(p.other_files.contains_key("background.jpg"));
        assert_eq!(p.other_files.len(), 2);
    }

    #[test]
    fn a_project_with_only_a_project_toml_bundles_the_rest_as_absent() {
        let fx = Fixture::new("minimal");
        fx.file("Professor/project.toml", b"accent = \"#174920\"\n");

        let (bundle, _) = build(&fx.root);
        let p = &bundle.projects["Professor"];
        assert_eq!(p.character_toml, None);
        assert!(p.other_files.is_empty());
    }

    #[test]
    fn write_then_read_round_trips() {
        let fx = Fixture::new("roundtrip");
        fx.file("githud/project.toml", b"accent = \"#692323\"\n");
        let (bundle, _) = build(&fx.root);

        let dest = fx.root.join("export.json");
        write(&bundle, &dest).unwrap();
        let read_back = read(&dest).unwrap();

        assert_eq!(read_back, bundle);
    }

    #[test]
    fn writing_leaves_no_temp_file_behind() {
        let fx = Fixture::new("no-temp");
        let (bundle, _) = build(&fx.root);
        let dest = fx.root.join("export.json");

        write(&bundle, &dest).unwrap();

        assert!(dest.exists());
        assert!(!dest.with_extension("json.tmp").exists());
    }

    #[test]
    fn reading_a_missing_file_is_an_error() {
        let missing = std::env::temp_dir().join("githud-bundle-no-such-file.json");
        assert!(read(&missing).is_err());
    }

    #[test]
    fn reading_malformed_json_is_an_error_not_a_panic() {
        let fx = Fixture::new("malformed");
        fx.file("bad.json", b"{not json");
        assert!(read(&fx.root.join("bad.json")).is_err());
    }

    #[test]
    fn a_future_version_is_refused_rather_than_half_applied() {
        let fx = Fixture::new("future-version");
        fx.file(
            "future.json",
            br#"{"version":99,"exported_at":0,"projects":{}}"#,
        );

        let err = read(&fx.root.join("future.json")).unwrap_err();
        assert!(err.contains("99"), "{err}");
    }

    #[test]
    fn applying_writes_every_named_project() {
        let fx = Fixture::new("apply");
        let mut projects = BTreeMap::new();
        projects.insert(
            "githud".to_string(),
            BundledProject {
                project_toml: Some("accent = \"#692323\"\n".into()),
                character_toml: Some("display = \"HUD\"\n".into()),
                other_files: BTreeMap::from([(
                    "character/head.png".to_string(),
                    "iVBORw0KGgo=".to_string(), // arbitrary valid base64
                )]),
            },
        );
        let bundle = Bundle {
            version: VERSION,
            exported_at: 0,
            projects,
        };

        let summary = apply(&bundle, &fx.root);

        assert_eq!(summary.imported, vec!["githud"]);
        assert!(summary.failed.is_empty());
        assert_eq!(
            fs::read_to_string(fx.root.join("githud/project.toml")).unwrap(),
            "accent = \"#692323\"\n"
        );
        assert!(fx.root.join("githud/character/head.png").exists());
    }

    #[test]
    fn applying_overwrites_a_project_wholesale() {
        let fx = Fixture::new("overwrite");
        // Something already there that the bundle does not mention.
        fx.file("githud/stale.txt", b"leftover");
        fx.file("githud/project.toml", b"accent = \"#000000\"\n");

        let mut projects = BTreeMap::new();
        projects.insert(
            "githud".to_string(),
            BundledProject {
                project_toml: Some("accent = \"#692323\"\n".into()),
                character_toml: None,
                other_files: BTreeMap::new(),
            },
        );
        let bundle = Bundle {
            version: VERSION,
            exported_at: 0,
            projects,
        };

        apply(&bundle, &fx.root);

        assert!(
            !fx.root.join("githud/stale.txt").exists(),
            "wholesale means gone"
        );
        assert_eq!(
            fs::read_to_string(fx.root.join("githud/project.toml")).unwrap(),
            "accent = \"#692323\"\n"
        );
    }

    #[test]
    fn applying_leaves_projects_not_named_in_the_bundle_untouched() {
        let fx = Fixture::new("untouched");
        fx.file("HOME_AI_VAULT/project.toml", b"note = \"the vault\"\n");

        let bundle = Bundle {
            version: VERSION,
            exported_at: 0,
            projects: BTreeMap::from([(
                "githud".to_string(),
                BundledProject {
                    project_toml: Some("accent = \"#692323\"\n".into()),
                    character_toml: None,
                    other_files: BTreeMap::new(),
                },
            )]),
        };

        apply(&bundle, &fx.root);

        assert_eq!(
            fs::read_to_string(fx.root.join("HOME_AI_VAULT/project.toml")).unwrap(),
            "note = \"the vault\"\n"
        );
    }

    #[test]
    fn a_bad_base64_file_fails_only_that_project() {
        let fx = Fixture::new("bad-base64");
        let bundle = Bundle {
            version: VERSION,
            exported_at: 0,
            projects: BTreeMap::from([
                (
                    "broken".to_string(),
                    BundledProject {
                        project_toml: None,
                        character_toml: None,
                        other_files: BTreeMap::from([(
                            "background.png".to_string(),
                            "not valid base64!!".to_string(),
                        )]),
                    },
                ),
                (
                    "fine".to_string(),
                    BundledProject {
                        project_toml: Some("accent = \"#000\"\n".into()),
                        character_toml: None,
                        other_files: BTreeMap::new(),
                    },
                ),
            ]),
        };

        let summary = apply(&bundle, &fx.root);

        assert_eq!(summary.imported, vec!["fine"]);
        assert_eq!(summary.failed.len(), 1);
        assert_eq!(summary.failed[0].key, "broken");
    }
}
