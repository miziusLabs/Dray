import { useMemo, useState } from "react";
import { Bot } from "lucide-react";

import "./App.css";
import Chat from "@/components/Chat";
import ChatInput from "@/components/ChatInput";
import Sidebar from "@/components/Sidebar";
import SubagentPanel from "@/components/SubagentPanel";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useSessions } from "@/hooks/useSessions";
import { basename } from "@/lib/format";
import { buildTranscript } from "@/lib/transcript";

function App() {
  const {
    selectedSessionId,
    selectedSession,
    streamingContentBlock,
    sessionIndexItems,
    models,
    modelId,
    effort,
    busy,
    handleModelChange,
    handleSendMsg,
    handleSelectSessionIndexItem,
    handleNewSession,
  } = useSessions();

  const [collapsed, setCollapsed] = useLocalStorage("ade.sidebarCollapsed", false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);

  // The chat derives this too, but the panel and the header count need it here
  // and the memo makes the second pass free.
  const { subagents, resultByCallId } = useMemo(
    () => buildTranscript(selectedSession?.events ?? []),
    [selectedSession?.events],
  );

  const openSubagent = (id: string) => {
    setSelectedSubagentId(id);
    setPanelOpen(true);
  };

  return (
    <AppShell
      sidebar={
        <Sidebar
          items={sessionIndexItems}
          selectedSessionId={selectedSessionId}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((prev) => !prev)}
          onSelect={handleSelectSessionIndexItem}
          onNewSession={handleNewSession}
        />
      }
      header={
        <header
          className="flex h-(--titlebar-h) shrink-0 items-center gap-2 px-3"
          data-tauri-drag-region
        >
          <span
            className="flex-1 truncate text-center text-ui text-muted-foreground"
            data-tauri-drag-region
          >
            {selectedSession ? basename(selectedSession.cwd) : "New session"}
          </span>

          {subagents.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setPanelOpen((prev) => !prev)}
              title={`${subagents.length} subagent${subagents.length > 1 ? "s" : ""}`}
            >
              <Bot />
            </Button>
          )}
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
          onSend={handleSendMsg}
          models={models}
          modelId={modelId}
          effort={effort}
          busy={busy}
          sessionId={selectedSessionId}
          onModelChange={handleModelChange}
        />
      }
    >
      <Chat
        session={selectedSession}
        streamingBlock={
          selectedSessionId ? streamingContentBlock[selectedSessionId] ?? null : null
        }
        onOpenSubagent={openSubagent}
      />
    </AppShell>
  );
}

export default App;
