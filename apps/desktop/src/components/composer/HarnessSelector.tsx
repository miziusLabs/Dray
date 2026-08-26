import { Bot } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Harness } from "@/types/events";

const HARNESSES: { id: Harness; label: string }[] = [
  { id: "claude_code", label: "Claude Code" },
  { id: "pi", label: "Pi" },
];

/// Selects which coding-agent process a new session starts.
export default function HarnessSelector({
  value,
  onChange,
}: {
  value: Harness;
  onChange: (harness: Harness) => void;
}) {
  const selected = HARNESSES.find((harness) => harness.id === value);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 px-1.5 text-ui text-muted-foreground"
              aria-label="Switch agent"
            >
              <Bot className="size-3.5" />
              {selected?.label ?? "Agent"}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Switch agent</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as Harness)}
        >
          {HARNESSES.map((harness) => (
            <DropdownMenuRadioItem key={harness.id} value={harness.id} className="text-ui">
              {harness.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
