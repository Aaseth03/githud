//! Declared project overrides.
//!
//! D10: the registry is scanned, never declared — but some facts cannot be
//! scanned. Whether a repo is *yours* is one of them, and D18 makes it a
//! declared `kind`.
//!
//! Pure and Tauri-free, like `scan`, so the rules can be tested directly.

use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;

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

/// One declared override. Every field is optional — an entry exists to say the
/// one thing the scan cannot work out.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Override {
    /// Display name, when the folder name is not what you want to read.
    pub name: Option<String>,
    pub kind: Option<ProjectKind>,
    pub agent: Option<AgentAccess>,
    /// Why this override exists. Shown in the UI so the reason travels with it.
    pub note: Option<String>,
    pub adapter: Option<String>,
    pub model: Option<String>,
    pub character: Option<String>,
    /// Keep a scanned repo out of the sidebar entirely.
    #[serde(default)]
    pub hidden: bool,
}

/// The parsed `config/projects.toml`, keyed by path relative to the scan root.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Overrides {
    #[serde(default)]
    pub projects: BTreeMap<String, Override>,
}

impl Overrides {
    /// Parse from TOML text.
    pub fn parse(text: &str) -> Result<Self, String> {
        toml::from_str(text).map_err(|e| e.to_string())
    }

    /// Load from disk.
    ///
    /// **A missing file is not an error** — no overrides is the normal state.
    /// A malformed one *is* an error, and it is surfaced rather than swallowed:
    /// silently ignoring a typo'd override would mean the agent gets write
    /// access somewhere the file says it should not.
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read_to_string(path) {
            Ok(text) => Self::parse(&text),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(format!("{}: {e}", path.display())),
        }
    }

    pub fn get(&self, rel_path: &str) -> Option<&Override> {
        self.projects.get(rel_path)
    }

    /// Resolve the kind and access for one project.
    ///
    /// An explicit `agent` always wins; otherwise it follows from the kind.
    pub fn resolve(&self, rel_path: &str) -> (ProjectKind, AgentAccess) {
        let entry = self.get(rel_path);
        let kind = entry.and_then(|o| o.kind).unwrap_or_default();
        let access = entry
            .and_then(|o| o.agent)
            .unwrap_or_else(|| kind.default_access());
        (kind, access)
    }
}

/// Set or clear one project's `character`, preserving everything else.
///
/// **Editing, not re-serializing.** `config/projects.toml` opens with a thirty-line
/// comment block explaining D10 and D18, and round-tripping it through `toml`
/// would delete all of it — the file would still be correct and would have lost
/// the reason it exists. `toml_edit` keeps trivia, so this adds one line.
///
/// Kept beside `parse` on purpose: the reader and the writer of the same file
/// cannot be allowed to drift, and the surest way to guarantee that is for them
/// to live in the same module and share its tests.
///
/// Pure — it takes and returns text, so the rule is testable without a
/// filesystem. `None` removes the key, and removes the table too if that was the
/// only thing in it, because an empty `[projects.x]` is noise that reads as a
/// declaration.
pub fn assign_character(text: &str, rel_path: &str, character: Option<&str>) -> Result<String, String> {
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("config/projects.toml is malformed: {e}"))?;

    if !doc.contains_key("projects") {
        if character.is_none() {
            return Ok(doc.to_string());
        }
        let mut table = toml_edit::Table::new();
        // Implicit, so the rendered file gets `[projects.foo]` rather than a bare
        // `[projects]` header nobody wrote.
        table.set_implicit(true);
        doc.insert("projects", toml_edit::Item::Table(table));
    }

    let projects = doc["projects"]
        .as_table_mut()
        .ok_or_else(|| "config/projects.toml: `projects` is not a table".to_string())?;

    match character {
        Some(name) => {
            if !projects.contains_key(rel_path) {
                projects.insert(rel_path, toml_edit::Item::Table(toml_edit::Table::new()));
            }
            let entry = projects[rel_path]
                .as_table_mut()
                .ok_or_else(|| format!("config/projects.toml: `{rel_path}` is not a table"))?;
            entry["character"] = toml_edit::value(name);
        }
        None => {
            if let Some(entry) = projects.get_mut(rel_path).and_then(|e| e.as_table_mut()) {
                entry.remove("character");
                if entry.is_empty() {
                    projects.remove(rel_path);
                }
            }
        }
    }

    Ok(doc.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_entry_means_own_and_read_write() {
        let o = Overrides::default();
        assert_eq!(
            o.resolve("anything"),
            (ProjectKind::Own, AgentAccess::ReadWrite)
        );
    }

    #[test]
    fn empty_file_parses_to_no_overrides() {
        assert_eq!(Overrides::parse("").unwrap(), Overrides::default());
    }

    #[test]
    fn a_comment_only_file_parses() {
        let o = Overrides::parse("# nothing declared yet\n").unwrap();
        assert!(o.projects.is_empty());
    }

    #[test]
    fn external_defaults_to_read_only() {
        // The D18 rule that matters: an agent should not quietly patch a
        // vendored dependency.
        let o = Overrides::parse(
            r#"
            [projects.voicebox]
            kind = "external"
            "#,
        )
        .unwrap();

        assert_eq!(
            o.resolve("voicebox"),
            (ProjectKind::External, AgentAccess::ReadOnly)
        );
    }

    #[test]
    fn deprecated_stays_writable() {
        let o = Overrides::parse(
            r#"
            [projects.AI-Dashboard]
            kind = "deprecated"
            "#,
        )
        .unwrap();

        assert_eq!(
            o.resolve("AI-Dashboard"),
            (ProjectKind::Deprecated, AgentAccess::ReadWrite)
        );
    }

    #[test]
    fn an_explicit_agent_setting_beats_the_kind_default() {
        let o = Overrides::parse(
            r#"
            [projects.vendored]
            kind = "external"
            agent = "read-write"
            "#,
        )
        .unwrap();

        assert_eq!(
            o.resolve("vendored"),
            (ProjectKind::External, AgentAccess::ReadWrite)
        );
    }

    #[test]
    fn read_only_can_be_set_on_an_own_project() {
        let o = Overrides::parse(
            r#"
            [projects.careful]
            agent = "read-only"
            "#,
        )
        .unwrap();

        assert_eq!(
            o.resolve("careful"),
            (ProjectKind::Own, AgentAccess::ReadOnly)
        );
    }

    #[test]
    fn nested_relative_paths_are_valid_keys() {
        let o = Overrides::parse(
            r#"
            [projects."Obsidian/HOME_AI_VAULT"]
            name = "Ideaverse"
            "#,
        )
        .unwrap();

        assert_eq!(
            o.get("Obsidian/HOME_AI_VAULT").unwrap().name.as_deref(),
            Some("Ideaverse")
        );
    }

    #[test]
    fn the_note_is_kept_so_the_reason_travels() {
        let o = Overrides::parse(
            r#"
            [projects.voicebox]
            kind = "external"
            note = "MIT, third-party."
            "#,
        )
        .unwrap();

        assert_eq!(
            o.get("voicebox").unwrap().note.as_deref(),
            Some("MIT, third-party.")
        );
    }

    #[test]
    fn an_unknown_kind_is_an_error_not_a_silent_default() {
        // Falling back to `own` here would flag a repo the file says to leave
        // alone; falling back to `external` would grant a silent exemption.
        // Neither is safe, so it fails loudly.
        let err = Overrides::parse(
            r#"
            [projects.x]
            kind = "vendored"
            "#,
        )
        .unwrap_err();

        assert!(err.contains("vendored"), "error should name the bad value: {err}");
    }

    #[test]
    fn an_unknown_field_is_an_error() {
        // Catches typos. A misspelled `knid = "external"` that parsed happily
        // would leave the repo flagged and writable with no indication why.
        let err = Overrides::parse(
            r#"
            [projects.x]
            knid = "external"
            "#,
        )
        .unwrap_err();

        assert!(err.contains("knid"), "error should name the bad key: {err}");
    }

    #[test]
    fn malformed_toml_errors_rather_than_panicking() {
        assert!(Overrides::parse("[projects.x").is_err());
        assert!(Overrides::parse("= nonsense").is_err());
    }

    #[test]
    fn a_missing_file_is_not_an_error() {
        let missing = std::env::temp_dir().join("githud-no-such-projects-file.toml");
        assert_eq!(Overrides::load(&missing).unwrap(), Overrides::default());
    }

    // ── Writing (M7) ────────────────────────────────────────────────────────
    //
    // The reader's tests above and these share a module deliberately: a writer
    // that drifts from its reader produces a file the app cannot load back.

    /// A file shaped like the real one: comments carrying the reasoning, then
    /// entries. The comments are the thing most at risk.
    const REAL: &str = r#"# Per-project overrides. Committed and synced (D8).
#
# THIS IS NOT A PROJECT LIST. The registry is scanned, not declared (D10).

[projects.voicebox]
kind  = "external"
agent = "read-only"
note  = "MIT, third-party."
"#;

    #[test]
    fn assigning_a_character_keeps_every_comment() {
        // The whole reason `toml_edit` is a dependency. `toml` would round-trip
        // this into a correct file that had lost the reason it exists.
        let out = assign_character(REAL, "githud", Some("hud")).unwrap();

        assert!(out.contains("# THIS IS NOT A PROJECT LIST"));
        assert!(out.contains("# Per-project overrides. Committed and synced (D8)."));
        assert!(out.contains(r#"note  = "MIT, third-party.""#));
        assert!(out.contains("[projects.githud]"));
        assert!(out.contains(r#"character = "hud""#));
    }

    #[test]
    fn assigning_adds_one_line_to_an_existing_entry() {
        let out = assign_character(REAL, "voicebox", Some("mia")).unwrap();

        let before = REAL.lines().count();
        let after = out.lines().count();
        assert_eq!(after, before + 1, "expected one added line, got:\n{out}");
        // And it joined the entry that was already there rather than making a
        // second table with the same key, which would not even parse.
        assert_eq!(out.matches("[projects.voicebox]").count(), 1);
    }

    #[test]
    fn the_result_is_always_readable_by_the_parser_that_reads_it() {
        // The property that matters more than any formatting detail.
        let out = assign_character(REAL, "githud", Some("hud")).unwrap();
        let reparsed = Overrides::parse(&out).unwrap();
        assert_eq!(
            reparsed.get("githud").unwrap().character.as_deref(),
            Some("hud")
        );
        // …and nothing else moved.
        assert_eq!(
            reparsed.resolve("voicebox"),
            (ProjectKind::External, AgentAccess::ReadOnly)
        );
    }

    #[test]
    fn reassigning_replaces_rather_than_duplicating() {
        let once = assign_character(REAL, "githud", Some("hud")).unwrap();
        let twice = assign_character(&once, "githud", Some("mia")).unwrap();

        assert_eq!(twice.matches("character =").count(), 1);
        assert_eq!(
            Overrides::parse(&twice).unwrap().get("githud").unwrap().character.as_deref(),
            Some("mia")
        );
    }

    #[test]
    fn clearing_removes_the_key_and_the_entry_it_was_alone_in() {
        // An empty `[projects.githud]` reads as a declaration about the project
        // when nothing is being declared.
        let assigned = assign_character(REAL, "githud", Some("hud")).unwrap();
        let cleared = assign_character(&assigned, "githud", None).unwrap();

        assert!(!cleared.contains("[projects.githud]"), "{cleared}");
        assert!(cleared.contains("# THIS IS NOT A PROJECT LIST"));
    }

    #[test]
    fn clearing_keeps_an_entry_that_declares_something_else() {
        let assigned = assign_character(REAL, "voicebox", Some("mia")).unwrap();
        let cleared = assign_character(&assigned, "voicebox", None).unwrap();

        assert!(cleared.contains("[projects.voicebox]"));
        assert!(cleared.contains(r#"kind  = "external""#));
        assert!(!cleared.contains("character"));
    }

    #[test]
    fn clearing_something_never_assigned_changes_nothing() {
        assert_eq!(assign_character(REAL, "nobody", None).unwrap(), REAL);
    }

    #[test]
    fn a_nested_path_is_quoted_so_the_file_still_parses() {
        // `Obsidian/HOME_AI_VAULT` is a real key on this machine, and a bare
        // slash in a table header is a parse error.
        let out = assign_character(REAL, "Obsidian/HOME_AI_VAULT", Some("mia")).unwrap();
        assert!(out.contains(r#"[projects."Obsidian/HOME_AI_VAULT"]"#), "{out}");
        assert_eq!(
            Overrides::parse(&out)
                .unwrap()
                .get("Obsidian/HOME_AI_VAULT")
                .unwrap()
                .character
                .as_deref(),
            Some("mia")
        );
    }

    #[test]
    fn an_empty_file_gains_only_what_was_asked_for() {
        let out = assign_character("", "githud", Some("hud")).unwrap();
        assert!(out.contains("[projects.githud]"));
        assert!(!out.contains("\n[projects]\n"), "no bare header nobody wrote: {out}");
        assert_eq!(
            Overrides::parse(&out).unwrap().get("githud").unwrap().character.as_deref(),
            Some("hud")
        );
    }

    #[test]
    fn a_malformed_file_is_refused_rather_than_rewritten() {
        // Writing over a file we could not understand would destroy whatever the
        // user was midway through typing.
        let err = assign_character("[projects.x", "x", Some("hud")).unwrap_err();
        assert!(err.contains("malformed"), "{err}");
    }

    #[test]
    fn only_own_projects_expect_icm() {
        assert!(ProjectKind::Own.expects_icm());
        assert!(!ProjectKind::External.expects_icm());
        assert!(!ProjectKind::Deprecated.expects_icm());
    }
}
