//! Personal, local, per-project configuration (D24).
//!
//! `config/projects.toml` used to hold this, keyed by every project in one
//! shared, committed file. That whole shape is gone, not narrowed — a
//! committed file that names a user's own repos (`voicebox is external,
//! read-only`) is exactly the kind of thing a public clone must never carry.
//! Everything a user declares about one of their own projects now lives in
//! that project's own small file, under `~/.local/share/githud/projects/`,
//! gitignored and never shipped (M13).
//!
//! Pure and Tauri-free, like `machine` and `scan`, so the rules are testable
//! without a running app.

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// What a project *is*, which determines what is expected of it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectKind {
    /// Yours. ICM is expected; a missing layer is worth flagging.
    #[default]
    Own,
    /// Third-party. Present because the work needs it, never authored here.
    External,
    /// Yours, but superseded. Kept, not developed.
    Deprecated,
}

impl ProjectKind {
    /// Does a missing ICM layer deserve a badge?
    ///
    /// Only for your own projects. Detection still runs everywhere — this is a
    /// judgement about whose repo it is, not about what is on disk (D18).
    pub fn expects_icm(&self) -> bool {
        matches!(self, ProjectKind::Own)
    }

    /// The agent write policy implied by this kind, absent an explicit one.
    fn default_access(&self) -> AgentAccess {
        match self {
            ProjectKind::External => AgentAccess::ReadOnly,
            ProjectKind::Own | ProjectKind::Deprecated => AgentAccess::ReadWrite,
        }
    }
}

impl fmt::Display for ProjectKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            ProjectKind::Own => "own",
            ProjectKind::External => "external",
            ProjectKind::Deprecated => "deprecated",
        })
    }
}

/// Whether an agent may write in a project.
///
/// **Recorded and displayed from M1; enforced at M4.** Until the bwrap scope
/// and the PATH shim honour it, this is a declaration, not a guarantee — do not
/// describe it as enforcement.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentAccess {
    #[default]
    ReadWrite,
    ReadOnly,
}

/// One project's personal, local declaration — everything D10 cannot scan and
/// D24 will not commit. Every field optional: a file exists to say the one
/// thing about this project the scan cannot work out, not to fill in a form.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, default)]
pub struct ProjectLocal {
    /// Display name, when the folder name is not what you want to read.
    pub name: Option<String>,
    pub kind: Option<ProjectKind>,
    pub agent: Option<AgentAccess>,
    /// Why this project is declared the way it is. Personal, like everything
    /// else here now (D24) — it used to sit beside `kind`/`agent` in a
    /// committed file, but it names and explains a user's own repo.
    pub note: Option<String>,
    pub adapter: Option<String>,
    pub model: Option<String>,
    /// A project's own accent, independent of its character (M8) — the tab
    /// rail and glass tint for the *room*, not the *resident* (D21).
    pub accent: Option<String>,
    /// Keep this project out of the sidebar entirely.
    pub hidden: bool,
}

impl ProjectLocal {
    /// Load from disk.
    ///
    /// **A missing file is not an error** — no local declaration is the
    /// normal state for a project nobody has configured. A malformed one *is*
    /// an error, surfaced rather than swallowed: a typo silently reverting a
    /// project to its defaults is exactly the failure this must not have.
    pub fn load(path: &Path) -> Result<Self, String> {
        match fs::read_to_string(path) {
            Ok(text) => toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(format!("{}: {e}", path.display())),
        }
    }

    /// Write to disk, via a temporary file then rename — so a crash mid-write
    /// cannot leave a truncated `project.toml`, the same dance `MachineConfig`
    /// and every write in this app already use.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        let text = toml::to_string_pretty(self).map_err(|e| e.to_string())?;
        let temp = path.with_extension("toml.tmp");
        fs::write(&temp, &text).map_err(|e| format!("{}: {e}", temp.display()))?;
        fs::rename(&temp, path).map_err(|e| format!("{}: {e}", path.display()))
    }

    /// Resolve the kind and access this project's declaration implies.
    ///
    /// An explicit `agent` always wins; otherwise it follows from the kind —
    /// the same rule `Overrides::resolve` had, unaffected by the file moving.
    pub fn resolve(&self) -> (ProjectKind, AgentAccess) {
        let kind = self.kind.unwrap_or_default();
        let access = self.agent.unwrap_or_else(|| kind.default_access());
        (kind, access)
    }
}

/// The directory one project's local data lives in, given the local root.
///
/// Keyed through `theme::key_for(rel_path)` — the identity the app already
/// uses for a project's background image — deliberately chosen over the
/// project's bare name (D24): two independently found repos can share a
/// folder name (two different `utils/` clones in different parents), and a
/// scanned path cannot.
pub fn project_dir(local_root: &Path, rel_path: &str) -> PathBuf {
    local_root.join(crate::theme::key_for(rel_path))
}

/// What `scan::scan_with` needs about one project's local folder, without the
/// caller having to know this module's file layout.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct LocalSummary {
    pub name: Option<String>,
    pub kind: ProjectKind,
    pub agent: AgentAccess,
    pub note: Option<String>,
    pub accent: Option<String>,
    pub hidden: bool,
    /// Whether `character.toml` exists — presence *is* the assignment (D24).
    /// There is no name to look up any more.
    pub has_character: bool,
    pub has_background: bool,
}

/// Read one project's local folder, if it has one.
///
/// **No folder is not an error** — most projects have never been configured,
/// which is the ordinary case, the same tolerance `Overrides` once had for an
/// entry naming a repo not on this machine. A folder that exists but whose
/// `project.toml` is malformed *is* an error, surfaced rather than silently
/// reverting the project to its defaults.
pub fn load_summary(local_root: &Path, rel_path: &str) -> Result<Option<LocalSummary>, String> {
    let dir = project_dir(local_root, rel_path);
    if !dir.is_dir() {
        return Ok(None);
    }

    let declared = ProjectLocal::load(&dir.join("project.toml"))?;
    let (kind, agent) = declared.resolve();

    Ok(Some(LocalSummary {
        name: declared.name,
        kind,
        agent,
        note: declared.note,
        accent: declared.accent,
        hidden: declared.hidden,
        has_character: dir.join("character.toml").is_file(),
        has_background: crate::theme::has_background(&dir),
    }))
}

/// Every project folder under `local_root`, by the `key_for` identity it is
/// named with. Used by `bundle` to build an export without needing to already
/// know which projects exist — the local store is walked, not declared,
/// mirroring D10's reasoning for the registry itself.
///
/// A missing `local_root` is not an error — no local directory at all is the
/// state a fresh install starts in.
pub fn known_keys(local_root: &Path) -> Result<Vec<String>, String> {
    let entries = match fs::read_dir(local_root) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("{}: {e}", local_root.display())),
    };

    let mut keys: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .collect();
    keys.sort();
    Ok(keys)
}

/// Every project's `LocalSummary`, by `key_for` — used where a caller already
/// knows the keys (export) rather than the `rel_path`s `load_summary` needs.
pub fn load_all(local_root: &Path) -> BTreeMap<String, Result<LocalSummary, String>> {
    let keys = known_keys(local_root).unwrap_or_default();
    keys.into_iter()
        .map(|key| {
            let dir = local_root.join(&key);
            let result = ProjectLocal::load(&dir.join("project.toml")).map(|declared| {
                let (kind, agent) = declared.resolve();
                LocalSummary {
                    name: declared.name,
                    kind,
                    agent,
                    note: declared.note,
                    accent: declared.accent,
                    hidden: declared.hidden,
                    has_character: dir.join("character.toml").is_file(),
                    has_background: crate::theme::has_background(&dir),
                }
            });
            (key, result)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new(tag: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "githud-local-test-{}-{}",
                tag,
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn dir(&self, rel: &str) -> PathBuf {
            let p = self.root.join(rel);
            fs::create_dir_all(&p).unwrap();
            p
        }

        fn file(&self, rel: &str, contents: &str) -> PathBuf {
            let p = self.root.join(rel);
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&p, contents).unwrap();
            p
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn a_missing_file_loads_as_default() {
        let fx = Fixture::new("missing");
        let path = fx.root.join("does-not-exist/project.toml");

        assert_eq!(ProjectLocal::load(&path).unwrap(), ProjectLocal::default());
    }

    #[test]
    fn a_malformed_file_is_an_error_not_a_silent_default() {
        let fx = Fixture::new("malformed");
        let path = fx.file("project.toml", "kind = [not valid toml");

        assert!(ProjectLocal::load(&path).is_err());
    }

    #[test]
    fn an_unknown_field_is_an_error() {
        let fx = Fixture::new("unknown-field");
        let path = fx.file("project.toml", "knid = \"external\"\n");

        let err = ProjectLocal::load(&path).unwrap_err();
        assert!(err.contains("knid"), "{err}");
    }

    #[test]
    fn save_then_load_round_trips() {
        let fx = Fixture::new("roundtrip");
        let path = fx.root.join("nested/project.toml");
        let declared = ProjectLocal {
            name: Some("Ideaverse".into()),
            kind: Some(ProjectKind::Deprecated),
            agent: Some(AgentAccess::ReadOnly),
            note: Some("kept for reference".into()),
            adapter: None,
            model: None,
            accent: Some("#174920".into()),
            hidden: false,
        };

        declared.save(&path).unwrap();

        assert_eq!(ProjectLocal::load(&path).unwrap(), declared);
    }

    #[test]
    fn absent_declares_own_and_read_write() {
        assert_eq!(
            ProjectLocal::default().resolve(),
            (ProjectKind::Own, AgentAccess::ReadWrite)
        );
    }

    #[test]
    fn external_defaults_to_read_only() {
        let declared = ProjectLocal {
            kind: Some(ProjectKind::External),
            ..Default::default()
        };
        assert_eq!(
            declared.resolve(),
            (ProjectKind::External, AgentAccess::ReadOnly)
        );
    }

    #[test]
    fn an_explicit_agent_beats_the_kind_default() {
        let declared = ProjectLocal {
            kind: Some(ProjectKind::External),
            agent: Some(AgentAccess::ReadWrite),
            ..Default::default()
        };
        assert_eq!(
            declared.resolve(),
            (ProjectKind::External, AgentAccess::ReadWrite)
        );
    }

    #[test]
    fn project_dir_flattens_a_nested_rel_path() {
        let root = Path::new("/local");
        assert_eq!(
            project_dir(root, "Obsidian/HOME_AI_VAULT"),
            PathBuf::from("/local/Obsidian__HOME_AI_VAULT")
        );
        assert_eq!(project_dir(root, "githud"), PathBuf::from("/local/githud"));
    }

    #[test]
    fn a_project_with_no_local_folder_summarises_as_none() {
        let fx = Fixture::new("no-folder");
        assert_eq!(load_summary(&fx.root, "nobody").unwrap(), None);
    }

    #[test]
    fn a_folder_with_no_project_toml_still_summarises() {
        // A character can exist with no declared project.toml at all — the
        // folder existing at all is enough to probe it.
        let fx = Fixture::new("character-only");
        fx.dir("githud");
        fx.file("githud/character.toml", "display = \"HUD\"\n");

        let summary = load_summary(&fx.root, "githud").unwrap().unwrap();
        assert_eq!(summary.kind, ProjectKind::Own);
        assert!(summary.has_character);
        assert!(!summary.has_background);
    }

    #[test]
    fn a_full_local_folder_summarises_every_fact() {
        let fx = Fixture::new("full");
        fx.dir("HOME_AI_VAULT");
        fx.file(
            "HOME_AI_VAULT/project.toml",
            "note = \"The vault. MIA is its character (D5).\"\n",
        );
        fx.file("HOME_AI_VAULT/character.toml", "display = \"MIA\"\n");

        let summary = load_summary(&fx.root, "HOME_AI_VAULT").unwrap().unwrap();
        assert_eq!(
            summary.note.as_deref(),
            Some("The vault. MIA is its character (D5).")
        );
        assert!(summary.has_character);
    }

    #[test]
    fn a_malformed_project_toml_in_an_existing_folder_is_an_error() {
        let fx = Fixture::new("malformed-folder");
        fx.dir("broken");
        fx.file("broken/project.toml", "kind = \"vendored\"\n");

        let err = load_summary(&fx.root, "broken").unwrap_err();
        assert!(err.contains("vendored"), "{err}");
    }

    #[test]
    fn known_keys_lists_every_project_folder_sorted() {
        let fx = Fixture::new("known-keys");
        for name in ["zed", "githud", "HOME_AI_VAULT"] {
            fx.dir(name);
        }
        fx.file("not-a-dir.toml", "");

        assert_eq!(
            known_keys(&fx.root).unwrap(),
            vec!["HOME_AI_VAULT", "githud", "zed"]
        );
    }

    #[test]
    fn known_keys_on_a_missing_root_is_empty_not_an_error() {
        let missing = std::env::temp_dir().join("githud-local-no-such-root");
        assert_eq!(known_keys(&missing).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn load_all_pairs_every_key_with_its_result() {
        let fx = Fixture::new("load-all");
        fx.dir("githud");
        fx.file("githud/project.toml", "accent = \"#692323\"\n");
        fx.dir("broken");
        fx.file("broken/project.toml", "kind = \"vendored\"\n");

        let all = load_all(&fx.root);
        assert_eq!(all.len(), 2);
        assert_eq!(
            all["githud"].as_ref().unwrap().accent.as_deref(),
            Some("#692323")
        );
        assert!(all["broken"].is_err());
    }
}
