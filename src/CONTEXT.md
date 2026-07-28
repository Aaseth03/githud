# Source

The Tauri application. Rust core in `src-tauri/`, React UI in `ui/`.

Before writing code here, read the relevant contract in
`../planning/architecture/`. Those documents are constraints; this directory
implements them and never restates them.

## Structure

```text
src/
├─ CONTEXT.md
├─ package.json            npm root — Vite, React, Tailwind, Tauri CLI
├─ index.html              loads /ui/main.tsx
├─ vite.config.ts          port 1420, strictPort
├─ tsconfig.json
├─ tsconfig.app.json       include: ["ui"]
├─ tsconfig.node.json
├─ .oxlintrc.json
├─ ui/
│  ├─ main.tsx
│  ├─ App.tsx              wires tab rules to events; holds no rules itself
│  ├─ types.ts             mirrors the Rust structs crossing the boundary
│  ├─ tabs.ts              tab semantics, pure
│  ├─ tabs.test.ts
│  ├─ hooks/
│  │  └─ useProjects.ts    calls the scan command; parses nothing
│  ├─ components/
│  │  ├─ Sidebar.tsx
│  │  ├─ TabStrip.tsx
│  │  ├─ IcmBadge.tsx
│  │  ├─ MainView.tsx      the main tab — routes, never acts (D5)
│  │  └─ ProjectView.tsx
│  └─ styles/
│     └─ index.css         Tailwind v4 @theme — there is no tailwind.config.js
└─ src-tauri/
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json
   ├─ capabilities/
   │  └─ default.json
   ├─ icons/               placeholder set from `tauri init`
   ├─ src/
   │  ├─ main.rs           thin entry point
   │  ├─ lib.rs            commands + handler registration
   │  └─ scan/
   │     └─ mod.rs         repo discovery, ICM detection, unit tests
   └─ tests/
      └─ real_root.rs      #[ignore]d — scans the real ~/github
```

## Routing

| Path | Contains | When to use |
|---|---|---|
| `src-tauri/src/scan/` | The walk, ICM detection | Changing discovery rules |
| `src-tauri/src/lib.rs` | Tauri commands | Adding a command the UI can call |
| `ui/tabs.ts` | Tab open/focus/close semantics | Changing tab behaviour |
| `ui/types.ts` | The Rust↔TS boundary types | Any change to a struct that crosses it |
| `ui/components/` | Presentation | UI work |
| `ui/styles/index.css` | Design tokens (`@theme`) | Colours, fonts, the starfield |

## Planned layout

Written down so later milestones do not have to invent it. Update this file
when a module actually lands.

```text
src-tauri/src/
├─ scan/     repo discovery, registry, project cards        (M1 · M5)
├─ pty/      portable-pty sessions — Channel 1              (M2)
├─ agent/    adapters + event normalization — Channel 2     (M3)
├─ git/      status, branch, diff                           (M5)
├─ guard/    bwrap scope + PATH shim generation             (M4)
└─ parse/    milestone parser                               (M5)
```

## Rules that bite here

- **No project workflow knowledge.** This app sets `cwd` and launches a binary.
  If you are writing a rule about how some *other* repo should be worked on, it
  belongs in that repo's ICM files, not here. This is principle 1 and the single
  easiest thing to get wrong in this codebase.
- **Rules live in pure modules, not in components.** `scan/mod.rs` and `tabs.ts`
  are both free of framework types precisely so the behaviour that matters can
  be tested directly instead of by clicking. Keep new rules that way.
- **The two channels never share a process.** PTY and adapter are separate
  supervisors. See `../planning/decisions/2026-07-28-D01-dual-channel.md`.
- **The UI reads structs, never prose.** All parsing happens in Rust. See
  `../planning/decisions/2026-07-28-D11-project-card-cached.md`.
- **Errors surface; they are never swallowed.** A failed scan renders as a
  visible error, not an empty list.
- **Never panic on a user's file.** Any parser handed a malformed file in
  someone else's repo returns a structured error.
- Rust: `snake_case` modules and commands. React: `PascalCase.tsx` components,
  `kebab-case` elsewhere.

## Build and run

`../docs/guides/build-and-run.md` is the canonical home for every build and
packaging dependency — system libs, Tauri plugins, sidecars, signing, and the
known Wayland launch issue. Do not document them here.
