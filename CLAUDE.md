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
- `cd src-tauri && cargo test` — the Rust tests (131: parser + mapper + event-model compatibility). Single test: `cargo test parses_complex_fixture`.
- `cd src-tauri && cargo check` — fast type check without linking the whole app.
- `pnpm test` — the frontend tests (vitest, node environment, no DOM). Currently [streaming.ts](src/lib/streaming.ts) only: it is the one piece of frontend logic with a wire format to get wrong, and it reads the same committed fixtures the Rust tests do rather than keeping its own captures.

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
- **Deltas are a preview; the committed event wins.** Claude Code sends streamed deltas *and* a finished `assistant` event for the same content, matched by `BlockRef`. Absent deltas are the common case — Codex sends none, Claude Code sends none for subagent output — so consumers must render correctly without them. This holds for tool calls too, but the join is not `BlockRef` — see *A tool call is drawn before its arguments arrive* below.

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

**A permission mode only asks if `--permission-prompt-tool stdio` is on the spawn.** The literal `stdio` is a special case, not a tool name — `--help` documents the flag as taking an MCP tool and doesn't mention this value at all. It's what the Agent SDK passes whenever a `canUseTool` callback is supplied, which is how it was found. Without it the CLI never asks: it auto-denies anything needing approval and reports `system`/`permission_denied`. That is the whole reason `manual` and `plan` looked broken — nothing was wrong with the modes, the channel was simply never opened.

With it on, a held call arrives as `control_request`/`can_use_tool` — the only line that travels *into* the app expecting an answer, and the CLI blocks its turn until a `control_response` carrying that `request_id` comes back. Silence isn't neutral; it stalls the session until the CLI's own deadline. So [permissions.rs](src-tauri/src/harness/claude_code/permissions.rs) exists to guarantee a reply, and an unmodelled control-request subtype is refused from inside `read_stdout` rather than ignored. That is also why the read loop needs the write end: `Session.stdin` is an `Arc<Mutex<ChildStdin>>` shared with it.

The reply double-wraps — the outer `response` is the control-protocol verdict, the inner one the permission decision:

```json
{"type":"control_response","response":{"subtype":"success","request_id":"…",
 "response":{"behavior":"allow","updatedInput":{…},"toolUseID":"…",
             "updatedPermissions":[…]}}}
```

`deny` takes a `message` (returned to the model as the tool's error) and an optional `interrupt` to end the turn outright. A wrongly shaped reply is ignored *silently*, so a regression here presents as a hung turn rather than an error.

**The options the user sees are the CLI's, not ours.** `permission_suggestions` carries pre-composed rules — allow this exact command, add this directory, switch to `acceptEdits` — and `build_options` turns each into a button, bracketed by "Allow once" and "Deny". Two rules hold: a suggestion whose effect can't be stated in a label is dropped rather than shown generically, and `suppress_always_allow_rule` removes the standing-rule button entirely (the CLI sets it where the rule it can compose is broader than the question, so the button would grant more than it says).

The rule never leaves Rust. `PermissionOption` carries an id, a label, and a behavior; the frontend answers with the id alone and the backend resolves it back to the update. Composing a rule from anything the UI holds would put the one durable grant here on the wrong side of the seam.

**A permission request is always main-thread, even when a subagent asked.** `can_use_tool` carries an `agent_id`, and putting it on the event's `Subagent` envelope is wrong twice over: subagent events are filtered out of the chat and rendered in a panel, so the card would be invisible while the agent hung waiting on it, and `agent_id` is the harness's own handle rather than the spawning call's `tool_use_id` this app correlates subagents by — so it would key a run that matches nothing.

**The card renders outside the turn stack**, below the transcript beside the background-task and compacting indicators, from `buildTranscript`'s `pendingAsks` — one list holding both a consent request and a question, since they share a `requestId` space and are retired by the same `permission_decided`. One place serves both threads: a subagent's tool call is filed into the panel, and a main-thread one sits in a turn that collapses once it closes, so *neither* can be relied on to be next to the question. That is also why the card carries the command itself — nothing above it is guaranteed to be on screen. It follows that neither `permission_requested` nor `questions_asked` is in `RENDERS`: they draw no row inside a turn, so counting one would miscount the collapse. And an open request suppresses the thinking indicator, like a compaction does — the turn genuinely draws nothing, but the agent is waiting on the reader rather than working.

**The questionnaire is a `<form>`, and that is what reads the answers back.** [QuestionRequest](src/components/chat/QuestionRequest.tsx) uses shadcn's `questionnaire` (over `@shadcn/react`, zero runtime deps), one question at a time with Previous/Skip/Next/Send. Each item's `name` is the question's own text, so `FormData` hands back a map already keyed the way the CLI matches — no second mapping to drift. `getAll` joins a multi-select into the comma-separated string the wire wants, and the free-text input takes the item's name only when it is the selected answer, so it lands in the same slot a choice would. Nothing is `required`: `QuestionnaireSkip` renders only for an optional question, and skipping is a real answer here. The card is deliberately narrower than the transcript (`max-w-md`) and overrides the component's `min-h-11` touch targets to `min-h-0` — those are a mobile floor, and on a one-word option they are most of the row's height doing nothing. The action row is overridden from the component's three-column grid to a flex row for the same reason: only two of Previous/Skip/Next/Send are ever visible, so the grid sizes itself from a fixed set of tracks holding mostly hidden `inert` cells, where a row is sized by what is actually in it. The free-text box is **not** optional to render — the CLI promises the user one and tells the model not to add an "Other" option because of it, so leaving it out removes an answer the question was written to allow. **Keyboard handling is the form's own**, and fires only when focus is inside it — unlike the window-level shortcuts the consent card tried and dropped. A number picks or toggles an option, arrows move, Enter confirms, ⌘/Ctrl-Enter submits from anywhere in the form; a digit typed into the free-text box stays text.

Two things arm it, and neither is optional. `items` must carry `choices` — the numbers are assigned from *that* array, not from the markup, so a card built without it renders no badges and answers no keys. And the card **takes focus on mount**, onto the first choice rather than the form: Enter only fires when the event target is a choice, so focusing the form leaves it dead. Stealing focus is defensible here and nowhere else in the app — the agent is blocked until this is answered.

`header` is deliberately unrendered. It is a chip-sized label the model writes alongside each question — "Indentation" over "Tabs or spaces?" — which reads as a heading for a section that isn't there and says nothing the question doesn't. The card carries no border or fill either: the choices have their own, and a box around boxes is a third surface.

**A permission request is never written to the log.** It joins deltas and usage updates in the emitted-but-not-persisted set, and its `PermissionDecided` is emitted straight from `Session::respond_permission` without a write. The reason is not volume: a request can only be answered by the child that asked, and no child survives a restart — so a persisted request would come back as a card whose buttons cannot work. Dropping it makes that stale card impossible rather than merely unlikely. Nothing is lost, because the tool call it belongs to *is* persisted and shows the outcome either way. `QuestionsAsked` is dropped on the same reasoning, and there the "nothing is lost" half holds harder — the `AskUserQuestion` result the CLI writes carries both the questions and the answers.

**A tool call with no result is only *pending* while something could still produce one.** `buildTranscript` takes `live` (the session's `busy`) and files an `ABANDONED` stand-in into `resultByCallId` for every call the log leaves open — which is why one line fixes every surface at once, since the collapsed row, the group header, and the shimmer all read pending-ness from that map. Without it a call caught mid-flight by a quit shimmers forever, most visibly `AskUserQuestion`: it blocks the harness until the app answers, so it is the call most likely to be open when the app goes away, and its request is not persisted so no card comes back to answer it.

Liveness alone is not enough, though — it is a property of *now*, and the next send would flip those rows back to shimmering. So a `user_message` also abandons everything open before it: a new prompt is proof the previous turn will not finish what it started. The marks are applied after the walk and only where no real result exists, because a background subagent can report back after the turn that spawned it.

This works only because the frontend keeps a loaded session in memory: `handleSelectSessionIndexItem` returns early when the session is already in `sessions`, so re-selecting a session with a request in flight reuses live state instead of re-reading the file. Change that to always refetch and an open card disappears mid-flight, with the agent still blocked behind it.

**`AskUserQuestion` rides this same channel, and is not a permission.** It arrives as an ordinary `can_use_tool` with `requires_user_interaction: true`, and the answer travels back inside the *allow*: `updatedInput` is the tool's own input with an `answers` map added, keyed by each question's verbatim text. So the call is never in question — it always may run — and allowing it with nothing filled in is exactly what produces the CLI's "The user did not answer the questions." That makes Allow/Deny the wrong two buttons, which is why the mapper branches on tool name into `QuestionsAsked` and `PendingRequest::for_questions` carries no options at all.

The other route is a dead end, and it's worth knowing why: `request_user_dialog` exists as a control-request subtype, but the CLI only sends one for a kind the host declared in `supportedDialogKinds` during an `initialize` handshake, fails closed otherwise, and the only kind the CLI's own bridge declares is `refusal_fallback_prompt`. Questions never travel that way.

Three answer shapes, all verified live against v2.1.226: an option's **label** is the answer (there are no option ids), a multi-select answer is one **comma-separated string** rather than a list, and free text is any string at all — the CLI notices it matched no option and tells the model to read it carefully. A question absent from the map is skipped, and a partial map is honoured, which is what makes Skip a real answer rather than a refusal. `answers` is also why the whole input is echoed back untouched: the CLI rebuilds the tool result from the same object.

**The settled `AskUserQuestion` row shows only the answer.** Its arguments are the questions and options the reader just answered on a card, so `ToolCall` drops the input body for it entirely rather than reprinting them as JSON. Its result keeps no code box either, and loses the mono font the other results carry — it is the one tool result the harness writes as a sentence rather than as a program's output.

**Two denials, and they mean different things.** `PermissionRequested` → `PermissionDecided` is a question the user answered; `PermissionDenied` is `system`/`permission_denied`, a call refused with no question possible. The durable cause of the second is the working-directory sandbox, which no answer channel can fix. `PermissionDecided` is minted by the app when it replies, since the CLI's ack carries nothing. **It renders as nothing at all** — it exists to retire the card. A settled request draws no row either way: an approval is visible in the tool simply running, a refusal in the tool's own error, so a card that outlived its answer would only repeat the row beneath it. The event is still persisted, because "was this answered" has to survive a reload and the log is the only place it lives.

**A tool call is drawn before its arguments arrive.** A `Write`'s arguments *are* the file, so the committed `assistant` event a row is normally built from lands only once the whole content has streamed — measured at **39.5s** on a 396-line file, with nothing on screen for any of it, which reads as a finished turn rather than a working one. That is 12KB, so it is not an outlier — an ordinary source file is enough. Nothing new is needed on the wire to fix that: `content_block_start` names the tool at 0.0s and the path lands 1.4s in. The split is **header from the stream, body from the committed event** — a half-arrived path is just a path, but a half-arrived diff is worse than none, so the preview row never expands.

[streaming.ts](src/lib/streaming.ts) reads the accumulated `input_json_delta` prefix rather than parsing it, holding no state between frames, so a dropped or reordered fragment cannot corrupt a running parse. It is O(n²) over a stream and deliberately so; the note in that file has the sizes and what to do if a multi-MB write ever makes it matter. Two key-lookup strategies sit side by side there and the difference is load-bearing: **target keys are field-keyed** (`file_path`, `command`, `pattern`…), because a path is a path on whatever tool carries it, which is what makes them safe on an MCP tool nobody has enumerated — while **the line-count key is tool-keyed**, because `content` only means *file* content on the tool that writes one. `TodoWrite` carries a `content` string inside every todo, and field-keying that counted the first todo as `+1` added lines on a call that writes no file. The scan finds nested keys; only the tool name distinguishes them.

Order matters within the target keys, since a tool can hold two at once and the first *complete* key wins. Bash sends both `command` and `description`, and `description` is what the committed row will never show — so the two must not race. They don't, twice over: `command` is checked first when both have landed, and it arrives first on the wire (41 of 41 Bash calls across every fixture emit `command,…`, the model following the tool's schema order). `description` cannot simply be dropped to settle it — it is how a subagent spawn names itself while its far longer `prompt` is still streaming.

**The preview is retired on `tool_call_started`, not `block_stop`.** The stop lands ~20ms later, which draws both rows for a frame with the preview shoved down by its own replacement. The two are matched on the **tool_use id**, which is all they share: `tool_call_started` carries no `BlockRef`, because the mapper builds it from the committed message rather than from the stream. Both writes happen in one listener call, which React batches into a single render — that is what makes the swap invisible. One swap is *not* seamless and is left that way: a subagent spawn previews as an ordinary tool row and is replaced by a `SubagentRow`, since the preview cannot know the committed row renders differently.

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
- **Failures are swallowed, per line, and filed.** `read_stdout` logs and continues rather than propagating — one bad line can't kill the loop — so a schema mismatch presents as a missing UI update, not an error. Every one also lands in `~/.automedon/parse_failures.jsonl` with the raw line: one file for the whole app, because these describe how well *this build* covers the wire format rather than anything about a conversation. `stage` is `parse` (no variant matched), `map` (the mapper errored), `unknown_subtype` (a `#[serde(other)]` arm caught it, so the line survived but we learned nothing from it), or `unsupported_request` (a control request we had to refuse to keep the turn moving — the only stage that changes what the agent does, so treat it as the urgent one). Read it after a testing session — `jq -r '.stage + " " + .detail' ~/.automedon/parse_failures.jsonl | sort | uniq -c` — rather than grepping stderr.
- `McpServer` and `ApprovalPolicy`/`PermissionMode` are defined once in `events` and re-exported by the parser. Don't reintroduce per-harness copies.

## Test fixtures

Tests use `include_str!` against real captured CLI output under `harness/<name>/fixtures/`:

- `claude_code/fixtures/printed.jsonl` — small smoke fixture.
- `claude_code/fixtures/complex.jsonl` — 176 lines with subagent/task traffic. Assertions hard-code exact counts, so editing this file breaks tests by design.
- `claude_code/fixtures/multi_turn.jsonl`, `interrupted.jsonl` — turn boundaries and a mid-turn interrupt.
- `claude_code/fixtures/interrupted_tools.jsonl` — an `interrupt` control request landing mid-tool-call: the `control_response` ack, `terminal_reason: "aborted_tools"`, a `local_bash` background task (no `subagent_type`, no `usage`), and the only capture with `thinking_tokens`.
- `claude_code/fixtures/permission_allow.jsonl`, `permission_deny.jsonl` — the same `touch` under `manual` with `--permission-prompt-tool stdio`, approved and refused. The only captures of an inbound `control_request`, and what pins the field names the reply is built from. Note what the denied one *lacks*: no `permission_denied` line, because the question was answered.
- `claude_code/fixtures/permission_denied_system.jsonl` — that same `touch` with no answer channel open, so the CLI refuses alone and says so on a `system` line.
- `claude_code/fixtures/ask_user_question.jsonl` — one `AskUserQuestion` carrying two questions, the second `multiSelect`, plus the tool result an answered call produces. The only capture of `requires_user_interaction`.
- `claude_code/fixtures/compaction.jsonl` — a manual `/compact`, driven over stdin like any other prompt. The only capture of `compact_boundary`, of a `result` with a null `stop_reason` and no `terminal_reason`, and of the `isReplay`/`isSynthetic` user lines.
- `claude_code/fixtures/file_write.jsonl` — a 396-line (12KB) `Write`, then an `Edit` and a `Read` of the same file. The only capture of a tool call whose arguments take real time to stream: 60 `input_json_delta` fragments over 39.5s, which is what the streaming preview is built and tested against. Also what pins the key ordering that preview depends on (`file_path` before `content`, and `replace_all` ahead of both on the `Edit`). Read by `pnpm test`, not by `cargo test`.
- `codex/fixtures/rollout.jsonl` — a session *replay* log, not the live protocol. Do not write the Codex parser against this.
- `codex/fixtures/live_simple.jsonl`, `live_tools.jsonl` — real `codex exec --json` output, which is what the Codex parser must target: a much simpler item lifecycle (`thread.started`, `item.started`/`item.completed`, `turn.completed`).

To add coverage, follow the same pattern: capture real CLI output, commit it as a fixture, assert against it. Shapes absent from every fixture (Claude Code `thinking` blocks) get hand-written tests pinning the documented shape.

The fixtures are the shared asset here, not the Rust test suite — a frontend test that needs real wire output reads the same file rather than committing a second capture of the same thing. Both `Bash` and `Read` appear in several fixtures; `Write` and `Edit` appear only in `file_write.jsonl`, which is why the streaming preview shipped before anything covered it.

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

A **group header carries the same figure, summed over its calls** ([ToolGroupRow](src/components/chat/ToolGroupRow.tsx)), from those same per-call counts — so it cannot disagree with what expanding it reveals. Without it a run collapsed to "Edited 1 file · 4 calls", which says something happened four times and nothing about how much changed, which is the one number a collapsed diff is hiding. These are *region* counts, not file counts: an `Edit` diffs its replaced fragment rather than the file, so the sum is the run's total churn and not what `git --stat` would report against the original — which no call in the group carries. Memoized on the call count rather than on `calls`, since a committed call's input is immutable and a run only grows; keying on the array re-parses every diff in the group on each render of a streaming turn.

**Where the time goes.** Tokenizing is not the cost — measured in the app, an already-attached language is 0ms. What varies is the per-language grammar chunk, and the spread is wide: the entire `COMMON_LANGS` set attaches in **~54ms** batched (the library parallelises the loaders), while **Ruby alone is ~390ms**, since it drags in HTML, CSS, JS and SQL for its embedded syntaxes.

That spread is why `warmHighlighter` preloads a *named list* rather than everything or nothing. `COMMON_LANGS` in [useHighlighter.ts](src/hooks/useHighlighter.ts) is the set this app is actually used on (TS/TSX, JS/JSX, Python, JSON, CSS, HTML, Markdown, YAML, Bash, Rust, Go, SQL, TOML) — cheap enough to pay for once at startup, off the critical path, and it means opening a diff or a read is instant for essentially every file that comes up. Keep it that way: it is not a "preload everything" list, and adding a Ruby-shaped grammar to it would cost more than the whole current set. Anything absent still loads lazily on mount and pays only its own grammar, rendering *unhighlighted but readable* text meanwhile rather than an empty frame — a blank box for 400ms reads as a stall.

## Current state

Several things are deliberately unfinished — don't mistake them for bugs:

- **The UI is still the active area.** The sidebar, transcript, and composer toolbar are built; the `+` attachment button in the toolbar is inert, and there's no project *management* beyond attach (no rename, no detach from the UI).
- **Only a *ranged* `Read` renders its code, and a whole-file read has no expander at all.** A successful whole-file read is a dead end on purpose — no diff, no code, no arguments, and its result is the file itself — so the row collapses to the tool name and the path with nothing to open. That read is the agent pulling a file into context, not showing it to the reader. The range comes from the call's own `offset`/`limit`; there is no line-range argument to read it from. A *failed* read still expands, since its error text is the only place the reason lives.
- **The code theme has no picker yet.** `CODE_THEMES` and `setCodeTheme` are the settings surface's whole contract; nothing calls the setter today, so the default is what everyone sees.
- **The mapper is partial.** `assistant`, `user`, `result`, `system/init`, tasks, `background_tasks_changed`, `compact_boundary`, `permission_denied`, `can_use_tool` (both as consent and as `AskUserQuestion`), and the stream frames are wired; hooks, `post_turn_summary`, `task_updated`, and `control_response` still fall through to `None`. `result.permission_denials` is also unmapped — every denial it lists already arrived as its own event, so it is a turn-level recap rather than new information. `status` is mapped for one value only — see compaction below. `SystemEvent` has a `#[serde(other)]` catch-all, so an unknown subtype degrades instead of failing the line (`thinking_tokens` arrived unannounced and did exactly that). `turn_id` is always `None` — deliberately: Claude Code has no turn identifier on the wire, the UI groups a transcript by user message, and a promptless agent-opened `init` (see below) means minting our own ids would split what the reader sees as one exchange.
- **A compaction is two events, and they come from different lines.** `system/status` with `status: "compacting"` opens it; `system/compact_boundary`, which carries `trigger`/`pre_tokens`/`post_tokens`/`duration_ms`, closes it. `status` is a general channel — it also reports `requesting` at the top of every turn — so the mapper gates on the value, not the subtype. The wire also sends `status: null` with `compact_result: "success"` between the two; it is deliberately unparsed, since the boundary is the same signal with numbers attached. **The live protocol is snake_case here and the replay log under `~/.claude/projects` is camelCase** (`compact_metadata` vs `compactMetadata`) — writing this against a replay log fails silently. Every metadata field is `Option` so an unseen shape still *closes* the indicator; a parse failure there would leave it spinning forever. `cumulative_dropped_tokens` is not carried: it sums every compaction in the session, so what one compaction saved is `pre_tokens - post_tokens`, and the two only agree on the first.

- **A compaction leaves two user lines behind and neither is conversation.** The summary comes back as a prompt flagged `isSynthetic`, and the `/compact` echo as one flagged `isReplay` — one flag each, so dropping them takes both. No tool result in any fixture carries either. The mapper drops them: this app mints its own user events, and the session log serves the UI rather than reconstructing the model's context, so the summary is Claude Code's to keep, not ours.

- **A rate limit is only an event when it's bad news.** The CLI reports `rate_limit_event` on roughly every turn, so the mapper emits one only when `RateLimitInfo::is_noteworthy()` holds. The check is "not a known-good state" rather than a list of bad ones, so an unrecognized *or missing* status surfaces instead of being assumed healthy — but `HEALTHY_STATUSES` is what grows, and **only from a capture**. It started at `allowed` alone, the only value captured at the time, and that was wrong: `allowed_warning` arrives with `utilization` around `0.93` to say the window is *approaching* full, and reading it as trouble put "Usage limit reached" on screen during an ordinary turn. Approaching a limit is real information and wants its own quiet surface (`is_approaching()`, unused so far), not the banner a spent one gets. The wire's own strings (`status`, `overageStatus`, `rateLimitType`) are carried through rather than collapsed into a `blocked` boolean, because the vocabulary beyond `allowed`/`rejected` is unconfirmed; `five_hour` is the only limit type captured and a longer window is believed to exist, so nothing branches on it. `resetsAt` is unix seconds and every other timestamp here is RFC3339 — `rfc3339_from_unix` bridges that.
- **Two payloads are emitted but never persisted.** `read_stdout` drops `Delta` and `UsageUpdate` before the log write. Deltas are superseded by their committed event; a usage update is a running counter whose final value lands on `turn_completed`, and `thinking_tokens` alone fires dozens of times per turn — persisting it would make the token counter most of a session's log.
- **Context occupancy is stored nowhere.** The composer's ring reads it back out of the session's own events, because everything that moves it is persisted already: `turn_completed.usage.contextWindow` for a turn, `context_compacted.postTokens` for what a compaction left. `used` and `max` are collected in one backward pass but independently — the boundary reports what it kept and not how large the window is, and the turn before it does the reverse. A `context_compacted` settles `used` even when it carried no count, since an earlier turn's figure is not a fallback there but a wrong and high answer.

  **`result.usage` is a per-turn sum, and is not a context reading.** Its four counts are summed over every main-thread message in the turn, and an agentic turn re-reads the whole context once per tool call — so it reports the context multiplied by the number of steps. `multi_turn.jsonl`'s first turn claims 401103 against a real occupancy of 41102. Its output figures are equally partial: two turns of `complex.jsonl` report 239 and 485 output tokens against 4682 actually produced, so a turn's real consumption is nowhere in `Usage`'s own fields either. `Usage.per_model` carries the `modelUsage` map for that: session-cumulative and monotonic, so a turn's figure is the difference between consecutive readings. It is persisted rather than deferred to whenever a usage page gets built, because the log is append-only and the CLI's output is gone once the process exits — anything not captured now is a permanent hole for every session run in the meantime.

  `modelUsage` stays `Value` in the parser and is read field-by-field in `map_model_usage`. Deliberately: this rides `turn_completed`, and serde would reject the whole `result` line over one field that changed type — which strands the session on `in_progress`, the exact bug the compaction capture exposed. An unfamiliar shape must cost one field, never the line.

  The two wire facts behind the gauge. **Used is one message's four counts summed** — `input + cache_creation + cache_read + output`, disjoint slices of a single prompt — and *which* message is the whole subtlety. It must be the turn's **last main-thread `assistant`**, tracked in `Mapper::last_occupancy` and handed to `turn_completed` when the turn closes; a subagent's messages are skipped, since it runs its own context and reports a number describing nothing about the gauge. **A single-message turn hides the distinction completely**, because the sum is then the last message — which is why `compaction.jsonl` agreed with its own `pre_tokens` to within two tokens and the summing bug shipped anyway. Reading one message costs the tail of the final message's output, which the last `assistant` event predates: 34 tokens on a 31k context. The gauge is a proportion, and being slightly light is invisible where being a multiple out is not.

  **Max comes from that same map's `contextWindow`**, so no window is hardcoded per model and a million-token model needs no code; the mapper remembers `init`'s `model` to index it, since a subagent on a second model puts two entries in it and only the main thread's describes the gauge. A compaction clears the tracked reading, so the zeroed `result` landing *after* the boundary can't carry a pre-compaction figure over the `post_tokens` the boundary just published — that keeps every consumer a plain "latest wins".
- **Session status is a state machine in `session.rs`.** `StatusTracker`: send or `init` → `in_progress`; `result` *with no background tasks outstanding* → `completed`; an empty `background_tasks_changed` with no open call → `completed`. A `result` alone is not the end of work — a background subagent runs past it, and the CLI opens a promptless `init` later to report its findings. `completed` means finished *and unread*: the frontend clears it to `idle` when the user views the session (`mark_session_idle`), and a persisted `in_progress` resets to `idle` at startup since no child survives a restart. Status changes reach the frontend as `session_status` events — derived state, never written to the `.jsonl` log.
- **Codex is a stub.** `Harness::Codex` parses from the frontend, but `Session::init` bails on it.
- **The composer toolbar is the session's control surface.** [composer/](src/components/composer) holds one component per control; `ComposerToolbar` hides project, branch, and the worktree toggle once a session exists. `ChatInput` takes the row as a `ReactNode` so it keeps owning layout and measurement and nothing else — including the row's own spacing from the card, since only `ChatInput` knows which side of it the row sits on.
- **`isNewTask` is the composer's two presentations, not one flag per effect.** Before a session exists the composer stands alone mid-window with nothing behind it, so [ChatInput](src/components/ChatInput.tsx) drops the card's fill, border, and padding, moves the toolbar above the input, swaps the placeholder, and replaces the send button with a "Press ⏎ to send" hint. Dropping the button is safe only because Enter-to-send lives in `onKeyDown` rather than in that button being the form's submitter — make it the submitter again and the empty state loses its send path. `AppShell` has its own `centered` prop for the surrounding geometry; the two travel together but mean different things. Horizontal alignment in this state is hand-tuned to a single edge: the toolbar's `-ml-2.5` cancels its `px-1` plus the ghost button's 6px icon inset so the `+` *glyph* lands on the text edge, not the button box. Change that button's size or variant and the offset has to move with it.
- **The TS event types are generated, not written.** `ts-rs` derives them from the Rust model into `src/types/events.ts`, which is checked in so the frontend build needs no Rust toolchain. `cargo test` regenerates; never edit the output. Two settings live in `src-tauri/.cargo/config.toml`: the export path, and `TS_RS_LARGE_INT = "number"` because `u64` otherwise becomes `bigint`, which `JSON.parse` never produces.

## Known issues

Diagnosed defects, not yet fixed. Unlike *Current state* above, these are broken rather than unbuilt. Delete the entry when you fix it.

- **Changing effort respawns the child.** The CLI has no `set_effort` control request (`set_model` exists and works), so the session is killed and resumed by id. Harmless today — the respawn happens inside `send_msg`, which only runs when the user types, so no turn is in flight. Revisit when queued/mid-turn messages land.
- **Worktree paths are computed, not verified.** `worktree_path()` joins the convention instead of reading `init`'s `cwd`. Correct as of now; reading it back isn't worth it — `init` fires repeatedly, so each would need a re-write plus dedup.
- **A permission request stranded by a child that dies mid-run is unanswerable.** The pending map lives in `Session`, so killing the child without quitting — the effort-change respawn is the only path today — leaves a card whose buttons error with "no running session". A restart is fine, since the request was never persisted. The request itself is not lost either way: the CLI re-asks on resume.
- **`requires_user_interaction` is parsed and only half honoured.** It marks a call whose own card is the answer surface, so Allow/Deny is not a real reply. `AskUserQuestion` is the one shape this app draws a card for and is matched by tool name; anything else carrying the flag — the elicitation-driven MCP prompts, the Cowork role picker — still gets Allow/Deny, which is wrong but at least unblocks the harness.
- **Status flashes `completed` between a task drain and its report-back turn.** When a background subagent finishes, `background_tasks_changed []` marks the session completed, and the promptless `init` the CLI opens a few lines later to narrate the findings flips it back to `in_progress`. Milliseconds today; debounce the edge before notifications hang off it.
