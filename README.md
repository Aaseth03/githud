# GIT HUD

A private desktop app that **replaces the terminal workflow** for AI-assisted
development — one surface where every project in `~/github` is visible,
enterable, and workable by voice or keyboard, with a character to talk to instead
of a prompt to type at.

Terminal-based AI development works, but it is a bad interface for the way the
work actually happens: no overview of what exists, no visible state, no way to
see two projects at once, no face to talk to, and nothing that enforces the
workflow discipline the projects already define. GIT HUD is the layer above — the
place work is chosen, entered, watched, and shipped.

## How it works

It scans `~/github`, presents every repo as an enterable tab, and inside a tab
runs an agent CLI whose output is normalized into a common event stream driving
chat, an activity view, a diff panel, and — from v2 — a speaking character.

Two channels, never sharing a process:

- **Terminal** — `portable-pty` → xterm.js. Zero parsing. Runs anything.
- **Agent** — a subprocess emitting line-delimited JSON, normalized by one
  adapter per harness into a single event stream.

GIT HUD holds **no project workflow knowledge**. It sets `cwd` and launches a
binary; the target project's own ICM context files do all the instructing.

## Stack

Tauri (Rust core) · React + Vite + TypeScript + Tailwind · xterm.js · Voicebox
for TTS and Whisper STT (v2). No Python.

## Status

**v1 is M0–M5**: shell, scan, tabs, embedded terminal, one adapter, streaming
chat, guardrails, panels and project cards. Voice, the character, worktrees, and
a second adapter come after and are the reward.

Roadmap and status: [`planning/milestones.md`](planning/milestones.md).

## For agents

This repo is an ICM workspace — *Interpretable Context Methodology*, folder
structure as agent architecture (arXiv:2603.16021v2).

Read [`AGENTS.md`](AGENTS.md), then [`CONTEXT.md`](CONTEXT.md), then the
`CONTEXT.md` of the one workspace you are working in. Do not read the whole repo.

## License

Private. Not for distribution.
