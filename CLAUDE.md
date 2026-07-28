# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`ade` is a Tauri 2 desktop app that wraps coding-agent CLIs in a chat UI. It spawns the `claude` binary as a child process, speaks stream-json over its stdin/stdout, parses each output line into a typed Rust enum, and forwards it to a React frontend as a Tauri event.

## Commands

Use **pnpm**, not npm. `tauri.conf.json` hardcodes `pnpm dev` / `pnpm build` as its before-commands. A stale `package-lock.json` sits next to `pnpm-lock.yaml` — ignore it; running `npm install` will desync the tree.

```bash
pnpm tauri dev
```

That is the real entry point — it builds and runs the Rust app and starts Vite via `beforeDevCommand`.

- `pnpm dev` — frontend only, port 1420 (`strictPort: true`, so a busy port is a hard failure, not a fallback). `invoke` calls do nothing in a plain browser, so this is only useful for pure-CSS/layout work.
- `pnpm build` — `tsc && vite build`. `pnpm tauri build` for a bundled app.
- `cd src-tauri && cargo test` — the only tests in the repo (5 parser tests). Single test: `cargo test parses_complex_fixture`.
- `cd src-tauri && cargo check` — fast type check without linking the whole app.

## Architecture: the event pipeline

Messages flow one way out to the CLI and one way back in, and the return path is what most of the Rust code exists to serve. Tracing it end to end:

1. **`src/App.tsx`** calls `invoke("send_msg", {...})` with camelCase keys (`sessionId`, `isNewSession`); Tauri maps them onto the snake_case params of the command in [lib.rs:9](src-tauri/src/lib.rs:9). The frontend mints the session UUID with `crypto.randomUUID()` — Claude Code adopts an id chosen by the app rather than the other way round.
2. **`SessionManager`** ([session.rs:14](src-tauri/src/session.rs:14)) owns a `Mutex<HashMap<String, Session>>`. On send it spawns a process for a new session, reuses the live one when present, and re-inits from `--resume` when the id is known but its process is gone.
3. **`claude_code::init`** ([claude_code.rs:16](src-tauri/src/claude_code.rs:16)) spawns `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`, adding `--session-id` for new sessions or `--resume` for existing ones.
4. Two `tokio::spawn` tasks drain stdout and stderr. Each non-empty stdout line goes through `parser::parse_line`, then `app.emit("events", &value)` broadcasts it to the frontend, with a copy pushed onto `Session.events`.
5. **`src/App.tsx:62`** listens for `"events"`.

Prompts travel the other direction as a single JSON line written to the child's stdin ([session.rs:97](src-tauri/src/session.rs:97)).

## Parser conventions

[parser.rs](src-tauri/src/claude_code/parser.rs) is the file most likely to need extending, and it has firm conventions:

- `ClaudeCodeEvent` is an externally-tagged enum on `type` (`#[serde(tag = "type", rename_all = "snake_case")]`). `SystemEvent` and `ResultEvent` nest a **second** tag on `subtype`. Adding a new CLI event means adding a variant at the correct level.
- Volatile or deeply-nested payloads stay as `serde_json::Value` (`message`, `usage`, `event`) rather than being modeled out.
- Fields the CLI may omit need `#[serde(default)]`. CamelCase wire fields need an explicit rename — see `permissionMode`, `apiKeySource`, `modelUsage`.
- **Parse failures are swallowed.** `read_stdout` logs them to stderr and continues rather than propagating ([claude_code.rs:100](src-tauri/src/claude_code.rs:100)). A schema mismatch silently drops that event, so a struct field that doesn't match the wire format presents as a missing UI update, not an error. Check stderr for `[parse err]` when events go missing.

## Test fixtures

Tests use `include_str!` against real captured CLI output in `src-tauri/src/claude_code/`:

- `claude_code_printed.jsonl` — small smoke fixture.
- `claude_code_complex.jsonl` — 176 lines with subagent/task traffic. Assertions hard-code exact counts (177 events, 30 `User`, 29 `TaskProgress`), so editing this file breaks tests by design.
- `codex_response.jsonl` — captured Codex output; nothing parses it yet.

To add parser coverage, follow the same pattern: capture real CLI output, commit it as a fixture, assert against it.

## Current state

Several things are deliberately unfinished — don't mistake them for bugs:

- **The UI renders nothing.** The `"events"` listener in `App.tsx` only `console.log`s, and `Chat.tsx` maps over a local `useState` array that is never written to. This is the active seam.
- **`fs.rs` is dead code.** It implements session-index persistence (`SessionIndexItem`, `list_session_by_project`, `append_session_index_item`) against `index.json` in the app data dir, but no Tauri command exposes it and nothing calls it.
- **Codex is a stub.** `Harness::Codex` parses from the frontend, but `Session::init` bails on it ([session.rs:90](src-tauri/src/session.rs:90)).
- **Model and effort are hardcoded** to `"haiku"` / `"low"` in `App.tsx`.
- **`src/types/events.type.ts` is empty** — the TS mirror of the Rust event enum hasn't been written, so frontend event handling is currently untyped.
