# Architecture: data layout

**Canonical for what is committed and what is not.** The split exists to make
sync conflicts impossible by construction rather than by resolution (D8).

## Committed and synced — this repo

```text
githud/
└─ config/
   ├─ projects.toml              declared overrides only, never a project list
   ├─ characters/<name>.toml     sprite set, voice id, theme
   ├─ sessions-index.jsonl       append-only session summaries
   └─ contracts/milestones.md    the cross-project milestone format
```

## Local state — never synced, never committed

```text
~/.local/share/githud/
├─ registry.json                 scan results — derived, regenerated at will
├─ sessions/<id>.jsonl           raw transcripts, N-day retention
├─ machine.toml                  adapter availability + per-machine overrides
└─ shim/{git,gh,rm,sudo}         guardrail wrappers
```

## Why each side is where it is

- **The registry is scanned, not declared** (D10). It is derived state, so it is
  always current, and because it is never committed, a registry conflict between
  two machines is not merely unlikely — it is structurally impossible. Only
  *overrides* are declared, and those live in `config/projects.toml`.
- **`sessions-index.jsonl` is append-only JSONL specifically so two machines
  writing it produce a union, not a conflict.** Never rewrite a line; never sort
  the file in place.
- **Raw transcripts stay local** (D12). They are large, they decay fast, and they
  quote file contents. The index is small and safe to sync.
- **`machine.toml` is per-machine by definition.** Adapter availability is a
  property of the hardware in front of you.
- **The shim is generated, not committed.** Its *source* lives in `ops/`; the
  executable wrappers are written into local state at startup so an out-of-date
  checkout cannot leave a stale guard on `PATH`.

## Characters are central, not per-repo

D9. A character profile lives here, not in the project it represents, so that
adding a character to GIT HUD never pollutes another repo. Revisitable later if
per-repo characters earn their keep.

## Project card caching

D11. A project's card — stack, branch, dirty files, last commit, milestone
progress — is read **once at registration** and cached into `registry.json`. The
UI reads a struct; it never parses prose at runtime. Re-read happens on
filesystem change, not per frame.
