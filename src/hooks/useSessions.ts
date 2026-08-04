import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState, useEffect } from "react";
import { AgentEvent } from "../types/events";


type Harness = "claude_code" | "codex";
type SessionStatus = "idle" | "in_progress" | "completed";

export type Session = {
  session_id: string,
  harness: Harness,
  model: string | null,
  effort: string | null,
  /// Where the agent runs — the worktree path for a worktree session.
  cwd: string,
  /// Repo root the user picked; `cwd` for a normal session.
  projectPath: string,
  worktreeName: string | null,
  status: SessionStatus,
  events: Array<AgentEvent>,
}

export type SessionIndexItem = {
  sessionId: string,
  harness: Harness,
  cwd: string,
  projectPath: string,
  branch: string | null,
  worktreeName: string | null,
  title: string,
  created: string,
  modified: string,
  archived: boolean,
  pinned: boolean,
};



// Until there's a project picker, every session runs here.
const DEFAULT_CWD = "/Users/yogesh/Documents/ade";

// `claude -w <name>` puts the tree here and names its branch `worktree-<name>`.
const worktreePath = (projectPath: string, name: string) =>
  `${projectPath}/.claude/worktrees/${name}`;

export type StreamingBlock = {
    index: number,
    type: "text" | "thinking" | "tool_use" | null
    text: string,
}

export function useSessions() {
    
    const [sessions, setSessions] = useState<Session[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [streamingContentBlock, setStreamingContentBlock] = useState<StreamingBlock[]>([]);
    const [sessionIndexItems, setSessionIndexItems] = useState<SessionIndexItem[]>([]);

const selectedSession = selectedSessionId && sessions ? sessions.find((s) => s.session_id == selectedSessionId) ?? null : null;

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


  const existing = sessions.find((s) => s.session_id === sessionId);
  const projectPath = opts?.projectPath ?? existing?.projectPath ?? DEFAULT_CWD;
  const useWorktree = isNewSession && (opts?.useWorktree ?? false);
  const worktreeName = useWorktree ? opts?.worktreeName ?? null : null;

  
  const cwd = isNewSession ? projectPath : existing?.cwd ?? projectPath;

  if(isNewSession){
    const ns: Session = {
      session_id: sessionId,
      harness: "claude_code",
      model: "haiku",
      effort: "low",
      // The backend names an unnamed worktree, so the real cwd is only known
      // once `init` reports it.
      cwd: useWorktree && worktreeName
        ? worktreePath(projectPath, worktreeName)
        : projectPath,
      projectPath,
      worktreeName,
      status: "in_progress",
      events: []
    }
    setSessions((prev) => prev ? [...prev, ns] : [ns]);
  }

  const indexItem = await invoke<SessionIndexItem | null>("send_msg", {
    sessionId,
    prompt: message,
    harness: "claude_code",
    model: "haiku",
    effort: "low",
    cwd,
    useWorktree,
    worktreeName,
    isNewSession,
  });

  // Only a new session yields an item. It carries the resolved worktree name
  // and the truncated title, so it supersedes what we guessed above.
  if (indexItem) {
    setSessionIndexItems((prev) => [...prev, indexItem]);
    setSessions((prev) =>
      prev.map((s) =>
        s.session_id === indexItem.sessionId
          ? { ...s, cwd: indexItem.cwd, worktreeName: indexItem.worktreeName }
          : s,
      ),
    );
  }

};

const handleSelectSessionIndexItem = async (indexItem: SessionIndexItem) => {
  setSelectedSessionId(indexItem.sessionId);

  const existingSession = sessions.find((s) => s.session_id == indexItem.sessionId);
  if (existingSession) {
    return;
  }

  const events = await invoke<AgentEvent[]>("get_session_by_id", { sessionId: indexItem.sessionId });
  const ns: Session = {
    session_id: indexItem.sessionId,
    harness: indexItem.harness,
    model: null,
    effort: null,
    cwd: indexItem.cwd,
    projectPath: indexItem.projectPath,
    worktreeName: indexItem.worktreeName,
    status: "idle",
    events,
  }
  setSessions((prev) => prev ? [...prev, ns] : [ns]);
}



useEffect(() => {
  const listSessionIndexItems = async () => {
    return await invoke<SessionIndexItem[]>("list_session_index_items");
  };

  listSessionIndexItems().then((items) => setSessionIndexItems(items));

}, [])

useEffect(() => {
  const setupListener = async () => {
    const unlisten = await listen<AgentEvent>("agent_event", (event) => {
      // console.log(event);

      const agentEvent = event.payload;
      console.log("agent event", agentEvent);

        if (agentEvent.payload.type != "delta") {
            setSessions((prev) =>
            (prev ?? []).map((s) =>
                s.session_id === agentEvent.sessionId
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

return {sessions, selectedSessionId, selectedSession, streamingContentBlock, sessionIndexItems, handleSendMsg, handleSelectSessionIndexItem};

}