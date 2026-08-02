//! Project discovery.
//!
//! D10: the registry is scanned, not declared. Walk the root, find repos, stop
//! descending the moment one is found. Nothing here knows about Tauri — the
//! walk is pure so it can be tested against a temp-dir fixture rather than by
//! squinting at the UI.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::local::{self, AgentAccess, ProjectKind};

/// How many directory levels below the root to search.
///
/// A depth of 1 would miss any repo living inside a container folder — the
/// vault used to be the case in point, nested under `~/github/Obsidian/`
/// until it moved to sit directly under the root. Kept at 3 as headroom for
/// whatever else ends up nested rather than tuned down to exactly what is
/// on disk today.
pub const DEFAULT_MAX_DEPTH: usize = 3;

/// Directories never worth descending into. Skipping these is the difference
/// between a scan that feels instant and one that walks a `node_modules`.
const PRUNE: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    "vendor",
];

/// Which ICM context layers a repo actually provides.
///
/// **`config/contracts/icm.md` is canonical for these chains — this code
/// implements that contract, not the other way round.** If the two disagree,
/// this code is wrong. Changing detection is a versioned breaking change and
/// must update both in the same commit (D17).
///
/// The chains matter: Professor keeps its Layer 1 routing table *inside*
/// `AGENTS.md`, so a detector that only looks for a root `CONTEXT.md` would
/// badge a conformant repo as non-conformant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct IcmStatus {
    /// `AGENTS.md`, else `CLAUDE.md`.
    pub layer0: bool,
    /// Root `CONTEXT.md`, else a routing section inside Layer 0, else `README.md`.
    pub layer1: bool,
}

impl IcmStatus {
    pub fn is_conformant(&self) -> bool {
        self.layer0 && self.layer1
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    /// Folder name — what the sidebar shows unless overridden.
    pub name: String,
    /// Absolute path on this machine.
    pub path: PathBuf,
    /// Path relative to the scan root. Machine-local identity — tabs and UI
    /// list keys use it, and it is also the identity a project's local
    /// folder is keyed by (`local::project_dir`, via `theme::key_for`), since
    /// an absolute path is machine-specific and a bare name is not
    /// guaranteed unique (D24).
    pub rel_path: String,
    /// Directory levels below the scan root.
    pub depth: usize,
    /// What ICM detection actually found. **Always the truth about disk**, for
    /// every project regardless of kind — `config/contracts/icm.md` is
    /// canonical and must never be made to lie.
    pub icm: IcmStatus,
    /// What this project *is* (D18). Declared, never derived.
    pub kind: ProjectKind,
    /// Agent write policy. Recorded here from M1, **enforced at M4**.
    pub agent: AgentAccess,
    /// Why this project is declared the way it is, from this project's own
    /// local folder. Personal (D24) — never committed, never shipped.
    pub note: Option<String>,
    /// This project's own pointer into the character library, if it has one
    /// (D26) — the pointer *is* the assignment. `None`, or an id the library
    /// no longer has, resolves to the house character; resolution happens in
    /// `ui/character.ts`, the scan only reports the fact.
    pub character_id: Option<String>,
    /// A project's own accent (M8), independent of its character — the tab
    /// rail and glass tint for the room, not the resident. `None` means the
    /// app's own signal colour.
    pub accent: Option<String>,
    /// Whether this project has a background image in its own local folder.
    /// The image itself is read on demand (`theme::read_background`); this is
    /// just the fact of whether one exists.
    pub has_local_background: bool,
}

impl Project {
    /// Should a missing ICM layer be surfaced as a badge?
    ///
    /// Detection and expectation are separate axes (D18). `voicebox` genuinely
    /// has no Layer 0 — that stays true in `icm` — but it is third-party, so
    /// being flagged for it would be noise.
    pub fn should_flag_icm(&self) -> bool {
        self.kind.expects_icm() && !self.icm.is_conformant()
    }
}

/// A folder sitting in the scan root that is not a repository and contains none.
///
/// From the failure-mode contract: "non-git folder → listed as uninitiated, not
/// enterable as a project." Only direct children of the root qualify — a
/// non-repo folder three levels down is just a folder, and listing every one of
/// those would be noise, not information.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Uninitiated {
    pub name: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScanResult {
    pub projects: Vec<Project>,
    pub uninitiated: Vec<Uninitiated>,
    /// Malformed local `project.toml` files, surfaced rather than swallowed —
    /// one per broken project, named. The scan still returns every project;
    /// a broken one simply carries its defaults, the same posture
    /// `character::load_all` already has for one bad profile.
    pub local_errors: Vec<String>,
}

/// Walk `root` and return every git repository, ordered by relative path.
///
/// A directory is a project if it contains `.git`. Descent stops there — a repo
/// inside a repo is a submodule or a vendored copy, not a separate project.
pub fn walk(root: &Path, max_depth: usize) -> Vec<Project> {
    scan(root, max_depth).projects
}

/// As [`walk`], but also reports root-level folders that hold no repository.
/// No local directory is consulted — every project carries its bare defaults.
pub fn scan(root: &Path, max_depth: usize) -> ScanResult {
    scan_with(root, max_depth, None)
}

/// The full scan, with each project's local declaration applied if it has one
/// (D24).
///
/// `local_root` is `None` in tests that only care about the walk itself;
/// `Some` is the real path — deliberately not defaulted to an empty or
/// relative path, which could accidentally resolve against the process's own
/// working directory and merge in data that was never meant for this scan.
pub fn scan_with(root: &Path, max_depth: usize, local_root: Option<&Path>) -> ScanResult {
    let mut scanned = Vec::new();
    walk_into(root, root, 0, max_depth, &mut scanned);
    scanned.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));

    let mut projects = Vec::with_capacity(scanned.len());
    let mut local_errors = Vec::new();

    for mut project in scanned {
        if let Some(local_root) = local_root {
            match local::load_summary(local_root, &project.rel_path) {
                Ok(Some(summary)) => {
                    // Ambiguous which project a corrupt-but-hidden entry
                    // meant is not a concern here — a folder belongs to
                    // exactly one `rel_path`, unlike the old shared file.
                    if summary.hidden {
                        continue;
                    }
                    if let Some(name) = summary.name {
                        project.name = name;
                    }
                    project.kind = summary.kind;
                    project.agent = summary.agent;
                    project.note = summary.note;
                    project.accent = summary.accent;
                    project.character_id = summary.character_id;
                    project.has_local_background = summary.has_background;
                }
                Ok(None) => {}
                Err(e) => local_errors.push(format!("{}: {e}", project.rel_path)),
            }
        }
        projects.push(project);
    }

    let mut uninitiated: Vec<Uninitiated> = child_dirs(root)
        .into_iter()
        .filter(|dir| {
            // Not a repo itself, and nothing below it is one either — so it is
            // not a container like `Obsidian/`, which leads to the vault.
            !is_repo(dir) && !projects.iter().any(|p| p.path.starts_with(dir))
        })
        .map(|path| Uninitiated {
            name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string(),
            path,
        })
        .collect();
    uninitiated.sort_by(|a, b| a.name.cmp(&b.name));

    ScanResult {
        projects,
        uninitiated,
        local_errors,
    }
}

/// Visible, non-pruned subdirectories of `dir`.
fn child_dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| !n.starts_with('.') && !PRUNE.contains(&n))
        })
        .collect()
}

fn walk_into(root: &Path, dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<Project>) {
    // Children of this directory would sit at `depth + 1`, so stop here once
    // that would exceed the limit. Checking `depth > max_depth` instead reads
    // naturally and searches exactly one level too deep.
    if depth >= max_depth {
        return;
    }

    // A missing or unreadable directory yields nothing rather than failing the
    // whole registry — `child_dirs` already swallows the read error.
    for path in child_dirs(dir) {
        let child_depth = depth + 1;
        if is_repo(&path) {
            out.push(describe(root, &path, child_depth));
            // Stop descending. Anything below is part of this repo.
            continue;
        }
        walk_into(root, &path, child_depth, max_depth, out);
    }
}

/// A directory is a repo if it contains `.git`.
///
/// `.git` may be a **file** rather than a directory — that is what a git
/// worktree looks like. M8 adds worktree sessions, so accepting both now costs
/// nothing and avoids a confusing bug later.
fn is_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

fn describe(root: &Path, path: &Path, depth: usize) -> Project {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();

    let rel_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");

    Project {
        name,
        path: path.to_path_buf(),
        rel_path,
        depth,
        icm: detect_icm(path),
        // Defaults; `scan_with` applies any local declaration afterwards.
        kind: ProjectKind::default(),
        agent: AgentAccess::default(),
        note: None,
        character_id: None,
        accent: None,
        has_local_background: false,
    }
}

/// Resolve the ICM layers a repo provides, following the documented fallbacks.
pub fn detect_icm(repo: &Path) -> IcmStatus {
    let layer0_file = ["AGENTS.md", "CLAUDE.md"]
        .iter()
        .map(|f| repo.join(f))
        .find(|p| p.is_file());

    let layer0 = layer0_file.is_some();

    let layer1 = repo.join("CONTEXT.md").is_file()
        || layer0_file.as_deref().is_some_and(has_routing_section)
        || repo.join("README.md").is_file();

    IcmStatus { layer0, layer1 }
}

/// Does this Layer 0 file carry its own routing table?
///
/// The Professor variant merges Layer 1 into `AGENTS.md`, so a heading
/// containing "routing" or "workspaces" is what stands in for a root
/// `CONTEXT.md`. Deliberately shallow: this is a badge, not a grader, and a
/// false negative here only costs a badge.
fn has_routing_section(layer0: &Path) -> bool {
    let Ok(text) = fs::read_to_string(layer0) else {
        return false;
    };
    text.lines()
        .filter(|l| l.trim_start().starts_with('#'))
        .any(|l| {
            let h = l.to_ascii_lowercase();
            h.contains("routing") || h.contains("workspaces")
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Build a directory tree under a fresh temp dir. Paths ending in `/` are
    /// plain directories; a path listed as a repo also gets a `.git`. A
    /// second, separate tree stands in for a project's local folder, so
    /// tests can declare local data without it looking like part of the
    /// scanned root.
    struct Fixture {
        root: PathBuf,
        local: PathBuf,
    }

    impl Fixture {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "githud-scan-test-{}-{}",
                tag,
                std::process::id()
            ));
            let root = base.join("root");
            let local = base.join("local");
            let _ = fs::remove_dir_all(&base);
            fs::create_dir_all(&root).unwrap();
            fs::create_dir_all(&local).unwrap();
            Self { root, local }
        }

        fn dir(&self, rel: &str) -> PathBuf {
            let p = self.root.join(rel);
            fs::create_dir_all(&p).unwrap();
            p
        }

        fn repo(&self, rel: &str) -> PathBuf {
            let p = self.dir(rel);
            fs::create_dir_all(p.join(".git")).unwrap();
            p
        }

        fn file(&self, rel: &str, contents: &str) {
            let p = self.root.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, contents).unwrap();
        }

        /// Declare a project's local `project.toml`, keyed the same way
        /// `local::project_dir` keys it (`theme::key_for(rel_path)`).
        fn local_project(&self, key: &str, toml: &str) {
            let dir = self.local.join(key);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("project.toml"), toml).unwrap();
        }

        /// Declare a project's `character_id` pointer (D26), so
        /// `character_id` reports it for that project.
        fn local_character(&self, key: &str, character_id: &str) {
            self.local_project(key, &format!("character_id = \"{character_id}\"\n"));
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(self.root.parent().unwrap());
        }
    }

    fn names(projects: &[Project]) -> Vec<&str> {
        projects.iter().map(|p| p.name.as_str()).collect()
    }

    #[test]
    fn finds_repos_at_depth_one() {
        let fx = Fixture::new("depth1");
        fx.repo("alpha");
        fx.repo("beta");
        fx.dir("not-a-repo");

        let found = walk(&fx.root, DEFAULT_MAX_DEPTH);

        assert_eq!(names(&found), vec!["alpha", "beta"]);
    }

    #[test]
    fn finds_a_repo_nested_two_levels_down() {
        // The vault used to be exactly this case: ~/github/Obsidian/HOME_AI_VAULT.
        let fx = Fixture::new("depth2");
        fx.dir("Obsidian");
        fx.repo("Obsidian/HOME_AI_VAULT");

        let found = walk(&fx.root, DEFAULT_MAX_DEPTH);

        assert_eq!(names(&found), vec!["HOME_AI_VAULT"]);
        assert_eq!(found[0].depth, 2);
        assert_eq!(found[0].rel_path, "Obsidian/HOME_AI_VAULT");
    }

    #[test]
    fn stops_descending_once_a_repo_is_found() {
        // A repo inside a repo is a submodule or a vendored copy, not a project.
        let fx = Fixture::new("nested");
        fx.repo("outer");
        fx.repo("outer/inner");

        let found = walk(&fx.root, DEFAULT_MAX_DEPTH);

        assert_eq!(names(&found), vec!["outer"]);
    }

    #[test]
    fn respects_max_depth() {
        let fx = Fixture::new("maxdepth");
        fx.dir("a/b/c");
        fx.repo("a/b/c/deep");

        assert!(
            walk(&fx.root, 3).is_empty(),
            "depth 4 must not be found at max 3"
        );
        assert_eq!(names(&walk(&fx.root, 4)), vec!["deep"]);
    }

    #[test]
    fn treats_a_git_file_as_a_repo() {
        // This is what a git worktree looks like. M8 needs it.
        let fx = Fixture::new("worktree");
        fx.dir("wt");
        fx.file("wt/.git", "gitdir: /somewhere/.git/worktrees/wt\n");

        assert_eq!(names(&walk(&fx.root, DEFAULT_MAX_DEPTH)), vec!["wt"]);
    }

    #[test]
    fn prunes_noise_directories() {
        let fx = Fixture::new("prune");
        fx.repo("node_modules/pkg");
        fx.repo("target/thing");
        fx.repo("real");

        assert_eq!(names(&walk(&fx.root, DEFAULT_MAX_DEPTH)), vec!["real"]);
    }

    #[test]
    fn skips_hidden_directories() {
        let fx = Fixture::new("hidden");
        fx.repo(".config/sneaky");
        fx.repo("visible");

        assert_eq!(names(&walk(&fx.root, DEFAULT_MAX_DEPTH)), vec!["visible"]);
    }

    #[test]
    fn missing_root_yields_nothing_rather_than_failing() {
        let missing = std::env::temp_dir().join("githud-definitely-not-here-xyz");
        assert!(walk(&missing, DEFAULT_MAX_DEPTH).is_empty());
    }

    #[test]
    fn results_are_sorted_by_relative_path() {
        let fx = Fixture::new("sorted");
        fx.repo("zebra");
        fx.repo("apple");
        fx.dir("Mid");
        fx.repo("Mid/thing");

        let found = walk(&fx.root, DEFAULT_MAX_DEPTH);
        let rels: Vec<&str> = found.iter().map(|p| p.rel_path.as_str()).collect();

        assert_eq!(rels, vec!["Mid/thing", "apple", "zebra"]);
    }

    #[test]
    fn detects_canonical_icm_layers() {
        let fx = Fixture::new("icm-canonical");
        fx.repo("canonical");
        fx.file("canonical/AGENTS.md", "# Thing\n");
        fx.file("canonical/CONTEXT.md", "# Routing\n");

        let icm = detect_icm(&fx.root.join("canonical"));

        assert!(icm.layer0 && icm.layer1 && icm.is_conformant());
    }

    #[test]
    fn accepts_claude_md_as_layer_zero() {
        let fx = Fixture::new("icm-claude");
        fx.repo("c");
        fx.file("c/CLAUDE.md", "# Thing\n");
        fx.file("c/CONTEXT.md", "# Routing\n");

        assert!(detect_icm(&fx.root.join("c")).layer0);
    }

    #[test]
    fn accepts_routing_inside_layer_zero_as_layer_one() {
        // The Professor variant. A detector that only looks for a root
        // CONTEXT.md would wrongly badge this repo as missing Layer 1.
        let fx = Fixture::new("icm-professor");
        fx.repo("professor");
        fx.file(
            "professor/AGENTS.md",
            "# Professor\n\n## Workspaces\n- /planning\n\n## Routing\n| Task | Go to |\n",
        );

        let icm = detect_icm(&fx.root.join("professor"));

        assert!(icm.layer0, "AGENTS.md is Layer 0");
        assert!(icm.layer1, "its routing section stands in for Layer 1");
    }

    #[test]
    fn does_not_invent_layer_one_from_prose_alone() {
        let fx = Fixture::new("icm-prose");
        fx.repo("bare");
        fx.file("bare/AGENTS.md", "# Bare\n\nSome prose about routing.\n");

        let icm = detect_icm(&fx.root.join("bare"));

        assert!(icm.layer0);
        assert!(
            !icm.layer1,
            "the word 'routing' in a paragraph is not a routing section"
        );
    }

    #[test]
    fn lists_a_root_folder_holding_no_repo_as_uninitiated() {
        let fx = Fixture::new("uninit");
        fx.repo("real");
        fx.dir("just-a-folder");

        let result = scan(&fx.root, DEFAULT_MAX_DEPTH);

        assert_eq!(names(&result.projects), vec!["real"]);
        let uninit: Vec<&str> = result.uninitiated.iter().map(|u| u.name.as_str()).collect();
        assert_eq!(uninit, vec!["just-a-folder"]);
    }

    #[test]
    fn does_not_call_a_container_folder_uninitiated() {
        // `Obsidian/` holds the vault. It is a route to a project, not a
        // folder waiting to become one.
        let fx = Fixture::new("container");
        fx.dir("Obsidian");
        fx.repo("Obsidian/HOME_AI_VAULT");

        let result = scan(&fx.root, DEFAULT_MAX_DEPTH);

        assert_eq!(names(&result.projects), vec!["HOME_AI_VAULT"]);
        assert!(
            result.uninitiated.is_empty(),
            "a folder that leads to a repo is a container, not uninitiated"
        );
    }

    #[test]
    fn a_repo_is_never_also_uninitiated() {
        let fx = Fixture::new("uninit-repo");
        fx.repo("alpha");

        assert!(scan(&fx.root, DEFAULT_MAX_DEPTH).uninitiated.is_empty());
    }

    #[test]
    fn does_not_list_deep_non_repo_folders_as_uninitiated() {
        // Only root-level folders qualify; listing every leaf would be noise.
        let fx = Fixture::new("uninit-deep");
        fx.repo("real");
        fx.dir("real-ish/nested/deeper");
        fx.repo("real-ish/nested/repo");

        let result = scan(&fx.root, DEFAULT_MAX_DEPTH);

        assert!(
            result.uninitiated.is_empty(),
            "real-ish leads to a repo; its inner folders are not root-level"
        );
    }

    #[test]
    fn an_external_repo_is_not_flagged_but_detection_still_tells_the_truth() {
        // The voicebox case. `icm` must keep reporting what is actually on
        // disk — the contract in config/contracts/icm.md is canonical and must
        // never be made to lie. Only the *flag* is suppressed.
        let fx = Fixture::new("kind-external");
        fx.repo("voicebox");
        fx.local_project("voicebox", "kind = \"external\"\n");

        let result = scan_with(&fx.root, DEFAULT_MAX_DEPTH, Some(&fx.local));
        let p = &result.projects[0];

        assert!(!p.icm.layer0, "detection still reports the truth");
        assert!(!p.icm.is_conformant());
        assert!(!p.should_flag_icm(), "an external repo is not flagged");
        assert_eq!(p.kind, ProjectKind::External);
        assert_eq!(p.agent, AgentAccess::ReadOnly);
    }

    #[test]
    fn an_own_repo_missing_icm_is_still_flagged() {
        let fx = Fixture::new("kind-own");
        fx.repo("mine");

        let result = scan_with(&fx.root, DEFAULT_MAX_DEPTH, Some(&fx.local));

        assert!(result.projects[0].should_flag_icm());
        assert_eq!(result.projects[0].kind, ProjectKind::Own);
    }

    #[test]
    fn a_conformant_own_repo_is_not_flagged() {
        let fx = Fixture::new("kind-own-ok");
        fx.repo("mine");
        fx.file("mine/AGENTS.md", "# Mine\n");
        fx.file("mine/CONTEXT.md", "# Routing\n");

        let result = scan_with(&fx.root, DEFAULT_MAX_DEPTH, Some(&fx.local));

        assert!(!result.projects[0].should_flag_icm());
    }

    #[test]
    fn a_deprecated_repo_is_not_flagged_but_stays_writable() {
        let fx = Fixture::new("kind-deprecated");
        fx.repo("old-thing");
        fx.local_project("old-thing", "kind = \"deprecated\"\n");

        let p = &scan_with(&fx.root, DEFAULT_MAX_DEPTH, Some(&fx.local)).projects[0];

        assert!(!p.should_flag_icm());
        assert_eq!(p.agent, AgentAccess::ReadWrite);
    }

    #[test]
    fn a_local_declaration_carries_its_note_and_display_name() {
        let fx = Fixture::new("kind-note");
        fx.repo("voicebox");
        fx.local_project(
            "voicebox",
            "kind = \"external\"\nname = \"Voicebox\"\nnote = \"MIT, third-party.\"\n",
        );

        let p = &scan_with(&fx.root, DEFAULT_MAX_DEPTH, Some(&fx.local)).projects[0];

        assert_eq!(p.name, "Voicebox");
        assert_eq!(p.note.as_deref(), Some("MIT, third-party."));
    }

    #[test]
    fn a_local_character_folder_is_reported_as_present() {
        // The scan reports the fact and takes no view on what the character
        // looks like — resolution is `ui/character.ts`'s job.
        let fx = Fixture::new("kind-character");
        fx.repo("vault");
        fx.repo("plain");
        fx.local_character("vault", "mia");

        let result = scan_with(&fx.root, DEFAULT_MAX_DEPTH, Some(&fx.local));
        let plain = result
            .projects
            .iter()
            .find(|p| p.rel_path == "plain")
            .unwrap();
        let vault = result
            .projects
            .iter()
            .find(|p| p.rel_path == "vault")
            .unwrap();

        assert_eq!(vault.character_id.as_deref(), Some("mia"));
        assert_eq!(
            plain.character_id, None,
            "unconfigured is a state, not a default"
        );
    }

    #[test]
    fn no_local_root_means_every_project_keeps_its_bare_defaults() {
        // `scan`/`walk` pass `None` — used by callers that only care about
        // the directory walk itself.
        let fx = Fixture::new("no-local-root");
        fx.repo("mine");
        fx.local_project("mine", "kind = \"external\"\n");

        let result = scan(&fx.root, DEFAULT_MAX_DEPTH);

        assert_eq!(
            result.projects[0].kind,
            ProjectKind::Own,
            "local data was never consulted"
        );
    }

    #[test]
    fn a_local_folder_for_a_repo_not_on_this_machine_is_ignored() {
        // The local store is per-machine by construction now (D24) — this is
        // the residual case of a folder whose repo has since moved or gone,
        // not an error.
        let fx = Fixture::new("kind-absent");
        fx.repo("here");
        fx.local_project("somewhere-else", "kind = \"external\"\n");

        let result = scan_with(&fx.root, DEFAULT_MAX_DEPTH, Some(&fx.local));

        assert_eq!(names(&result.projects), vec!["here"]);
        assert_eq!(result.projects[0].kind, ProjectKind::Own);
    }

    #[test]
    fn a_hidden_declaration_removes_the_project_from_the_list() {
        let fx = Fixture::new("kind-hidden");
        fx.repo("shown");
        fx.repo("secret");
        fx.local_project("secret", "hidden = true\n");

        assert_eq!(
            names(&scan_with(&fx.root, DEFAULT_MAX_DEPTH, Some(&fx.local)).projects),
            vec!["shown"]
        );
    }

    #[test]
    fn a_malformed_local_project_toml_is_carried_through_not_swallowed() {
        let fx = Fixture::new("kind-err");
        fx.repo("mine");
        fx.local_project("mine", "kind = \"vendored\"\n");

        let result = scan_with(&fx.root, DEFAULT_MAX_DEPTH, Some(&fx.local));

        assert_eq!(result.local_errors.len(), 1);
        assert!(
            result.local_errors[0].contains("mine"),
            "{:?}",
            result.local_errors
        );
        assert!(
            result.local_errors[0].contains("vendored"),
            "{:?}",
            result.local_errors
        );
        assert_eq!(
            names(&result.projects),
            vec!["mine"],
            "projects still returned"
        );
        assert_eq!(
            result.projects[0].kind,
            ProjectKind::Own,
            "the bad entry keeps its defaults"
        );
    }

    #[test]
    fn flags_a_repo_with_no_icm_at_all() {
        let fx = Fixture::new("icm-none");
        fx.repo("plain");

        let icm = detect_icm(&fx.root.join("plain"));

        assert!(!icm.layer0);
        assert!(!icm.layer1);
        assert!(!icm.is_conformant());
    }
}
