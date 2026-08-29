<h1 align="center">
  <br>
  Dray
  <br>
</h1>

<h4 align="center">A desktop home for your coding agents.</h4>

<p align="center">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white">
  <img alt="Version" src="https://img.shields.io/badge/version-0.7.4-blue?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-6B4EFF?style=flat-square">
</p>

## Overview

Dray wraps coding-agent CLIs in a native chat UI, giving you a desktop home for running and managing coding-agent sessions. The current harness integrates with [Pi](https://github.com/badlogic/pi-mono).

> This project is a fork of [monorepo-labs/dray](https://github.com/monorepo-labs/dray).

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE).

## Features

- Persistent multi-session workspace with search, pinning, settling, forks, nested sessions, unread/waiting state, and desktop notifications.
- Local Sessions inside attached projects, with project and Git branch switching.
- Isolated Cloud Sessions that run Pi in Docker with their own persistent workspace volume.
- Model and reasoning/effort controls, configurable permission modes, context usage, queued follow-ups, and generated session titles.
- Rich chat transcripts with Markdown, syntax highlighting, reasoning, tool calls, file edits, diffs, subagents, background tasks, images, permission requests, and structured questions.
- File/image attachments, drag and drop, `@file` fuzzy search, `/commands`, and `$skills` discovered from Pi.
- Repository Changes view for uncommitted work, commit history, file lists, and highlighted diffs.
- Turn-scoped change tracking backed by Git snapshots, so completed-turn diffs stay stable after later edits.
- Git handoff actions for commit, push, and pull-request workflows.
- GitHub pull request panel through `gh`, including checks, comments/reviews, draft/ready state, reopen, and merge controls.
- Themes, native window integration, keyboard shortcuts, sounds, notices, and safe quit handling while work is active.

## Tech stack

- [Tauri](https://tauri.app/) 2 with a Rust backend
- [React](https://react.dev/) 19 and [Vite](https://vite.dev/) 7
- [Tailwind CSS](https://tailwindcss.com/) v4
- [pnpm](https://pnpm.io/) workspace

## Layout

| Path           | What                                                          |
| -------------- | ------------------------------------------------------------- |
| `apps/desktop` | The Tauri app. React 19 + Vite frontend, Rust backend.        |
| `packages`     | Shared code. Empty until something is genuinely wanted twice. |
| `AGENTS.md`    | Detailed architecture, component, feature, and agent guide.   |

## Development

Install dependencies from the root. The lockfile covers the whole workspace.

```sh
pnpm install
```

Start the app from the root.

```sh
pnpm app           # desktop app (Tauri + Vite), with hot reload
pnpm app:no-watch  # desktop app without frontend or backend auto-reload
```

Commands beyond starting an app should be run from its own directory, because
`tauri.conf.json`, `.cargo/config.toml`, and `scripts/install.ps1` resolve their
paths against it:

```sh
cd apps/desktop && pnpm tauri build
cd apps/desktop/src-tauri && cargo test
```

## Cloud sandbox

Cloud Sessions run Pi in Docker without mounting or cloning the selected project.
The sandbox image includes Java 21, Java 25, Node.js 24, GitHub CLI, and Pi.
Pi's host `~/.pi/agent` directory is mounted read-only as a seed so extensions,
settings, and authentication are available without sharing session history.
GitHub authentication follows Agentsmith: `GITHUB_TOKEN` is passed only to the
container and the entrypoint exports it as `GH_TOKEN`, runs `gh auth setup-git`,
and rewrites SSH GitHub URLs to HTTPS.

Build the image locally (Docker Desktop must be running):

```sh
pnpm build:sandbox
```

The build runs from the host on Windows, macOS, and Linux. On Windows it uses
the same Docker daemon (Docker Desktop's WSL 2 backend) that Cloud Sessions
run on, so no separate WSL setup is needed — the image is built where it will
be used.

Use `DRAY_CLOUD_IMAGE` to select a different image tag and `GITHUB_TOKEN` (or a
logged-in `gh`) to provide the token passed to Cloud containers.

## Releasing the app

Tag `vX.Y.Z`. The version in the tag has to match
`apps/desktop/src-tauri/tauri.conf.json`. Release notes are generated from the
commits included in the release.
