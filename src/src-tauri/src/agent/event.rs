//! The normalized agent event stream.
//!
//! `planning/architecture/event-schema.md` is canonical for this vocabulary;
//! this file implements it. **The UI subscribes to these and to nothing else** —
//! it must never see a harness's own JSON. That is what makes D2 work: a second
//! adapter changes only its own mapping.

use serde::{Deserialize, Serialize};

/// What the agent is doing right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Activity {
    Thinking,
    Working,
    Idle,
}

/// One event in the normalized stream.
///
/// `tag`/`content` shape so TypeScript can discriminate on `type`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    SessionStarted {
        session_id: String,
        project: String,
        adapter: String,
        model: String,
    },
    /// A chunk of assistant prose. `final` closes the message.
    AssistantText {
        text: String,
        #[serde(rename = "final")]
        is_final: bool,
    },
    /// A tool the agent invoked.
    ///
    /// `detail` is the human-readable target — the real file path where there
    /// is one. This is what lets the status line say `reading src/main.rs`
    /// instead of inventing a word.
    ToolCall {
        id: String,
        name: String,
        detail: Option<String>,
    },
    ToolResult {
        id: String,
        ok: bool,
        detail: Option<String>,
    },
    Status {
        state: Activity,
        detail: Option<String>,
    },
    Error {
        message: String,
        fatal: bool,
    },
    /// Something the harness did that is worth saying out loud rather than
    /// leaving silent — a command's effect, not a status blip. Unlike
    /// `Status.detail`, this must survive to the next event: a `/clear`
    /// reported this way and then immediately overwritten by the next
    /// `Status` in the same turn would never be seen at all.
    Notice {
        text: String,
    },
    /// The **session** ended — not a turn.
    ///
    /// A harness that reports the end of a turn must not produce this, or the
    /// UI will tear down a session that is still alive and still has context.
    SessionEnded {
        reason: String,
    },
    /// A turn finished; the session remains open and ready for the next message.
    TurnEnded {
        stop_reason: Option<String>,
    },
}

impl AgentEvent {
    pub fn error(message: impl Into<String>) -> Self {
        AgentEvent::Error {
            message: message.into(),
            fatal: false,
        }
    }
}
