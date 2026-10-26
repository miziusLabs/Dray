import { ArrowLeft, ArrowRight, ExternalLink, Maximize2, Minimize2, RotateCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { invoke } from "@/lib/transport";
import { normalizeUrl, publishTabs, type BrowserTab } from "@/lib/browser";

type View = { tabs: BrowserTab[]; image: string | null; width: number; height: number };

/// Windows shares the agent's Chromium through private pipes and displays its viewport.
export default function WindowsBrowserPane({ sessionId, active, mode, fullOpen = false, onExpand, onCollapse }: {
  sessionId: string;
  active: boolean;
  mode: "panel" | "full";
  fullOpen?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const editing = useRef(false);
  const owner = useRef(sessionId);
  owner.current = sessionId;
  const visible = active && !(mode === "panel" && fullOpen);
  const selected = view?.tabs.find((tab) => tab.active);

  useEffect(() => {
    setView(null);
    setUrl("");
    setError(null);
  }, [sessionId]);

  useEffect(() => {
    if (!visible) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await invoke<View>("browser_view", { sessionId });
        if (stopped) return;
        setView(next);
        publishTabs(sessionId, next.tabs);
        if (!editing.current) setUrl(next.tabs.find((tab) => tab.active)?.url ?? "");
      } catch (cause) {
        if (!stopped) setError(String(cause));
      } finally {
        if (!stopped) timer = setTimeout(refresh, 500);
      }
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [sessionId, visible]);

  async function input(action: Record<string, unknown>) {
    const session = sessionId;
    try {
      await invoke("browser_input", { sessionId: session, action });
      if (owner.current === session) setError(null);
    } catch (cause) {
      if (owner.current === session) setError(String(cause));
    }
  }

  async function navigate() {
    if (!url.trim() || busy) return;
    setBusy(true);
    try { await input({ action: "open", url: normalizeUrl(url.trim()) }); }
    finally { setBusy(false); }
  }

  if (mode === "panel" && fullOpen) {
    return <div className="flex h-full items-center justify-center p-6 text-ui text-muted-foreground">The browser is open in the main pane.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b p-1">
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => void input({ action: "back" })}><ArrowLeft className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Forward" onClick={() => void input({ action: "forward" })}><ArrowRight className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Reload" onClick={() => void input({ action: "reload" })}><RotateCw className="size-4" /></Button>
        <form className="min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); void navigate(); }}>
          <input className="h-8 w-full rounded-md bg-muted px-2 text-ui outline-none focus-visible:ring-1 focus-visible:ring-ring" aria-label="Page address" placeholder="Enter a URL" value={url} onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; }} onChange={(event) => setUrl(event.target.value)} />
        </form>
        <Button variant="ghost" size="icon-sm" aria-label="Open in browser" disabled={!selected} onClick={() => selected && void openUrl(selected.url)}><ExternalLink className="size-4" /></Button>
        {(onExpand || onCollapse) && <Button variant="ghost" size="icon-sm" aria-label={mode === "panel" ? "Expand browser" : "Collapse browser"} onClick={mode === "panel" ? onExpand : onCollapse}>{mode === "panel" ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}</Button>}
      </div>
      {error && <p className="shrink-0 px-3 py-2 text-ui text-destructive" role="status">{error}</p>}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/30">
        {view?.image ? <img ref={image} src={`data:image/jpeg;base64,${view.image}`} alt={selected?.title || "Browser page"} draggable={false} tabIndex={0} className="max-h-full max-w-full object-contain outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={(event) => {
            event.currentTarget.focus();
            const rect = event.currentTarget.getBoundingClientRect();
            void input({ action: "pointer", x: (event.clientX - rect.left) * event.currentTarget.naturalWidth / rect.width, y: (event.clientY - rect.top) * event.currentTarget.naturalHeight / rect.height });
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.currentTarget.focus();
            const rect = event.currentTarget.getBoundingClientRect();
            void input({ action: "pointer", button: "right", x: (event.clientX - rect.left) * event.currentTarget.naturalWidth / rect.width, y: (event.clientY - rect.top) * event.currentTarget.naturalHeight / rect.height });
          }}
          onAuxClick={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            event.currentTarget.focus();
            const rect = event.currentTarget.getBoundingClientRect();
            void input({ action: "pointer", button: "middle", x: (event.clientX - rect.left) * event.currentTarget.naturalWidth / rect.width, y: (event.clientY - rect.top) * event.currentTarget.naturalHeight / rect.height });
          }}
          onWheel={(event) => { event.preventDefault(); void input({ action: "wheel", delta: event.deltaY }); }}
          onKeyDown={(event) => {
            if (event.key === "Tab" && event.shiftKey) return;
            if (event.key === "v" && event.ctrlKey) return;
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault(); void input({ action: "text", text: event.key });
            } else if (["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key) || event.ctrlKey) {
              event.preventDefault();
              void input({ action: "press", key: `${event.ctrlKey ? "Ctrl+" : ""}${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${event.key}` });
            }
          }}
          onPaste={(event) => { event.preventDefault(); void input({ action: "text", text: event.clipboardData.getData("text/plain") }); }}
        /> : <p className="p-6 text-center text-ui text-muted-foreground">{busy ? "Opening the page…" : "Enter a URL to open a page. The browser shares its tabs with this session's agent."}</p>}
      </div>
    </div>
  );
}
