import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CodexUsage, CodexUsageWindow, UsageDisplayMode } from "@/types/usage";

export default function AnalyticsDialog({
  open,
  onOpenChange,
  displayMode,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  displayMode: UsageDisplayMode;
}) {
  const [usage, setUsage] = useState<CodexUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsage(await invoke<CodexUsage>("get_codex_usage"));
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "Could not load Codex usage.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-120" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Codex usage</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-ui text-muted-foreground">
              {displayMode === "left" ? "Usage remaining" : "Usage consumed"}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-ui"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className={loading ? "animate-spin" : undefined} />
              Refresh
            </Button>
          </div>

          {error ? (
            <p className="text-ui text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <div className="flex flex-col gap-5" aria-live="polite">
              <UsageBar
                label="5-hour limit"
                window={usage?.fiveHour ?? null}
                displayMode={displayMode}
                loading={loading && usage === null}
              />
              <UsageBar
                label="Weekly limit"
                window={usage?.weekly ?? null}
                displayMode={displayMode}
                loading={loading && usage === null}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UsageBar({
  label,
  window,
  displayMode,
  loading,
}: {
  label: string;
  window: CodexUsageWindow | null;
  displayMode: UsageDisplayMode;
  loading: boolean;
}) {
  const percentage = window
    ? displayMode === "left"
      ? 100 - window.percentage
      : window.percentage
    : null;
  const reset = window?.resetAt != null ? formatResetTime(window.resetAt) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-ui">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {loading ? "Loading…" : percentage === null ? "—" : `${Math.round(percentage)}%`}
        </span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${label} ${displayMode}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage ?? 0}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percentage ?? 0}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        {reset
          ? `Resets on ${reset.date} at ${reset.time}.`
          : "Reset time unavailable"}
      </span>
    </div>
  );
}

function formatResetTime(timestamp: number): { date: string; time: string } {
  const date = new Date(timestamp);
  return {
    date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date),
    time: new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date),
  };
}
