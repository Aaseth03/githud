# Docs

Documentation for **humans**. Agent-facing context is `CONTEXT.md` files;
architecture contracts are `../planning/architecture/`. Neither belongs here.

## Structure

```text
docs/
├─ CONTEXT.md
├─ guides/
│  ├─ build-and-run.md
│  └─ procedural-assets-inkscape.md
└─ research/
   └─ tts-stt-alternatives.md
```

## Routing

| Path | Contains | When to use |
|---|---|---|
| `guides/` | How to do a thing: build, run, package, debug | Writing or following a procedure |
| `research/` | Evaluations of external options (libraries, services, stacks) not yet a committed decision | Comparing alternatives before a `planning/decisions/` record is written |

## Canonical

[`guides/build-and-run.md`](guides/build-and-run.md) is the **single home for
every build and packaging dependency** — system libraries, Tauri plugins,
sidecars, signing, proven toolchain versions, and known platform issues. When a
dependency is added anywhere in the project, it is recorded there and nowhere
else. Link to it; never mirror it.
