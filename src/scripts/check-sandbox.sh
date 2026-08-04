#!/usr/bin/env bash
set -euo pipefail

# The agent's sandbox floor (D16, D19, D27) — GIT HUD refuses to start an
# agent session without it. Checked here, before the window even opens,
# instead of only surfacing when a chat session is first started.

case "$(uname -s)" in
  Linux)
    if ! command -v bwrap >/dev/null 2>&1; then
      cat <<'EOF'

bubblewrap (bwrap) not found — the agent's sandbox floor. GIT HUD will not
start an agent session without it (D16, D19): a floor that silently is not
there is worse than no floor.

Install it with your distro's package manager:

    sudo dnf install bubblewrap      # Fedora / Nobara
    sudo apt install bubblewrap      # Debian / Ubuntu
    sudo pacman -S bubblewrap        # Arch

See docs/guides/build-and-run.md for the full setup notes.

EOF
      exit 1
    fi
    ;;
  Darwin)
    if ! command -v sandbox-exec >/dev/null 2>&1; then
      cat <<'EOF'

sandbox-exec not found — the agent's sandbox floor on macOS (D27). This ships
with every macOS install, so its absence here is unexpected rather than a
missing package to install. GIT HUD will not start an agent session without
it: a floor that silently is not there is worse than no floor.

See docs/guides/build-and-run.md and
planning/decisions/2026-08-04-D27-macos-sandbox-floor.md.

EOF
      exit 1
    fi
    ;;
esac
