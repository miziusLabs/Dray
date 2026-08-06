import { useMemo } from "react";
import { GitBranch, PanelLeftClose, PanelLeftOpen, SquarePen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { basename, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SessionIndexItem } from "@/types/events";

type SidebarProps = {
  items: SessionIndexItem[];
  selectedSessionId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (sessionId: string) => Promise<void>;
  onNewSession: () => void;
};

type ProjectGroup = { path: string; items: SessionIndexItem[] };

/// Groups on `projectPath` rather than `cwd` so a worktree session lists under its
/// repo instead of becoming a project of its own. Done here rather than through the
/// backend's `list_sessions_by_project`, which has no generated TS type.
function groupByProject(items: SessionIndexItem[]): ProjectGroup[] {
  const groups = new Map<string, SessionIndexItem[]>();

  for (const item of items) {
    const existing = groups.get(item.projectPath);
    if (existing) existing.push(item);
    else groups.set(item.projectPath, [item]);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
  }

  // Most recently touched project first, so the group you're working in stays on top.
  return [...groups.entries()]
    .map(([path, groupItems]) => ({ path, items: groupItems }))
    .sort((a, b) => Date.parse(b.items[0].modified) - Date.parse(a.items[0].modified));
}

export default function Sidebar({
  items,
  selectedSessionId,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onNewSession,
}: SidebarProps) {
  const groups = useMemo(() => groupByProject(items), [items]);

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar pb-3">
        <div className="h-(--titlebar-h) w-full" data-tauri-drag-region />
        <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} title="Show sidebar">
          <PanelLeftOpen />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onNewSession} title="New session">
          <SquarePen />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Traffic lights sit over this strip, so it stays empty and draggable. */}
      <div className="h-(--titlebar-h) shrink-0" data-tauri-drag-region />

      <div className="flex items-center justify-between px-2 pb-2" data-tauri-drag-region>
        <span className="pl-1 text-ui font-medium text-sidebar-foreground/60">Sessions</span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" onClick={onNewSession} title="New session">
            <SquarePen />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapsed}
            title="Hide sidebar"
          >
            <PanelLeftClose />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-ui text-muted-foreground">
            No sessions yet. Start one below.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.path} className="mb-3">
              <h2
                className="truncate px-2 py-1 text-ui font-medium text-muted-foreground"
                title={group.path}
              >
                {basename(group.path)}
              </h2>

              <div className="flex flex-col gap-px">
                {group.items.map((item) => (
                  <SessionRow
                    key={item.sessionId}
                    item={item}
                    active={item.sessionId === selectedSessionId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}

function SessionRow({
  item,
  active,
  onSelect,
}: {
  item: SessionIndexItem;
  active: boolean;
  onSelect: (sessionId: string) => Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={() => void onSelect(item.sessionId)}
      title={item.title}
      className={cn(
        "group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
      )}
    >
      <span className="truncate text-ui">{item.title}</span>

      <span className="flex items-center gap-1.5 text-ui text-muted-foreground">
        {item.worktreeName && (
          <>
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{item.worktreeName}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className="shrink-0">{relativeTime(item.modified)}</span>
      </span>
    </button>
  );
}
