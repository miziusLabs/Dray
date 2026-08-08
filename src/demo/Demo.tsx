import { useMemo, useState } from "react";
import { CpuChipIcon } from "@heroicons/react/24/outline";

import Chat from "@/components/Chat";
import ChatInput from "@/components/ChatInput";
import Sidebar, { SidebarToggle } from "@/components/Sidebar";
import SubagentPanel from "@/components/SubagentPanel";
import AppShell from "@/components/layout/AppShell";
import ComposerToolbar from "@/components/composer/ComposerToolbar";
import SessionHeader from "@/components/layout/SessionHeader";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEMO_EVENTS, DEMO_MODELS } from "@/demo/fixtures";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useHotkey } from "@/hooks/useHotkey";
import { buildTranscript } from "@/lib/transcript";
import { cn } from "@/lib/utils";
import type {
  ApprovalPolicy,
  BranchList,
  Effort,
  ModelId,
  Project,
  SessionIndexItem,
  SessionSnapshot,
} from "@/types/events";

const INDEX: SessionIndexItem = {
  sessionId: "demo",
  harness: "claude_code",
  cwd: "/Users/yogesh/Documents/yogesh",
  projectPath: "/Users/yogesh/Documents/yogesh",
  branch: "main",
  worktreeName: null,
  // Long on purpose: the sidebar clips this, which is the whole reason the
  // header shows the title at all.
  title: "How does the blog work, and where does the frontmatter get parsed?",
  model: "opus",
  effort: "high",
  permissionMode: "acceptEdits",
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

const DEMO_PROJECTS: Project[] = [
  { path: "/Users/yogesh/Documents/yogesh", name: "yogesh", added: "" },
  { path: "/Users/yogesh/Documents/mayo/supalytics-server", name: "supalytics-server", added: "" },
];

const DEMO_BRANCHES: BranchList = {
  current: "main",
  branches: ["main", "feat/pagination", "fix/rss-dates"],
  dirty: false,
};

/// Renders every transcript component against fixed content so the UI can be
/// reviewed without a live agent. Reachable at `?demo`; not part of the app.
export default function Demo() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<ModelId>("opus");
  const [effort, setEffort] = useState<Effort | null>("high");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [permissionMode, setPermissionMode] = useState<ApprovalPolicy>("auto");
  const [projectPath, setProjectPath] = useState<string | null>(DEMO_PROJECTS[0].path);
  const [branch, setBranch] = useState<string | null>("main");
  const [useWorktree, setUseWorktree] = useState(false);
  // Drives the toolbar's creation-time trio, which a real session hides once it
  // exists — both states need to be reviewable here.
  const [isNewSession, setIsNewSession] = useState(true);

  const { subagents, resultByCallId } = useMemo(
    () => buildTranscript(DEMO_EVENTS),
    [],
  );

  const toggleSidebar = () => setCollapsed((prev) => !prev);
  useHotkey("b", toggleSidebar);
  const fullscreen = useFullscreen();

  return (
    <TooltipProvider>
    <AppShell
      sidebar={
        <Sidebar
          items={[INDEX, WORKTREE, OTHER_PROJECT]}
          selectedSessionId="demo"
          collapsed={collapsed}
          onToggleCollapsed={toggleSidebar}
          onSelect={async () => {}}
          onNewSession={() => {}}
        />
      }
      header={
        <header className="flex h-(--titlebar-h) shrink-0 items-center gap-2 px-3">
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
            </div>
          )}

          <SessionHeader session={SESSION} className="flex-1" />

          {/* Demo-only: the real app derives this from whether a session exists. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsNewSession((v) => !v)}
            className="text-ui text-muted-foreground"
          >
            {isNewSession ? "new session" : "live session"}
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPanelOpen((prev) => !prev)}
            title="Subagents"
          >
            <CpuChipIcon />
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
          busy={busy}
          sessionId="demo"
          toolbar={
            <ComposerToolbar
              models={DEMO_MODELS}
              modelId={modelId}
              effort={effort}
              onModelChange={(id, next) => {
                setModelId(id);
                setEffort(next);
              }}
              permissionMode={permissionMode}
              onPermissionModeChange={setPermissionMode}
              projects={DEMO_PROJECTS}
              projectPath={projectPath}
              onSelectProject={setProjectPath}
              onAttachProject={() => {}}
              branches={DEMO_BRANCHES}
              branch={branch}
              onSelectBranch={setBranch}
              useWorktree={useWorktree}
              onToggleWorktree={() => setUseWorktree((v) => !v)}
              isNewSession={isNewSession}
            />
          }
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
    </TooltipProvider>
  );
}
