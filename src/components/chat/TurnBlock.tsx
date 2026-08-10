import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import AssistantMessage from "@/components/chat/AssistantMessage";
import EventRow from "@/components/chat/EventRow";
import SubagentRow from "@/components/chat/SubagentRow";
import ToolGroupRow from "@/components/chat/ToolGroupRow";
import UserMessage from "@/components/chat/UserMessage";
import { GROUP_MIN, isToolGroup, type SubagentRun, type Turn } from "@/lib/transcript";
import { cn } from "@/lib/utils";
import type { ToolResult } from "@/types/events";

type TurnBlockProps = {
  turn: Turn;
  subagentById: Map<string, SubagentRun>;
  resultByCallId: Map<string, ToolResult>;
  onOpenSubagent: (id: string) => void;
  /// Trails the turn's work inside this block's own stack. The thinking
  /// indicator and the streaming preview both go here rather than after the
  /// block, so they sit at the same gap the committed event will — placing them
  /// outside left them at the between-turn gap, and the content that replaced
  /// them jumped up by the difference.
  footer?: ReactNode;
};

/// How many rendered rows a turn must have before it collapses behind its
/// summary. Fewer than this and the collapse costs a click to reveal less than
/// the summary line it stood in for.
///
/// Separate from `GROUP_MIN` because they answer different questions — that one
/// is how many *calls* make a group, this is how many *rows* make a collapse —
/// but not independent of it: grouping runs first, so a group is already one row
/// by the time this counts. Keeping this at or above `GROUP_MIN` is what stops a
/// run too short to group from collapsing a turn on its own.
const COLLAPSE_MIN = 3;

// Tune either constant freely, but not past the other: this throws on load
// rather than letting the pairing silently reintroduce ungrouped repeats inside
// a collapsed turn.
if (GROUP_MIN > COLLAPSE_MIN) {
  throw new Error(
    `GROUP_MIN (${GROUP_MIN}) must not exceed COLLAPSE_MIN (${COLLAPSE_MIN}) — ` +
      "runs too short to group would still collapse a turn on their own.",
  );
}

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
  footer,
}: TurnBlockProps) {
  const [open, setOpen] = useState(false);

  const running = turn.completed === null;

  const parts: string[] = [];
  if (turn.toolCalls) parts.push(plural(turn.toolCalls, "tool call"));
  if (turn.messages) parts.push(plural(turn.messages, "message"));

  // `finalText` duplicates the turn's last `assistant_text`, so the collapsed
  // view renders it in that message's place rather than alongside it. A running
  // turn has no `finalText` yet, so its work stays visible instead.
  //
  // `rows` rather than `work.length` or the summary counts: a turn whose only
  // work *is* that final message has nothing left to reveal and would offer an
  // empty toggle. See `COLLAPSE_MIN` for why the threshold is what it is.
  const collapsible = !running && turn.rows >= COLLAPSE_MIN;
  const showWork = open || !collapsible;

  return (
    <div className="flex flex-col gap-3">
      {turn.prompt && <UserMessage {...userProps(turn)} />}

      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="group/turn flex items-center gap-2 text-left text-chat text-muted-foreground"
        >
          <span>{parts.join(" · ")}</span>
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-all",
              open ? "rotate-90 opacity-100" : "opacity-0 group-hover/turn:opacity-100",
            )}
          />
        </button>
      )}

      {showWork &&
        turn.work.map((item) => {
          if (isToolGroup(item)) {
            return (
              <ToolGroupRow key={item.key} group={item} resultByCallId={resultByCallId} />
            );
          }

          const run =
            item.payload.type === "tool_call_started"
              ? subagentById.get(item.payload.callId)
              : undefined;

          return run ? (
            <SubagentRow key={item.id} run={run} onOpen={onOpenSubagent} />
          ) : (
            <EventRow
              key={item.id}
              event={item}
              resultByCallId={resultByCallId}
            />
          );
        })}

      {/* Collapsed, this stands in for the turn's last message; expanded, that
          message already rendered above, so it would be a duplicate. */}
      {!showWork && turn.finalText && <AssistantMessage text={turn.finalText} />}

      {footer}

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
