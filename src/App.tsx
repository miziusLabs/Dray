import { useEffect, useMemo, useState } from "react";

import "./App.css";
import Chat from "@/components/Chat";
import ChangesPanel from "@/components/ChangesPanel";
import ChatInput from "@/components/ChatInput";
import RightPanel, { PanelToggle, type PanelTab } from "@/components/RightPanel";
import Sidebar, { DevBadge, SidebarToggle } from "@/components/Sidebar";
import SubagentPanel from "@/components/SubagentPanel";
import ComposerToolbar from "@/components/composer/ComposerToolbar";
import { nextPermissionMode } from "@/components/composer/PermissionSelector";
import AppShell from "@/components/layout/AppShell";
import SessionHeader from "@/components/layout/SessionHeader";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCodeTheme } from "@/hooks/useCodeTheme";
import { useDoubleTap } from "@/hooks/useDoubleTap";
import { useFullscreen } from "@/hooks/useFullscreen";
import { warmHighlighter } from "@/hooks/useHighlighter";
import { useHotkey } from "@/hooks/useHotkey";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useSessions } from "@/hooks/useSessions";
import { baselineFor } from "@/lib/changes";
import { buildTranscript } from "@/lib/transcript";
import { cn } from "@/lib/utils";

function App() {
  const {
    selectedSessionId,
    selectedSession,
    streamingContentBlock,
    sessionIndexItems,
    statusBySession,
    showArchived,
    setShowArchived,
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
    backgroundTasks,
    compacting,
    working,
    contextUsage,
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
    handleInterrupt,
    handleRespondPermission,
    handleAnswerQuestions,
    handleSelectSessionIndexItem,
    handleNewSession,
    setSessionFlags,
    deleteSession,
  } = useSessions();

  const [collapsed, setCollapsed] = useLocalStorage("ade.sidebarCollapsed", false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useLocalStorage<PanelTab>("ade.panelTab", "changes");
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);

  // Themes and Shiki's engine are shared by every code surface, so they load
  // once here instead of on the first diff the user happens to open.
  const { pair: codeThemePair } = useCodeTheme();
  useEffect(() => warmHighlighter(codeThemePair), [codeThemePair]);

  // The chat derives this too, but the panel and the header count need it here
  // and the memo makes the second pass free.
  const { subagents, resultByCallId } = useMemo(
    // Same `busy` the chat passes. Left off, a subagent's in-flight call would
    // show in the panel as one that never finished.
    () => buildTranscript(selectedSession?.events ?? [], busy),
    [selectedSession?.events, busy],
  );

  const togglePanel = () => setPanelOpen((prev) => !prev);

  const openSubagent = (id: string) => {
    setSelectedSubagentId(id);
    setPanelTab("subagents");
    setPanelOpen(true);
  };

  const baseline = useMemo(
    () => baselineFor(selectedSession?.events ?? []),
    [selectedSession?.events],
  );

  // What tells the panel to re-read — a cache key, not a count. The event total
  // moves as a turn's writes land, and `busy` covers the turn ending, where the
  // final file write and the closing event can arrive in either order.
  const revision = `${selectedSession?.events.length ?? 0}:${busy}`;

  const toggleSidebar = () => setCollapsed((prev) => !prev);
  useHotkey("b", toggleSidebar);
  useHotkey("n", handleNewSession);
  // ⌘E for the right pane against ⌘B for the left.
  useHotkey("e", togglePanel);
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
          statusBySession={statusBySession}
          selectedSessionId={selectedSessionId}
          collapsed={collapsed}
          onToggleCollapsed={toggleSidebar}
          onSelect={handleSelectSessionIndexItem}
          onNewSession={handleNewSession}
          onSetFlags={async (sessionId, flags) => {
            await setSessionFlags(sessionId, flags);
            // Settling the open session leaves nothing to look at but the
            // unsettle bar, so it goes back to the empty composer instead.
            if (flags.archived === true && sessionId === selectedSessionId) {
              handleNewSession();
            } else if (flags.archived === false && showArchived) {
              // Unsettling only happens from the settled list, and the row
              // just left it — follow it back to where it landed.
              setShowArchived(false);
            }
          }}
          onDelete={deleteSession}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived((v) => !v)}
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

          {selectedSession && <PanelToggle onToggle={togglePanel} open={panelOpen} />}
        </header>
      }
      panel={
        panelOpen && selectedSession ? (
          <RightPanel
            tab={panelTab}
            onTabChange={setPanelTab}
            counts={{ subagents: subagents.length }}
          >
            {panelTab === "changes" ? (
              <ChangesPanel
                cwd={selectedSession.cwd}
                baseline={baseline}
                revision={revision}
              />
            ) : (
              <SubagentPanel
                runs={subagents}
                selectedId={selectedSubagentId}
                resultByCallId={resultByCallId}
                onSelect={setSelectedSubagentId}
              />
            )}
          </RightPanel>
        ) : null
      }
      footer={
        <ChatInput
          onSend={handleSendMsg}
          onStop={handleInterrupt}
          busy={busy}
          sessionId={selectedSessionId}
          isNewTask={!selectedSession}
          error={error}
          onDismissError={() => setError(null)}
          archived={selectedSession?.archived ?? false}
          onUnarchive={() =>
            selectedSessionId && setSessionFlags(selectedSessionId, { archived: false })
          }
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
              contextUsage={contextUsage}
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
        onRespondPermission={handleRespondPermission}
        onAnswerQuestions={handleAnswerQuestions}
        busy={busy}
        backgroundTaskCount={backgroundTasks.length}
        compacting={compacting}
        working={working}
      />
    </AppShell>
    </TooltipProvider>
  );
}

export default App;
