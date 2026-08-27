---
name: dray
description: Create, list and message Dray Cloud Sessions from the command line. Use when the user asks to work on several things at once — a batch of issues, tickets, or tasks — and each deserves its own agent, its own sandbox, and its own place in the sidebar. Also for checking on sessions you started, and for sending a message or summary between sessions.
---

# Dray sessions

Dray runs coding agents in parallel, one chat per piece of work. The `dray` CLI
creates those sessions from outside the app, so an agent in one session can fan
work out into several.

Every session created this way appears in the user's sidebar immediately. They
can open it, read the transcript, interrupt it, or delete it like any other.

## When to reach for this

The user has **several separate pieces of work** and wants them going at once —
"work through these 3 Linear issues", "fix all four of these bugs", "start a
session for each of these tickets".

Do **not** use it to break one task into steps. Sessions are for work that is
genuinely independent: separate branches, separate PRs. Steps of one job belong
in one session, and subagents already handle parallelism inside a turn.

## Creating a session

```bash
dray new "Fix the login redirect loop described in ENG-412"
```

Prints the new session's id. It returns immediately — the session starts working
on its own, and nothing waits for it.

Write the prompt as if briefing a colleague who has not read this conversation.
The new session starts empty: it inherits no context, no files you have read, and
no decisions made here. Include the issue text, the reproduction, the constraints
— everything it needs.

Options:

| flag | meaning |
|---|---|
| `--project <path>` | Project metadata for grouping and branch context. Defaults to the current session's project. The project is not copied into the Cloud sandbox. |
| `--effort <level>` | `low`, `medium`, `high`, `xhigh`, `max`. Defaults to the current session's. |
| `--from <session\|branch>` | Record which branch the Cloud is about — a session id or branch name. The Cloud still starts with no repository. |

### Each session gets its own Cloud sandbox

Every session runs in its own Docker sandbox backed by a private volume, and
there is no way to turn that isolation off. The sandbox starts empty: Dray does
not clone, mount, or otherwise include a GitHub repository. The selected project
and branch are metadata used to group the session.

### Naming the branch a Cloud is about

```bash
dray new --from <session-id> "Review the work on this branch and report what you find"
dray new --from feature/login "Write tests for the login flow on this branch"
```

`--from` takes a **session id** — the same id `dray ls` prints and `dray send`
takes — or a branch name. Naming a session uses the branch recorded for that
session; either way the branch is recorded on the new Cloud — it shows in
`dray ls` and the sidebar — and the Cloud still starts with no repository.
Dray itself never clones or mounts the branch, so say in the prompt which
branch the agent should work on.

The line `dray new` prints says what it resolved: `Started "…" in Cloud
<id>, based on <base>`.

## Listing sessions

```bash
dray ls              # this project, human-readable
dray ls --json       # machine-readable
dray ls --all        # every project
```

Each row carries the session id, title, status (`idle`, `in_progress`,
`completed`), and branch. A session created by another one also says which —
`spawned by <id>` in the table, `parentSessionId` in the JSON. This is how you
check on sessions you started — nothing reports back on its own, so poll
`dray ls` if you need to know when one finishes.

## Messaging a session

```bash
dray send <session-id> "Code review is done. Two findings, both fixed."
```

Works in both directions and between any two sessions:

- A session you created can report a summary back to the one that created it.
- You can hand a session you created extra context after it has started.

The message arrives as an ordinary prompt and **starts a turn** in the receiving
session, so it wakes an idle agent up. If that session is mid-turn the message is
queued and picked up at the next boundary — that is reported, and is not a
failure.

The receiving agent is told which session the message came from, and is given its
id — so it can answer with `dray send <that-id>` without looking anything up.
Write it as a message to a colleague, not as a note to yourself.

Send when there is something the other session genuinely needs. A message costs
it a whole turn, so "done" on its own is rarely worth one.

## Reporting back to the user

Say briefly what is now running, in terms of the work — "three sessions, one per
issue". **Do not list session names or ids.** The user sees every session in the
sidebar, nested under this one, and reading ids back is noise they cannot act on.

Don't poll in a loop waiting for sessions to finish unless the user asked you to.
They can watch the sidebar.

## Staying current

```bash
dray update
```

Downloads the installer and re-runs it, landing the new binary where the current
one sits — and rewrites this skill, which ships inside that binary. So whatever
you are reading always describes the `dray` you actually have.

The app and this CLI ship separately, so they can drift. When they disagree about
the protocol the app **refuses the command** — every command, not just whichever
one is new — rather than doing something you cannot see is wrong. You do not need
to know which flags need which version: run the command, and if the two disagree
you get a refusal naming the cure. There are only two:

- *"this dray CLI speaks protocol vN, the app speaks vM — run `dray update`"* —
  you are behind. Run it, then retry the command. This is the common case and
  you can fix it yourself, in one step, without asking anyone.
- *"… — update the Dray app"* — the **app** is behind. You cannot fix this from
  here. Say so to the user, name the command you were trying to run, and stop.
  Do not work around it.

A refusal is not a failure of the thing you were doing. Nothing was created and
nothing was sent, so retrying after the fix is safe.

## Limits

- **No reading transcripts.** You can create, list and message. You cannot read
  what another session said — ask it to send you a summary instead.
- **Two levels deep.** A session you create may create sessions of its own; those
  may not. If you hit this, say so — the user can start the next batch from a
  top-level session.
- **Dray must be running.** If it is not, `dray` says so and exits non-zero.
- **Nothing updates itself.** A CLI too old for the app is refused with a line
  saying so; `dray update` is how that gets fixed. If the refusal says the *app*
  is behind, tell the user — you cannot update it from here. Updating the app
  first is the smoother order for exactly that reason: it leaves the CLI behind,
  which is the half that can fix itself.
