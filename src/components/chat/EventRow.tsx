import { TriangleAlert } from "lucide-react";

import AssistantMessage from "@/components/chat/AssistantMessage";
import ToolCallRow from "@/components/chat/ToolCallRow";
import UserMessage from "@/components/chat/UserMessage";
import type { AgentEvent } from "@/types/events";

/// The one place event payloads become UI. Later passes extend this switch —
/// subagents, file diffs, hooks, and context compaction all currently fall
/// through to `null`, which renders nothing rather than breaking the transcript.
export default function EventRow({
  event,
  resultByCallId,
}: {
  event: AgentEvent;
  /// Completion state per tool call, so a started call can render its outcome
  /// without the row having to search the event list itself.
  resultByCallId: Map<string, boolean>;
}) {
  const { payload } = event;

  switch (payload.type) {
    case "user_message":
      return <UserMessage text={payload.text} />;

    case "assistant_text":
      return <AssistantMessage text={payload.text} />;

    case "reasoning":
      // Encrypted reasoning carries no readable text — showing an empty block
      // would just be a gap in the transcript.
      if (payload.encrypted || !payload.text.trim()) return null;
      return (
        <p className="border-l-2 border-accent-thinking/40 pl-3 text-ui whitespace-pre-wrap text-muted-foreground italic">
          {payload.text}
        </p>
      );

    case "tool_call_started":
      return (
        <ToolCallRow
          name={payload.name}
          toolType={payload.toolType}
          title={payload.title}
          isError={resultByCallId.get(payload.callId)}
        />
      );

    case "error":
      return (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-ui text-destructive">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{payload.message}</span>
        </div>
      );

    case "turn_completed":
      // Cost is the only figure Claude Code reliably reports; it omits
      // `contextWindow` entirely, so there is no gauge to draw here.
      if (payload.usage?.costUsd == null) return null;
      // Negative top margin pulls the figure up against the message it belongs
      // to, so the transcript's gap reads as separating turns rather than lines.
      return (
        <p className="-mt-2 text-ui text-muted-foreground/60">
          ${payload.usage.costUsd.toFixed(4)}
        </p>
      );

    default:
      return null;
  }
}
