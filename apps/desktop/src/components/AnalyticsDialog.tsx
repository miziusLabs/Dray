import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usageBarColorClass } from "@/lib/usage";
import type { PlanUsage, PlanUsageWindow } from "@/types/events";
import type { UsageDisplayMode } from "@/types/usage";

export default function AnalyticsDialog({ open, onOpenChange, displayMode }: {
  open: boolean; onOpenChange: (next: boolean) => void; displayMode: UsageDisplayMode;
}) {
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await invoke<PlanUsage>("get_plan_usage");
      if (request === generation.current) setUsage(next);
    } catch (reason) {
      if (request === generation.current) {
        setUsage(null);
        setError(String(reason));
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    void refresh();
    // Account-wide usage can change in other apps while this dialog is open.
    const timer = setInterval(() => void refresh(), 60_000);
    let disposed = false;
    const subscription = listen("account_changed", () => {
      if (disposed) return;
      setUsage(null);
      void refresh();
    });
    return () => {
      disposed = true;
      generation.current++;
      clearInterval(timer);
      void subscription.then((unlisten) => unlisten());
    };
  }, [open, refresh]);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-120" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Usage</DialogTitle></DialogHeader>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <div className="text-ui text-muted-foreground">
            <p>{displayMode === "left" ? "Plan usage remaining" : "Plan usage consumed"}</p>
            {usage && <p>{usage.signedIn ? [usage.email ?? "Connected to ChatGPT", usage.planType].filter(Boolean).join(" · ") : "Connect to ChatGPT in Settings to view plan usage."}</p>}
          </div>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "animate-spin" : undefined} />Refresh</Button>
        </div>
        {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : <div className="flex flex-col gap-5" aria-live="polite">
          <UsageBar label="5-hour limit" window={usage?.fiveHour ?? null} displayMode={displayMode} loading={loading} />
          <UsageBar label="Weekly limit" window={usage?.weekly ?? null} displayMode={displayMode} loading={loading} />
        </div>}
        <p className="text-xs text-muted-foreground">Account-wide Codex limits for your ChatGPT plan, shared across apps. Unavailable limits are shown as —, not estimated from local tokens.</p>
        <Button variant="outline" onClick={() => void openUrl("https://chatgpt.com/settings/usage")}>View ChatGPT plan usage and limits</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

function UsageBar({ label, window, displayMode, loading }: {
  label: string; window: PlanUsageWindow | null; displayMode: UsageDisplayMode; loading: boolean;
}) {
  const percentage = window ? displayMode === "left" ? 100 - window.usedPercent : window.usedPercent : null;
  const reset = window && window.resetAt > 0 ? new Date(window.resetAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  return <div className="flex flex-col gap-2">
    <div className="flex justify-between text-ui"><span className="font-medium">{label}</span><span className="tabular-nums text-muted-foreground">{percentage === null ? loading ? "Loading…" : "—" : `${Math.round(percentage)}%`}</span></div>
    <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${label} ${displayMode}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage ?? undefined}>
      <div className={`h-full rounded-full ${usageBarColorClass(percentage, displayMode)} transition-[width]`} style={{ width: `${percentage ?? 0}%` }} />
    </div>
    <span className="text-xs text-muted-foreground">{reset ? `Resets on ${reset}.` : "Reset time unavailable"}</span>
  </div>;
}
