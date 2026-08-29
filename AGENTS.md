# Dray repository guide

Dray is a Tauri 2 desktop application for running coding-agent sessions through a native chat UI. The current agent harness is Pi. The frontend is React 19 + Vite 7 + Tailwind CSS 4; the backend is Rust and owns process/session management, persistence, Git/GitHub integration, file indexing, attachments, notifications, and Docker-backed Cloud Sessions.

This file is the implementation map for agents working in this repository. Keep the user-facing overview in `README.md` concise; update this file when components, major behavior, or repository structure change.

## Repository layout

- `apps/desktop/` — the only application currently in the workspace.
- `apps/desktop/src/` — React frontend.
- `apps/desktop/src/components/` — application UI and shared UI primitives.
- `apps/desktop/src/hooks/` — stateful frontend behavior and Tauri data access.
- `apps/desktop/src/lib/` — pure helpers, transcript/diff parsing, presentation logic, and small platform integrations.
- `apps/desktop/src/types/events.ts` — generated Rust/TypeScript event and command types. `cargo test` regenerates it through `ts-rs`; avoid hand-maintaining generated definitions.
- `apps/desktop/src-tauri/src/` — Rust backend and Tauri command surface.
- `apps/desktop/sandbox/` — Docker image used by Cloud Sessions.
- `apps/desktop/scripts/` — Tauri launcher, sandbox builder, Windows installer, and icon tooling.
- `apps/desktop/public/` — app assets, sounds, and logos.
- `packages/` — reserved by the pnpm workspace for code genuinely shared by more than one app; currently empty.

## Main product features

- Native desktop chat UI for Pi coding-agent sessions.
- Multiple persistent sessions with search, unread/waiting/working state, pinning, settling/archiving, deletion, forking, and parent/child nesting.
- Local Sessions that run in a selected project checkout and Cloud Sessions that run Pi inside an isolated Docker container and persistent Docker volume.
- Project picker with attach, rename, delete-from-picker, recent-project ordering, and remembered selection.
- Git branch discovery and switching, including dirty-worktree handling before checkout.
- Dynamic Pi model catalog with model selection, reasoning/effort selection, configurable model cycling, and separate model/effort preferences for generated session titles.
- Permission modes: Auto, Plan, Accept edits, Ask every time, and Bypass permissions.
- Rich transcript rendering for assistant text, user text, reasoning, tool calls, grouped tool calls, file edits, diffs, background tasks, subagents, images, checkpoints, compaction, permission requests, and structured question requests.
- Streaming assistant/tool output and live work indicators.
- Prompt queuing while a turn is already running, with cancellation/restoration of a queued prompt when still retractable.
- File attachments via picker or drag/drop, image previews, persistent archived result images, transcript thumbnails, and a keyboard-navigable image lightbox.
- `@file` fuzzy search backed by a warmed Rust file index.
- `/commands` and `$skills` discovered from Pi, with search, source-aware grouping, aliases, and recent-command ranking.
- Context-window meter in the composer.
- Per-session draft preservation and focus restoration.
- Desktop notifications, in-app notices, dock/taskbar badge state, attention indicators, and notification/celebration sounds.
- Main repository Changes view with uncommitted changes, commit history, changed-file lists, commit metadata, and file diffs.
- Right inspector with turn-scoped Changes, Subagents, and Pull Request tabs.
- Turn-scoped Git snapshots so a completed turn's diff remains stable even if the checkout changes afterward.
- Git status handoff actions for Commit, Commit & push, Push, Create PR, and Draft PR.
- GitHub pull request discovery through `gh`, including draft/open/merged/closed state, checks, comments/reviews, changed-file counts, reopen, mark-ready, and merge actions/methods.
- Sidebar PR markers and ready-to-merge notifications with polling/caching per repository.
- Syntax-highlighted Markdown/code and worker-backed diff rendering.
- Light/dark/system-aware theming helpers, code themes, macOS vibrancy/titlebar integration, and cross-platform hotkeys.
- Safe quit flow that asks before exiting while sessions are active.

## Frontend entry points

- `src/main.tsx` — React bootstrap.
- `src/App.tsx` — top-level orchestration. Connects sessions, repository state, pull requests, notices, panels, settings, hotkeys, themes, and the composer.
- `src/App.css` — application-level layout and visual tokens.
- `src/styles/attention-glow.css` — attention/notification glow treatment.

## Application components

Top-level components in `src/components/`:

- `Avatar.tsx` — generic avatar/fallback rendering.
- `SessionAvatar.tsx` — session/project-aware avatar presentation.
- `Chat.tsx` — transcript list, follow-to-bottom behavior, streaming placement, and turn rendering.
- `ChatInput.tsx` — composer text input, send/stop behavior, command/file menus, queued-send behavior, error state, and attachment integration.
- `Sidebar.tsx` — task/session navigation, project grouping, search, nesting, session status, PR markers, pin/settle actions, row menus, and settings entry point.
- `RightPanel.tsx` — shared inspector frame and tabs for PR, Changes, and Subagents.
- `ChangesPanel.tsx` — right-panel view of changes made by the selected turn.
- `SubagentPanel.tsx` — subagent run list/detail and individual stop actions.
- `PrPanel.tsx` — pull request details, checks, comments/reviews, GitHub links, draft/ready/reopen/merge controls, and merge-method selection.
- `PrStateIcon.tsx` — compact pull request state iconography.
- `SettingsDialog.tsx` — settled-session toggle, model-cycle configuration, and title-generation model configuration.
- `NoticeStack.tsx` — transient in-app notices.
- `QuitDialog.tsx` — quit confirmation for active work.
- `DiffWorkerPool.tsx` — shared worker/rendering pool for highlighted diffs.
- `FileIcon.tsx` — file-type icon selection.

### Composer components

Files in `src/components/composer/`:

- `ComposerToolbar.tsx` — attachment, project, cloud/local, branch, model, effort, permission, and context controls.
- `ProjectSelector.tsx` — attach/select/rename/remove projects.
- `BranchSelector.tsx` — branch picker and dirty-worktree warning context.
- `BranchSwitchDialog.tsx` — branch-switch resolution when local changes need handling.
- `CloudToggle.tsx` — toggles Docker-backed Cloud Session mode.
- `ModelSelector.tsx` — model and effort picker plus model-label/key helpers.
- `PermissionSelector.tsx` — approval/permission policy picker.
- `ContextMeter.tsx` — visual model-context usage meter.
- `AttachmentTray.tsx` — pending attachment previews/removal.
- `FileMentionMenu.tsx` — `@file` search results.
- `SlashCommandMenu.tsx` — `/command` and `$skill` picker.
- `PickerMenu.tsx` — reusable grouped/searchable picker surface.
- `HandoffRow.tsx` — post-work Git/PR actions.
- `handoffIcons.ts` — handoff action-to-icon mapping.

### Chat/transcript components

Files in `src/components/chat/`:

- `TurnBlock.tsx` — one user/assistant turn container.
- `UserMessage.tsx` — user prompt, file/image attachments, and prompt metadata.
- `AssistantMessage.tsx` — assistant Markdown/content blocks.
- `Reasoning.tsx` — collapsible reasoning presentation.
- `ToolCall.tsx` — completed tool call rendering.
- `StreamingToolCall.tsx` — in-flight tool call rendering.
- `ToolGroupRow.tsx` — compact grouped consecutive tool calls.
- `EventRow.tsx` — generic transcript event row.
- `FileEdits.tsx` — file-edit summaries from tool output.
- `DiffView.tsx` — inline edit/diff display.
- `CodeView.tsx` — highlighted code display.
- `Markdown.tsx` — Streamdown/Markdown renderer with code, links, and local-file link handling.
- `LinkDialog.tsx` — confirmation/details for links that need explicit handling.
- `ImageRow.tsx` — sent/returned image rows and overflow behavior.
- `ImageLightbox.tsx` — full-size image viewer with multi-image keyboard navigation.
- `PermissionRequest.tsx` — inline agent permission decision UI.
- `QuestionRequest.tsx` — structured question/answer UI from the agent.
- `QueuedMessages.tsx` — queued follow-up prompts and cancellation.
- `BackgroundTasksIndicator.tsx` — live background task list/state.
- `SubagentRow.tsx` — subagent transcript row.
- `CheckpointRail.tsx` — turn/checkpoint navigation rail.
- `CompactingIndicator.tsx` — context-compaction state.
- `WorkingIndicator.tsx` — active turn indicator.

### Repository Changes components

Files in `src/components/changes/`:

- `ChangesView.tsx` — full repository view with Uncommitted and History sub-tabs.
- `FileList.tsx` — reusable changed-file list.
- `DiffPane.tsx` — selected-file diff pane.
- `HistoryList.tsx` — paginated commit history with expandable file lists.
- `CommitMessage.tsx` — selected commit subject/body/short SHA.
- `Counts.tsx` — additions/deletions counters.

### Layout and icon components

- `layout/AppShell.tsx` — three-column/window shell.
- `layout/SessionHeader.tsx` — selected session title and branch context.
- `layout/ViewTabs.tsx` — main Chat/Changes view tabs.
- `icons/PanelLeftIcon.tsx`, `PanelRightIcon.tsx`, `GitBranchIcon.tsx` — custom chrome icons.

### Shared UI primitives

`src/components/ui/` contains the local shadcn/Radix-style primitives used by the application: `alert-dialog`, `alert`, `badge`, `button`, `card`, `collapsible`, `context-menu`, `dialog`, `dropdown-menu`, `input`, `kbd`, `questionnaire`, `scroll-area`, `separator`, `switch`, `textarea`, and `tooltip`.

## Frontend hooks

Files in `src/hooks/`:

- `useSessions.ts` — central frontend session state: session index/snapshots, model/permission/project/branch/cloud controls, send/queue/interrupt/stop/respond/fork/detach/delete operations, backend event subscriptions, status/unread state, notices, and context/background-task derivation.
- `useChanges.ts` — fetches and caches turn/revision change sets and individual file versions.
- `useRepo.ts` — HEAD tree, commit history, and sync status for the repository Changes view.
- `useWorkStatus.ts` — working tree, branch, upstream, default branch, and ahead/dirty state for handoff actions.
- `usePullRequest.ts` — selected branch PR loading/polling and PR mutations.
- `usePrMarks.ts` — per-repository cached PR markers for sidebar sessions.
- `usePrReady.ts` — announces PRs that become ready to merge.
- `useAttachments.ts` — composer attachment state and Tauri attachment reads.
- `useFileSearch.ts` — warms and queries the Rust fuzzy file index.
- `useSlashCommands.ts` — loads/caches Pi commands and skills per working directory.
- `useRecentCommands.ts` — persists recent command/skill usage.
- `useComposerPrefs.ts` — persisted composer model/effort/permission/cloud preferences.
- `useTitlePrefs.ts` — persisted title-generation model and effort.
- `useDraft.ts` — per-session unsent composer drafts.
- `useNotices.ts` — in-app notice state.
- `useDockBadge.ts` — dock/taskbar badge integration.
- `useAvatar.ts` — commit-author avatar lookup/cache.
- `useTheme.ts` and `useCodeTheme.ts` — app/code theme selection.
- `useHighlighter.ts` — shared syntax highlighter lifecycle.
- `useVibrancy.ts` — native window vibrancy behavior.
- `useFullscreen.ts` — native fullscreen state.
- `useHotkey.ts` and `useDoubleTap.ts` — keyboard shortcut helpers.
- `useLocalStorage.ts` — typed persisted browser storage state.

## Frontend library modules

Files in `src/lib/`:

- `transcript.ts` — converts raw backend events into renderable turns, tool/subagent state, and result maps.
- `streaming.ts` — parses incremental stream payloads and reconstructs streamable content/tool data.
- `tools.ts` — tool-call classification/grouping helpers.
- `changes.ts` — turn-to-Git-baseline/change-range helpers.
- `diff.ts` — edit/read extraction, diff sides, filenames, ranges, and line counts.
- `commit.ts` — commit baseline and file-selection reconciliation helpers.
- `pr.ts` — pull-request state/label/session-branch helpers.
- `prSync.ts` — PR/check synchronization helpers.
- `handoff.ts` — derives available Commit/Push/PR handoff actions from Git state.
- `slash.ts` — command/skill invocation detection, ranking, grouping, parsing, and insertion.
- `mention.ts` and `highlight.ts` — `@file`, `$skill`, and command text segmentation/highlighting.
- `fileLinks.ts` — proxy/unwrap logic for local file links rendered through Markdown.
- `codePlugin.ts`, `codeTheme.ts`, `highlight.ts` — code rendering/highlight integration.
- `relay.ts` — frontend event relay helpers.
- `attention.ts` — session attention/unread presentation rules.
- `sessionOrder.test.ts` covers ordering behavior implemented alongside sidebar helpers.
- `avatar.ts` — avatar lookup helpers.
- `format.ts` — relative time, token/byte counts, and path formatting.
- `focus.ts` — focus utilities.
- `notify.ts` — invokes native notification delivery.
- `sound.ts` — notification/celebration audio.
- `confetti.ts` — celebration visual effect.
- `theme.ts` — theme utilities.
- `platform.ts` — OS/platform detection.
- `utils.ts` — shared class-name/general helpers.

Most pure behavior has adjacent `*.test.ts`/`*.test.tsx` coverage. Preserve that pattern when adding logic that can be separated from UI wiring.

## Rust backend

Files in `src-tauri/src/`:

- `main.rs` — native executable entry point.
- `lib.rs` — Tauri builder, window lifecycle, command registration, and frontend-facing command wrappers.
- `session.rs` — core process/session manager: spawn/resume Pi, local/cloud execution, stdin protocol, event streaming, prompt queuing, model/permission changes, background-task control, forks, interrupt/kill, deletion, and status publication.
- `store.rs` — persistent session logs/index/snapshots, status flags, nesting metadata, and archive/pin state.
- `projects.rs` — persistent attached-project list, names, and recent selection ordering.
- `git.rs` — branch operations, tree snapshots, turn/revision diffs, file-version reads, commit log, work/sync status, commit, and push operations.
- `github.rs` — `gh`-based PR discovery, sidebar marks, checks/comments/reviews, ready/reopen/merge operations, and GitHub state normalization.
- `files.rs` — cached fuzzy file index used by `@file` mentions.
- `attachments.rs` — attachment validation/description, image encoding, session attachment storage, and returned-image archiving.
- `sandbox.rs` — Docker image/container/volume management for Cloud Sessions and GitHub credential handoff.
- `notifications.rs` — native desktop notifications and click handling.
- `quit.rs` — active-work quit interception and confirmation.
- `title.rs` — generated session-title behavior.
- `binpath.rs` — CLI executable discovery/path handling.
- `models/models.rs` — model IDs, Pi model metadata, effort levels, and configured fallback model.
- `events/events.rs` — shared serializable event/domain model exported to TypeScript.
- `events/usage.rs` — token/context usage normalization.
- `harness/harness.rs` — harness abstraction and selection; currently Pi only.
- `harness/pi/pi.rs` — Pi process command/protocol integration.
- `harness/pi/parser.rs` — Pi JSON/event stream parsing.
- `harness/pi/mapper.rs` — maps Pi protocol events into Dray's normalized event model.
- `harness/pi/commands.rs` — Pi model and command/skill discovery.

The frontend-facing Tauri command surface covers session send/read/control, attachments, models, commands/skills, file search, projects, branches, Git diffs/history/status, session flags/forks/deletion, notifications, PR operations, and quit confirmation. Add new native capabilities through a narrow command in `lib.rs` and keep implementation in the owning module.

## Cloud Sessions

Cloud mode is local Docker isolation, not a hosted service. `src-tauri/src/sandbox.rs` creates one container per live session and one persistent volume per cloud workspace. The selected project is not bind-mounted or cloned automatically; the agent starts in the sandbox and performs any repository setup it needs.

The image is defined by `apps/desktop/sandbox/Dockerfile` and launched through `sandbox-entrypoint.sh`. The current image includes Java 21, Java 25, Node.js 24, GitHub CLI, Git, and Pi. `~/.pi/agent` is seeded read-only from the host for Pi configuration/extensions/auth without sharing host session history. GitHub credentials are exposed only to the container, converted to `GH_TOKEN`, and used to configure authenticated HTTPS Git access.

Use `DRAY_CLOUD_IMAGE` to override the Docker image tag. `GITHUB_TOKEN` or an authenticated host `gh` can provide the token forwarded to a Cloud Session.

## Important interaction rules

- A local session is tied to a project/checkout; a Cloud Session has no local repository view.
- Completed-turn changes use Git tree snapshots. Do not replace them with a live `git diff` or the UI will drift after later edits.
- The full Changes view is repository-scoped; the right-panel Changes tab is turn-scoped. Keep those concepts separate.
- GitHub integration intentionally uses the user's installed/authenticated `gh` CLI rather than owning GitHub authentication.
- Session status distinguishes active work, waiting-for-user requests, completed-but-unread work, and idle/read work. Sidebar indicators and OS notices depend on that distinction.
- Parent/child session nesting represents forks/subsessions. Detach changes hierarchy; delete removes the session and its persisted data/resources.
- Cloud containers and volumes are named from session/cloud IDs. Treat cleanup logic as user-data-sensitive.
- Permission answers must only use options supplied by the underlying Pi request; do not widen a permission in the frontend.
- Generated TypeScript event types mirror Rust. Change the Rust model first and regenerate.
- Local links in Markdown use a proxy/unwrap path because normal browser link handling cannot safely expose arbitrary local paths directly.

## Keyboard shortcuts

`useHotkey` maps the primary modifier to Command on macOS and Control elsewhere unless the binding explicitly opts out.

- `Cmd/Ctrl+B` — toggle sidebar.
- `Cmd/Ctrl+N` — new session.
- `Cmd/Ctrl+Shift+Up/Down` — move through sessions.
- `Cmd/Ctrl+E` — toggle right inspector.
- `Cmd/Ctrl+Shift+[` / `]` — move through right-panel tabs.
- `Cmd/Ctrl+R` — refresh the active right-panel tab when supported.
- `Cmd/Ctrl+1` — Chat main view.
- `Cmd/Ctrl+2` — Changes main view.
- `Cmd/Ctrl+,` — Settings.
- `Shift+Tab` — cycle effort/reasoning level for the current model.
- `Cmd/Ctrl+M` — cycle the configured model subset.
- `Alt+O` — attach files.
- In Changes view, `Cmd/Ctrl+Shift+Left/Right` switches Uncommitted/History.

## Development commands

Run workspace install/start commands from the repository root:

```sh
pnpm install
pnpm app
pnpm app:no-watch
pnpm test
pnpm build:app
pnpm build:sandbox
```

Run commands whose config paths are app-relative from the owning directory:

```sh
cd apps/desktop && pnpm tauri build
cd apps/desktop/src-tauri && cargo test
```

Useful targeted checks:

```sh
cd apps/desktop && pnpm test
cd apps/desktop && pnpm build
cd apps/desktop/src-tauri && cargo test
```

Prefer the smallest verification that covers a change. Documentation-only edits generally need only a diff/status review.

## Editing conventions

- Preserve existing user changes in a dirty worktree.
- Keep stateful Tauri I/O in hooks/backend modules and pure derivation in `src/lib/` when practical; this repository already tests that split heavily.
- Reuse the shared panel, picker, UI primitive, diff, transcript, and formatting components instead of adding parallel one-off surfaces.
- Keep platform-specific behavior behind `platform.ts`, Tauri APIs, or Rust `cfg` branches.
- Update tests beside pure logic when behavior changes.
- Keep README feature claims aligned with the actual UI and backend; keep implementation detail here instead.
- When bumping the app version, keep `apps/desktop/package.json`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/tauri.conf.json`, and the README badge aligned.

