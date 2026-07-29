//! Git facts about a project.
//!
//! D13: mechanical work is scripted, not prompted. Everything here is a `git`
//! invocation and a parse — no agent is involved in showing a project card,
//! which is the entire point of M5's validation.

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

/// Bound on diff output. A working tree with a vendored directory in it can
/// produce megabytes, and a panel that hangs is worse than one that truncates.
const DIFF_LIMIT: usize = 200_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    /// Relative, as git renders it — "3 hours ago".
    pub when: String,
    pub author: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Status {
    pub branch: Option<String>,
    pub dirty: usize,
    pub last_commit: Option<Commit>,
    /// Commits ahead of the upstream, when there is one.
    pub ahead: Option<usize>,
}

fn git(repo: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

/// Everything the card needs, in a handful of cheap calls.
///
/// A repo that answers nothing — freshly initialised, no commits — yields a
/// status full of `None` rather than an error. That is a state, not a failure.
pub fn status(repo: &Path) -> Status {
    let branch = git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])
        .filter(|b| !b.is_empty() && b != "HEAD");

    let dirty = git(repo, &["status", "--porcelain"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0);

    // A unit separator keeps subjects containing the delimiter from splitting.
    let last_commit = git(
        repo,
        &["log", "-1", "--no-color", "--pretty=format:%h\x1f%s\x1f%cr\x1f%an"],
    )
    .and_then(|line| {
        let mut parts = line.split('\x1f');
        Some(Commit {
            hash: parts.next()?.to_string(),
            subject: parts.next()?.to_string(),
            when: parts.next()?.to_string(),
            author: parts.next().unwrap_or_default().to_string(),
        })
    });

    let ahead = git(repo, &["rev-list", "--count", "@{upstream}..HEAD"])
        .and_then(|s| s.trim().parse().ok());

    Status {
        branch,
        dirty,
        last_commit,
        ahead,
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diff {
    pub patch: String,
    pub truncated: bool,
    pub files: usize,
}

/// The working tree against HEAD, including staged changes.
pub fn diff(repo: &Path) -> Diff {
    let files = git(repo, &["diff", "HEAD", "--name-only"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0);

    let mut patch = git(repo, &["diff", "HEAD", "--no-color"]).unwrap_or_default();
    let truncated = patch.len() > DIFF_LIMIT;
    if truncated {
        // Cut on a char boundary — a diff can contain any UTF-8.
        let mut cut = DIFF_LIMIT;
        while cut > 0 && !patch.is_char_boundary(cut) {
            cut -= 1;
        }
        patch.truncate(cut);
    }

    Diff {
        patch,
        truncated,
        files,
    }
}

/// A guess at the stack, from files that are cheap to look for.
///
/// Useful at a glance and never load-bearing — nothing branches on it.
pub fn stack(repo: &Path) -> Vec<String> {
    let markers: &[(&str, &str)] = &[
        ("Cargo.toml", "Rust"),
        ("package.json", "Node"),
        ("pyproject.toml", "Python"),
        ("requirements.txt", "Python"),
        ("go.mod", "Go"),
        ("Gemfile", "Ruby"),
        ("pom.xml", "Java"),
        ("composer.json", "PHP"),
        ("Dockerfile", "Docker"),
        ("flake.nix", "Nix"),
        ("src-tauri/tauri.conf.json", "Tauri"),
        ("src/src-tauri/tauri.conf.json", "Tauri"),
    ];

    let mut found: Vec<String> = Vec::new();
    for (marker, name) in markers {
        if repo.join(marker).exists() && !found.iter().any(|f| f == name) {
            found.push((*name).to_string());
        }
    }
    found
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TreeEntry {
    pub name: String,
    /// Relative to the repo root, so the UI can request children.
    pub path: String,
    pub is_dir: bool,
}

/// Directories never worth listing. The same noise the project scan prunes.
const PRUNE: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
];

/// One directory's children, directories first then files, both alphabetical.
///
/// **Lazy by design.** A repo with a hundred thousand files must not be walked
/// to show a tree; the UI asks for a directory when it is opened.
pub fn list_dir(repo: &Path, rel: &str) -> Result<Vec<TreeEntry>, String> {
    // Refuse to leave the repo. A `..` in the path would otherwise let the tree
    // browse the whole filesystem.
    if rel.split('/').any(|p| p == "..") {
        return Err("path escapes the project".into());
    }

    let dir = if rel.is_empty() {
        repo.to_path_buf()
    } else {
        repo.join(rel)
    };

    let entries = std::fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;

    let mut out: Vec<TreeEntry> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if PRUNE.contains(&name.as_str()) {
                return None;
            }
            let is_dir = e.path().is_dir();
            let path = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            Some(TreeEntry { name, path, is_dir })
        })
        .collect();

    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(out)
}

/// A file's contents, bounded and honest about what it did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileContents {
    pub path: String,
    pub text: String,
    pub truncated: bool,
    /// Bytes on disk, whatever was returned.
    pub bytes: u64,
    /// Not text. The viewer says so rather than rendering noise.
    pub binary: bool,
}

/// How much of a file to read. A viewer is for reading, not for loading a
/// gigabyte into a webview.
const FILE_LIMIT: usize = 512 * 1024;

/// Read a file inside the project.
///
/// Refuses to leave the project, the same rule the tree walk follows — a `..`
/// would otherwise turn the viewer into a filesystem browser.
pub fn read_file(repo: &Path, rel: &str) -> Result<FileContents, String> {
    if rel.is_empty() {
        return Err("no file given".into());
    }
    if rel.split('/').any(|p| p == "..") {
        return Err("path escapes the project".into());
    }

    let full = repo.join(rel);
    let meta = std::fs::metadata(&full).map_err(|e| format!("{rel}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("{rel} is a directory"));
    }
    let bytes = meta.len();

    let raw = std::fs::read(&full).map_err(|e| format!("{rel}: {e}"))?;

    // A NUL in the first block is how git itself guesses binary, and it beats
    // trusting a file extension.
    let probe = &raw[..raw.len().min(8000)];
    if probe.contains(&0) {
        return Ok(FileContents {
            path: rel.to_string(),
            text: String::new(),
            truncated: false,
            bytes,
            binary: true,
        });
    }

    let truncated = raw.len() > FILE_LIMIT;
    let slice = if truncated { &raw[..FILE_LIMIT] } else { &raw[..] };
    // Lossy is right here: a viewer should show what it can rather than refuse
    // a file with one stray byte.
    let text = String::from_utf8_lossy(slice).into_owned();

    Ok(FileContents {
        path: rel.to_string(),
        text,
        truncated,
        bytes,
        binary: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn repo(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("githud-git-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        for args in [
            vec!["init", "-q", "-b", "main"],
            vec!["config", "user.email", "t@example.invalid"],
            vec!["config", "user.name", "T"],
        ] {
            Command::new("git").args(&args).current_dir(&p).output().unwrap();
        }
        p
    }

    fn commit(repo: &Path, file: &str, body: &str, msg: &str) {
        std::fs::write(repo.join(file), body).unwrap();
        Command::new("git").args(["add", "-A"]).current_dir(repo).output().unwrap();
        Command::new("git")
            .args(["commit", "-qm", msg])
            .current_dir(repo)
            .output()
            .unwrap();
    }

    #[test]
    fn reports_branch_dirt_and_the_last_commit() {
        let r = repo("status");
        commit(&r, "a.txt", "one", "first commit");
        std::fs::write(r.join("b.txt"), "wip").unwrap();

        let s = status(&r);

        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.dirty, 1);
        let c = s.last_commit.expect("a commit");
        assert_eq!(c.subject, "first commit");
        assert!(!c.hash.is_empty());
        assert!(!c.when.is_empty());
    }

    #[test]
    fn a_repo_with_no_commits_reports_state_rather_than_failing() {
        let r = repo("empty");

        let s = status(&r);

        assert_eq!(s.last_commit, None);
        assert_eq!(s.dirty, 0);
    }

    #[test]
    fn a_commit_subject_containing_the_delimiter_survives() {
        let r = repo("delim");
        commit(&r, "a.txt", "x", "fix: handle a|b and c:d properly");

        let c = status(&r).last_commit.unwrap();

        assert_eq!(c.subject, "fix: handle a|b and c:d properly");
    }

    #[test]
    fn a_clean_tree_has_no_diff() {
        let r = repo("clean");
        commit(&r, "a.txt", "one", "c");

        let d = diff(&r);

        assert_eq!(d.files, 0);
        assert!(d.patch.is_empty());
        assert!(!d.truncated);
    }

    #[test]
    fn a_changed_file_appears_in_the_diff() {
        let r = repo("dirty");
        commit(&r, "a.txt", "one\n", "c");
        std::fs::write(r.join("a.txt"), "two\n").unwrap();

        let d = diff(&r);

        assert_eq!(d.files, 1);
        assert!(d.patch.contains("-one"), "{}", d.patch);
        assert!(d.patch.contains("+two"), "{}", d.patch);
    }

    #[test]
    fn a_huge_diff_is_truncated_rather_than_hanging_the_panel() {
        let r = repo("huge");
        commit(&r, "a.txt", "seed\n", "c");
        std::fs::write(r.join("a.txt"), "x\n".repeat(200_000)).unwrap();

        let d = diff(&r);

        assert!(d.truncated, "expected truncation");
        assert!(d.patch.len() <= DIFF_LIMIT);
    }

    #[test]
    fn the_stack_guess_finds_what_is_there() {
        let r = repo("stack");
        std::fs::write(r.join("Cargo.toml"), "").unwrap();
        std::fs::write(r.join("package.json"), "{}").unwrap();

        let s = stack(&r);

        assert!(s.contains(&"Rust".to_string()));
        assert!(s.contains(&"Node".to_string()));
    }

    #[test]
    fn a_stack_is_never_reported_twice() {
        let r = repo("stack-dup");
        std::fs::write(r.join("pyproject.toml"), "").unwrap();
        std::fs::write(r.join("requirements.txt"), "").unwrap();

        assert_eq!(stack(&r), vec!["Python".to_string()]);
    }

    #[test]
    fn the_tree_lists_directories_first_then_files() {
        let r = repo("tree");
        std::fs::create_dir_all(r.join("zeta")).unwrap();
        std::fs::create_dir_all(r.join("alpha")).unwrap();
        std::fs::write(r.join("b.txt"), "").unwrap();
        std::fs::write(r.join("a.txt"), "").unwrap();

        let names: Vec<String> = list_dir(&r, "").unwrap().into_iter().map(|e| e.name).collect();

        assert_eq!(names, vec!["alpha", "zeta", "a.txt", "b.txt"]);
    }

    #[test]
    fn the_tree_prunes_the_same_noise_the_scan_does() {
        let r = repo("tree-prune");
        std::fs::create_dir_all(r.join("node_modules")).unwrap();
        std::fs::create_dir_all(r.join("target")).unwrap();
        std::fs::create_dir_all(r.join("src")).unwrap();

        let names: Vec<String> = list_dir(&r, "").unwrap().into_iter().map(|e| e.name).collect();

        assert_eq!(names, vec!["src"]);
    }

    #[test]
    fn the_tree_cannot_be_walked_out_of_the_project() {
        let r = repo("tree-escape");

        assert!(list_dir(&r, "..").is_err());
        assert!(list_dir(&r, "src/../..").is_err());
    }

    #[test]
    fn listing_a_missing_directory_errors_rather_than_panicking() {
        let r = repo("tree-missing");
        assert!(list_dir(&r, "nope").is_err());
    }

    #[test]
    fn a_text_file_reads_back_whole() {
        let r = repo("read");
        std::fs::write(r.join("a.txt"), "hello\nworld\n").unwrap();

        let f = read_file(&r, "a.txt").unwrap();

        assert_eq!(f.text, "hello\nworld\n");
        assert!(!f.truncated);
        assert!(!f.binary);
        assert_eq!(f.bytes, 12);
    }

    #[test]
    fn a_nested_file_reads_by_its_relative_path() {
        let r = repo("read-nested");
        std::fs::create_dir_all(r.join("src/inner")).unwrap();
        std::fs::write(r.join("src/inner/x.rs"), "fn main() {}").unwrap();

        assert_eq!(read_file(&r, "src/inner/x.rs").unwrap().text, "fn main() {}");
    }

    #[test]
    fn a_binary_file_is_reported_rather_than_dumped() {
        let r = repo("read-bin");
        std::fs::write(r.join("blob.bin"), [0u8, 1, 2, 3, 0, 255]).unwrap();

        let f = read_file(&r, "blob.bin").unwrap();

        assert!(f.binary);
        assert!(f.text.is_empty(), "binary content must not be rendered");
    }

    #[test]
    fn a_huge_file_is_truncated_and_says_so() {
        let r = repo("read-huge");
        std::fs::write(r.join("big.txt"), "x".repeat(FILE_LIMIT * 2)).unwrap();

        let f = read_file(&r, "big.txt").unwrap();

        assert!(f.truncated);
        assert_eq!(f.text.len(), FILE_LIMIT);
        assert_eq!(f.bytes, (FILE_LIMIT * 2) as u64);
    }

    #[test]
    fn the_viewer_cannot_read_outside_the_project() {
        // Otherwise the tree becomes a filesystem browser.
        let r = repo("read-escape");

        assert!(read_file(&r, "../../../etc/passwd").is_err());
        assert!(read_file(&r, "src/../../secret").is_err());
    }

    #[test]
    fn reading_a_directory_or_a_missing_file_errors_rather_than_panicking() {
        let r = repo("read-bad");
        std::fs::create_dir_all(r.join("adir")).unwrap();

        assert!(read_file(&r, "adir").is_err());
        assert!(read_file(&r, "nope.txt").is_err());
        assert!(read_file(&r, "").is_err());
    }

    #[test]
    fn invalid_utf8_is_shown_lossily_rather_than_refused() {
        let r = repo("read-lossy");
        // High bytes with no NUL: not binary by the probe, not valid UTF-8.
        std::fs::write(r.join("odd.txt"), [b'h', b'i', 0xff, b'!']).unwrap();

        let f = read_file(&r, "odd.txt").unwrap();

        assert!(!f.binary);
        assert!(f.text.contains("hi"), "{:?}", f.text);
    }

    #[test]
    fn child_paths_are_relative_so_they_can_be_requested_back() {
        let r = repo("tree-paths");
        std::fs::create_dir_all(r.join("src/inner")).unwrap();

        let top = list_dir(&r, "").unwrap();
        assert_eq!(top[0].path, "src");

        let inner = list_dir(&r, "src").unwrap();
        assert_eq!(inner[0].path, "src/inner");
    }
}
