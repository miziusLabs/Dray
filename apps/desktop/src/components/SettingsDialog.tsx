import { useId, useState, type ReactNode } from "react";

import packageJson from "../../package.json";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ModelSelector, {
  DEFAULT_CYCLE_EFFORTS,
  EFFORT_LABELS,
  EFFORTS,
  modelKey,
  modelLabel,
} from "@/components/composer/ModelSelector";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import type { Effort, Model, ModelId, PiModel } from "@/types/events";
import type { UsageDisplayMode } from "@/types/usage";
import type { UpdateCheckResult } from "@/components/UpdateNotice";

/// The app's preferences, such as they are.
///
/// Mounted in `App` rather than beside the gear that opens it so the dialog's
/// lifecycle stays independent from the sidebar controls.
const SETTINGS_CATEGORIES = ["general", "models", "updates"] as const;

type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

const SETTINGS_CATEGORY_LABELS: Record<SettingsCategory, string> = {
  general: "General",
  models: "Models",
  updates: "Updates",
};

const SETTINGS_CATEGORY_INDEX: Record<SettingsCategory, number> = {
  general: 0,
  models: 1,
  updates: 2,
};

export default function SettingsDialog({
  open,
  onOpenChange,
  showArchived,
  onShowArchivedChange,
  usageDisplayMode,
  onUsageDisplayModeChange,
  models,
  visibleModelKeys,
  onVisibleModelKeysChange,
  cycleModelKeys,
  onCycleModelKeysChange,
  cycleEfforts,
  onCycleEffortsChange,
  autoDownloadUpdates,
  onAutoDownloadUpdatesChange,
  titleModels,
  titleModelId,
  titlePiModel,
  titleEffort,
  onTitleModelChange,
  checkingForUpdates,
  onCheckForUpdates,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  showArchived: boolean;
  onShowArchivedChange: (next: boolean) => void;
  usageDisplayMode: UsageDisplayMode;
  onUsageDisplayModeChange: (next: UsageDisplayMode) => void;
  models: Model[];
  visibleModelKeys: string[] | null;
  onVisibleModelKeysChange: (next: string[]) => void;
  cycleModelKeys: string[] | null;
  onCycleModelKeysChange: (next: string[]) => void;
  cycleEfforts: Effort[] | null;
  onCycleEffortsChange: (next: Effort[]) => void;
  autoDownloadUpdates: boolean;
  onAutoDownloadUpdatesChange: (next: boolean) => void;
  titleModels: Model[];
  titleModelId: ModelId;
  titlePiModel: PiModel | null;
  titleEffort: Effort;
  onTitleModelChange: (
    modelId: ModelId,
    effort: Effort | null,
    piModel: PiModel | null,
  ) => void;
  checkingForUpdates: boolean;
  onCheckForUpdates: () => Promise<UpdateCheckResult>;
}) {
  const [category, setCategory] = useState<SettingsCategory>("general");

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

        <div
          className="relative flex rounded-lg bg-muted p-0.5"
          role="tablist"
          aria-label="Settings categories"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-md bg-popover shadow-sm transition-transform duration-200 ease-out"
            style={{
              width: "calc((100% - 0.5rem) / 3)",
              transform: `translateX(${SETTINGS_CATEGORY_INDEX[category] * 100}%)`,
            }}
          />
          {SETTINGS_CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={category === value}
              aria-controls="settings-panel"
              tabIndex={category === value ? 0 : -1}
              onClick={() => setCategory(value)}
              className={[
                "relative z-10 flex-1 rounded-md px-2 py-1.5 text-ui transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                category === value
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {SETTINGS_CATEGORY_LABELS[value]}
            </button>
          ))}
        </div>

        {/* Keep every category in the same grid cell so the dialog reserves the
            height of the largest category while only the selected one is visible. */}
        <div
          id="settings-panel"
          role="tabpanel"
          aria-label={SETTINGS_CATEGORY_LABELS[category]}
          className="grid items-start"
        >
          <div
            className={[
              "col-start-1 row-start-1 flex flex-col gap-6",
              category !== "general" && "invisible pointer-events-none",
            ].filter(Boolean).join(" ")}
            aria-hidden={category !== "general"}
            inert={category !== "general"}
          >
            <SettledSessionsRow
              checked={showArchived}
              onChange={onShowArchivedChange}
            />
            <UsageDisplayRow
              mode={usageDisplayMode}
              onChange={onUsageDisplayModeChange}
            />
          </div>
          <div
            className={[
              "col-start-1 row-start-1 flex flex-col gap-6",
              category !== "models" && "invisible pointer-events-none",
            ].filter(Boolean).join(" ")}
            aria-hidden={category !== "models"}
            inert={category !== "models"}
          >
            <ModelSelectionRow
              models={models}
              selectedKeys={visibleModelKeys}
              onChange={onVisibleModelKeysChange}
              label="Shown models"
              description="Choose which models appear in the model selector and /model or /models commands."
            />
            <ModelSelectionRow
              models={models}
              selectedKeys={cycleModelKeys}
              onChange={onCycleModelKeysChange}
              label="Cycle models"
              description="Choose which models Ctrl+M cycles through."
            />
            <CycleEffortsRow
              selectedEfforts={cycleEfforts}
              onChange={onCycleEffortsChange}
            />
            <TitleGenerationRow
              models={titleModels}
              modelId={titleModelId}
              piModel={titlePiModel}
              effort={titleEffort}
              onChange={onTitleModelChange}
            />
          </div>
          <div
            className={[
              "col-start-1 row-start-1 flex flex-col gap-6",
              category !== "updates" && "invisible pointer-events-none",
            ].filter(Boolean).join(" ")}
            aria-hidden={category !== "updates"}
            inert={category !== "updates"}
          >
            <UpdateCheckRow
              checking={checkingForUpdates}
              onCheck={onCheckForUpdates}
              autoDownloadUpdates={autoDownloadUpdates}
            />
            <AutoDownloadUpdatesRow
              checked={autoDownloadUpdates}
              onChange={onAutoDownloadUpdatesChange}
            />
          </div>
        </div>

        <footer className="pt-3 text-center text-xs text-muted-foreground">
          © miziusLabs | v{packageJson.version}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function UsageDisplayRow({
  mode,
  onChange,
}: {
  mode: UsageDisplayMode;
  onChange: (next: UsageDisplayMode) => void;
}) {
  const id = useId();

  return (
    <SettingRow
      id={id}
      label="Usage display"
      description="Choose whether Codex analytics bars show what is left or already used."
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id={id} type="button" variant="outline" size="sm" className="text-ui">
            {mode === "left" ? "Left" : "Used"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-24">
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => {
              if (value === "left" || value === "used") onChange(value);
            }}
          >
            <DropdownMenuRadioItem value="left" className="text-ui">
              Left
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="used" className="text-ui">
              Used
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingRow>
  );
}

function UpdateCheckRow({
  checking,
  onCheck,
  autoDownloadUpdates,
}: {
  checking: boolean;
  onCheck: () => Promise<UpdateCheckResult>;
  autoDownloadUpdates: boolean;
}) {
  const id = useId();
  const [message, setMessage] = useState<string | null>(null);

  const checkForUpdates = async () => {
    setMessage(null);
    try {
      const result = await onCheck();
      setMessage(
        result === "available"
          ? autoDownloadUpdates
            ? "An update is available and is being downloaded."
            : "An update is available. Download it from the sidebar."
          : result === "none"
            ? "You're up to date."
            : "Update checks are unavailable in development builds.",
      );
    } catch {
      setMessage("Could not check for updates. Try again later.");
    }
  };

  return (
    <SettingRow
      id={id}
      label="App updates"
      description={
        <>
          <span>Check for a newer version of Dray. Automatic checks run every 15 minutes.</span>
          {message && (
            <span className="mt-1 block" role="status">
              {message}
            </span>
          )}
        </>
      }
    >
      <Button
        id={id}
        type="button"
        variant="outline"
        size="sm"
        className="text-ui"
        disabled={checking}
        onClick={() => void checkForUpdates()}
      >
        {checking ? "Checking…" : "Check for updates"}
      </Button>
    </SettingRow>
  );
}

function AutoDownloadUpdatesRow({
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
      label="Automatically download updates"
      description="Download updates as soon as they become available. Installation still requires a restart."
    >
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </SettingRow>
  );
}

function ModelSelectionRow({
  models,
  selectedKeys,
  onChange,
  label,
  description,
}: {
  models: Model[];
  selectedKeys: string[] | null;
  onChange: (next: string[]) => void;
  label: string;
  description: string;
}) {
  const id = useId();
  const resolvedKeys = selectedKeys ?? models.map(modelKey);
  const selectedCount = models.filter((model) => resolvedKeys.includes(modelKey(model))).length;
  const summary =
    selectedCount === models.length
      ? "All models"
      : selectedCount === 1
        ? "1 model"
        : `${selectedCount} models`;

  const setChecked = (model: Model, checked: boolean) => {
    const key = modelKey(model);
    onChange(
      checked
        ? Array.from(new Set([...resolvedKeys, key]))
        : resolvedKeys.filter((selected) => selected !== key),
    );
  };

  return (
    <SettingRow id={id} label={label} description={description}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id={id} type="button" variant="outline" size="sm" className="text-ui">
            {summary}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {models.map((model) => {
            const key = modelKey(model);
            return (
              <DropdownMenuCheckboxItem
                key={key}
                checked={resolvedKeys.includes(key)}
                className="text-ui"
                onCheckedChange={(checked) => setChecked(model, checked === true)}
                onSelect={(event) => event.preventDefault()}
              >
                {modelLabel(model)}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingRow>
  );
}

function CycleEffortsRow({
  selectedEfforts,
  onChange,
}: {
  selectedEfforts: Effort[] | null;
  onChange: (next: Effort[]) => void;
}) {
  const id = useId();
  const resolvedEfforts = selectedEfforts ?? DEFAULT_CYCLE_EFFORTS;
  const selectedCount = EFFORTS.filter((effort) => resolvedEfforts.includes(effort)).length;
  const summary =
    selectedCount === EFFORTS.length
      ? "All levels"
      : selectedCount === 1
        ? "1 level"
        : `${selectedCount} levels`;

  const setChecked = (effort: Effort, checked: boolean) => {
    onChange(
      checked
        ? EFFORTS.filter((level) => level === effort || resolvedEfforts.includes(level))
        : resolvedEfforts.filter((level) => level !== effort),
    );
  };

  return (
    <SettingRow
      id={id}
      label="Cycle reasoning levels"
      description="Choose which reasoning levels Shift+Tab cycles through."
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id={id} type="button" variant="outline" size="sm" className="text-ui">
            {summary}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {EFFORTS.map((effort) => (
            <DropdownMenuCheckboxItem
              key={effort}
              checked={resolvedEfforts.includes(effort)}
              className="text-ui"
              onCheckedChange={(checked) => setChecked(effort, checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {EFFORT_LABELS[effort]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingRow>
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
  description: ReactNode;
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
