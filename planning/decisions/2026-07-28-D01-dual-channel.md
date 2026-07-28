# D1 — Dual channel: raw PTY terminal plus a normalized agent event stream

**Date:** 2026-07-28 · **Status:** Committed

## Context
An agent CLI can be consumed two ways: scrape its terminal UI, or consume a
structured output mode. Scraping is tempting because it works with anything.

## Decision
Two channels that never share a process.
- **Channel 1 — Terminal.** `portable-pty` → xterm.js. Zero parsing. Runs
  anything: `sudo`, `htop`, `npm run dev`, or an agent CLI by hand.
- **Channel 2 — Agent.** Subprocess plus line-delimited JSON, normalized by an
  adapter into one event stream.

## Rationale
A TUI is ANSI soup that changes shape every release. Parsing one is the fastest
available route to "nonfunctional." JSON is a contract. Channel 1 costs almost
nothing and buys the thing that makes this a terminal *replacement* rather than a
terminal *alternative* — it works with CLIs that do not exist yet.

## Consequences
- A harness with no JSON mode gets Channel 1 only. That is an acceptable tier.
- The terminal is the user's. The agent's tool calls render read-only in the
  panel; they are never typed into the user's shell.
- Everything downstream subscribes to the event stream, never to adapter output.
  See `../architecture/event-schema.md`.
