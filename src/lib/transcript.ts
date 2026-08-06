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

export type Turn = {
  /// The user's prompt opening this turn, absent only for a transcript that
  /// starts mid-conversation.
  prompt: AgentEvent | null;
  /// Everything the agent did between the prompt and completion — tool calls,
  /// subagent spawns, reasoning, and its intermediate messages.
  work: AgentEvent[];
  /// The closing `turn_completed`, absent while the turn is still running.
  completed: AgentEvent | null;
  /// `turn_completed.finalText`, which is a verbatim copy of the turn's last
  /// `assistant_text` — so showing both would print the answer twice.
  finalText: string | null;
  toolCalls: number;
  messages: number;
  key: string;
};

/// `seq` is the ordering key — most Claude Code events carry no usable `ts`.
function bySeq(a: AgentEvent, b: AgentEvent) {
  return a.seq - b.seq;
}

/// Cuts the main thread into turns: each runs from a user prompt to the
/// `turn_completed` that closes it. A turn's intermediate work collapses behind
/// one summary line, leaving the prompt and the final answer as the default view.
function groupTurns(events: AgentEvent[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  const open = (prompt: AgentEvent | null, key: string): Turn => ({
    prompt,
    work: [],
    completed: null,
    finalText: null,
    toolCalls: 0,
    messages: 0,
    key,
  });

  for (const event of events) {
    if (event.payload.type === "user_message") {
      if (current) turns.push(current);
      current = open(event, event.id);
      continue;
    }

    // Events before any prompt still need a home — a resumed session replays
    // the log from wherever it was truncated.
    current ??= open(null, `head-${event.id}`);

    if (event.payload.type === "turn_completed") {
      current.completed = event;
      current.finalText = event.payload.finalText;
      turns.push(current);
      current = null;
      continue;
    }

    if (event.payload.type === "tool_call_started") current.toolCalls += 1;
    if (event.payload.type === "assistant_text") current.messages += 1;
    current.work.push(event);
  }

  if (current) turns.push(current);
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
    turns: groupTurns(mainThread),
    subagents: [...subagentById.values()],
    subagentById,
    resultByCallId,
  };
}
