import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useState, useEffect } from "react";
import { AgentEvent, ApprovalPolicy, BranchList, Effort, Model, ModelId, Project, ProjectsFile, SessionIndexItem, SessionSnapshot } from "../types/events";

const DEFAULT_MODEL: ModelId = "haiku";
const DEFAULT_EFFORT: Effort = "high";
const DEFAULT_PERMISSION: ApprovalPolicy = "auto";

// Effort is a property of the model, not of the picker: switching to Sonnet must
// not inherit the Max you last chose on Opus. Absent key = use the model default.
type EffortByModel = Partial<Record<ModelId, Effort>>;

export type StreamingBlock = {
    index: number,
    type: "text" | "thinking" | "tool_use" | null
    text: string,
}

export function useSessions() {
    
    const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    // sessionId → the one in-flight block (CLI streams start→deltas→stop serially).
    const [streamingContentBlock, setStreamingContentBlock] = useState<Record<string, StreamingBlock | null>>({});
    const [sessionIndexItems, setSessionIndexItems] = useState<SessionIndexItem[]>([]);
    const [models, setModels] = useState<Model[]>([]);
    const [modelId, setModelId] = useState<ModelId>(DEFAULT_MODEL);
    const [effortByModel, setEffortByModel] = useState<EffortByModel>({});
    const [permissionMode, setPermissionMode] = useState<ApprovalPolicy>(DEFAULT_PERMISSION);
    const [projects, setProjects] = useState<Project[]>([]);
    const [projectPath, setProjectPath] = useState<string | null>(null);
    // Derived from the selected project, not a preference — refetched on switch
    // and never persisted.
    const [branches, setBranches] = useState<BranchList | null>(null);
    const [branch, setBranch] = useState<string | null>(null);
    const [useWorktree, setUseWorktree] = useState(false);
    // Per-session, not global: sessions run concurrently and all of their events
    // arrive on the same channel, so a single flag would clear on another's turn.
    const [busyBySession, setBusyBySession] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<string | null>(null);

// What actually gets sent for the current model: its remembered pick, else its
// own default, and null for a model that takes no effort flag at all.
const model = models.find((m) => m.id === modelId) ?? null;
const effort: Effort | null = model
  ? model.efforts.length
    ? effortByModel[modelId] ?? model.defaultEffort ?? DEFAULT_EFFORT
    : null
  : effortByModel[modelId] ?? null;

// A null effort means "just switch to this model" — it must leave the model's
// remembered pick alone, or coming back to Sonnet would lose the Extra High set
// on it earlier. Only an explicit level writes to the map.
const handleModelChange = (nextModelId: ModelId, nextEffort: Effort | null) => {
  setModelId(nextModelId);
  if (nextEffort) {
    setEffortByModel((prev) => ({ ...prev, [nextModelId]: nextEffort }));
  }
};

// Attaching a known project just selects it, so this doubles as "switch to one
// I already have" without the picker growing duplicates.
const handleAttachProject = async () => {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;

  try {
    const file = await invoke<ProjectsFile>("add_project", { path: picked });
    setProjects(file.projects);
    setProjectPath(file.lastSelected ?? picked);
  } catch (e) {
    setError(String(e));
  }
};

const handleSelectProject = (path: string) => {
  setProjectPath(path);
  // Fire and forget: losing the remembered pick costs one dropdown next launch.
  void invoke("set_last_selected_project", { path }).catch(() => {});
};

const selectedSession = selectedSessionId ? sessions.find((s) => s.sessionId === selectedSessionId) ?? null : null;

// Dedupes against the queued array, not the render snapshot: two fast clicks
// both miss an `existing` check made before their `await`, and would otherwise
// each append the same session.
const upsertSession = (snapshot: SessionSnapshot) =>
  setSessions((prev) =>
    prev.some((s) => s.sessionId === snapshot.sessionId)
      ? prev.map((s) => (s.sessionId === snapshot.sessionId ? snapshot : s))
      : [...prev, snapshot],
  );

const handleSendMsg = async (
  message: string,
) => {

  let sessionId = selectedSessionId;
  const isNewSession = !sessionId;

  const existing = sessionId ? sessions.find((s) => s.sessionId === sessionId) : undefined;
  // The backend reads the recorded cwd on resume, so this only has to be right
  // for a new session.
  const cwd = isNewSession ? projectPath : existing?.cwd ?? projectPath;

  if (!cwd) {
    setError("Attach a project first.");
    return;
  }

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    setSelectedSessionId(sessionId);
  }

  setError(null);
  setBusyBySession((prev) => ({ ...prev, [sessionId]: true }));

  try {
    const snapshot = await invoke<SessionSnapshot | null>("send_msg", {
      sessionId,
      prompt: message,
      harness: "claude_code",
      model: modelId,
      effort,
      permissionMode,
      cwd,
      // Creation-time only; the composer hides both once a session exists.
      branch: isNewSession ? branch : null,
      useWorktree: isNewSession && useWorktree,
      worktreeName: null,
      isNewSession,
    });

    // Only a new session yields a snapshot. Built by the backend, so the resolved
    // worktree name and truncated title come from disk rather than a guess here.
    if (snapshot) {
      upsertSession(snapshot);
      setSessionIndexItems((prev) => [...prev, snapshot]);
      return;
    }

    // The backend just bumped `modified` and the model on an existing session's
    // index entry; mirror it so the sidebar doesn't need a refetch.
    setSessionIndexItems((prev) =>
      prev.map((i) =>
        i.sessionId === sessionId
          ? { ...i, model: modelId, effort, permissionMode, modified: new Date().toISOString() }
          : i,
      ),
    );
  } catch (e) {
    // A rejected invoke means the turn never started, so nothing will arrive to
    // clear the flag — release it here rather than leaving the composer stuck.
    setBusyBySession((prev) => ({ ...prev, [sessionId]: false }));
    setError(String(e));
  }
};

// Keeps effortByModel, the project, and the permission mode: all preferences
// that outlive any one session. Only the worktree flag resets — it's a per-
// session choice, and defaulting it on would quietly multiply trees.
const handleNewSession = () => {
  setSelectedSessionId(null);
  setModelId(DEFAULT_MODEL);
  setUseWorktree(false);
  setBranch(branches?.current ?? null);
};

const handleSelectSessionIndexItem = async (sessionId: string) => {
  setSelectedSessionId(sessionId);

  // The point of persisting model/effort: switching sessions restores what the
  // user last picked there instead of resetting to a default.
  const indexItem = sessionIndexItems.find((i) => i.sessionId === sessionId);
  if (indexItem) {
    // Sessions indexed before the model was recorded read back as "unknown".
    const restored =
      indexItem.model === "unknown" ? DEFAULT_MODEL : indexItem.model;
    setModelId(restored);
    // The index stores one model/effort pair, so it can only seed that model's
    // entry; the rest of the map falls back to per-model defaults.
    if (indexItem.effort) {
      setEffortByModel((prev) => ({ ...prev, [restored]: indexItem.effort! }));
    }
    setPermissionMode(indexItem.permissionMode);
  }

  // Project, branch, and the worktree flag aren't restored — the composer hides
  // all three once a session exists, and they'd only mislead the next new chat.

  if (sessions.some((s) => s.sessionId === sessionId)) {
    return;
  }

  try {
    const snapshot = await invoke<SessionSnapshot | null>("get_session_by_id", { sessionId });
    if (snapshot) {
      upsertSession(snapshot);
    }
  } catch (e) {
    setError(String(e));
  }
}



useEffect(() => {
  const listSessionIndexItems = async () => {
    return await invoke<SessionIndexItem[]>("list_session_index_items");
  };

  listSessionIndexItems().then((items) => setSessionIndexItems(items));

}, [])

useEffect(() => {
  invoke<Model[]>("list_models").then(setModels);
}, [])

useEffect(() => {
  invoke<ProjectsFile>("list_projects").then((file) => {
    setProjects(file.projects);
    setProjectPath(file.lastSelected ?? file.projects[0]?.path ?? null);
  });
}, [])

// Refetched per project rather than cached: branches change outside the app.
// The guard matters because switching projects quickly would otherwise let a
// slower repo's response land on top of the faster one's.
useEffect(() => {
  if (!projectPath) {
    setBranches(null);
    setBranch(null);
    return;
  }

  let cancelled = false;

  invoke<BranchList>("list_branches", { cwd: projectPath }).then((list) => {
    if (cancelled) return;
    setBranches(list);
    setBranch(list.current);
  });

  return () => {
    cancelled = true;
  };
}, [projectPath])

useEffect(() => {
  const setupListener = async () => {
    const unlisten = await listen<AgentEvent>("agent_event", (event) => {
      // console.log(event);

      const agentEvent = event.payload;

        if (agentEvent.payload.type != "delta") {
            setSessions((prev) =>
            prev.map((s) =>
                s.sessionId === agentEvent.sessionId
                ? { ...s, events: [...s.events, agentEvent] }
                : s,
            ),
            );

            // The only signals that a turn is over. `turn_completed` fires once per
            // turn rather than per session, so this releases exactly the session
            // whose turn ended and leaves any other running one alone.
            const done =
              agentEvent.payload.type === "turn_completed" ||
              (agentEvent.payload.type === "error" && agentEvent.payload.fatal);

            if (done) {
              setBusyBySession((prev) => ({ ...prev, [agentEvent.sessionId]: false }));
            }

            if (agentEvent.payload.type === "error") {
              setError(agentEvent.payload.message);
            }
        } else {
            const payload = agentEvent.payload;

            const sessionId = agentEvent.sessionId;

            if (payload.delta == "block_start") {
                setStreamingContentBlock((prev) => ({
                  ...prev,
                  [sessionId]: { index: payload.block.index, text: "", type: null },
                }));
            } else if (payload.delta == "text_delta") {
                setStreamingContentBlock((prev) => {
                  const cur = prev[sessionId];
                  if (!cur || cur.index !== payload.block.index) return prev;
                  return {
                    ...prev,
                    [sessionId]: { ...cur, type: "text", text: cur.text + payload.text },
                  };
                });
            } else if (payload.delta == "input_delta") {
                setStreamingContentBlock((prev) => {
                  const cur = prev[sessionId];
                  if (!cur || cur.index !== payload.block.index) return prev;
                  return {
                    ...prev,
                    [sessionId]: {
                      ...cur,
                      type: "tool_use",
                      text: cur.text + payload.partialJson,
                    },
                  };
                });
            } else if (payload.delta == "block_stop") {
                setStreamingContentBlock((prev) => ({ ...prev, [sessionId]: null }));
            } else {
                setStreamingContentBlock((prev) => ({ ...prev, [sessionId]: null }));
            }
        }

    });
    return unlisten;
  };

  const listenerPromise = setupListener();

  return () => {
    listenerPromise.then((unlisten) => unlisten());
  };
}, []);

// A brand-new session has no id until its first send, so nothing can be in flight.
const busy = selectedSessionId ? busyBySession[selectedSessionId] ?? false : false;

return {sessions, selectedSessionId, selectedSession, streamingContentBlock, sessionIndexItems, models, modelId, effort, permissionMode, projects, projectPath, branches, branch, useWorktree, busy, busyBySession, error, setError, handleModelChange, setPermissionMode, handleAttachProject, handleSelectProject, setBranch, setUseWorktree, handleSendMsg, handleSelectSessionIndexItem, handleNewSession};

}