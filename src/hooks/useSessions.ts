import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState, useEffect } from "react";
import { AgentEvent, Effort, Model, ModelId, SessionIndexItem, SessionSnapshot } from "../types/events";

// Until there's a project picker, every session runs here.
const DEFAULT_CWD = "/Users/yogesh/Documents/ade";

const DEFAULT_MODEL: ModelId = "haiku";
const DEFAULT_EFFORT: Effort = "high";

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
  opts?: { projectPath?: string; useWorktree?: boolean; worktreeName?: string | null },
) => {

  let sessionId = selectedSessionId;
  const isNewSession = !sessionId;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    setSelectedSessionId(sessionId);
  }


  const existing = sessions.find((s) => s.sessionId === sessionId);
  const projectPath = opts?.projectPath ?? existing?.projectPath ?? DEFAULT_CWD;
  const useWorktree = isNewSession && (opts?.useWorktree ?? false);
  const worktreeName = useWorktree ? opts?.worktreeName ?? null : null;

  const cwd = isNewSession ? projectPath : existing?.cwd ?? projectPath;

  const snapshot = await invoke<SessionSnapshot | null>("send_msg", {
    sessionId,
    prompt: message,
    harness: "claude_code",
    model: modelId,
    effort,
    cwd,
    useWorktree,
    worktreeName,
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
        ? { ...i, model: modelId, effort, modified: new Date().toISOString() }
        : i,
    ),
  );
};

// Keeps effortByModel: the per-model picks are a preference that outlives any
// one session, so a new chat starts on the default model but still remembers
// the effort chosen for each.
const handleNewSession = () => {
  setSelectedSessionId(null);
  setModelId(DEFAULT_MODEL);
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
  }

  if (sessions.some((s) => s.sessionId === sessionId)) {
    return;
  }

  const snapshot = await invoke<SessionSnapshot | null>("get_session_by_id", { sessionId });
  if (snapshot) {
    upsertSession(snapshot);
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
  const setupListener = async () => {
    const unlisten = await listen<AgentEvent>("agent_event", (event) => {
      // console.log(event);

      const agentEvent = event.payload;
      console.log("agent event", agentEvent);

        if (agentEvent.payload.type != "delta") {
            setSessions((prev) =>
            prev.map((s) =>
                s.sessionId === agentEvent.sessionId
                ? { ...s, events: [...s.events, agentEvent] }
                : s,
            ),
            );
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

return {sessions, selectedSessionId, selectedSession, streamingContentBlock, sessionIndexItems, models, modelId, effort, handleModelChange, handleSendMsg, handleSelectSessionIndexItem, handleNewSession};

}