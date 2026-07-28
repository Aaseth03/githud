# Source

The Tauri application. **Nothing here yet** — M1 scaffolds it.

Before you write code in this directory, read the relevant contract in
`../planning/architecture/`. Those documents are constraints; this directory
implements them and never restates them.

## Structure

```text
src/
└─ CONTEXT.md        (the app is scaffolded at M1)
```

Update this tree in the same change that scaffolds the app.

## Planned layout

Written down so M1 does not have to invent it. Adjust if reality disagrees —
then update this file.

```text
src/
├─ src-tauri/        Rust core
│  └─ src/
│     ├─ scan/       repo discovery, registry, project cards
│     ├─ pty/        portable-pty sessions — Channel 1
│     ├─ agent/      adapters + event normalization — Channel 2
│     ├─ git/        status, branch, diff
│     ├─ guard/      PATH shim generation
│     └─ parse/      milestone parser
└─ ui/               React + Vite + TypeScript + Tailwind
   ├─ components/
   ├─ hooks/
   └─ styles/
```

## Rules that bite here

- **No project workflow knowledge.** This app sets `cwd` and launches a binary.
  If you are writing a rule about how some *other* repo should be worked on, it
  belongs in that repo's ICM files, not here. This is principle 1 and it is the
  single easiest thing to get wrong in this codebase.
- **The two channels never share a process.** PTY and adapter are separate
  supervisors. See `../planning/decisions/2026-07-28-D01-dual-channel.md`.
- **The UI reads structs, never prose.** All parsing happens in Rust, at
  registration, cached. See
  `../planning/decisions/2026-07-28-D11-project-card-cached.md`.
- **Derived state never reaches git.** See
  `../planning/architecture/data-layout.md`.
- **Never panic on a user's file.** Any parser handed a malformed file in someone
  else's repo returns a structured error that surfaces in the Activity panel.
- Rust: `snake_case` modules and Tauri commands. React: `PascalCase.tsx`
  components, `kebab-case` for everything else.

## Build and run

`../docs/guides/build-and-run.md` is the canonical home for every build and
packaging dependency — system libs, Tauri plugins, sidecars, signing. Do not
document them here.
