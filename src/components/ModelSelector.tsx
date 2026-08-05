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
import type { Effort, Model } from "@/types/events";

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
  modelId: string;
  effort: Effort | null;
  onChange: (modelId: string, effort: Effort | null) => void;
}) {
  const selected = models.find((m) => m.id === modelId) ?? null;

  const triggerLabel = selected
    ? selected.efforts.length && effort
      ? `${selected.label} ${EFFORT_LABELS[effort]}`
      : selected.label
    : modelId;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {triggerLabel}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-48">
        {models.map((model) =>
          model.efforts.length ? (
            <DropdownMenuSub key={model.id}>
              <DropdownMenuSubTrigger>{model.label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {model.efforts.map((level) => (
                  <DropdownMenuItem
                    key={level}
                    onSelect={() => onChange(model.id, level)}
                  >
                    {EFFORT_LABELS[level]}
                    {level === model.defaultEffort && (
                      <span className="text-muted-foreground ml-auto text-xs">
                        default
                      </span>
                    )}
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
