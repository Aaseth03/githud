# Src

The Tauri application, split into two workspaces below. **Read the one you are
changing, not both** — the split exists because most changes touch one side.
If your change crosses the wire between them, read
[`lessons/boundary.md`](lessons/boundary.md) either way.

## Structure

```text
src/
├─ CONTEXT.md
├─ package.json            npm root — Vite, React, Tailwind, Tauri CLI
├─ package-lock.json
├─ index.html              loads /ui/main.tsx
├─ vite.config.ts          port 1420, strictPort
├─ tsconfig.json
├─ tsconfig.app.json       include: ["ui"]
├─ tsconfig.node.json
├─ .oxlintrc.json
├─ .gitignore
├─ scripts/
│  ├─ check-rust.sh        preflight: is cargo on PATH, with install steps if not
│  └─ check-sandbox.sh     preflight: is the sandbox floor present for this OS (D16, D27)
├─ lessons/                the rules that bite, split by what they constrain — shared by both workspaces below
│  ├─ boundary.md          the Rust↔TS wire
│  ├─ process.md           processes, sessions, lifetime
│  ├─ webview.md           WebKitGTK and its silent failures
│  ├─ voice.md             Voicebox, speech, capture
│  ├─ character.md         motion, and the audio it moves to
│  └─ ui.md                state ownership
├─ ui/                     React UI — its own CONTEXT.md
└─ src-tauri/              Rust core — its own CONTEXT.md
```

## Routing

| I need to… | Go to |
|---|---|
| Write, change, or debug the React UI | [`ui/CONTEXT.md`](ui/CONTEXT.md) |
| Write, change, or debug the Rust core (Tauri commands, PTY, git, agent adapters, guardrails) | [`src-tauri/CONTEXT.md`](src-tauri/CONTEXT.md) |
| Build, run, or package the app | `../docs/guides/build-and-run.md` |
| Change the cargo-on-PATH preflight | `scripts/check-rust.sh` |
| Change what the app refuses to launch without | `scripts/check-sandbox.sh` |

`lessons/` has no `CONTEXT.md` of its own — it is shared reference material, not
a workspace. Each side's `CONTEXT.md` links to the one file in here that
constrains what you're touching; do not read all six.
