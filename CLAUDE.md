# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working practices

**Never commit without asking.** Stage and describe the change, then wait for approval — even for work that is finished and passing tests. The same goes for `git push`, branches, and anything else that rewrites history.

**Comment sparingly.** Aim for roughly 10% of lines, and only where the code cannot speak for itself:

- Write down *why*, not *what*. `// bump seq` on `self.seq += 1` is noise; "the session layer must number synthesized events through this same counter or seq develops gaps" is not.
- Good reasons to comment: a non-obvious wire-format fact, an invariant a future edit could silently break, why a simpler-looking alternative was rejected, a deliberate omission.
- Don't restate the type signature, don't add banner separators (`// ---- helpers ----`), don't leave a doc comment on every field of an obvious struct.
- Prefer one dense sentence over a three-paragraph doc comment. If an explanation is long enough to need paragraphs, it probably belongs in this file or a plan doc.
- Write plainly. Short sentences, plain words. No jargon or fancy phrasing where a simple word does the job.

**Stay out of files being actively edited.** When the user says they're working on something, review and advise but don't rewrite it — a `todo!()` or a missing match arm is work in progress, not a defect to fix.

**`///` doc comments show on hover, so add one to every `pub fn` and any non-obvious private fn** — one line, same "why not what" bar as inline comments. Skip trivial helpers/getters where the name says it all.

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
- `cd src-tauri && cargo test` — the only tests in the repo (52: parser + mapper + event-model compatibility). Single test: `cargo test parses_complex_fixture`.
- `cd src-tauri && cargo check` — fast type check without linking the whole app.

## Architecture: the event pipeline

Messages flow one way out to the CLI and one way back in, and the return path is what most of the Rust code exists to serve. Tracing it end to end:

1. **`useSessions`** ([useSessions.ts](src/hooks/useSessions.ts)) calls `invoke("send_msg", {...})` with camelCase keys (`sessionId`, `isNewSession`); Tauri maps them onto the snake_case params of the command in [lib.rs](src-tauri/src/lib.rs). The frontend mints the session UUID with `crypto.randomUUID()` — Claude Code adopts an id chosen by the app rather than the other way round.
2. **`SessionManager`** ([session.rs](src-tauri/src/session.rs)) owns a `Mutex<HashMap<String, Session>>`. On send it spawns a process for a new session, reuses the live one when present, and re-inits from `--resume` when the id is known but its process is gone. New sessions are written to the index before the spawn, so one that fails to start is still visible, and the created `SessionIndexItem` is returned to the frontend — `Some` on creation, `None` on resume — so the resolved worktree name and truncated title come from one source rather than being guessed twice.
3. **`claude_code::init`** ([claude_code.rs](src-tauri/src/harness/claude_code/claude_code.rs)) spawns `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`, adding `--session-id` for new sessions or `--resume` for existing ones, and `-w <name>` on creation for a worktree session.
4. Two `tokio::spawn` tasks drain stdout and stderr. Each non-empty stdout line goes through `parser::parse_line` → `Mapper::map` → `app.emit("agent_event", &agent_event)`, with a copy pushed onto `Session.events` and appended to the session's JSONL.
5. **`useSessions`** listens for `"agent_event"`, routing deltas into `streamingContentBlock` and everything else onto the session's `events`. `Chat.tsx` renders both.

**Worktrees.** `claude -w <name>` puts the tree at `<project>/.claude/worktrees/<name>` on branch `worktree-<name>`. The child must spawn at the **project root** — a directory that doesn't exist yet can't be `chdir`ed into, and the CLI creates the tree and moves itself in after launch. So the spawn dir and the session's recorded `cwd` differ for worktree sessions, and only the latter points at the tree.

## The normalized event model

Both harnesses map onto one vocabulary in [events/events.rs](src-tauri/src/events/events.rs), so the frontend and the on-disk log never see a raw wire format. Adding a harness means writing one mapper.

Two rules the whole design rests on:

- **`seq` is the ordering key, not `ts`.** Most Claude Code lines have no timestamp. One counter per session, and events the app synthesizes itself (the user's own prompt, which the CLI never echoes back) must be numbered through it too.
- **Deltas are a preview; the committed event wins.** Claude Code sends streamed deltas *and* a finished `assistant` event for the same content, matched by `BlockRef`. Absent deltas are the common case — Codex sends none, Claude Code sends none for subagent output — so consumers must render correctly without them.

Per-harness code lives under `harness/<name>/` with a deliberate seam: `parser.rs` (wire format → its own typed events) and `mapper.rs` (those → `AgentEvent`). A wire-format change touches only the parser; a vocabulary change only the mapper.

Module entry files are named after their directory (`events/events.rs`, `harness/harness.rs`) rather than `mod.rs`, declared with `#[path]`. Only entry files need the attribute.

Prompts travel the other direction as a single JSON line written to the child's stdin ([session.rs](src-tauri/src/session.rs)). The same pipe carries `control_request` lines — `set_model` switches a running child's model in place, verified against the CLI. `set_effort` does not exist, and an `effort` field on `set_model` is accepted and ignored, so effort changes require a respawn.

**Models.** [models/models.rs](src-tauri/src/models/models.rs) is the single source for the model list, its effort levels, and the defaults; the frontend builds its picker from `list_models` rather than a hardcoded array. Ids are bare aliases (`opus`, not a dated name) so sessions follow the latest model. Haiku has no effort levels — the CLI tolerates `--effort` there and ignores it, so omitting it keeps the persisted value honest rather than avoiding a crash.

## Persistence

Everything lives under `~/.automedon/sessions/` ([store.rs](src-tauri/src/store.rs)):

- **`<session-id>.jsonl`** — one mapped `AgentEvent` per line, append-only. Single writer per file, so `O_APPEND` alone is enough; no lock. On resume, `next_seq_by_session_id` tail-reads the last line to continue the counter.
- **`index.json`** — one `SessionIndexItem` per session, holding both `cwd` (where the agent runs) and `project_path` (the repo root, used as the grouping key so worktree sessions still list under their project). Rewritten whole, so it takes a process-wide lock and lands via write-temp + `rename`.

The asymmetry is the point: appending to a private file is atomic, rewriting a shared one is not.

## Parser conventions

[parser.rs](src-tauri/src/harness/claude_code/parser.rs) is the file most likely to need extending, and it has firm conventions:

- `ClaudeCodeEvent` is an externally-tagged enum on `type` (`#[serde(tag = "type", rename_all = "snake_case")]`). `SystemEvent` and `ResultEvent` nest a **second** tag on `subtype`. Adding a new CLI event means adding a variant at the correct level.
- `stream_event.event` is fully modeled as `StreamFrame`. Every stream enum carries a `#[serde(other)]` catch-all so one unknown frame type doesn't cost the whole line.
- Genuinely volatile payloads (`message`, `usage`) stay as `serde_json::Value`.
- Fields the CLI may omit need `#[serde(default)]`. CamelCase wire fields need an explicit rename — see `permissionMode`, `apiKeySource`, `modelUsage`.
- **Failures are swallowed, per line.** `read_stdout` logs and continues rather than propagating — one bad line can't kill the loop — so a schema mismatch presents as a missing UI update, not an error. Grep stderr for `[claude parse err]`, `[claude map err]`, `[claude emit err]`, `[claude write err]` when events go missing. (Better would be emitting an `Error` event — not done yet.)
- `McpServer` and `ApprovalPolicy`/`PermissionMode` are defined once in `events` and re-exported by the parser. Don't reintroduce per-harness copies.

## Test fixtures

Tests use `include_str!` against real captured CLI output under `harness/<name>/fixtures/`:

- `claude_code/fixtures/printed.jsonl` — small smoke fixture.
- `claude_code/fixtures/complex.jsonl` — 176 lines with subagent/task traffic. Assertions hard-code exact counts, so editing this file breaks tests by design.
- `claude_code/fixtures/multi_turn.jsonl`, `interrupted.jsonl` — turn boundaries and a mid-turn interrupt.
- `codex/fixtures/rollout.jsonl` — a session *replay* log, not the live protocol. Do not write the Codex parser against this.
- `codex/fixtures/live_simple.jsonl`, `live_tools.jsonl` — real `codex exec --json` output, which is what the Codex parser must target: a much simpler item lifecycle (`thread.started`, `item.started`/`item.completed`, `turn.completed`).

To add coverage, follow the same pattern: capture real CLI output, commit it as a fixture, assert against it. Shapes absent from every fixture (Claude Code `thinking` blocks, permission requests) get hand-written tests pinning the documented shape.

## Current state

Several things are deliberately unfinished — don't mistake them for bugs:

- **The UI is a bare seam.** `Chat.tsx` renders text off a handful of payload types and `ChatInput` sends; there is no session list, project picker, or tool-call rendering. This is the active area.
- **The mapper is partial.** `assistant`, `user`, `result`, `system/init`, tasks, and the stream frames are wired; the remaining system events fall through to `None`. `turn_id` is always `None` and `ThreadRef.label` is unset (the label needs a `tool_use_id → subagent_type` map from `system/task_started`).
- **Codex is a stub.** `Harness::Codex` parses from the frontend, but `Session::init` bails on it.
- **`DEFAULT_CWD` is hardcoded** in `useSessions.ts` — there's no project picker yet. Model and effort now come from `ModelSelector`, backed by `models/models.rs`.
- **The TS event types are generated, not written.** `ts-rs` derives them from the Rust model into `src/types/events.ts`, which is checked in so the frontend build needs no Rust toolchain. `cargo test` regenerates; never edit the output. Two settings live in `src-tauri/.cargo/config.toml`: the export path, and `TS_RS_LARGE_INT = "number"` because `u64` otherwise becomes `bigint`, which `JSON.parse` never produces.

## Known issues

Diagnosed defects, not yet fixed. Unlike *Current state* above, these are broken rather than unbuilt. Delete the entry when you fix it.

- **Sessions load on startup but their events don't.** The sidebar reads `list_session_index_items`, but nothing calls `get_session_by_id`, so selecting an older session shows an empty chat and `sessions` still only holds what this run created.
- **Deltas are persisted and kept in memory.** Filter them from the JSONL and `Session.events`; the committed event supersedes them. Leave `seq` a `u64` — gaps are fine.
- **`modified` only updates on send.** The AI side has no completion signal yet, so it reads as "last time the user typed" rather than last activity.

- **Changing effort respawns the child.** The CLI has no `set_effort` control request (`set_model` exists and works), so the session is killed and resumed by id. Harmless today — the respawn happens inside `send_msg`, which only runs when the user types, so no turn is in flight. Revisit when queued/mid-turn messages land.
- **Worktree paths are computed, not verified.** `worktree_path()` joins the convention instead of reading `init`'s `cwd`. Correct as of now; reading it back isn't worth it — `init` fires repeatedly, so each would need a re-write plus dedup.
- **`Session.status` never leaves `"in_progress"`** — the `result` event that should advance it isn't mapped.
