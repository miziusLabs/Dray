import { useId, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ModelSelector from "@/components/composer/ModelSelector";
import { Switch } from "@/components/ui/switch";
import type { Effort, Model, ModelId, PiModel } from "@/types/events";

/// The app's preferences, such as they are.
///
/// Mounted in `App` rather than beside the gear that opens it: the sidebar
/// unmounts when it collapses, and a dialog living there would take the ⌘,
/// shortcut with it — which is the one route into this that survives a
/// collapsed sidebar.
export default function SettingsDialog({
  open,
  onOpenChange,
  showArchived,
  onShowArchivedChange,
  titleModels,
  titleModelId,
  titlePiModel,
  titleEffort,
  onTitleModelChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  showArchived: boolean;
  onShowArchivedChange: (next: boolean) => void;
  titleModels: Model[];
  titleModelId: ModelId;
  titlePiModel: PiModel | null;
  titleEffort: Effort;
  onTitleModelChange: (
    modelId: ModelId,
    effort: Effort | null,
    piModel: PiModel | null,
  ) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Each row carries its own sentence, so there is no one description the
          dialog is described *by* — left unset, Radix warns about the missing
          `aria-describedby` and pointing it at a row would read that row's copy
          out as the dialog's purpose. */}
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          <SettledSessionsRow
            checked={showArchived}
            onChange={onShowArchivedChange}
          />
          <TitleGenerationRow
            models={titleModels}
            modelId={titleModelId}
            piModel={titlePiModel}
            effort={titleEffort}
            onChange={onTitleModelChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TitleGenerationRow({
  models,
  modelId,
  piModel,
  effort,
  onChange,
}: {
  models: Model[];
  modelId: ModelId;
  piModel: PiModel | null;
  effort: Effort;
  onChange: (modelId: ModelId, effort: Effort | null, piModel: PiModel | null) => void;
}) {
  const id = useId();

  return (
    <SettingRow
      id={id}
      label="Title generation model"
      description="Choose the model and reasoning level used to name new sessions."
    >
      <ModelSelector
        id={id}
        models={models}
        modelId={modelId}
        piModel={piModel}
        effort={effort}
        onChange={onChange}
      />
    </SettingRow>
  );
}

function SettledSessionsRow({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();

  return (
    <SettingRow
      id={id}
      label="Show settled sessions"
      description="Show settled sessions instead of active sessions."
    >
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </SettingRow>
  );
}

/// Label and reason on the left, control on the right — the shape every
/// settings row here should take, so the second one costs no layout decisions.
function SettingRow({
  id,
  label,
  description,
  children,
}: {
  id: string;
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-ui font-medium">
          {label}
        </label>
        <p className="text-ui text-muted-foreground">{description}</p>
      </div>
      {/* Nudged to sit on the label's own line rather than the row's top edge,
          which the description below makes taller than the control. */}
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
