# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working practices

**Don't commit unprompted.** Stage and describe the change, then wait — even when it's finished and passing. Being asked to commit is the approval, but for that commit only, not the ones after. Same for `git push`, branches, and anything else that rewrites history.

**Comment sparingly.** Aim for roughly 10% of lines, and only where the code cannot speak for itself:

- Write down *why*, not *what*. `// bump seq` on `self.seq += 1` is noise; "the session layer must number synthesized events through this same counter or seq develops gaps" is not.
- Good reasons to comment: a non-obvious wire-format fact, an invariant a future edit could silently break, why a simpler-looking alternative was rejected, a deliberate omission.
- Don't restate the type signature, don't add banner separators (`// ---- helpers ----`), don't leave a doc comment on every field of an obvious struct.
- Prefer one dense sentence over a three-paragraph doc comment. If an explanation is long enough to need paragraphs, it probably belongs in this file or a plan doc.

**Write plainly.** This applies everywhere — chat replies, comments, docs, commit messages, plan files.

- Write simply. No clutter.
- Keep sentences short.
- Use active voice.
- Don't over-explain.
- Don't under-explain when the detail matters.
- Skip fancy words. Technical terms are fine when they're the right word.
- Complex ideas don't need complex sentences.
- Cut any word or sentence that does no work.

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

**Finding the binary.** [binpath.rs](src-tauri/src/binpath.rs) resolves `claude` to an absolute path, cached in a `OnceLock`; both spawn sites go through it. Never go back to `Command::new("claude")` — a bundled `.app` launched from Finder or the Dock inherits launchd's `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), which holds no `claude` however globally it is installed. That makes the bare name work under `pnpm tauri dev` and fail in the bundle, and the CLI never starts so no events arrive at all. Resolution escalates by cost: inherited `PATH`, then the known install dirs (`~/.local/bin`, `~/.claude/local`, `~/.bun/bin`, `~/.npm-global/bin`, Homebrew, globbed nvm version dirs), then `$SHELL -l -c 'command -v claude'`. The `-l` is load-bearing — without it zsh reads `.zshrc` only and misses a `PATH` exported from `.zprofile`, which is where the installers write it. `git` needs none of this: `/usr/bin/git` is present under the minimal `PATH`.

**Worktrees.** `claude -w <name>` puts the tree at `<project>/.claude/worktrees/<name>` on branch `worktree-<name>`. The child must spawn at the **project root** — a directory that doesn't exist yet can't be `chdir`ed into, and the CLI creates the tree and moves itself in after launch. So the spawn dir and the session's recorded `cwd` differ for worktree sessions, and only the latter points at the tree.

## The normalized event model

Both harnesses map onto one vocabulary in [events/events.rs](src-tauri/src/events/events.rs), so the frontend and the on-disk log never see a raw wire format. Adding a harness means writing one mapper.

Two rules the whole design rests on:

- **`seq` is the ordering key, not `ts`.** Most Claude Code lines have no timestamp. One counter per session, and events the app synthesizes itself (the user's own prompt, which the CLI never echoes back) must be numbered through it too.
- **Deltas are a preview; the committed event wins.** Claude Code sends streamed deltas *and* a finished `assistant` event for the same content, matched by `BlockRef`. Absent deltas are the common case — Codex sends none, Claude Code sends none for subagent output — so consumers must render correctly without them.

Per-harness code lives under `harness/<name>/` with a deliberate seam: `parser.rs` (wire format → its own typed events) and `mapper.rs` (those → `AgentEvent`). A wire-format change touches only the parser; a vocabulary change only the mapper.

Module entry files are named after their directory (`events/events.rs`, `harness/harness.rs`) rather than `mod.rs`, declared with `#[path]`. Only entry files need the attribute.

Prompts travel the other direction as a single JSON line written to the child's stdin ([session.rs](src-tauri/src/session.rs)). The same pipe carries `control_request` lines — `set_model` and `set_permission_mode` both switch a running child in place, verified against the CLI. `set_effort` does not exist, and an `effort` field on `set_model` is accepted and ignored, so effort changes require a respawn.

**What can change mid-session.** A control is live only if the CLI has a control request for it; everything deciding *where* the agent runs is fixed at creation, and the composer hides it once a session exists. So model and permission mode apply in place, effort kills and resumes, and project/branch/worktree are creation-time only. That rule is what keeps a `git checkout` from ever running under a live child.

**Permission mode is asymmetric**, and two separate types hold the two directions ([events.rs](src-tauri/src/events/events.rs)). `ApprovalPolicy` is the settable set that `--permission-mode` accepts; `PermissionMode` is what `system/init` reports, which is wider. Verified against v2.1.224 by passing each mode and reading the init event back:

| passed | reported |
|---|---|
| `plan`, `acceptEdits`, `bypassPermissions`, `dontAsk` | itself |
| `auto` | `default` |
| `manual` | `default` |

So `default` is not "no flag was passed" — it is the CLI's own name for the stance `auto` and `manual` both resolve into, and it comes back even when you set something else. `ApprovalPolicy` must therefore never regain a `Default` variant, or an unsettable mode reaches the flag.

The reported value is transcript data only: it reaches `Settings.approval_policy` on a `SessionConfigured` event and nothing reads it back. The index item is what the app stores and displays, written from the user's own pick. Keep it that way — reconciling session state *from* the init event would quietly fail, since `auto` and `manual` are indistinguishable there.

**Git.** [git.rs](src-tauri/src/git.rs) is the only place the app shells out to anything but `claude`. `checkout_branch` validates the name against the branches git just listed — no shell is involved, so injection isn't the risk, but a name starting with `-` would parse as a flag. It runs when the user picks a branch in the composer, not at send: the picker is the only thing that moves the working tree, so by spawn time the repo is already where the session expects it. `dirty` is re-read at pick time rather than reused from the project's initial load, or edits made since would silently skip the confirm.

**A `-w` worktree does not fork from the checked-out branch.** The CLI resolves the repo's default branch, fetches `origin/<it>`, and passes that to `git worktree add --no-track -B` — so the fork point is `origin/main` regardless of what is checked out, and it depends on network state (a failed fetch falls back to local `HEAD`). `worktree.baseRef: "head"` in settings switches this, but the `-w` flag surface exposes no base ref. Hence the composer hides the branch picker in worktree mode and shows the resolved base instead: offering a branch there would promise something the CLI doesn't honour.

**Models.** [models/models.rs](src-tauri/src/models/models.rs) is the single source for the model list, its effort levels, and the defaults; the frontend builds its picker from `list_models` rather than a hardcoded array. Ids are bare aliases (`opus`, not a dated name) so sessions follow the latest model. Haiku has no effort levels — the CLI tolerates `--effort` there and ignores it, so omitting it keeps the persisted value honest rather than avoiding a crash.

## Persistence

Everything lives under `~/.automedon/` ([store.rs](src-tauri/src/store.rs), [projects.rs](src-tauri/src/projects.rs)):

- **`sessions/<session-id>.jsonl`** — one mapped `AgentEvent` per line, append-only. Single writer per file, so `O_APPEND` alone is enough; no lock. On resume, `next_seq_by_session_id` tail-reads the last line to continue the counter.
- **`sessions/index.json`** — one `SessionIndexItem` per session, holding both `cwd` (where the agent runs) and `project_path` (the repo root, used as the grouping key so worktree sessions still list under their project). Rewritten whole, so it takes a process-wide lock and lands via write-temp + `rename`.
- **`projects.json`** — the attached projects and which was last selected. Its own file and its own lock, because it shares none of the index's semantics. Paths are canonicalized at attach time; without that, `/x/proj` and `/x/proj/` become two projects and split the sidebar's grouping.

The asymmetry is the point: appending to a private file is atomic, rewriting a shared one is not.

`cwd` on the index is authoritative on resume — `send_msg` reads it rather than trusting the caller's argument, since the project picker makes the two able to disagree and resuming in the wrong directory is silent.

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

## Rendering code

Every surface that shows code — the `Edit` diff, the ranged `Read` slice, and markdown code blocks — goes through **one** Shiki highlighter, the shared instance inside `@pierre/diffs`. That single instance is the whole design:

- [DiffView](src/components/chat/DiffView.tsx) renders a `file_edit` call's two sides via `FileDiff`.
- [CodeView](src/components/chat/CodeView.tsx) renders a ranged `file_read` via `File`.
- [codePlugin.ts](src/lib/codePlugin.ts) is a Streamdown `code-highlighter` backed by the same instance, replacing `@streamdown/code`'s runtime (the package survives as a type-only import).

Sharing it is not just deduplication. The stock Streamdown plugin builds a *second* Shiki with its own theme and grammar registries — which both duplicates grammar loading (the slowness) and cannot see `pierre-*` at all, failing with "Theme `pierre-light` is not included in this bundle".

**Themes are `{light, dark}` pairs, never one name** ([codeTheme.ts](src/lib/codeTheme.ts)). The app's mode can change under a mounted view — `system` follows the OS — and a dark syntax theme on a light page is unreadable. The user picks one entry; the resolved mode picks a side. [useCodeTheme](src/hooks/useCodeTheme.ts) is a `useSyncExternalStore` rather than `useLocalStorage` because several diffs and code blocks are mounted at once and per-component state would desync them.

Three failure modes, all of which present as *code that renders but is blank or grey* rather than as an error:

- **A view must not mount before *its own* language and theme are attached.** `FileDiff`/`File` kick off their own load when they hydrate without one, then drop the promise and never re-render — so a premature mount paints an empty or unhighlighted `<pre>` and stays that way until something remounts it. [useHighlighter](src/hooks/useHighlighter.ts) is the single gate both views use, and it checks `getLoadedThemes()`/`getLoadedLanguages()` for the specific pair and language. Do not gate on `isHighlighterLoaded()`: it only reports that the *instance* exists, so a view whose grammar is still loading mounts the moment any other view has warmed the highlighter, and renders grey until it is collapsed and expanded again.
- **Themes and grammars load independently.** Tokenizing with the theme unattached returns every token with an empty style; tokenizing with the *grammar* unattached silently yields one plain-text token per line. `codePlugin` therefore checks `getLoadedThemes()` *and* `getLoadedLanguages()` and reports not-ready instead of caching either result — caching the plain-text fallback is what left blocks permanently grey.
- **A fence's info string is a language id, not a filename.** `getFiletypeFromFileName` maps *extensions*, so it turns `typescript` and `rust` into `text` while only `ts` happens to work. Use it for a path (`CodeView`, `DiffView`), never for a fence tag.

`File` numbers a file from 1 and exposes no starting-line option, so `CodeView` rewrites the gutter in `onPostRender` — which hands back the *host* element, whose rows live in its shadow root. Padding the content with blank lines also works and then collapses: an `offset` of 420 renders 419 empty rows.

**`+N -M` comes from the library's hunks, not a hand-rolled scan.** `countChanges` parses the diff and sums `hunk.additionLines`/`deletionLines` so the collapsed row can never disagree with the diff it opens. A prefix/suffix scan looks equivalent and isn't: `Edit` fragments usually arrive without a trailing newline, so the diff algorithm treats the boundary line as changed on both sides — appending two lines to `"a\nb"` renders as `+3/-1`, not the `+2/-0` a scan reports.

**Where the time goes.** Tokenizing is not the cost — measured in the app, an already-attached language is 0ms. What varies is the per-language grammar chunk, and the spread is wide: the entire `COMMON_LANGS` set attaches in **~54ms** batched (the library parallelises the loaders), while **Ruby alone is ~390ms**, since it drags in HTML, CSS, JS and SQL for its embedded syntaxes.

That spread is why `warmHighlighter` preloads a *named list* rather than everything or nothing. `COMMON_LANGS` in [useHighlighter.ts](src/hooks/useHighlighter.ts) is the set this app is actually used on (TS/TSX, JS/JSX, Python, JSON, CSS, HTML, Markdown, YAML, Bash, Rust, Go, SQL, TOML) — cheap enough to pay for once at startup, off the critical path, and it means opening a diff or a read is instant for essentially every file that comes up. Keep it that way: it is not a "preload everything" list, and adding a Ruby-shaped grammar to it would cost more than the whole current set. Anything absent still loads lazily on mount and pays only its own grammar, rendering *unhighlighted but readable* text meanwhile rather than an empty frame — a blank box for 400ms reads as a stall.

## Current state

Several things are deliberately unfinished — don't mistake them for bugs:

- **The UI is still the active area.** The sidebar, transcript, and composer toolbar are built; the `+` attachment button in the toolbar is inert, and there's no project *management* beyond attach (no rename, no detach from the UI).
- **Only a *ranged* `Read` renders its code, and a whole-file read has no expander at all.** A successful whole-file read is a dead end on purpose — no diff, no code, no arguments, and its result is the file itself — so the row collapses to the tool name and the path with nothing to open. That read is the agent pulling a file into context, not showing it to the reader. The range comes from the call's own `offset`/`limit`; there is no line-range argument to read it from. A *failed* read still expands, since its error text is the only place the reason lives.
- **The code theme has no picker yet.** `CODE_THEMES` and `setCodeTheme` are the settings surface's whole contract; nothing calls the setter today, so the default is what everyone sees.
- **The mapper is partial.** `assistant`, `user`, `result`, `system/init`, tasks, and the stream frames are wired; the remaining system events fall through to `None`. `turn_id` is always `None` and `ThreadRef.label` is unset (the label needs a `tool_use_id → subagent_type` map from `system/task_started`).
- **Codex is a stub.** `Harness::Codex` parses from the frontend, but `Session::init` bails on it.
- **The composer toolbar is the session's control surface.** [composer/](src/components/composer) holds one component per control; `ComposerToolbar` hides project, branch, and the worktree toggle once a session exists. `ChatInput` takes the row as a `ReactNode` so it keeps owning layout and measurement and nothing else — including the row's own spacing from the card, since only `ChatInput` knows which side of it the row sits on.
- **`isNewTask` is the composer's two presentations, not one flag per effect.** Before a session exists the composer stands alone mid-window with nothing behind it, so [ChatInput](src/components/ChatInput.tsx) drops the card's fill, border, and padding, moves the toolbar above the input, swaps the placeholder, and replaces the send button with a "Press ⏎ to send" hint. Dropping the button is safe only because Enter-to-send lives in `onKeyDown` rather than in that button being the form's submitter — make it the submitter again and the empty state loses its send path. `AppShell` has its own `centered` prop for the surrounding geometry; the two travel together but mean different things. Horizontal alignment in this state is hand-tuned to a single edge: the toolbar's `-ml-2.5` cancels its `px-1` plus the ghost button's 6px icon inset so the `+` *glyph* lands on the text edge, not the button box. Change that button's size or variant and the offset has to move with it.
- **The TS event types are generated, not written.** `ts-rs` derives them from the Rust model into `src/types/events.ts`, which is checked in so the frontend build needs no Rust toolchain. `cargo test` regenerates; never edit the output. Two settings live in `src-tauri/.cargo/config.toml`: the export path, and `TS_RS_LARGE_INT = "number"` because `u64` otherwise becomes `bigint`, which `JSON.parse` never produces.

## Known issues

Diagnosed defects, not yet fixed. Unlike *Current state* above, these are broken rather than unbuilt. Delete the entry when you fix it.

- **`modified` only updates on send.** The AI side has no completion signal yet, so it reads as "last time the user typed" rather than last activity.
- **Changing effort respawns the child.** The CLI has no `set_effort` control request (`set_model` exists and works), so the session is killed and resumed by id. Harmless today — the respawn happens inside `send_msg`, which only runs when the user types, so no turn is in flight. Revisit when queued/mid-turn messages land.
- **Worktree paths are computed, not verified.** `worktree_path()` joins the convention instead of reading `init`'s `cwd`. Correct as of now; reading it back isn't worth it — `init` fires repeatedly, so each would need a re-write plus dedup.
- **`Session.status` never leaves `"in_progress"`** — the `result` event that should advance it isn't mapped.
