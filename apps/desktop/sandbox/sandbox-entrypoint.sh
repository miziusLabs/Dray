#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$HOME/workspace"

# Seed each Cloud volume from the user's Pi setup without bind-mounting it
# live. This gives the sandbox its extensions, settings and authentication,
# while Pi's token refreshes and session files stay in the Cloud volume.
if [[ -d /run/pi-agent && ! -d "$HOME/.pi/agent" ]]; then
  mkdir -p "$HOME/.pi"
  cp -a /run/pi-agent "$HOME/.pi/agent"
  rm -rf "$HOME/.pi/agent/sessions"
  chmod -R u+rwX "$HOME/.pi/agent"
  if [[ -f "$HOME/.pi/agent/auth.json" ]]; then
    chmod 600 "$HOME/.pi/agent/auth.json"
  fi
fi

# Match Agentsmith's GitHub authentication flow. The token is injected by the
# host for this container only; it is never written to the Pi seed or volume.
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  export GH_TOKEN="$GITHUB_TOKEN"
  gh auth setup-git --hostname github.com
  git config --global url."https://github.com/".insteadOf "git@github.com:"
fi

git config --global --add safe.directory '*'
cd "$HOME/workspace"
exec "$@"
