import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Effort, Model, ModelId } from "@/types/events";

const EFFORT_LABELS: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export default function ModelSelector({
  models,
  modelId,
  effort,
  onChange,
}: {
  models: Model[];
  modelId: ModelId;
  effort: Effort | null;
  onChange: (modelId: ModelId, effort: Effort | null) => void;
}) {
  // Controlled so a click on a submenu trigger can close the whole menu; Radix
  // otherwise keeps the parent open for the submenu it just opened on hover.
  const [open, setOpen] = useState(false);

  const selected = models.find((m) => m.id === modelId) ?? null;

  const triggerLabel = selected
    ? effort
      ? `${selected.label} ${EFFORT_LABELS[effort]}`
      : selected.label
    : modelId;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {triggerLabel}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-48">
        {models.map((model) =>
          model.efforts.length ? (
            // One row: hover opens the effort submenu (Radix's own behaviour),
            // click picks the model and leaves its effort alone. Splitting the
            // two into separate items would give the row two hover states.
            <DropdownMenuSub key={model.id}>
              <DropdownMenuSubTrigger
                className="cursor-pointer"
                onClick={() => {
                  onChange(model.id, null);
                  setOpen(false);
                }}
              >
                {model.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {model.efforts.map((level) => (
                  <DropdownMenuItem
                    key={level}
                    onSelect={() => {
                      onChange(model.id, level);
                      setOpen(false);
                    }}
                  >
                    {EFFORT_LABELS[level]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            // No submenu and no chevron for a model with no effort levels.
            <DropdownMenuItem
              key={model.id}
              onSelect={() => onChange(model.id, null)}
            >
              {model.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
