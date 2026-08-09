import { useMemo, useState } from "react";
import { CpuChipIcon } from "@heroicons/react/24/outline";

import "./App.css";
import Chat from "@/components/Chat";
import ChatInput from "@/components/ChatInput";
import Sidebar, { DevBadge, SidebarToggle } from "@/components/Sidebar";
import SubagentPanel from "@/components/SubagentPanel";
import ComposerToolbar from "@/components/composer/ComposerToolbar";
import { nextPermissionMode } from "@/components/composer/PermissionSelector";
import AppShell from "@/components/layout/AppShell";
import SessionHeader from "@/components/layout/SessionHeader";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDoubleTap } from "@/hooks/useDoubleTap";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useHotkey } from "@/hooks/useHotkey";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useSessions } from "@/hooks/useSessions";
import { buildTranscript } from "@/lib/transcript";
import { cn } from "@/lib/utils";

function App() {
  const {
    selectedSessionId,
    selectedSession,
    streamingContentBlock,
    sessionIndexItems,
    models,
    modelId,
    effort,
    permissionMode,
    projects,
    projectPath,
    branches,
    branch,
    useWorktree,
    busy,
    error,
    setError,
    handleModelChange,
    setPermissionMode,
    handleAttachProject,
    handleSelectProject,
    handleSelectBranch,
    pendingBranch,
    setPendingBranch,
    runCheckout,
    setUseWorktree,
    handleSendMsg,
    handleSelectSessionIndexItem,
    handleNewSession,
    setSessionFlags,
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

  const toggleSidebar = () => setCollapsed((prev) => !prev);
  useHotkey("b", toggleSidebar);
  useHotkey("n", handleNewSession);
  // No accelerator: Shift+Tab on its own, matching the CLI's own chord for this.
  useHotkey("Tab", () => setPermissionMode(nextPermissionMode(permissionMode)), {
    meta: false,
    shift: true,
  });
  // Double-tap Shift cycles the model, JetBrains-search style — leaves each
  // model's own remembered effort alone, same as picking it from the menu.
  useDoubleTap("Shift", () => {
    if (models.length < 2) return;
    const index = models.findIndex((m) => m.id === modelId);
    const next = models[(index + 1) % models.length];
    handleModelChange(next.id, null);
  });
  const fullscreen = useFullscreen();

  return (
    <TooltipProvider>
    <AppShell
      centered={!selectedSession}
      sidebar={
        <Sidebar
          items={sessionIndexItems}
          selectedSessionId={selectedSessionId}
          collapsed={collapsed}
          onToggleCollapsed={toggleSidebar}
          onSelect={handleSelectSessionIndexItem}
          onNewSession={handleNewSession}
          onSetFlags={setSessionFlags}
        />
      }
      header={
        <header
          className="flex h-(--titlebar-h) shrink-0 items-center gap-2 px-3"
          data-tauri-drag-region
        >
          {/* Only when collapsed — expanded, the sidebar owns the toggle. This
              header reaches the window edge in that state, so it has to clear
              the traffic lights, which fullscreen removes. */}
          {collapsed && (
            <div
              className={cn(
                "flex items-center",
                // Fullscreen has no traffic lights, so the toggle pulls back past
                // the header's own padding to sit flush at the window edge.
                fullscreen ? "-ml-1" : "pl-(--traffic-lights-w)",
              )}
            >
              <SidebarToggle onToggle={toggleSidebar} collapsed />
              {import.meta.env.DEV && <DevBadge className="ml-1" />}
            </div>
          )}

          <SessionHeader session={selectedSession} className="flex-1" />

          {subagents.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setPanelOpen((prev) => !prev)}
              title={`${subagents.length} subagent${subagents.length > 1 ? "s" : ""}`}
            >
              <CpuChipIcon />
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
          busy={busy}
          sessionId={selectedSessionId}
          isNewTask={!selectedSession}
          error={error}
          onDismissError={() => setError(null)}
          toolbar={
            <ComposerToolbar
              models={models}
              modelId={modelId}
              effort={effort}
              onModelChange={handleModelChange}
              permissionMode={permissionMode}
              onPermissionModeChange={setPermissionMode}
              projects={projects}
              projectPath={projectPath}
              onSelectProject={handleSelectProject}
              onAttachProject={handleAttachProject}
              branches={branches}
              branch={branch}
              onSelectBranch={handleSelectBranch}
              pendingBranch={pendingBranch}
              onConfirmBranchSwitch={(stash) =>
                pendingBranch && runCheckout(pendingBranch, stash)
              }
              onCancelBranchSwitch={() => setPendingBranch(null)}
              useWorktree={useWorktree}
              onToggleWorktree={() => setUseWorktree((v) => !v)}
              isNewSession={!selectedSessionId}
            />
          }
        />
      }
    >
      <Chat
        session={selectedSession}
        streamingBlock={
          selectedSessionId ? streamingContentBlock[selectedSessionId] ?? null : null
        }
        onOpenSubagent={openSubagent}
        busy={busy}
      />
    </AppShell>
    </TooltipProvider>
  );
}

export default App;
