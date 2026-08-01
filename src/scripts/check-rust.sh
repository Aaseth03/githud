#!/usr/bin/env bash
set -euo pipefail

if ! command -v cargo >/dev/null 2>&1; then
  cat <<'EOF'

Rust toolchain not found (cargo is missing) — Tauri needs it to build the app.

Install it with:

    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

Then open a NEW terminal window and confirm it's on PATH:

    command -v cargo

If it's still missing in a new terminal, rustup failed to patch your shell's
startup file (this happens silently, e.g. if that file has bad permissions).
Add this line to ~/.zprofile (zsh) or ~/.bash_profile (bash) yourself:

    . "$HOME/.cargo/env"

See docs/guides/build-and-run.md for the full setup notes.

EOF
  exit 1
fi
