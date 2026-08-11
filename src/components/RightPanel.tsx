import PanelRightIcon from "@/components/icons/PanelRightIcon";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";

/// The header button that opens and closes the pane. Lives here rather than in
/// `App` so the toggle and the thing it toggles stay in one file, and outside
/// [RightPanel] itself because a closed pane renders nothing — the button has to
/// survive its own pane disappearing. Mirrors `SidebarToggle` on the far side.
export function PanelToggle({ onToggle, open }: { onToggle: () => void; open: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Held back at rest — it's chrome, not content — and brought to full
            strength under the cursor. */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-label="Toggle panel"
          className="opacity-80 transition-opacity hover:opacity-100"
        >
          <PanelRightIcon className="size-4.5" dim={!open} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        Toggle Panel
        <KbdGroup>
          <Kbd>{IS_MAC ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>E</Kbd>
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  );
}

/// Which body the right panel is showing. Ordered as the tabs read: changes
/// first, since it answers "what just happened" and is the one open by default.
export const PANEL_TABS = ["changes", "subagents"] as const;

export type PanelTab = (typeof PANEL_TABS)[number];

const LABELS: Record<PanelTab, string> = {
  changes: "Changes",
  subagents: "Subagents",
};

type RightPanelProps = {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /// Rendered beside its tab's label. Only shown above zero — a tab reading
  /// "Subagents 0" says the same thing as the empty state one click away.
  counts?: Partial<Record<PanelTab, number>>;
  children: React.ReactNode;
};

/// The frame every right-hand inspector shares: one border, one row of tabs.
/// Bodies render inside it and own no chrome of their own, so adding a third
/// view is a tab and a component rather than another panel competing for the
/// same slot.
///
/// No close button: [PanelToggle] and ⌘E both close it, and a third affordance
/// for the same action inside the thing it dismisses is the one the eye has to
/// skip past on every read.
///
/// No titlebar spacer either, unlike the main column. This pane reaches the top
/// of the window and its tab row is what sits there; the traffic lights are on
/// the far side, so nothing needs clearing.
export default function RightPanel({ tab, onTabChange, counts, children }: RightPanelProps) {
  return (
    <aside className="flex w-[32rem] shrink-0 flex-col border-l border-border bg-sidebar">
      <div
        className="flex h-(--titlebar-h) shrink-0 items-center gap-0.5 border-b border-border px-2"
        data-tauri-drag-region
      >
        {PANEL_TABS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onTabChange(value)}
            className={cn(
              "rounded-md px-2 py-1 text-ui transition-colors",
              tab === value
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {LABELS[value]}
            {!!counts?.[value] && (
              <span className="ml-1 text-muted-foreground">{counts[value]}</span>
            )}
          </button>
        ))}
      </div>

      {children}
    </aside>
  );
}
