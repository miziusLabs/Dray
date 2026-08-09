import { useState } from "react";
import { ChevronRight } from "lucide-react";

import EventRow from "@/components/chat/EventRow";
import { groupLabel, groupVerb } from "@/lib/tools";
import type { ToolGroup } from "@/lib/transcript";
import { cn } from "@/lib/utils";
import type { ToolResult } from "@/types/events";

/// A run of consecutive same-tool calls behind one row. Expanding reveals the
/// individual calls, each still its own independently expandable `ToolCall`.
export default function ToolGroupRow({
  group,
  resultByCallId,
}: {
  group: ToolGroup;
  resultByCallId: Map<string, ToolResult>;
}) {
  const [open, setOpen] = useState(false);

  // Any call still awaiting its result keeps the group live, so a run that
  // collapses mid-flight still shows it is working.
  const pending = group.calls.some(
    (event) =>
      event.payload.type === "tool_call_started" &&
      !resultByCallId.has(event.payload.callId),
  );

  const failed = group.calls.some(
    (event) =>
      event.payload.type === "tool_call_started" &&
      resultByCallId.get(event.payload.callId)?.isError,
  );

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="group/group flex w-full items-center gap-2 text-left text-chat text-muted-foreground"
      >
        {/* Styled as the turn summary is, not as a tool row: with the
            double-nesting rule this heads the turn's work where that summary
            otherwise would, so the two must read as the same kind of toggle.
            A group can hold both a failure and a still-running call, and
            pending wins — the shimmer's transparent fill would cancel the
            destructive color and leave the text invisible. */}
        <span
          className={cn(
            "shrink-0",
            pending ? "shimmer-text" : failed && "text-destructive",
          )}
        >
          {group.target
            ? groupVerb(group.name, pending)
            : groupLabel(group.name, group.targets, pending)}
        </span>

        {/* A run that hit one target names it instead of counting to one, so it
            reads like the `ToolCall` rows underneath — same mono, same truncation
            — with the verb above keeping the group's own styling. */}
        {group.target && (
          <span className="min-w-0 max-w-fit truncate font-mono">{group.target}</span>
        )}

        {/* The label counts targets, so repeat visits vanish from it — 30 edits
            across 12 files reads as "12 files". This is the only place that
            gap is visible, and without it a 3-row group can say "1 file". */}
        {group.calls.length > group.targets && (
          <span className="shrink-0">{group.calls.length} calls</span>
        )}

        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-all",
            open ? "rotate-90 opacity-100" : "opacity-0 group-hover/group:opacity-100",
          )}
        />
      </button>

      {/* Indented so the calls read as belonging to the row above rather than
          as siblings that appeared from nowhere. */}
      {open && (
        <div className="flex flex-col gap-1.5 border-l border-border/60 pl-3">
          {group.calls.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              resultByCallId={resultByCallId}
              hideToolLabel
            />
          ))}
        </div>
      )}
    </div>
  );
}
