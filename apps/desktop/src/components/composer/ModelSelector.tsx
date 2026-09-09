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
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IS_MAC } from "@/lib/platform";
import type { Effort, Model, ModelId, PiModel } from "@/types/events";

export const EFFORT_LABELS: Record<Effort, string> = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export const EFFORTS: Effort[] = ["off", "low", "medium", "high", "xhigh", "max"];

// Preserve the original shortcut behavior until the user explicitly configures
// the cycle. Off and Low remain available both in the picker and as opt-in
// cycle levels.
export const DEFAULT_CYCLE_EFFORTS: Effort[] = ["medium", "high", "xhigh", "max"];

export const modelKey = (model: Model) =>
  model.piModel ? `pi:${model.piModel.provider}/${model.piModel.id}` : model.id;

export const modelLabel = (model: Model) => model.label || model.piModel?.id || model.id;

/// Model and effort completions use the same ranking shape as commands: an
/// exact name prefix wins, while provider/model identifiers remain searchable.
export function filterModels(models: Model[], query: string): Model[] {
  const q = query.toLowerCase();
  return models
    .map((model) => {
      const values = [modelLabel(model), model.id, model.piModel?.id, modelKey(model)]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase());
      const score = values.some((value) => value.startsWith(q))
        ? 0
        : values.some((value) => value.includes(q))
          ? 1
          : null;
      return { model, score };
    })
    .filter((match) => match.score !== null)
    .sort((a, b) => a.score! - b.score!)
    .map((match) => match.model);
}

export function filterEfforts(query: string, efforts: readonly Effort[]): Effort[] {
  const q = query.toLowerCase();
  return efforts.filter(
    (effort) => effort.startsWith(q) || EFFORT_LABELS[effort].toLowerCase().startsWith(q),
  );
}

/// Next effort level for `model`, wrapping — what Shift+Tab lands on. `null`
/// where the model offers nothing to cycle, so the chord no-ops rather than
/// inventing an effort the CLI would ignore.
///
/// Levels outside the configured cycle stay pickable from the menu and enter
/// the cycle at its first supported level when the shortcut is pressed.
export function nextEffort(
  model: Model | undefined,
  current: Effort | null,
  included: readonly Effort[] = DEFAULT_CYCLE_EFFORTS,
): Effort | null {
  const cycle = model?.efforts.filter((effort) => included.includes(effort)) ?? [];
  if (cycle.length === 0) return null;
  const from = current ?? model?.defaultEffort ?? null;
  const i = from ? cycle.indexOf(from) : -1;
  return cycle[(i + 1) % cycle.length];
}

export default function ModelSelector({
  models,
  modelId,
  id,
  piModel,
  effort,
  onChange,
}: {
  models: Model[];
  modelId: ModelId;
  id?: string;
  piModel: PiModel | null;
  effort: Effort | null;
  onChange: (modelId: ModelId, effort: Effort | null, piModel: PiModel | null) => void;
}) {
  // Controlled so a click on a submenu trigger can close the whole menu; Radix
  // otherwise keeps the parent open for the submenu it just opened on hover.
  const [open, setOpen] = useState(false);

  const selected = models.find(
    (m) =>
      m.id === modelId &&
      (m.id !== "pi" ||
        (m.piModel?.provider === piModel?.provider && m.piModel?.id === piModel?.id)),
  ) ?? null;
  /// What a row would resolve to if clicked: the live effort for the model
  /// already selected, each other model's own default. Mirrors the resolution
  /// in `useSessions`, so the menu can't advertise an effort the send wouldn't use.
  const rowEffort = (model: Model): Effort | null =>
    model.id === modelId ? effort : model.defaultEffort;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            {/* `text-ui` over the button's own `text-sm`: the toolbar has to track
                the runtime font-size setting like the rest of the chrome. */}
            <Button
              id={id}
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 px-1.5 text-ui text-muted-foreground"
            >
              {/* Effort is a qualifier on the model, not part of its name, so it's
                  held back a step rather than reading as one long label. */}
              <span>
                {selected ? modelLabel(selected) : modelId === "pi" && piModel ? piModel.id : modelId}
              </span>
              {effort && (
                <span className="text-muted-foreground/60">{EFFORT_LABELS[effort]}</span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {/* One line, so it stays a tooltip rather than a menu of shortcuts —
            hence `max-w-none`, which the default `max-w-xs` would wrap. */}
        <TooltipContent side="top" className="max-w-none whitespace-nowrap">
          Switch model
          <KbdGroup>
            <Kbd>{IS_MAC ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>M</Kbd>
          </KbdGroup>
          <span className="text-muted-foreground">Effort</span>
          <KbdGroup>
            <Kbd>Shift</Kbd>
            <Kbd>Tab</Kbd>
          </KbdGroup>
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="min-w-48">
        {models.map((model) =>
          model.efforts.length ? (
            // One row: hover opens the effort submenu (Radix's own behaviour),
            // click picks the model and leaves its effort alone. Splitting the
            // two into separate items would give the row two hover states.
            <DropdownMenuSub key={modelKey(model)}>
              <DropdownMenuSubTrigger
                className="cursor-pointer gap-1 text-ui"
                onClick={() => {
                  onChange(model.id, null, model.piModel);
                  setOpen(false);
                }}
              >
                {modelLabel(model)}
                {rowEffort(model) && (
                  <span className="text-muted-foreground/60">
                    {EFFORT_LABELS[rowEffort(model)!]}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {model.efforts.map((level) => (
                  <DropdownMenuItem
                    key={level}
                    className="text-ui"
                    onSelect={() => {
                      onChange(model.id, level, model.piModel);
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
              key={modelKey(model)}
              className="text-ui"
              onSelect={() => onChange(model.id, null, model.piModel)}
            >
              {modelLabel(model)}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
