import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/// Reads together with the branch selector to its right: "New worktree · main"
/// runs on `main` itself, "New worktree from · main" forks a fresh tree off it.
export default function WorktreeToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="switch"
          aria-checked={on}
          onClick={onToggle}
          className="gap-1.5 px-1.5 text-ui text-muted-foreground aria-checked:text-foreground"
        >
          {/* The track reads as on/off at a glance; the label alone left the
              state ambiguous until you'd read both it and the branch beside it. */}
          <span
            aria-hidden
            className={cn(
              "flex h-3 w-5 shrink-0 items-center rounded-full p-px transition-colors",
              on ? "bg-primary" : "bg-muted-foreground/30",
            )}
          >
            <span
              className={cn(
                "size-2.5 rounded-full bg-background transition-transform",
                on && "translate-x-2",
              )}
            />
          </span>
          {on ? "New worktree from" : "New worktree"}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {on
          ? "Forks an isolated worktree off the selected branch"
          : "Run this session on the selected branch directly"}
      </TooltipContent>
    </Tooltip>
  );
}
