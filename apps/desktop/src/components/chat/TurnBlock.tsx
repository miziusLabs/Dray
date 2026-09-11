import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import AssistantMessage from "@/components/chat/AssistantMessage";
import EventRow from "@/components/chat/EventRow";
import StreamingToolCall from "@/components/chat/StreamingToolCall";
import ToolGroupRow from "@/components/chat/ToolGroupRow";
import UserMessage from "@/components/chat/UserMessage";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  isToolGroup,
  rendersWorkItem,
  type Turn,
  type WorkItem,
} from "@/lib/transcript";
import { formatDuration } from "@/lib/tools";
import { cn } from "@/lib/utils";
import type { ToolResult } from "@/types/events";

type StreamingTool = {
  name: string;
  partialJson: string;
};

type TurnBlockProps = {
  turn: Turn;
  resultByCallId: Map<string, ToolResult>;
  onOpenSession: (sessionId: string) => void;
  cwd?: string | null;
  footer?: ReactNode;
  /// Whether this is the trailing turn of a session with a live agent process.
  /// An unclosed turn can remain in the transcript after Stop, so the missing
  /// completion event alone is not enough to decide that its timer is running.
  live: boolean;
  /// A not-yet-committed tool block. When it follows an existing collapsed
  /// group, that group's title temporarily becomes this active state.
  streamingTool?: StreamingTool | null;
};

function firstEventTime(turn: Turn): number | null {
  const firstWork = turn.work[0];
  const first =
    turn.prompt ?? (firstWork && isToolGroup(firstWork) ? firstWork.calls[0] : firstWork);
  const parsed = Date.parse(first?.ts ?? turn.completed?.ts ?? "");
  return Number.isNaN(parsed) ? null : parsed;
}

function useTurnDuration(turn: Turn, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Capture both edges: the first tick starts from the moment the turn becomes
    // live, and the final one freezes at the moment the process stops even when
    // no `turn_completed` event was emitted.
    setNow(Date.now());
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (
    turn.completed?.payload.type === "turn_completed" &&
    turn.completed.payload.durationMs != null
  ) {
    return turn.completed.payload.durationMs;
  }

  const start = firstEventTime(turn);
  if (start === null) return 0;
  const end = running ? now : Date.parse(turn.completed?.ts ?? "");
  return Math.max(0, (Number.isNaN(end) ? start : end) - start);
}

/// One turn: the prompt, a “Worked for …” disclosure containing every
/// intermediate step, a divider, then the final answer. Live work is forced
/// open; the same section closes automatically as soon as the turn completes.
export default function TurnBlock({
  turn,
  resultByCallId,
  onOpenSession,
  cwd = null,
  footer,
  live,
  streamingTool = null,
}: TurnBlockProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const running = live && turn.completed === null;
  const open = running || detailsOpen;
  const duration = useTurnDuration(turn, running);

  const trailingItem = [...turn.work].reverse().find(rendersWorkItem);
  const streamingGroup =
    streamingTool && trailingItem && isToolGroup(trailingItem) ? trailingItem : null;

  return (
    <div className="flex flex-col gap-3">
      {turn.prompt && <UserMessage {...userProps(turn)} cwd={cwd} onOpenSession={onOpenSession} />}

      <Collapsible
        open={open}
        onOpenChange={(next) => {
          if (!running) setDetailsOpen(next);
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1.5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                "group/worked flex w-fit items-center gap-2 text-left text-chat text-muted-foreground",
                running ? "cursor-default" : "cursor-pointer",
              )}
            >
              <span>Worked for {formatDuration(duration)}</span>
              <ChevronRight
                className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")}
              />
            </button>
          </CollapsibleTrigger>

          <div className="border-t border-border" />
        </div>

        <CollapsibleContent className="collapsible-smooth">
          <div className="flex flex-col gap-3">
            {turn.work.map((item) =>
              renderItem(
                item,
                resultByCallId,
                onOpenSession,
                cwd,
                item === streamingGroup ? streamingTool : null,
              ),
            )}
            {streamingTool && !streamingGroup && <StreamingToolCall {...streamingTool} />}
            {footer}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {turn.finalText && <AssistantMessage text={turn.finalText} cwd={cwd} />}

      {turn.completed && (
        <EventRow event={turn.completed} resultByCallId={resultByCallId} cwd={cwd} />
      )}
    </div>
  );
}

function renderItem(
  item: WorkItem,
  resultByCallId: Map<string, ToolResult>,
  onOpenSession: (sessionId: string) => void,
  cwd: string | null,
  streamingTool: StreamingTool | null,
) {
  if (isToolGroup(item)) {
    return (
      <ToolGroupRow
        key={item.key}
        group={item}
        resultByCallId={resultByCallId}
        streamingTool={streamingTool}
      />
    );
  }

  return (
    <EventRow
      key={item.id}
      event={item}
      resultByCallId={resultByCallId}
      onOpenSession={onOpenSession}
      cwd={cwd}
    />
  );
}

function userProps(turn: Turn) {
  const payload = turn.prompt?.payload;
  return payload?.type === "user_message"
    ? { text: payload.text, images: payload.images, from: payload.from }
    : { text: "" };
}
