import "./App.css";

import Chat from "@/components/Chat";
import ChatInput from "@/components/ChatInput";
import Sidebar from "@/components/Sidebar";
import AppShell from "@/components/layout/AppShell";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useSessions } from "@/hooks/useSessions";
import { basename } from "@/lib/format";

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
          className="flex h-(--titlebar-h) shrink-0 items-center justify-center px-3"
          data-tauri-drag-region
        >
          <span className="truncate text-ui text-muted-foreground" data-tauri-drag-region>
            {selectedSession ? basename(selectedSession.cwd) : "New session"}
          </span>
        </header>
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
      />
    </AppShell>
  );
}

export default App;
