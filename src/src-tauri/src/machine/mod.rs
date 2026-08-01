//! Machine-local settings.
//!
//! `config/` is committed and synced (D8); this is the other half —
//! `~/.local/share/githud/machine.toml`, documented in
//! `planning/architecture/data-layout.md` as "per-machine overrides" and
//! implemented here for the first time, starting with where the app looks
//! for projects.
//!
//! Pure and Tauri-free, like `scan` and `overrides`, so the rules are testable
//! without a running app.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// What this machine has declared for itself. Every field optional — absent
/// means "use the built-in default," never a value this module invents.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MachineConfig {
    /// Where to scan for projects. `None` means the default (`~/github`).
    pub project_root: Option<PathBuf>,
}

impl MachineConfig {
    /// Load from disk.
    ///
    /// **A missing file is not an error** — no machine settings is the normal
    /// state on a fresh install. A malformed one *is* an error, surfaced
    /// rather than swallowed, the same posture `local::ProjectLocal::load`
    /// takes: a typo silently reverting to defaults is exactly the failure
    /// this must not have.
    pub fn load(path: &Path) -> Result<Self, String> {
        match fs::read_to_string(path) {
            Ok(text) => toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(format!("{}: {e}", path.display())),
        }
    }

    /// Write to disk, via a temporary file then rename — so a crash mid-write
    /// cannot leave a truncated `machine.toml` (the same dance
    /// `local::ProjectLocal::save` uses for a project's own `project.toml`).
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        let text = toml::to_string_pretty(self).map_err(|e| e.to_string())?;
        let temp = path.with_extension("toml.tmp");
        fs::write(&temp, &text).map_err(|e| format!("{}: {e}", temp.display()))?;
        fs::rename(&temp, path).map_err(|e| format!("{}: {e}", path.display()))
    }
}

/// Turn a user-chosen path into one this app can trust: absolute, real, and a
/// directory — never the raw string.
///
/// This is the one validation choke point for the scan root, called both when
/// persisting a new setting and every time the app reads the persisted one.
/// `fs::canonicalize` is what does the actual work — it resolves `..`
/// segments and symlinks in one step and fails outright if the path does not
/// exist, so nothing downstream ever reasons about a path that could still
/// point somewhere else than it appears to.
pub fn resolve_project_root(input: &Path) -> Result<PathBuf, String> {
    if input.as_os_str().is_empty() {
        return Err("no folder given".into());
    }
    let real = fs::canonicalize(input).map_err(|e| format!("{}: {e}", input.display()))?;
    if !real.is_dir() {
        return Err(format!("{} is not a folder", real.display()));
    }
    Ok(real)
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
                "githud-machine-test-{}-{}",
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
        let path = fx.root.join("does-not-exist/machine.toml");

        assert_eq!(
            MachineConfig::load(&path).unwrap(),
            MachineConfig::default()
        );
    }

    #[test]
    fn a_malformed_file_is_an_error_not_a_silent_default() {
        let fx = Fixture::new("malformed");
        let path = fx.file("machine.toml", "project_root = [not valid toml");

        assert!(MachineConfig::load(&path).is_err());
    }

    #[test]
    fn save_then_load_round_trips() {
        let fx = Fixture::new("roundtrip");
        let path = fx.root.join("nested/machine.toml");
        let config = MachineConfig {
            project_root: Some(PathBuf::from("/home/someone/projects")),
        };

        config.save(&path).unwrap();

        assert_eq!(MachineConfig::load(&path).unwrap(), config);
    }

    #[test]
    fn a_crash_mid_write_cannot_be_simulated_but_the_temp_file_is_cleaned_up() {
        let fx = Fixture::new("tempfile");
        let path = fx.root.join("machine.toml");
        let config = MachineConfig::default();

        config.save(&path).unwrap();

        assert!(path.exists());
        assert!(!path.with_extension("toml.tmp").exists());
    }

    #[test]
    fn resolve_rejects_an_empty_path() {
        assert!(resolve_project_root(Path::new("")).is_err());
    }

    #[test]
    fn resolve_rejects_a_path_that_does_not_exist() {
        let fx = Fixture::new("absent");
        let missing = fx.root.join("nope");

        assert!(resolve_project_root(&missing).is_err());
    }

    #[test]
    fn resolve_rejects_a_file() {
        let fx = Fixture::new("file");
        let file = fx.file("readme.txt", "not a folder");

        let err = resolve_project_root(&file).unwrap_err();
        assert!(err.contains("not a folder"), "got: {err}");
    }

    #[test]
    fn resolve_accepts_a_real_directory_and_canonicalizes_it() {
        let fx = Fixture::new("accept");
        let dir = fx.dir("projects");

        let resolved = resolve_project_root(&dir).unwrap();

        assert_eq!(resolved, fs::canonicalize(&dir).unwrap());
        assert!(resolved.is_absolute());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_follows_a_symlink_to_its_real_target() {
        use std::os::unix::fs::symlink;

        let fx = Fixture::new("symlink");
        let real = fx.dir("real-projects");
        let link = fx.root.join("link-to-projects");
        symlink(&real, &link).unwrap();

        let resolved = resolve_project_root(&link).unwrap();

        // The point of canonicalizing: what gets stored and used is the real
        // path, not a symlink that could later be repointed elsewhere.
        assert_eq!(resolved, fs::canonicalize(&real).unwrap());
        assert_ne!(resolved, link);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_rejects_a_broken_symlink() {
        use std::os::unix::fs::symlink;

        let fx = Fixture::new("broken-symlink");
        let link = fx.root.join("dangling");
        symlink(fx.root.join("never-created"), &link).unwrap();

        assert!(resolve_project_root(&link).is_err());
    }
}
