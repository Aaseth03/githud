> **Work in progress.** This project is under active, largely incomplete
> development. Interfaces, behavior, and structure are expected to change
> without notice. See [Status](#status) below for where it currently stands.

# AI Disclosure

This project is developed with substantial involvement from AI systems
(Claude Code and related large language model agents). AI has been used to
draft and modify source code, author planning and architecture documents
(see [`planning/decisions/`](planning/decisions/) and
[`planning/plans/`](planning/plans/)), and, consistent with this project's
own operating principles, to act with reduced or no per-action human
approval within defined guardrails. AI-generated output is subject to human
review before being
merged, but the degree of review varies by change, and no representation is
made that any specific line of code, decision, or document in this
repository was independently verified by a human prior to inclusion.

## No Warranty

THIS SOFTWARE IS PROVIDED "AS IS," WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. THE AUTHOR
MAKES NO REPRESENTATION OR WARRANTY THAT THIS SOFTWARE IS SECURE, FREE OF
DEFECTS OR VULNERABILITIES, RELIABLE, OR FIT FOR USE IN ANY PRODUCTION,
COMMERCIAL, OR SECURITY-SENSITIVE ENVIRONMENT. THIS SOFTWARE EXECUTES
AI-GENERATED CODE AND GRANTS AGENTS FILESYSTEM, PROCESS, AND SHELL ACCESS ON
THE HOST MACHINE. NO AUDIT, PENETRATION TEST, OR FORMAL SECURITY REVIEW HAS
BEEN PERFORMED ON THIS SOFTWARE, AND NONE IS REPRESENTED TO HAVE OCCURRED.

## Limitation of Liability

USE OF THIS SOFTWARE IS ENTIRELY AT YOUR OWN RISK. TO THE MAXIMUM EXTENT
PERMITTED BY APPLICABLE LAW, THE AUTHOR SHALL NOT BE LIABLE FOR ANY CLAIM,
DAMAGES, DATA LOSS, SYSTEM COMPROMISE, OR OTHER LIABILITY, WHETHER ARISING
IN CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH
THIS SOFTWARE OR THE USE OR OTHER DEALINGS IN THIS SOFTWARE, EVEN IF ADVISED
OF THE POSSIBILITY OF SUCH DAMAGES. BY DOWNLOADING, CLONING, RUNNING, OR
OTHERWISE USING THIS SOFTWARE, YOU ACKNOWLEDGE AND ACCEPT THESE TERMS AND
AGREE THAT YOU DO SO ON YOUR OWN TERMS AND AT YOUR OWN RISK.

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
for TTS and Whisper STT (v2).

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

All rights reserved. This repository is public for viewing purposes only
(e.g., portfolio review by prospective employers and collaborators). Public
visibility does not constitute a license grant: no permission is given to
use, copy, modify, merge, publish, distribute, sublicense, or sell copies of
this software, in whole or in part, without the author's prior written
consent. This restriction governs use, modification, and distribution of the
code itself; it does not expand or limit whatever forking or viewing
mechanics GitHub's own Terms of Service grant to users of the platform.
