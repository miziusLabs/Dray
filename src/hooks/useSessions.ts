import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState, useEffect } from "react";
import { AgentEvent, Effort, Model, SessionIndexItem, SessionSnapshot } from "../types/events";

// Until there's a project picker, every session runs here.
const DEFAULT_CWD = "/Users/yogesh/Documents/ade";

const DEFAULT_MODEL = "haiku";

export type StreamingBlock = {
    index: number,
    type: "text" | "thinking" | "tool_use" | null
    text: string,
}

export function useSessions() {
    
    const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [streamingContentBlock, setStreamingContentBlock] = useState<StreamingBlock[]>([]);
    const [sessionIndexItems, setSessionIndexItems] = useState<SessionIndexItem[]>([]);
    const [models, setModels] = useState<Model[]>([]);
    const [modelId, setModelId] = useState<string>(DEFAULT_MODEL);
    const [effort, setEffort] = useState<Effort | null>(null);

const handleModelChange = (nextModelId: string, nextEffort: Effort | null) => {
  setModelId(nextModelId);
  setEffort(nextEffort);
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

const handleSelectSessionIndexItem = async (sessionId: string) => {
  setSelectedSessionId(sessionId);

  // The point of persisting model/effort: switching sessions restores what the
  // user last picked there instead of resetting to a default.
  const indexItem = sessionIndexItems.find((i) => i.sessionId === sessionId);
  if (indexItem) {
    setModelId(indexItem.model || DEFAULT_MODEL);
    setEffort(indexItem.effort);
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

            if (payload.delta == "block_start") {
                setStreamingContentBlock((prev) => {
                    let block: StreamingBlock = {
                        index: payload.block.index,
                        text: "",
                        type: null,
                    };
                    return [...prev, block]
            })

             } else if(payload.delta == "text_delta") {
                setStreamingContentBlock((prev) => 
                    (prev ?? []).map((b) => b.index == payload.block.index ? {...b, type: "text", text: b.text + payload.text} : b)
                 )
            } else if(payload.delta == "input_delta") {
                setStreamingContentBlock((prev) => 
                    (prev ?? []).map((b) => b.index == payload.block.index ? {...b, type: "tool_use", text: b.text + payload.partialJson} : b)
                 )
            } else if (payload.delta == "block_stop") {
                setStreamingContentBlock([])
            } else {
                setStreamingContentBlock([])
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

return {sessions, selectedSessionId, selectedSession, streamingContentBlock, sessionIndexItems, models, modelId, effort, handleModelChange, handleSendMsg, handleSelectSessionIndexItem};

}