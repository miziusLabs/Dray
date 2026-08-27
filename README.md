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
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs&logoColor=white">
  <img alt="Version" src="https://img.shields.io/badge/version-0.7.3-blue?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-6B4EFF?style=flat-square">
</p>

## Overview

Dray wraps coding-agent CLIs in a native chat UI, giving you a desktop home for running and managing coding-agent sessions. The repository also includes a Next.js marketing site.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE).

## Features

- Native desktop chat UI for coding-agent CLIs.
- Session management with changes, diffs, pull requests, and isolated Cloud Sessions.
- Attachments, slash commands, themes, and desktop notifications.
- Marketing site with a Next.js App Router frontend.

## Tech stack

- [Tauri](https://tauri.app/) 2 with a Rust backend
- [React](https://react.dev/) 19 and [Vite](https://vite.dev/) 7
- [Next.js](https://nextjs.org/) 15 App Router for the marketing site
- [Tailwind CSS](https://tailwindcss.com/) v4
- [pnpm](https://pnpm.io/) workspace

## Layout

| Path           | What                                                          |
| -------------- | ------------------------------------------------------------- |
| `apps/desktop` | The Tauri app. React 19 + Vite frontend, Rust backend.        |
| `apps/web`     | Marketing site. Next.js App Router, deployed to Vercel.       |
| `packages`     | Shared code. Empty until something is genuinely wanted twice. |

## Development

Install dependencies from the root. The lockfile covers the whole workspace.

```sh
pnpm install
```

Start either app from the root.

```sh
pnpm app           # desktop app (Tauri + Vite), with hot reload
pnpm app:no-watch  # desktop app without frontend or backend auto-reload
pnpm web           # marketing site on :3000
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

## Deploying the site

Deploy to Vercel with **Root Directory** set to `apps/web`. Vercel reads the
workspace lockfile at the repo root on its own; no `vercel.json` is needed.

## Releasing the app

Tag `vX.Y.Z`. The version in the tag has to match
`apps/desktop/src-tauri/tauri.conf.json`, and a release needs a matching
`## X.Y.Z` section in `apps/desktop/CHANGELOG.md` — the workflow fails loudly
on either.
