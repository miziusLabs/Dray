import type { AgentEvent, ToolResult, Usage } from "@/types/events";

export type SubagentRun = {
  /// The spawning tool call's id — what the envelope correlates on, and the key
  /// the panel selects by.
  id: string;
  /// The harness's own handle on the run, which is what `stop_task` names.
  ///
  /// Not the same id as `id` above, and the difference is silent if confused:
  /// the CLI answers success for a task it does not hold, so stopping by the
  /// spawning call's id looks like a stop that did nothing. Null until a
  /// lifecycle event carries it, which is also the honest reading — a run with
  /// no `agentId` yet is one the harness has not registered as stoppable.
  taskId: string | null;
  label: string | null;
  description: string | null;
  /// Latest `subagent_progress.description`, rewritten per event by the harness.
  status: string | null;
  lastTool: string | null;
  done: boolean;
  usage: Usage | null;
  /// The subagent's own work, excluding its lifecycle events.
  events: AgentEvent[];
  /// The main-thread `tool_call_started` that spawned this run. It is the only
  /// place a `local_bash` task's command and output live — such a task reports
  /// no events of its own, so a run built from the envelope alone is empty —
  /// and for an agent run it carries the prompt and the final report.
  spawn: AgentEvent | null;
};

/// Consecutive tool calls, possibly of different types, collapsed behind one
/// summary row. Assistant output ends a group; invisible lifecycle/result
/// events do not.
export type ToolGroup = {
  kind: "tool_group";
  /// The spawning events, in `seq` order. Never fewer than two.
  calls: AgentEvent[];
  key: string;
};

/// Either a lone event or a collapsed run of tool calls.
export type WorkItem = AgentEvent | ToolGroup;

/// The `permission_requested` payload, narrowed out of the union once here so
/// the renderer doesn't re-check a type the builder already established.
export type PermissionRequestPayload = Extract<
  AgentEvent["payload"],
  { type: "permission_requested" }
>;

export type QuestionsAskedPayload = Extract<
  AgentEvent["payload"],
  { type: "questions_asked" }
>;

/// Something the agent is blocked on until the user answers. Two shapes, one
/// list: they arrive on the same channel, share a `requestId` space, and are
/// retired by the same `permission_decided`, so splitting them would mean two
/// pending sets that have to stay ordered against each other.
export type PendingAsk = PermissionRequestPayload | QuestionsAskedPayload;

export function isToolGroup(item: WorkItem): item is ToolGroup {
  return "kind" in item && item.kind === "tool_group";
}

export type Turn = {
  /// The user's prompt opening this turn, absent only for a transcript that
  /// starts mid-conversation.
  prompt: AgentEvent | null;
  /// Everything the agent did between the prompt and completion — tool calls,
  /// subagent spawns, reasoning, and its intermediate messages. Consecutive
  /// tool calls arrive pre-collapsed into a `ToolGroup`.
  work: WorkItem[];
  /// The closing `turn_completed`, absent while the turn is still running.
  completed: AgentEvent | null;
  /// `turn_completed.finalText`, which is a verbatim copy of the turn's last
  /// `assistant_text` — so showing both would print the answer twice. A turn
  /// that closed without one (an interrupt) falls back to its last
  /// `assistant_text` directly, so a collapsed turn always ends on what the
  /// agent last said; still `null` when the turn produced no text at all.
  finalText: string | null;
  key: string;
};

/// Payload types that put something on screen — the complement of the
/// `return null` arms in [EventRow](../components/chat/EventRow.tsx). Keep the
/// two in step: this set decides what breaks a tool run and which existing row
/// a streaming tool preview may join.
const RENDERS = new Set([
  // Only ever reached by a *queued* prompt. An ordinary one is a turn's header
  // rather than its work, so it never enters `work` for this to be asked about.
  "user_message",
  "assistant_text",
  "tool_call_started",
  "file_edits",
  "error",
  "extension_notification",
  "context_compacted",
  "rate_limited",
  "permission_denied",
]);

/// Whether an item draws a row. A group always does — it is built from tool
/// calls, which always draw. Exported so the live preview can locate the last
/// visible item without maintaining a second event-type list.
export function rendersWorkItem(item: WorkItem): boolean {
  return isToolGroup(item) || RENDERS.has(item.payload.type);
}

/// `seq` is the ordering key — most Pi events carry no usable `ts`.
function bySeq(a: AgentEvent, b: AgentEvent) {
  return a.seq - b.seq;
}

type OpenTurn = Omit<Turn, "work"> & {
  /// Ungrouped while the turn is open; `groupTools` runs whenever the snapshot
  /// handed to the UI is built.
  work: AgentEvent[];
};

function groupableTool(event: AgentEvent, subagentIds: Set<string>): boolean {
  const { payload } = event;
  return (
    payload.type === "tool_call_started" &&
    payload.toolType !== "subagent_spawn" &&
    !subagentIds.has(payload.callId)
  );
}

/// Groups every uninterrupted run of two or more calls, regardless of type.
/// Assistant text and other visible rows end a run; result/lifecycle events are
/// transparent, so the normal started/completed/started sequence stays whole.
function groupTools(work: AgentEvent[], subagentIds: Set<string>): WorkItem[] {
  const items: WorkItem[] = [];
  let run: AgentEvent[] = [];
  let held: AgentEvent[] = [];

  const flush = () => {
    if (run.length >= 2) {
      items.push({ kind: "tool_group", calls: run, key: `group-${run[0].id}` });
    } else {
      items.push(...run);
    }
    items.push(...held);
    run = [];
    held = [];
  };

  for (const event of work) {
    if (groupableTool(event, subagentIds)) {
      run.push(event);
      continue;
    }

    if (run.length > 0 && !rendersWorkItem(event)) {
      held.push(event);
      continue;
    }

    flush();
    items.push(event);
  }
  flush();
  return items;
}

/// Cuts the main thread into turns: each runs from a user prompt to the
/// `turn_completed` that closes it. The renderer places all intermediate work
/// in one disclosure and keeps the final answer outside it.
function groupTurns(events: AgentEvent[], subagentIds: Set<string>): Turn[] {
  const turns: Turn[] = [];
  let current: OpenTurn | null = null;

  // A turn is only pushed once per transcript build, here, so grouping has one
  // source of truth for both live and settled turns.
  const close = (turn: OpenTurn) => {
    let finalText = turn.finalText;
    if (finalText === null && turn.completed !== null) {
      for (let i = turn.work.length - 1; i >= 0; i--) {
        const payload = turn.work[i].payload;
        if (payload.type === "assistant_text") {
          finalText = payload.text;
          break;
        }
      }
    }

    // The completion payload copies the final assistant message. Keep that
    // message permanently outside the disclosure—even after it is expanded—so
    // “everything except the final output” remains an honest boundary.
    const detailWork = groupTools(turn.work, subagentIds);
    if (finalText !== null && turn.completed !== null) {
      for (let i = detailWork.length - 1; i >= 0; i--) {
        const item = detailWork[i];
        if (isToolGroup(item)) continue;
        const payload = item.payload;
        if (payload.type === "assistant_text" && payload.text === finalText) {
          detailWork.splice(i, 1);
          break;
        }
      }
    }

    turns.push({ ...turn, finalText, work: detailWork });
  };

  const open = (prompt: AgentEvent | null, key: string): OpenTurn => ({
    prompt,
    work: [],
    completed: null,
    finalText: null,
    key,
  });

  for (const event of events) {
    // A queued prompt does not open a turn: it was typed into one already
    // running, and the CLI answers both inside it and emits a single
    // `turn_completed` for the pair. Cutting here would leave the first turn
    // permanently open and hand its remaining work to a second one. It falls
    // through to the bottom instead and renders as a row where it was typed.
    //
    // `current` still guards it — a queued prompt is only ever queued onto a
    // turn, but a log replayed from a truncation could start on one, and it
    // has to have somewhere to go.
    const inlineQueued = event.payload.type === "user_message" && event.payload.queued && current;

    if (event.payload.type === "user_message" && !inlineQueued) {
      if (current) close(current);
      current = open(event, event.id);
      continue;
    }

    // Events before any prompt still need a home — a resumed session replays
    // the log from wherever it was truncated.
    current ??= open(null, `head-${event.id}`);

    if (event.payload.type === "turn_completed") {
      current.completed = event;
      current.finalText = event.payload.finalText;
      close(current);
      current = null;
      continue;
    }

    current.work.push(event);
  }

  // The open trailing turn groups too, so a run collapses as it arrives rather
  // than only once the turn closes.
  if (current) close(current);
  return turns;
}

/// Splits the event log into the main thread and the subagent runs the panel
/// lists.
///
/// Correlation is `envelope.subagent.id === the spawning call's callId`, not the
/// `agentId` on the subagent payloads — that is the harness's own handle and
/// matches nothing else.
/// Stands in for the result a call will now never get.
///
/// Not an error: nothing went wrong with the call, the process it belonged to
/// stopped existing. Flagging it would tint the row red and spring it open on
/// load, which is a lot of noise for "this didn't finish".
const ABANDONED: ToolResult = {
  text: "No result — the session ended before this call finished.",
  isError: false,
  structured: null,
  exitCode: null,
  durationMs: null,
  images: [],
};

export function buildTranscript(
  source: AgentEvent[],
  /// Whether a child is actually running this session. A call with no result is
  /// only *pending* while something could still produce one; with the process
  /// gone it is abandoned, and rendering it as in-flight leaves a row shimmering
  /// forever. Most visible on `AskUserQuestion`, which blocks the harness until
  /// the app answers and so is the call most likely to be open at a quit — but
  /// it is true of any tool call caught mid-flight.
  live = false,
): {
  /// Main-thread events only, in `seq` order. Subagent work is excluded; the
  /// spawning tool call stays so the chat can show a row linking to the panel.
  events: AgentEvent[];
  /// The same main-thread events, cut into user-prompt-to-turn-completed spans.
  turns: Turn[];
  subagents: SubagentRun[];
  subagentById: Map<string, SubagentRun>;
  resultByCallId: Map<string, ToolResult>;
  /// Consent requests and questions still waiting on the user, oldest first.
  ///
  /// Lifted out of the turns on purpose. A subagent's request would otherwise
  /// have nowhere to render — its events are filed into the panel, not the
  /// chat — and a main-thread one would sit buried in a turn that collapses
  /// once it closes. One place, below the transcript, works for both.
  pendingAsks: PendingAsk[];
} {
  const events = [...source].sort(bySeq);

  const resultByCallId = new Map<string, ToolResult>();
  // Calls with no result yet, and the ones a later event proved will never get
  // one. Only the second is decided during the walk — a result routinely lands
  // many events after its call, so "still open" is a running state, not a
  // verdict.
  const open = new Set<string>();
  const abandoned = new Set<string>();
  const asks: PendingAsk[] = [];
  const answered = new Set<string>();
  const callById = new Map<string, AgentEvent>();
  for (const event of events) {
    if (event.payload.type === "tool_call_started") {
      open.add(event.payload.callId);
      callById.set(event.payload.callId, event);
    }
    if (event.payload.type === "tool_call_completed") {
      open.delete(event.payload.callId);
      resultByCallId.set(event.payload.callId, event.payload.result);
    }
    // A new prompt closes the book on everything before it: whatever the agent
    // was mid-way through, this turn is not going to finish it. Without this the
    // marks below would be undone by the next send — the session goes live
    // again, and a row abandoned at the last restart would start shimmering a
    // second time.
    //
    // A *queued* prompt proves the opposite. It was typed into a turn that was
    // already running, and the CLI folds it into that turn — so the calls open
    // in front of it are still live, and marking them here would stop a running
    // tool's row shimmering while it is genuinely still working.
    if (event.payload.type === "user_message" && !event.payload.queued) {
      for (const callId of open) abandoned.add(callId);
      open.clear();
    }
    if (
      event.payload.type === "permission_requested" ||
      event.payload.type === "questions_asked"
    ) {
      asks.push(event.payload);
    }
    if (event.payload.type === "permission_decided") {
      answered.add(event.payload.requestId);
    }
  }

  const pendingAsks = asks.filter((ask) => !answered.has(ask.requestId));

  // Whatever is still open at the end of the log is only pending while something
  // could still produce a result. With no child running, nothing can.
  if (!live) for (const callId of open) abandoned.add(callId);

  // Applied last, and only where no real result exists. A background subagent
  // can report back after the turn that spawned it, so a call marked here early
  // in the walk must still lose to the result that eventually arrives.
  for (const callId of abandoned) {
    if (!resultByCallId.has(callId)) resultByCallId.set(callId, ABANDONED);
  }

  const subagentById = new Map<string, SubagentRun>();
  for (const event of events) {
    const ref = event.subagent;
    if (!ref) continue;

    let run = subagentById.get(ref.id);
    if (!run) {
      run = {
        id: ref.id,
        taskId: null,
        label: ref.label,
        description: null,
        status: null,
        lastTool: null,
        done: false,
        usage: null,
        events: [],
        spawn: null,
      };
      subagentById.set(ref.id, run);
    }

    // The envelope label is null on some events (the completion, notably), so
    // keep the first non-null rather than letting a later one erase it.
    run.label ??= ref.label;

    switch (event.payload.type) {
      case "subagent_started":
        run.taskId = event.payload.agentId;
        run.label ??= event.payload.label;
        run.description = event.payload.description;
        break;
      case "subagent_progress":
        run.taskId = event.payload.agentId;
        run.status = event.payload.description;
        run.lastTool = event.payload.lastTool;
        break;
      case "subagent_completed":
        run.taskId = event.payload.agentId;
        run.done = true;
        run.usage = event.payload.usage;
        break;
      default:
        // Only real work goes in the body; the lifecycle events above drive the
        // header and the live status line instead.
        run.events.push(event);
    }
  }

  // A second pass, because the spawning call is logged before the `task_started`
  // that creates the run — the tool_use block lands in the assistant message
  // first.
  for (const run of subagentById.values()) {
    run.spawn = callById.get(run.id) ?? null;
  }

  const mainThread = events.filter((event) => !event.subagent);

  return {
    events: mainThread,
    // `subagentById` is keyed by the spawning call's id, so its key set is
    // exactly the calls that render as a `SubagentRow` and must not group.
    turns: groupTurns(mainThread, new Set(subagentById.keys())),
    // Newest first. The map is keyed in spawn order, which put the run the
    // reader is waiting on at the bottom of a list that only ever grows — and
    // the panel keeps its scroll position, so a long session opened the tab on
    // whatever was running an hour ago. `subagentById` keeps insertion order for
    // everything that looks a run up by id.
    subagents: [...subagentById.values()].reverse(),
    subagentById,
    resultByCallId,
    pendingAsks,
  };
}
