import { useEffect, useState } from "react";
import "./App.css";
import Chat from "./components/Chat";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ChatInput from "./components/ChatInput";


type Harness = "claude_code" | "codex";
type SessionStatus = "idle" | "in_progress" | "completed";

export type Session = {
  id: string,
  harness: Harness,
  model: string,
  effort: string,
  status: SessionStatus,
  events: string[],
}

function App() {

  const [sessions, setSessions] = useState<Array<Session>>();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const selectedSession = selectedSessionId && sessions ? sessions.find((s) => s.id == selectedSessionId) ?? null : null;

  const handleSendMsg = async (message: string) => {

    let sessionId = selectedSessionId;
    const isNewSession = !sessionId;
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      setSelectedSessionId(sessionId);
    }

    if(isNewSession){
      const ns: Session = {
        id: sessionId,
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
      const unlisten = await listen("events", (event) => {
        console.log(event);
      });
      return unlisten;
    };

    const listenerPromise = setupListener();

    return () => {
      listenerPromise.then((unlisten) => unlisten());
    };
  }, [selectedSessionId]);
  

  return (
    <main className="container">
      <Chat sessionId={selectedSessionId} session={selectedSession}/>
      <ChatInput onSend={handleSendMsg}/>
    </main>
  );
}

export default App;
