import { useMemo, useState } from "react";
import { Bot } from "lucide-react";

import Chat from "@/components/Chat";
import ChatInput from "@/components/ChatInput";
import Sidebar from "@/components/Sidebar";
import SubagentPanel from "@/components/SubagentPanel";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { DEMO_EVENTS, DEMO_MODELS } from "@/demo/fixtures";
import { buildTranscript } from "@/lib/transcript";
import type { Effort, ModelId, SessionIndexItem, SessionSnapshot } from "@/types/events";

const INDEX: SessionIndexItem = {
  sessionId: "demo",
  harness: "claude_code",
  cwd: "/Users/yogesh/Documents/yogesh",
  projectPath: "/Users/yogesh/Documents/yogesh",
  branch: null,
  worktreeName: null,
  title: "How does the blog work?",
  model: "opus",
  effort: "high",
  status: "idle",
  created: new Date(Date.now() - 3_600_000).toISOString(),
  modified: new Date(Date.now() - 120_000).toISOString(),
  archived: false,
  pinned: false,
};

const WORKTREE: SessionIndexItem = {
  ...INDEX,
  sessionId: "demo-wt",
  title: "Add pagination to the blog index",
  branch: "worktree-amber-jade-lantern",
  worktreeName: "amber-jade-lantern",
  cwd: "/Users/yogesh/Documents/yogesh/.claude/worktrees/amber-jade-lantern",
  modified: new Date(Date.now() - 86_400_000).toISOString(),
};

const OTHER_PROJECT: SessionIndexItem = {
  ...INDEX,
  sessionId: "demo-other",
  title: "Wire up revenue attribution events",
  projectPath: "/Users/yogesh/Documents/mayo/supalytics-server",
  cwd: "/Users/yogesh/Documents/mayo/supalytics-server",
  model: "unknown",
  effort: null,
  modified: new Date(Date.now() - 5 * 86_400_000).toISOString(),
};

const SESSION: SessionSnapshot = { ...INDEX, events: DEMO_EVENTS };

/// Renders every transcript component against fixed content so the UI can be
/// reviewed without a live agent. Reachable at `?demo`; not part of the app.
export default function Demo() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<ModelId>("opus");
  const [effort, setEffort] = useState<Effort | null>("high");
  const [busy, setBusy] = useState(false);

  const { subagents, resultByCallId } = useMemo(
    () => buildTranscript(DEMO_EVENTS),
    [],
  );

  return (
    <AppShell
      sidebar={
        <Sidebar
          items={[INDEX, WORKTREE, OTHER_PROJECT]}
          selectedSessionId="demo"
          collapsed={false}
          onToggleCollapsed={() => {}}
          onSelect={async () => {}}
          onNewSession={() => {}}
        />
      }
      header={
        <header className="flex h-(--titlebar-h) shrink-0 items-center gap-2 px-3">
          <span className="flex-1 truncate text-center text-ui text-muted-foreground">
            yogesh — demo
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPanelOpen((prev) => !prev)}
            title="Subagents"
          >
            <Bot />
          </Button>
        </header>
      }
      panel={
        panelOpen ? (
          <SubagentPanel
            runs={subagents}
            selectedId={selectedSubagentId}
            resultByCallId={resultByCallId}
            onSelect={setSelectedSubagentId}
            onClose={() => setPanelOpen(false)}
          />
        ) : null
      }
      footer={
        <ChatInput
          // Toggles the busy state so the send/stop swap can be seen.
          onSend={() => {
            setBusy(true);
            setTimeout(() => setBusy(false), 2000);
          }}
          models={DEMO_MODELS}
          modelId={modelId}
          effort={effort}
          busy={busy}
          sessionId="demo"
          onModelChange={(id, next) => {
            setModelId(id);
            setEffort(next);
          }}
        />
      }
    >
      <Chat
        session={SESSION}
        streamingBlock={null}
        onOpenSubagent={(id) => {
          setSelectedSubagentId(id);
          setPanelOpen(true);
        }}
      />
    </AppShell>
  );
}
