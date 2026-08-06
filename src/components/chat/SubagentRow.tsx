import { Bot, ChevronRight } from "lucide-react";

import type { SubagentRun } from "@/lib/transcript";

/// The subagent's place in the main conversation: one compact row. It never
/// expands inline — clicking opens the subagent panel, which is where the run's
/// events actually live.
export default function SubagentRow({
  run,
  onOpen,
}: {
  run: SubagentRun;
  onOpen: (id: string) => void;
}) {
  const label = run.label ?? "Subagent";
  // While running, `status` is rewritten per progress event, so it reads as a
  // live status line without opening anything.
  const detail = run.done ? run.description : run.status ?? run.description;

  return (
    <button
      type="button"
      onClick={() => onOpen(run.id)}
      className="group flex w-full items-center gap-2 text-left text-chat"
    >
      <Bot className="size-3.5 shrink-0 text-accent-thinking" />
      <span className="shrink-0 font-medium text-foreground/80">{label}</span>

      {detail && (
        <span className="min-w-0 max-w-fit truncate text-muted-foreground">{detail}</span>
      )}

      <ChevronRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />

      <span className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground/70">
        <span>{run.events.length} steps</span>
        {!run.done && (
          <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
        )}
      </span>
    </button>
  );
}
