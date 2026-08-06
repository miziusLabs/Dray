import {
  Bot,
  FilePen,
  FileText,
  Globe,
  Plug,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ToolType } from "@/types/events";

const ICONS: Record<ToolType, typeof Wrench> = {
  shell: Terminal,
  file_read: FileText,
  file_edit: FilePen,
  search: Search,
  web: Globe,
  mcp: Plug,
  subagent_spawn: Bot,
  other: Wrench,
};

type ToolCallRowProps = {
  name: string;
  toolType: ToolType;
  title: string | null;
  /// `undefined` while the call is still in flight.
  isError?: boolean;
};

/// Deliberately one line this pass. Rich argument and result rendering is the next
/// pass; `toolType` is only a hint, so `other` has to look fine too.
export default function ToolCallRow({
  name,
  toolType,
  title,
  isError,
}: ToolCallRowProps) {
  const Icon = ICONS[toolType] ?? Wrench;
  const pending = isError === undefined;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border/60 bg-surface-raised px-2.5 py-1.5 text-ui",
        isError ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="shrink-0 font-medium text-foreground/80">{name}</span>
      {title && <span className="truncate">{title}</span>}
      {pending && (
        <span className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
      )}
    </div>
  );
}
