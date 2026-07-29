//! The project card.
//!
//! D11: read once at registration, cached. **The UI reads a struct; it never
//! parses prose per render.** Putting a markdown parser in the render path
//! would make a malformed file a rendering bug instead of a data error.
//!
//! Nothing here involves an agent — that is M5's whole validation: open a
//! project cold and see its state.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::{git, parse};

/// Where a project declares its milestones, per the cross-project contract.
const MILESTONES: &str = "planning/milestones.md";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Card {
    pub stack: Vec<String>,
    pub status: git::Status,
    pub milestones: parse::Milestones,
    /// True when the project declares no milestones at all.
    ///
    /// Absence is a state, not a failure — most repos have none, and marking
    /// them red would be noise (see `config/contracts/milestones.md`).
    pub has_milestones: bool,
}

/// Read a project's card from disk.
///
/// Never fails: a repo that answers nothing yields an empty card. Milestone
/// parse errors ride along inside `milestones.errors` so the Activity panel can
/// show them **while the rest of the card still renders** — the failure-mode
/// contract requires exactly that.
pub fn read(repo: &Path) -> Card {
    let path = repo.join(MILESTONES);
    let (milestones, has_milestones) = match std::fs::read_to_string(&path) {
        Ok(text) => (parse::parse(&text), true),
        Err(_) => (parse::Milestones::default(), false),
    };

    Card {
        stack: git::stack(repo),
        status: git::status(repo),
        milestones,
        has_milestones,
    }
}

/// Cards held by project key, so the UI reads a struct rather than the disk.
#[derive(Clone, Default)]
pub struct Cards {
    inner: Arc<Mutex<HashMap<String, Card>>>,
}

impl Cards {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Card>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The cached card, reading it on first request.
    pub fn get(&self, id: &str, repo: &Path) -> Card {
        if let Some(card) = self.lock().get(id) {
            return card.clone();
        }
        let card = read(repo);
        self.lock().insert(id.to_string(), card.clone());
        card
    }

    /// Re-read from disk, replacing the cache.
    ///
    /// The card changes whenever the agent commits or the branch moves, so this
    /// is called on demand — never per frame (D11).
    pub fn refresh(&self, id: &str, repo: &Path) -> Card {
        let card = read(repo);
        self.lock().insert(id.to_string(), card.clone());
        card
    }

    pub fn forget(&self, id: &str) {
        self.lock().remove(id);
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    fn repo(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("githud-card-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        for args in [
            vec!["init", "-q", "-b", "main"],
            vec!["config", "user.email", "t@example.invalid"],
            vec!["config", "user.name", "T"],
        ] {
            Command::new("git").args(&args).current_dir(&p).output().unwrap();
        }
        std::fs::write(p.join("seed.txt"), "seed").unwrap();
        Command::new("git").args(["add", "-A"]).current_dir(&p).output().unwrap();
        Command::new("git")
            .args(["commit", "-qm", "seed"])
            .current_dir(&p)
            .output()
            .unwrap();
        p
    }

    fn with_milestones(repo: &Path, body: &str) {
        let dir = repo.join("planning");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("milestones.md"), body).unwrap();
    }

    #[test]
    fn a_cold_read_reports_everything_the_card_needs() {
        // M5's validation: no agent involved.
        let r = repo("cold");
        std::fs::write(r.join("Cargo.toml"), "").unwrap();
        with_milestones(&r, "### M1 — Thing\n**Status:** done\n");

        let card = read(&r);

        assert_eq!(card.stack, vec!["Rust".to_string()]);
        assert_eq!(card.status.branch.as_deref(), Some("main"));
        assert!(card.status.last_commit.is_some());
        assert_eq!(card.milestones.counts(), (1, 1));
        assert!(card.has_milestones);
    }

    #[test]
    fn a_project_with_no_milestones_is_a_state_not_a_failure() {
        let r = repo("no-ms");

        let card = read(&r);

        assert!(!card.has_milestones);
        assert!(card.milestones.errors.is_empty(), "absence is not an error");
        assert!(card.status.last_commit.is_some(), "the rest still reads");
    }

    #[test]
    fn a_malformed_milestone_file_does_not_take_the_card_down() {
        // The failure-mode contract: error in the panel, rest of the card
        // still renders.
        let r = repo("bad-ms");
        with_milestones(&r, "### M1 — Thing\n**Status:** nonsense\n");

        let card = read(&r);

        assert!(!card.milestones.errors.is_empty(), "the error must survive");
        assert_eq!(card.status.branch.as_deref(), Some("main"), "branch still read");
        assert!(card.status.last_commit.is_some(), "commit still read");
    }

    #[test]
    fn the_cache_serves_the_same_card_without_touching_disk_again() {
        let r = repo("cache");
        with_milestones(&r, "### M1 — A\n**Status:** done\n");
        let cards = Cards::new();

        let first = cards.get("p", &r);
        // Change disk behind the cache; a cached read must not notice.
        with_milestones(&r, "### M1 — A\n**Status:** blocked\n");
        let second = cards.get("p", &r);

        assert_eq!(first, second, "the cache should not re-read per call");
    }

    #[test]
    fn refresh_picks_up_a_change() {
        let r = repo("refresh");
        with_milestones(&r, "### M1 — A\n**Status:** done\n");
        let cards = Cards::new();
        cards.get("p", &r);

        with_milestones(&r, "### M1 — A\n**Status:** blocked\n");
        let after = cards.refresh("p", &r);

        assert_eq!(after.milestones.milestones[0].state, parse::State::Blocked);
    }

    #[test]
    fn forgetting_a_project_drops_its_card() {
        let r = repo("forget");
        let cards = Cards::new();
        cards.get("p", &r);
        assert_eq!(cards.len(), 1);

        cards.forget("p");

        assert!(cards.is_empty());
    }

    #[test]
    fn cards_are_kept_per_project() {
        let a = repo("multi-a");
        let b = repo("multi-b");
        std::fs::write(a.join("Cargo.toml"), "").unwrap();
        std::fs::write(b.join("go.mod"), "").unwrap();
        let cards = Cards::new();

        assert_eq!(cards.get("a", &a).stack, vec!["Rust".to_string()]);
        assert_eq!(cards.get("b", &b).stack, vec!["Go".to_string()]);
        assert_eq!(cards.len(), 2);
    }
}
