import { Cpu } from "lucide-react";

import EventRow from "@/components/chat/EventRow";
import type { SubagentRun } from "@/lib/transcript";
import { cn } from "@/lib/utils";
import type { ToolResult } from "@/types/events";

type SubagentPanelProps = {
  runs: SubagentRun[];
  selectedId: string | null;
  resultByCallId: Map<string, ToolResult>;
  onSelect: (id: string) => void;
};

/// Every subagent in the session, listed, with the selected one's events beside
/// it. A tab of [RightPanel](./RightPanel.tsx), which owns the frame — this is
/// the body only. Reached either from that tab or by clicking a subagent row in
/// the chat, the second with that run already selected.
export default function SubagentPanel({
  runs,
  selectedId,
  resultByCallId,
  onSelect,
}: SubagentPanelProps) {
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0] ?? null;

  if (runs.length === 0) {
    return (
      <p className="px-3 py-6 text-ui text-muted-foreground">No subagents in this session.</p>
    );
  }

  return (
    <>
      <div className="flex max-h-48 shrink-0 flex-col gap-px overflow-y-auto border-b border-border p-2">
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            active={run.id === selected?.id}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {selected ? <SubagentDetail run={selected} resultByCallId={resultByCallId} /> : null}
      </div>
    </>
  );
}

function RunRow({
  run,
  active,
  onSelect,
}: {
  run: SubagentRun;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(run.id)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
      )}
    >
      <Cpu className="size-3.5 shrink-0 text-accent-thinking" />
      <span className="shrink-0 font-medium">{run.label ?? "Subagent"}</span>
      {run.description && (
        <span className="truncate text-muted-foreground">{run.description}</span>
      )}
      {!run.done && (
        <span className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
      )}
    </button>
  );
}

function SubagentDetail({
  run,
  resultByCallId,
}: {
  run: SubagentRun;
  resultByCallId: Map<string, ToolResult>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="text-chat font-medium">{run.label ?? "Subagent"}</h2>
        {run.description && (
          <p className="text-ui text-muted-foreground">{run.description}</p>
        )}
        <p className="text-ui text-muted-foreground/60">
          {run.done ? "Completed" : run.status ?? "Running"}
          {run.usage?.totalTokens != null &&
            ` · ${run.usage.totalTokens.toLocaleString()} tokens`}
        </p>
      </header>

      <div className="flex flex-col gap-2">
        {run.events.map((event) => (
          <EventRow key={event.id} event={event} resultByCallId={resultByCallId} />
        ))}
      </div>
    </div>
  );
}
