import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AgentEvent, AgentUsage } from "@/types/events";
import type { UsageDisplayMode } from "@/types/usage";

export default function AnalyticsDialog({ open, onOpenChange, displayMode }: {
  open: boolean; onOpenChange: (next: boolean) => void; displayMode: UsageDisplayMode;
}) {
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setUsage(await invoke<AgentUsage>("get_agent_usage")); }
    catch (reason) { setUsage(null); setError(String(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  useEffect(() => {
    if (!open) return;
    const subscription = listen("account_changed", () => void refresh());
    return () => { void subscription.then((unlisten) => unlisten()); };
  }, [open, refresh]);
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const subscription = listen<AgentEvent>("agent_event", ({ payload }) => {
      if (disposed || !["usage_update", "turn_completed"].includes(payload.payload.type)) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 500);
    });
    return () => { disposed = true; clearTimeout(timer); void subscription.then((unlisten) => unlisten()); };
  }, [open, refresh]);
  const cacheHit = usage && usage.inputTokens > 0 ? Math.min(100, usage.cachedInputTokens / usage.inputTokens * 100) : null;
  const cached = cacheHit === null ? null : displayMode === "left" ? 100 - cacheHit : cacheHit;
  const cacheLabel = displayMode === "left" ? "Uncached input" : "Input served from cache";
  const format = (tokens: number | undefined) => tokens === undefined ? "—" : tokens.toLocaleString();
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-120" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Usage</DialogTitle></DialogHeader>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-ui text-muted-foreground">{usage?.signedIn ? usage.email ?? "Connected to ChatGPT" : loading && !usage ? "Loading usage…" : "ChatGPT account disconnected"}</p>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "animate-spin" : undefined} />Refresh</Button>
        </div>
        {error && <p role="alert" className="text-ui text-destructive">{error}</p>}
        <dl className="grid grid-cols-2 gap-2 text-ui" aria-live="polite">
          <dt>Input tokens</dt><dd className="text-right tabular-nums">{format(usage?.inputTokens)}</dd>
          <dt>Output tokens</dt><dd className="text-right tabular-nums">{format(usage?.outputTokens)}</dd>
          <dt>Cached input tokens</dt><dd className="text-right tabular-nums">{format(usage?.cachedInputTokens)}</dd>
          <dt>Reasoning tokens</dt><dd className="text-right tabular-nums">{format(usage?.reasoningTokens)}</dd>
          <dt>Recorded turns</dt><dd className="text-right tabular-nums">{format(usage?.completedTurns)}</dd>
        </dl>
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-ui"><span>{cacheLabel}</span><span>{cached === null ? "—" : Math.round(cached) + "%"}</span></div>
          <div className="h-2.5 rounded-full bg-muted" role="progressbar" aria-label={cacheLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={cached ?? undefined}>
            <div className="h-full rounded-full bg-primary" style={{ width: (cached ?? 0) + "%" }} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Usage recorded in Dray’s saved sessions on this device. Cached input is included in input tokens; reasoning is included in output tokens. ChatGPT tracks plan limits and usage across apps.</p>
        <Button variant="outline" onClick={() => void openUrl("https://chatgpt.com/settings/usage")}>View ChatGPT plan usage and limits</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
