# Dray project guidance

Dray is a Tauri 2 desktop app for coding-agent sessions. The desktop frontend uses React and Vite. Its Rust backend starts agent CLIs, maps their output into Dray's event model, and stores session history. The repository also contains the `dray` CLI, its shared protocol crate, a marketing site, public docs, and an iOS client.

The canonical repository is [miziusLabs/Dray](https://github.com/miziusLabs/Dray).

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/desktop` | Tauri desktop app, React frontend, and Rust backend |
| `apps/cli` | Standalone `dray` command line client |
| `crates/dray-proto` | Wire types shared by the CLI and app |
| `apps/web` | Next.js marketing site and public install scripts |
| `apps/docs` | Public documentation site |
| `apps/ios` | SwiftUI client for `dray-serve` |

The root is a pnpm workspace with one `pnpm-lock.yaml`. Keep application dependencies in their app package. Run `pnpm install` from the root. The root package scripts are thin aliases for app commands.

## Build and development

- `pnpm app` starts the desktop app.
- `pnpm test` runs the desktop frontend tests.
- `pnpm web` starts the marketing site.
- Run `pnpm tauri build` from `apps/desktop` to bundle the desktop app.
- Run Rust commands from `apps/desktop/src-tauri` or `apps/cli`, as appropriate.
- `cargo test` in `apps/desktop/src-tauri` regenerates the TypeScript event types in `apps/desktop/src/types`. `ts-rs` exports only types reached by a test run, so a filtered run can produce a partial file. Follow it with the full `cargo test` command.
- The headless server is a separate build. Core changes must also compile with `cargo check --no-default-features --features serve --bin dray-serve` in `apps/desktop/src-tauri`.

## Design references

Read [the desktop design guide](apps/desktop/DESIGN.md) before changing the desktop visual language, window chrome, or shared panel patterns. It records the app's visual rules and platform details.

Read [the server plan](apps/desktop/SERVE-PLAN.md) before changing the remote server protocol or transport. Read [the iOS plan](apps/ios/PLAN.md) before changing the iOS client. The iOS app has hand-written Codable types for the `dray-serve` protocol, so wire changes may require matching client changes.

The web app and desktop app share visual direction but do not share code. Keep their imports and build steps separate unless a component is deliberately moved into a shared package.

Public docs use Blume under `apps/docs/content`. Blume builds with the `/docs` base path, while the site rewrite in `apps/web/next.config.ts` removes that prefix before forwarding the request. Keep the base path, rewrite, and content root in sync.

## Event and session architecture

The desktop frontend calls backend commands through `apps/desktop/src/lib/transport.ts`. The Rust session manager starts or resumes an agent process. Harness-specific parsers and mappers convert each agent's wire format into the normalized event types in `apps/desktop/src-tauri/src/events/events.rs`. The backend appends events to the session log and forwards them to the frontend.

Keep harness parsing and mapping under `apps/desktop/src-tauri/src/harness/<harness>/`. The frontend and persisted logs use Dray's normalized event model, not a harness's raw message format. `seq` orders events within a session. Streaming deltas are previews; committed events remain the source of truth, so rendering must work when a harness sends no deltas.

The core can run inside the Tauri app or as the headless `dray-serve` binary. The default `desktop` feature includes Tauri and desktop integrations. The opt-in `serve` feature builds the headless server. Keep shared session and protocol logic independent of Tauri so both entry points can use it.

The CLI and app also share types through `crates/dray-proto`. Changes to `dray-serve` commands or event payloads may need updates in that crate and in `apps/ios`.

Production UI code uses `invoke` and `listen` from `apps/desktop/src/lib/transport.ts`. Use its `fileSrc` helper for local and remote files so each path uses the right asset or server route.

Use `apps/desktop/src-tauri/src/binpath.rs` to resolve agent executables. A desktop app may not inherit the user's interactive shell path, so spawning a bare CLI name can fail after a successful development run.

`DRAY_HOME` selects one server's session data and socket. In development worktrees, `store::config_dir` points projects, settings, and credentials at shared development config while session state stays per server. Keep those paths distinct so two development servers do not resume the same session.

After a remote connection drops, the client rebuilds the transcript from the event log and refreshes transient state from the server's `live_state` frame. Keep persisted events in the log and state that cannot be replayed there in `serve.rs`'s live state.

Streaming deltas are previews held outside React state and published once per animation frame. A committed event replaces its preview. Keep the transcript correct when a harness sends no deltas.

## Release workflows

Desktop releases use `vX.Y.Z` or `vX.Y.Z-beta.N` tags. The tag must match `apps/desktop/src-tauri/tauri.conf.json`. Stable releases also need a matching entry in `apps/desktop/CHANGELOG.md`.

CLI releases use `cli-vX.Y.Z` or `cli-vX.Y.Z-beta.N` tags. The version must match `apps/cli/Cargo.toml`. The CLI workflow packages platform binaries and checksums for GitHub Releases.

The Windows CI workflow builds the desktop app on `windows-latest`. Desktop tag releases build the Windows NSIS installer with `apps/desktop/src-tauri/tauri.windows.conf.json`.
