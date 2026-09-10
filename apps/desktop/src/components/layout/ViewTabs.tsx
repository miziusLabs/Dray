import { cn } from "@/lib/utils";

/// Which view fills the main column. Set and order in one, unlike the right
/// panel's tabs: none of these are conditional, so a Terminal view joins by
/// being added here and given a body.
export const VIEW_TABS = ["chat", "changes"] as const;

export type ViewTab = (typeof VIEW_TABS)[number];

const LABELS: Record<ViewTab, string> = {
  chat: "Chat",
  changes: "Changes",
};

/// The main column's tab row, drawn in the titlebar beside the session's name.
///
/// Styled as the right panel's tab row rather than as buttons, because they are
/// the same control: one row where exactly one entry is on.
export default function ViewTabs({
  tab,
  onChange,
}: {
  tab: ViewTab;
  onChange: (tab: ViewTab) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {VIEW_TABS.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cn(
            "rounded-md px-2 py-1 text-ui transition-colors",
            tab === value
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABELS[value]}
        </button>
      ))}
    </div>
  );
}
