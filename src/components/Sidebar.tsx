import { useMemo } from "react";
import {
  FunnelIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { Check, Pin } from "lucide-react";

import PanelLeftIcon from "@/components/icons/PanelLeftIcon";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFullscreen } from "@/hooks/useFullscreen";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SessionIndexItem } from "@/types/events";

type SidebarProps = {
  items: SessionIndexItem[];
  selectedSessionId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (sessionId: string) => Promise<void>;
  onNewSession: () => void;
  onSetFlags: (
    sessionId: string,
    flags: { archived?: boolean; pinned?: boolean },
  ) => Promise<void>;
};

// Rendered rather than detected per-keystroke: the hotkey itself accepts either
// modifier, so this only decides which symbol the tooltip shows.
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/// Sidebar toggle. Lives outside `Sidebar` because a collapsed sidebar renders
/// nothing at all — the button has to survive its own pane disappearing, so the
/// app header owns it and its y position never moves.
export function SidebarToggle({
  onToggle,
  collapsed = false,
}: {
  onToggle: () => void;
  collapsed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Held back at rest — it's chrome, not content — and brought to full
            strength under the cursor. */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-label="Toggle sidebar"
          className="opacity-80 transition-opacity hover:opacity-100"
        >
          <PanelLeftIcon className="size-4.5" dim={collapsed} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        Toggle Sidebar
        <KbdGroup>
          <Kbd>{IS_MAC ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>B</Kbd>
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  );
}

/// Marks a dev build so it can't be mistaken for the installed app. Gated on
/// `import.meta.env.DEV`, which Vite folds to a constant — the badge and this
/// component are dropped from a production bundle entirely.
export function DevBadge({ className }: { className?: string }) {
  return (
    <span
      // Drag region is opted out of so the label never swallows a window drag.
      className={cn(
        "rounded bg-orange-500/15 px-1.5 py-0.5 font-mono text-[10px] leading-none font-medium tracking-wide text-orange-500 uppercase",
        className,
      )}
      data-tauri-drag-region={false}
    >
      Dev
    </span>
  );
}

export default function Sidebar({
  items,
  selectedSessionId,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onNewSession,
  onSetFlags,
}: SidebarProps) {
  const fullscreen = useFullscreen();

  // Flat and recency-ordered. Project only survives as the filter label above the
  // list, so the same session never appears under two headings.
  const sorted = useMemo(
    () => [...items].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)),
    [items],
  );

  // Collapsed is nothing at all, not a rail. The toggle moves to the app header
  // in that state, which is the one row present either way.
  if (collapsed) return null;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border">
      {/* The toggle shares this strip with the traffic lights, so it sits at the
          right to clear them — except in fullscreen, where they're gone and the
          left edge is free. */}
      <div
        className={cn(
          "flex h-(--titlebar-h) shrink-0 items-center px-2",
          // Left-aligned, the toggle's larger icon would sit 2px inside the
          // buttons below it; nudge it out so every icon shares one edge.
          fullscreen ? "justify-start pl-2.5" : "justify-end",
        )}
        data-tauri-drag-region
      >
        {import.meta.env.DEV && <DevBadge className="mr-auto" />}
        <SidebarToggle onToggle={onToggleCollapsed} />
      </div>

      {/* `px-1.5` on the buttons rather than `size="sm"`'s `px-2.5`, so their
          icons land on the same 12px inset as the toggle above. */}
      <div className="flex flex-col gap-px px-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewSession}
          className="w-full justify-start px-1.5 text-ui"
        >
          <PlusIcon />
          New Task
          <KbdGroup className="ml-auto">
            <Kbd>{IS_MAC ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>N</Kbd>
          </KbdGroup>
        </Button>

        <Button variant="ghost" size="sm" className="w-full justify-start px-1.5 text-ui">
          <MagnifyingGlassIcon />
          Search
        </Button>
      </div>

      {/* Neither control is wired yet — the filter label is where project
          grouping went, and it stays inert until there's a project picker. */}
      <div className="mt-4 flex items-start justify-between py-1 pr-2 pl-3">
        <ProjectFilter />

        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-xs" title="Filter">
            <FunnelIcon />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        {sorted.length === 0 ? (
          <p className="px-2 py-6 text-ui text-muted-foreground">
            No sessions yet. Start one below.
          </p>
        ) : (
          sorted.map((item) => (
            <SessionRow
              key={item.sessionId}
              item={item}
              active={item.sessionId === selectedSessionId}
              onSelect={onSelect}
              onSetFlags={onSetFlags}
            />
          ))
        )}
      </div>
    </aside>
  );
}

const PROJECT_COUNT = 3;

/// The project filter. One dot per project, centered under the label and shown
/// only on hover — the same affordance as a photo carousel. Count is fixed until
/// there's a real project list to drive it.
function ProjectFilter() {
  const activeIndex = 0;

  return (
    <div className="group/projects flex flex-col items-center gap-1">
      <button
        type="button"
        className="text-ui text-muted-foreground transition-colors hover:text-foreground"
      >
        All Projects
      </button>

      {/* Reserved height, so revealing the dots never shifts the row below. */}
      <div className="flex h-1.5 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/projects:opacity-100">
        {Array.from({ length: PROJECT_COUNT }, (_, i) => (
          <span
            key={i}
            className={cn(
              "size-1 rounded-full",
              i === activeIndex ? "bg-foreground/80" : "bg-muted-foreground/30",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/// One hover control on a session row. Stops the click from reaching the row's
/// own handler, so acting on a session never also selects it.
function RowAction({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={active}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          // Set here rather than inherited from the row: the UA stylesheet's own
          // `button { cursor: default }` wins over an inherited value.
          className={cn(
            "cursor-pointer",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function SessionRow({
  item,
  active,
  onSelect,
  onSetFlags,
}: {
  item: SessionIndexItem;
  active: boolean;
  onSelect: (sessionId: string) => Promise<void>;
  onSetFlags: (
    sessionId: string,
    flags: { archived?: boolean; pinned?: boolean },
  ) => Promise<void>;
}) {
  return (
    // A button can't nest a button, so the row is a div with a click handler and
    // the pin/settle controls are the only real buttons inside it.
    <div
      role="button"
      tabIndex={0}
      onClick={() => void onSelect(item.sessionId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void onSelect(item.sessionId);
        }
      }}
      className={cn(
        // No vertical padding: the 24px hover buttons are the tallest thing in
        // the row, so they'd add to any padding here and make the row grow the
        // moment these controls landed. `min-h` keeps the height when they're the
        // only thing not rendered — an empty row still matches a populated one.
        "group relative flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-ui">{item.title}</span>

      {/* One slot for both, sized by the buttons and always holding that width —
          so a long title truncates against it either way and nothing reflows on
          hover. The two children stack via `absolute` on the date and crossfade
          on `opacity` over the same duration, so they never both read at once;
          `visibility` would flip instantly while the button's inherited
          `transition-all` still crossfades, which is what read as an overlap. */}
      <div className="relative flex shrink-0 items-center justify-end self-stretch">
        {/* `pointer-events-none` unconditionally: it's never a target, and a
            faded-but-present element still hit-tests — stacked on `right-0` it
            would otherwise swallow the cursor over the last button, which reads
            as that one button being dead while its neighbour works. */}
        <span className="pointer-events-none absolute right-0 text-ui text-muted-foreground transition-opacity duration-150 group-hover:opacity-0">
          {relativeTime(item.modified)}
        </span>

        {/* `opacity-0` rather than `hidden`: shadcn's button base sets
            `inline-flex`, and Tailwind emits that after `hidden` at equal
            specificity, so a `display` utility here silently loses.
            `pointer-events-none` keeps the invisible buttons unclickable. */}
        <div className="pointer-events-none relative flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
          <RowAction
            label={item.pinned ? "Unpin" : "Pin"}
            active={item.pinned}
            onClick={() => onSetFlags(item.sessionId, { pinned: !item.pinned })}
          >
            <Pin />
          </RowAction>

          <RowAction
            label={item.archived ? "Unsettle" : "Settle"}
            active={item.archived}
            onClick={() => onSetFlags(item.sessionId, { archived: !item.archived })}
          >
            <Check />
          </RowAction>
        </div>
      </div>
    </div>
  );
}
