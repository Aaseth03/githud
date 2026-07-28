# Docs

Documentation for **humans**. Agent-facing context is `CONTEXT.md` files;
architecture contracts are `../planning/architecture/`. Neither belongs here.

## Structure

```text
docs/
├─ CONTEXT.md
└─ guides/          (empty — .gitkeep; build-and-run.md lands at M1)
```

## Routing

| Path | Contains | When to use |
|---|---|---|
| `guides/` | How to do a thing: build, run, package, debug | Writing or following a procedure |

## Canonical

`guides/build-and-run.md` is the **single home for every build and packaging
dependency** — system libraries, Tauri plugins, sidecars, signing. When a
dependency is added anywhere in the project, it is recorded there and nowhere
else. Link to it; never mirror it.

It does not exist yet. It is created at M1, when there is something to build.
