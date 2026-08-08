import { useState } from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

import AssistantMessage from "@/components/chat/AssistantMessage";
import EventRow from "@/components/chat/EventRow";
import SubagentRow from "@/components/chat/SubagentRow";
import UserMessage from "@/components/chat/UserMessage";
import type { SubagentRun, Turn } from "@/lib/transcript";
import { cn } from "@/lib/utils";
import type { ToolResult } from "@/types/events";

type TurnBlockProps = {
  turn: Turn;
  subagentById: Map<string, SubagentRun>;
  resultByCallId: Map<string, ToolResult>;
  onOpenSubagent: (id: string) => void;
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/// One turn: the user's prompt, a collapsed summary of the work, and the final
/// answer. Expanding reveals the intermediate steps.
export default function TurnBlock({
  turn,
  subagentById,
  resultByCallId,
  onOpenSubagent,
}: TurnBlockProps) {
  const [open, setOpen] = useState(false);

  const running = turn.completed === null;

  const parts: string[] = [];
  if (turn.toolCalls) parts.push(plural(turn.toolCalls, "tool call"));
  if (turn.messages) parts.push(plural(turn.messages, "message"));

  // `finalText` duplicates the turn's last `assistant_text`, so the collapsed
  // view renders it in that message's place rather than alongside it. A running
  // turn has no `finalText` yet, so its work stays visible instead. Gate on the
  // summary rather than `work.length`: a turn whose only work *is* that final
  // message has nothing left to reveal, and would offer an empty toggle.
  const collapsible = !running && parts.length > 0;
  const showWork = open || !collapsible;

  return (
    <div className="flex flex-col gap-2">
      {turn.prompt && <UserMessage {...userProps(turn)} />}

      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="group/turn flex items-center gap-2 text-left text-chat text-muted-foreground"
        >
          <span>{parts.join(" · ")}</span>
          <ChevronRightIcon
            className={cn(
              "size-3 shrink-0 transition-all",
              open ? "rotate-90 opacity-100" : "opacity-0 group-hover/turn:opacity-100",
            )}
          />
        </button>
      )}

      {showWork &&
        turn.work.map((event) => {
          const run =
            event.payload.type === "tool_call_started"
              ? subagentById.get(event.payload.callId)
              : undefined;

          return run ? (
            <SubagentRow key={event.id} run={run} onOpen={onOpenSubagent} />
          ) : (
            <EventRow key={event.id} event={event} resultByCallId={resultByCallId} />
          );
        })}

      {/* Collapsed, this stands in for the turn's last message; expanded, that
          message already rendered above, so it would be a duplicate. */}
      {!showWork && turn.finalText && <AssistantMessage text={turn.finalText} />}

      {turn.completed && (
        <EventRow
          event={turn.completed}
          resultByCallId={resultByCallId}
        />
      )}
    </div>
  );
}

/// `prompt` is always a `user_message` here — the grouping only opens a turn on
/// one — but the payload union has to be narrowed for the props to typecheck.
function userProps(turn: Turn) {
  const payload = turn.prompt?.payload;
  return payload?.type === "user_message"
    ? { text: payload.text, images: payload.images }
    : { text: "" };
}
