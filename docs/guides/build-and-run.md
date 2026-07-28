# Build and run

**This file is the canonical home for every build and packaging dependency** —
system libraries, Tauri plugins, sidecars, signing. When a dependency is added
anywhere in the project, it is recorded here and nowhere else. Link to this
file; never mirror it.

## Quick start

```bash
cd src
npm install
npm run app          # tauri dev — starts Vite, builds the Rust core, opens the window
```

## Layout

The npm project root is `src/`, not `src/ui/`. React sources live in `src/ui/`;
the Rust core lives in `src/src-tauri/`.

```text
src/
├─ package.json         npm root — Vite, React, Tailwind, Tauri CLI
├─ index.html           loads /ui/main.tsx
├─ vite.config.ts       port 1420, strictPort — Tauri points the webview here
├─ tsconfig*.json       `include: ["ui"]`
├─ ui/                  React + TypeScript
└─ src-tauri/           Rust core, Cargo project
```

## Commands

Run from `src/`.

| Command | Does |
|---|---|
| `npm run app` | Dev: Vite + Rust core + window, with hot reload on both sides |
| `npm run app:build` | Production bundle (AppImage / deb on Linux) |
| `npm run dev` | Vite only, in a browser — no Tauri commands available |
| `npm run build` | Type-check and build the front end only |
| `npm test` | Front-end unit tests (Vitest) |
| `npm run test:core` | Rust unit tests |
| `npm run lint` | oxlint |

The full validation sweep:

```bash
cd src
npm run build && npm test && npm run test:core
cargo test --manifest-path src-tauri/Cargo.toml --test real_root -- --ignored --nocapture
```

The last one is environment-dependent — it scans the real `~/github` — so it is
`#[ignore]`d and never runs by accident.

## Toolchain

| Tool | Version proven on |
|---|---|
| Rust | 1.97.1 (edition 2021, `rust-version = "1.77.2"`) |
| Node | 22.x |
| Tauri | v2 (`tauri` 2.11, `@tauri-apps/cli` ^2) |
| Vite | 8 |
| React | 19 |
| Tailwind | 4, via `@tailwindcss/vite` — no `tailwind.config.js`; the theme is `@theme` in `ui/styles/index.css` |
| Vitest | 3 |

## System dependencies — Linux (Fedora / Nobara)

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
                 librsvg2-devel gtk3-devel
```

`webkit2gtk4.1-devel` is the one that actually matters; without it the Rust
build fails at link time.

**`libappindicator-gtk3-devel` is not required.** It appears in Tauri's generic
Linux instructions but is only needed for a system tray, which GIT HUD does not
have. It is not installed on the dev machine and nothing has asked for it.

## Known issue — WebKitGTK DMABUF on Nvidia

**`npm run app` already sets the fix.** This section explains what it is and why,
so nobody removes it.

On this machine (KDE/Wayland, GeForce RTX 3060 alongside Intel UHD 770),
WebKitGTK's DMABUF renderer cannot allocate a GPU buffer. It fails one of two
ways depending on the backend:

```
Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display.   # native Wayland: no window at all
Failed to create GBM buffer of size 1440x900: Invalid argument           # XWayland: a window that paints nothing
```

The second is the dangerous one — **the process stays alive and the window is
titled correctly, but the content area is solid black.** A liveness check passes
while the app is completely broken.

The fix is one environment variable:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1
```

That alone resolves both symptoms on native Wayland. `GDK_BACKEND=x11` is **not**
required and was a misdiagnosis on first contact — XWayland appeared to help only
because it converted a hard failure into a silent one.

Verified 2026-07-28: with the variable set, `npm run app` renders correctly on
native Wayland. Drop the variable when WebKitGTK or the driver fixes the DMABUF
path; the only cost of keeping it is losing that renderer's acceleration, which
is broken here anyway.

**Lesson worth keeping:** a Tauri process that survives is not evidence that it
renders. Screenshot it.

## Known trap — a stale Vite serves stale UI to a new window

`vite.config.ts` sets `strictPort: true`, so a second `npm run app` **cannot**
bind port 1420 if one is already listening. What happens next is the trap: the
Vite half fails, but Tauri still opens a window pointed at
`http://localhost:1420` — which the *old* server answers, with whatever code it
was serving.

The window looks alive and completely current. It is showing another branch's
frontend against the new Rust binary, and the two disagree in ways that look
exactly like real bugs. Observed 2026-07-28: a mismatch here read as "every
project is being classified wrong" when nothing was wrong at all.

Compounding it, a detached launch (`setsid`, `nohup`, or a backgrounded shell
that exits) leaves the window orphaned to `systemd --user` rather than dying
with its parent, so instances accumulate silently.

Before trusting anything you see in a dev window:

```bash
ps -eo comm --no-headers | grep -cx githud     # expect exactly 1
ss -lptn | grep 1420                           # expect exactly one listener
```

If either is wrong, kill everything and relaunch:

```bash
pkill -x githud
kill "$(ss -lptnH 'sport = :1420' | grep -oP 'pid=\K[0-9]+' | head -1)"
```

`pkill -x` matches the process name exactly — plain `pkill -f githud` also
matches the shell command that contains the word, so it kills the caller.

## Notes

- **Port 1420 is fixed** (`strictPort: true`). A silent port bump would leave
  the webview pointed at nothing, so failing to bind is deliberately loud.
- `src/dist/` and `src/src-tauri/target/` are build output and are gitignored.
- `src/src-tauri/icons/` is the placeholder Tauri icon set. Replace it when the
  app has a real identity; `npm run tauri icon <path>` regenerates every size.
