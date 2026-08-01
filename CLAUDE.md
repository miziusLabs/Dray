# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working practices

**Never commit without asking.** Stage and describe the change, then wait for approval — even for work that is finished and passing tests. The same goes for `git push`, branches, and anything else that rewrites history.

**Comment sparingly.** Aim for roughly 10% of lines, and only where the code cannot speak for itself:

- Write down *why*, not *what*. `// bump seq` on `self.seq += 1` is noise; "the session layer must number synthesized events through this same counter or seq develops gaps" is not.
- Good reasons to comment: a non-obvious wire-format fact, an invariant a future edit could silently break, why a simpler-looking alternative was rejected, a deliberate omission.
- Don't restate the type signature, don't add banner separators (`// ---- helpers ----`), don't leave a doc comment on every field of an obvious struct.
- Prefer one dense sentence over a three-paragraph doc comment. If an explanation is long enough to need paragraphs, it probably belongs in this file or a plan doc.

**Stay out of files being actively edited.** When the user says they're working on something, review and advise but don't rewrite it — a `todo!()` or a missing match arm is work in progress, not a defect to fix.

## What this is

`automedon` is a Tauri 2 desktop app that wraps coding-agent CLIs in a chat UI. It spawns the `claude` binary as a child process, speaks stream-json over its stdin/stdout, parses each output line into a typed Rust enum, and forwards it to a React frontend as a Tauri event.

## Commands

Use **pnpm**, not npm. `tauri.conf.json` hardcodes `pnpm dev` / `pnpm build` as its before-commands. A stale `package-lock.json` sits next to `pnpm-lock.yaml` — ignore it; running `npm install` will desync the tree.

```bash
pnpm tauri dev
```

That is the real entry point — it builds and runs the Rust app and starts Vite via `beforeDevCommand`.

- `pnpm dev` — frontend only, port 1420 (`strictPort: true`, so a busy port is a hard failure, not a fallback). `invoke` calls do nothing in a plain browser, so this is only useful for pure-CSS/layout work.
- `pnpm build` — `tsc && vite build`. `pnpm tauri build` for a bundled app.
- `cd src-tauri && cargo test` — the only tests in the repo (13: parser + event-model compatibility). Single test: `cargo test parses_complex_fixture`.
- `cd src-tauri && cargo check` — fast type check without linking the whole app.

## Architecture: the event pipeline

Messages flow one way out to the CLI and one way back in, and the return path is what most of the Rust code exists to serve. Tracing it end to end:

1. **`src/App.tsx`** calls `invoke("send_msg", {...})` with camelCase keys (`sessionId`, `isNewSession`); Tauri maps them onto the snake_case params of the command in [lib.rs:9](src-tauri/src/lib.rs:9). The frontend mints the session UUID with `crypto.randomUUID()` — Claude Code adopts an id chosen by the app rather than the other way round.
2. **`SessionManager`** ([session.rs](src-tauri/src/session.rs)) owns a `Mutex<HashMap<String, Session>>`. On send it spawns a process for a new session, reuses the live one when present, and re-inits from `--resume` when the id is known but its process is gone.
3. **`claude_code::init`** ([claude_code.rs](src-tauri/src/harness/claude_code/claude_code.rs)) spawns `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`, adding `--session-id` for new sessions or `--resume` for existing ones.
4. Two `tokio::spawn` tasks drain stdout and stderr. Each non-empty stdout line goes through `parser::parse_line` → `Mapper::map` → `app.emit("events", &agent_event)`, with a copy pushed onto `Session.events`.
5. **`src/App.tsx`** listens for `"events"`.

## The normalized event model

Both harnesses map onto one vocabulary in [events/events.rs](src-tauri/src/events/events.rs), so the frontend and the on-disk log never see a raw wire format. Adding a harness means writing one mapper.

Two rules the whole design rests on:

- **`seq` is the ordering key, not `ts`.** Most Claude Code lines have no timestamp. One counter per session, and events the app synthesizes itself (the user's own prompt, which the CLI never echoes back) must be numbered through it too.
- **Deltas are a preview; the committed event wins.** Claude Code sends streamed deltas *and* a finished `assistant` event for the same content, matched by `BlockRef`. Absent deltas are the common case — Codex sends none, Claude Code sends none for subagent output — so consumers must render correctly without them.

Per-harness code lives under `harness/<name>/` with a deliberate seam: `parser.rs` (wire format → its own typed events) and `mapper.rs` (those → `AgentEvent`). A wire-format change touches only the parser; a vocabulary change only the mapper.

Module entry files are named after their directory (`events/events.rs`, `harness/harness.rs`) rather than `mod.rs`, declared with `#[path]`. Only entry files need the attribute.

Prompts travel the other direction as a single JSON line written to the child's stdin ([session.rs:97](src-tauri/src/session.rs:97)).

## Parser conventions

[parser.rs](src-tauri/src/claude_code/parser.rs) is the file most likely to need extending, and it has firm conventions:

- `ClaudeCodeEvent` is an externally-tagged enum on `type` (`#[serde(tag = "type", rename_all = "snake_case")]`). `SystemEvent` and `ResultEvent` nest a **second** tag on `subtype`. Adding a new CLI event means adding a variant at the correct level.
- `stream_event.event` is fully modeled as `StreamFrame`. Every stream enum carries a `#[serde(other)]` catch-all so one unknown frame type doesn't cost the whole line.
- Genuinely volatile payloads (`message`, `usage`) stay as `serde_json::Value`.
- Fields the CLI may omit need `#[serde(default)]`. CamelCase wire fields need an explicit rename — see `permissionMode`, `apiKeySource`, `modelUsage`.
- **Parse failures are swallowed.** `read_stdout` logs to stderr and continues rather than propagating, so a schema mismatch presents as a missing UI update, not an error. Check stderr for `[parse err]` when events go missing. (Better would be emitting an `Error` event — not done yet.)
- `McpServer` and `ApprovalPolicy`/`PermissionMode` are defined once in `events` and re-exported by the parser. Don't reintroduce per-harness copies.

## Test fixtures

Tests use `include_str!` against real captured CLI output under `harness/<name>/fixtures/`:

- `claude_code/fixtures/printed.jsonl` — small smoke fixture.
- `claude_code/fixtures/complex.jsonl` — 176 lines with subagent/task traffic. Assertions hard-code exact counts (177 events, 30 `User`, 29 `TaskProgress`), so editing this file breaks tests by design.
- `codex/fixtures/rollout.jsonl` — a session *replay* log, not the live protocol. Do not write the Codex parser against this.
- `codex/fixtures/live_simple.jsonl`, `live_tools.jsonl` — real `codex exec --json` output, which is what the Codex parser must target: a much simpler item lifecycle (`thread.started`, `item.started`/`item.completed`, `turn.completed`).

To add coverage, follow the same pattern: capture real CLI output, commit it as a fixture, assert against it. Shapes absent from every fixture (Claude Code `thinking` blocks, permission requests) get hand-written tests pinning the documented shape.

## Current state

Several things are deliberately unfinished — don't mistake them for bugs:

- **The UI renders nothing.** The `"events"` listener in `App.tsx` only `console.log`s, and `Chat.tsx` maps over a local `useState` array that is never written to. This is the active seam.
- **`fs.rs` is dead code.** It implements session-index persistence (`SessionIndexItem`, `list_session_by_project`, `append_session_index_item`) against `index.json` in the app data dir, but no Tauri command exposes it and nothing calls it. Two known bugs to fix when reviving it: `list_session` calls `create_dir_all` on the *file* path when `index.json` is missing (creating a directory by that name, permanently breaking writes), and `append_session_index_item` is an unlocked read-modify-write.
- **The mapper is partial.** `system/init` and the stream frames are wired; `assistant`, `user`, `result`, and the subagent/hook system events still fall through to `None`. `turn_id` is always `None` and `ThreadRef.label` is unset (the label needs a `tool_use_id → subagent_type` map from `system/task_started`).
- **Codex is a stub.** `Harness::Codex` parses from the frontend, but `Session::init` bails on it.
- **Model and effort are hardcoded** to `"haiku"` / `"low"` in `App.tsx`.
- **The TS event types are generated, not written.** `ts-rs` derives them from the Rust model into `src/types/events.ts`, which is checked in so the frontend build needs no Rust toolchain. `cargo test` regenerates; never edit the output. Two settings live in `src-tauri/.cargo/config.toml`: the export path, and `TS_RS_LARGE_INT = "number"` because `u64` otherwise becomes `bigint`, which `JSON.parse` never produces.
