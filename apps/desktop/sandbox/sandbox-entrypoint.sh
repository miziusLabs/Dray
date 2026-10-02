#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$HOME/workspace"

# GitHub credentials are restricted to this Cloud container.
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  export GH_TOKEN="$GITHUB_TOKEN"
  gh auth setup-git --hostname github.com
  git config --global url."https://github.com/".insteadOf "git@github.com:"
fi

git config --global --add safe.directory '*'
cd "$HOME/workspace"
exec "$@"
