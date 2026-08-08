import GitBranchIcon from "@/components/icons/GitBranchIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BranchList } from "@/types/events";

export default function BranchSelector({
  branches,
  value,
  onSelect,
}: {
  branches: BranchList | null;
  value: string | null;
  onSelect: (branch: string) => void;
}) {
  // A folder that isn't a repo has no branches, and an empty picker is worse
  // than no picker.
  if (!branches?.branches.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="max-w-40 gap-1.5 px-1.5 text-ui text-muted-foreground"
        >
          <GitBranchIcon className="size-3.5 shrink-0" />
          <span className="truncate">{value ?? branches.current ?? "detached"}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-44">
        {/* The checkout happens at send, so a dirty tree fails then rather than
            here — saying so up front beats surfacing git's stderr after. */}
        {branches.dirty && (
          <DropdownMenuLabel className="text-ui font-normal text-muted-foreground">
            Uncommitted changes may block the switch
          </DropdownMenuLabel>
        )}

        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={onSelect}>
          {branches.branches.map((b) => (
            <DropdownMenuRadioItem key={b} value={b} className="text-ui">
              <span className="truncate">{b}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
