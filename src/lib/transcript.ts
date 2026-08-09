import { toolSummary } from "@/lib/tools";
import type { AgentEvent, ToolResult, Usage } from "@/types/events";

export type SubagentRun = {
  /// The spawning tool call's id — what the envelope correlates on, and the key
  /// the panel selects by.
  id: string;
  label: string | null;
  description: string | null;
  /// Latest `subagent_progress.description`, rewritten per event by the harness.
  status: string | null;
  lastTool: string | null;
  done: boolean;
  usage: Usage | null;
  /// The subagent's own work, excluding its lifecycle events.
  events: AgentEvent[];
};

/// A run of consecutive same-tool calls, collapsed behind one row. Built from
/// the turn's work so the renderer walks a single list rather than re-deriving
/// the runs while it draws.
export type ToolGroup = {
  kind: "tool_group";
  /// The tool every call in the run shares — the grouping key.
  name: string;
  /// The spawning events, in `seq` order. Never fewer than `GROUP_MIN`.
  calls: AgentEvent[];
  /// Distinct targets across the run, which is what the label counts — three
  /// edits to one file is "Edited 1 file", not 3. Falls back to the call count
  /// for a tool whose calls carry no identifying field.
  targets: number;
  key: string;
};

/// Either a lone event or a collapsed run of same-tool calls.
export type WorkItem = AgentEvent | ToolGroup;

export function isToolGroup(item: WorkItem): item is ToolGroup {
  return "kind" in item && item.kind === "tool_group";
}

export type Turn = {
  /// The user's prompt opening this turn, absent only for a transcript that
  /// starts mid-conversation.
  prompt: AgentEvent | null;
  /// Everything the agent did between the prompt and completion — tool calls,
  /// subagent spawns, reasoning, and its intermediate messages. Runs of
  /// consecutive same-tool calls arrive pre-collapsed into a `ToolGroup`.
  work: WorkItem[];
  /// The closing `turn_completed`, absent while the turn is still running.
  completed: AgentEvent | null;
  /// `turn_completed.finalText`, which is a verbatim copy of the turn's last
  /// `assistant_text` — so showing both would print the answer twice.
  finalText: string | null;
  toolCalls: number;
  messages: number;
  /// How many rows collapsing this turn would actually hide — groups count as
  /// one, events the transcript renders nothing for count as none, and the
  /// message duplicated into `finalText` counts as none because the collapsed
  /// view shows it anyway. What the toggle is worth is a function of this, not
  /// of `work.length`.
  rows: number;
  key: string;
};

/// Payload types that put something on screen — the complement of the
/// `return null` arms in [EventRow](../components/chat/EventRow.tsx). Keep the
/// two in step, or a turn miscounts what expanding it would reveal.
const RENDERS = new Set([
  "assistant_text",
  "reasoning",
  "tool_call_started",
  "file_edits",
  "error",
  "context_compacted",
]);

/// Whether an item draws a row. A group always does — it is built from tool
/// calls, which always draw.
export function rendersRow(item: WorkItem): boolean {
  return isToolGroup(item) || RENDERS.has(item.payload.type);
}

/// `seq` is the ordering key — most Claude Code events carry no usable `ts`.
function bySeq(a: AgentEvent, b: AgentEvent) {
  return a.seq - b.seq;
}

/// How many consecutive same-tool calls collapse into one group row.
///
/// Any repeat groups. Consistency is the point: the tool name never appears
/// twice in a row, so a run reads the same whether it is two calls or thirty.
///
/// Constrained by `COLLAPSE_MIN` in [TurnBlock](../components/chat/TurnBlock.tsx):
/// keep this at or below it. A run too short to group still costs a row each,
/// so raising this above the collapse threshold puts ungrouped repeats inside a
/// collapsed turn — expand it and you find two rows of the same tool under a
/// summary, which is the double summary the row count exists to prevent. That
/// is exactly what a 3/3 pairing did before: a run of 2 grouped nowhere and
/// collapsed anyway.
export const GROUP_MIN = 2;

/// Bookkeeping the summary count needs while a turn is open, dropped from the
/// `Turn` handed to the UI.
type OpenTurn = Omit<Turn, "work" | "rows"> & {
  /// Ungrouped while the turn is open; `groupTools` runs once on close.
  work: AgentEvent[];
  lastWasAssistantText: boolean;
};

/// The grouping key: same tool name, and only for calls that render as a
/// `ToolCall` row. A subagent spawn draws a `SubagentRow` instead, so folding
/// several into a "Task 4 calls" row would hide the panel links they exist for.
function groupKey(event: AgentEvent, subagentIds: Set<string>): string | null {
  const { payload } = event;
  if (payload.type !== "tool_call_started") return null;
  if (payload.toolType === "subagent_spawn") return null;
  if (subagentIds.has(payload.callId)) return null;
  return payload.name;
}

/// Events that draw nothing of their own and so cannot break a run. A
/// `tool_call_completed` lands between every pair of calls — it is consumed via
/// `resultByCallId` rather than rendered — so treating it as a breaker would
/// mean no run ever exceeds length 1.
const TRANSPARENT = new Set([
  "tool_call_completed",
  "turn_started",
  "usage_update",
  "hook",
  "settings_changed",
  "delta",
  "unknown",
]);

/// Distinct summaries across a run — the same string a row shows, so the label
/// counts exactly what the reader will see listed. A call with no summary counts
/// as its own target: it is something that happened, just unnamed.
function countTargets(run: AgentEvent[]): number {
  const seen = new Set<string>();
  let unnamed = 0;
  for (const event of run) {
    if (event.payload.type !== "tool_call_started") continue;
    const { title, name, toolType, input } = event.payload;
    const summary = title ?? toolSummary(name, toolType, input);
    if (summary === null) unnamed += 1;
    else seen.add(summary);
  }
  return seen.size + unnamed;
}

/// Collapses runs of `GROUP_MIN`+ consecutive calls to the same tool into one
/// item. Only *consecutive* runs group: anything the transcript actually draws
/// between them — a message, a reasoning block — is the agent changing subject,
/// and swallowing that into a single row would reorder the transcript.
///
/// `calls` holds only the spawning events. The transparent events that fell
/// between them are re-emitted after the group — they draw nothing, so their
/// exact position among the calls carries no meaning, and keeping `calls` pure
/// means the row can count it directly.
function groupTools(work: AgentEvent[], subagentIds: Set<string>): WorkItem[] {
  const items: WorkItem[] = [];
  let run: AgentEvent[] = [];
  let runKey: string | null = null;
  // Transparent events seen since the last call. Held rather than emitted so a
  // run that continues past them isn't broken in two.
  let held: AgentEvent[] = [];
  // The held events from *inside* a run, which must outlive `held` being reset
  // as the run continues.
  let passthrough: AgentEvent[] = [];

  const flush = () => {
    if (runKey !== null && run.length >= GROUP_MIN) {
      items.push({
        kind: "tool_group",
        name: runKey,
        calls: run,
        targets: countTargets(run),
        key: `group-${run[0].id}`,
      });
    } else {
      items.push(...run);
    }
    items.push(...passthrough, ...held);
    run = [];
    held = [];
    passthrough = [];
    runKey = null;
  };

  for (const event of work) {
    if (runKey !== null && TRANSPARENT.has(event.payload.type)) {
      held.push(event);
      continue;
    }

    const key = groupKey(event, subagentIds);
    if (key !== null && key === runKey) {
      run.push(event);
      passthrough.push(...held);
      held = [];
      continue;
    }

    flush();
    if (key !== null) {
      run = [event];
      runKey = key;
    } else {
      items.push(event);
    }
  }
  flush();

  return items;
}

/// Cuts the main thread into turns: each runs from a user prompt to the
/// `turn_completed` that closes it. A turn's intermediate work collapses behind
/// one summary line, leaving the prompt and the final answer as the default view.
function groupTurns(events: AgentEvent[], subagentIds: Set<string>): Turn[] {
  const turns: Turn[] = [];
  let current: OpenTurn | null = null;

  // A turn is only pushed once, here, so the tool grouping runs exactly once
  // per turn rather than on every render.
  const close = (turn: OpenTurn) => {
    const { lastWasAssistantText, ...rest } = turn;
    const work = groupTools(turn.work, subagentIds);
    // The collapsed view renders `finalText` in place of the message it copies,
    // so that row is on screen either way and collapsing does not hide it. The
    // same condition that discounts it from `messages` applies here.
    const duplicated = turn.finalText !== null && lastWasAssistantText ? 1 : 0;
    turns.push({ ...rest, work, rows: work.filter(rendersRow).length - duplicated });
  };

  const open = (prompt: AgentEvent | null, key: string): OpenTurn => ({
    prompt,
    work: [],
    completed: null,
    finalText: null,
    toolCalls: 0,
    messages: 0,
    key,
    lastWasAssistantText: false,
  });

  for (const event of events) {
    if (event.payload.type === "user_message") {
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
      // The final answer renders in the collapsed view, so it isn't work the
      // summary hides. Only discount it when it really is the last
      // `assistant_text` — an interrupted turn has no `finalText` at all, and a
      // tool call after the last message means the copy is of an earlier one.
      if (current.finalText !== null && current.lastWasAssistantText) {
        current.messages -= 1;
      }
      close(current);
      current = null;
      continue;
    }

    if (event.payload.type === "tool_call_started") current.toolCalls += 1;
    if (event.payload.type === "assistant_text") current.messages += 1;
    current.lastWasAssistantText = event.payload.type === "assistant_text";
    current.work.push(event);
  }

  // The open trailing turn groups too — a run of reads collapses as it arrives
  // rather than only once the turn closes. A run still below `GROUP_MIN` renders
  // as loose rows until the call that reaches it, which is the same thing the
  // reader would see anyway.
  if (current) close(current);
  return turns;
}

/// Splits the event log into the main thread and the subagent runs the panel
/// lists.
///
/// Correlation is `envelope.subagent.id === the spawning call's callId`, not the
/// `agentId` on the subagent payloads — that is the harness's own handle and
/// matches nothing else.
export function buildTranscript(source: AgentEvent[]): {
  /// Main-thread events only, in `seq` order. Subagent work is excluded; the
  /// spawning tool call stays so the chat can show a row linking to the panel.
  events: AgentEvent[];
  /// The same main-thread events, cut into user-prompt-to-turn-completed spans.
  turns: Turn[];
  subagents: SubagentRun[];
  subagentById: Map<string, SubagentRun>;
  resultByCallId: Map<string, ToolResult>;
} {
  const events = [...source].sort(bySeq);

  const resultByCallId = new Map<string, ToolResult>();
  for (const event of events) {
    if (event.payload.type === "tool_call_completed") {
      resultByCallId.set(event.payload.callId, event.payload.result);
    }
  }

  const subagentById = new Map<string, SubagentRun>();
  for (const event of events) {
    const ref = event.subagent;
    if (!ref) continue;

    let run = subagentById.get(ref.id);
    if (!run) {
      run = {
        id: ref.id,
        label: ref.label,
        description: null,
        status: null,
        lastTool: null,
        done: false,
        usage: null,
        events: [],
      };
      subagentById.set(ref.id, run);
    }

    // The envelope label is null on some events (the completion, notably), so
    // keep the first non-null rather than letting a later one erase it.
    run.label ??= ref.label;

    switch (event.payload.type) {
      case "subagent_started":
        run.label ??= event.payload.label;
        run.description = event.payload.description;
        break;
      case "subagent_progress":
        run.status = event.payload.description;
        run.lastTool = event.payload.lastTool;
        break;
      case "subagent_completed":
        run.done = true;
        run.usage = event.payload.usage;
        break;
      default:
        // Only real work goes in the body; the lifecycle events above drive the
        // header and the live status line instead.
        run.events.push(event);
    }
  }

  const mainThread = events.filter((event) => !event.subagent);

  return {
    events: mainThread,
    // `subagentById` is keyed by the spawning call's id, so its key set is
    // exactly the calls that render as a `SubagentRow` and must not group.
    turns: groupTurns(mainThread, new Set(subagentById.keys())),
    subagents: [...subagentById.values()],
    subagentById,
    resultByCallId,
  };
}
