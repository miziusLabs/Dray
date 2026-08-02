import { useEffect, useState } from "react";
import "./App.css";
import Chat from "./components/Chat";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ChatInput from "./components/ChatInput";
import type { AgentEvent } from "./types/events";


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

function App() {

  const [sessions, setSessions] = useState<Array<Session>>();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

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


          setSessions((prev) =>
            (prev ?? []).map((s) =>
              s.session_id === agentEvent.sessionId
                ? { ...s, events: [...s.events, agentEvent] }
                : s,
            ),
          );

      });
      return unlisten;
    };

    const listenerPromise = setupListener();

    return () => {
      listenerPromise.then((unlisten) => unlisten());
    };
  }, []);
  

  return (
    <main className="container">
      <Chat sessionId={selectedSessionId} session={selectedSession}/>
      <ChatInput onSend={handleSendMsg}/>
    </main>
  );
}

export default App;
