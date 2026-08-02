import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState, useEffect } from "react";
import { AgentEvent } from "../types/events";


type Harness = "claude_code" | "codex";
type SessionStatus = "idle" | "in_progress" | "completed";

export type Session = {
  session_id: string,
  harness: Harness,
  model: string,
  effort: string,
  status: SessionStatus,
  events: Array<AgentEvent>,
}

export type StreamingBlock = {
    index: number,
    type: "text" | "thinking" | "tool_use" | null
    text: string,
}

export function useSessions() {
    
    const [sessions, setSessions] = useState<Session[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [streamingContentBlock, setStreamingContentBlock] = useState<StreamingBlock[]>([]);

const selectedSession = selectedSessionId && sessions ? sessions.find((s) => s.session_id == selectedSessionId) ?? null : null;

const handleSendMsg = async (message: string) => {

  let sessionId = selectedSessionId;
  const isNewSession = !sessionId;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    setSelectedSessionId(sessionId);
  }


  if(isNewSession){
    const ns: Session = {
      session_id: sessionId,
      harness: "claude_code",
      model: "haiku",
      effort: "low",
      status: "in_progress",
      events: []
    }
    setSessions((prev) => prev ? [...prev, ns] : [ns]);
  }

  await invoke("send_msg", {
    sessionId,
    prompt: message,
    harness: "claude_code",
    model: "haiku",
    effort: "low",
    isNewSession,
  });

};

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

return {sessions, selectedSessionId, selectedSession, streamingContentBlock, handleSendMsg};

}