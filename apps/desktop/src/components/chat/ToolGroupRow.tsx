import { useState } from "react";
import { ChevronRight } from "lucide-react";

import EventRow from "@/components/chat/EventRow";
import StreamingToolCall from "@/components/chat/StreamingToolCall";
import ToolCallIcon from "@/components/chat/ToolCallIcon";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { streamingCall } from "@/lib/streaming";
import { streamingLabel, toolGroupLabel, toolLabel, toolSummary } from "@/lib/tools";
import type { ToolGroup } from "@/lib/transcript";
import { cn } from "@/lib/utils";
import type { ToolResult, ToolType } from "@/types/events";

type StreamingTool = {
  name: string;
  partialJson: string;
};

type ActiveCall = {
  name: string;
  toolType: ToolType;
  label: string;
  target: string | null;
};

/// A heterogeneous run of consecutive calls. Its resting title summarizes the
/// actions; expanding reveals fully labeled, independently expandable calls.
export default function ToolGroupRow({
  group,
  resultByCallId,
  streamingTool,
}: {
  group: ToolGroup;
  resultByCallId: Map<string, ToolResult>;
  streamingTool?: StreamingTool | null;
}) {
  const [open, setOpen] = useState(false);

  const calls = group.calls.flatMap((event) =>
    event.payload.type === "tool_call_started" ? [event.payload] : [],
  );
  const first = calls[0];
  const pending = [...calls]
    .reverse()
    .find((call) => !resultByCallId.has(call.callId));

  let active: ActiveCall | null = null;
  if (streamingTool) {
    const target = streamingCall(streamingTool.name, streamingTool.partialJson).target;
    active = {
      name: streamingTool.name,
      toolType: "other",
      label: target ? toolLabel(streamingTool.name, true) : streamingLabel(streamingTool.name),
      target,
    };
  } else if (pending) {
    const target = pending.title ?? toolSummary(pending.name, pending.toolType, pending.input);
    active = {
      name: pending.name,
      toolType: pending.toolType,
      label: target ? toolLabel(pending.name, true) : streamingLabel(pending.name),
      target,
    };
  }

  // A collapsed live group becomes the active call, exactly where the settled
  // aggregate sat. If the reader has it open, preserve the title and append the
  // live row to the list instead.
  const showActiveTitle = !open && active !== null;
  const icon = showActiveTitle ? active : first;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1.5">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left text-chat text-muted-foreground"
        >
          {icon && <ToolCallIcon name={icon.name} toolType={icon.toolType} />}

          {showActiveTitle && active ? (
            <span className="flex min-w-0 items-baseline gap-1.5 shimmer-text">
              <span className="shrink-0">{active.label}</span>
              {active.target && <span className="truncate font-mono">{active.target}</span>}
            </span>
          ) : (
            <span className="min-w-0 truncate">{toolGroupLabel(calls)}</span>
          )}

          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="collapsible-smooth">
        <div className="flex flex-col gap-1.5">
          {group.calls.map((event) => (
            <EventRow key={event.id} event={event} resultByCallId={resultByCallId} />
          ))}
          {streamingTool && <StreamingToolCall {...streamingTool} />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
