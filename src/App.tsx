
import "./App.css";
import Chat from "./components/Chat";
import ChatInput from "./components/ChatInput";
import Sidebar from "./components/Sidebar";
import { useSessions } from "./hooks/useSessions";

function App() {
  let {selectedSessionId, selectedSession, streamingContentBlock, sessionIndexItems, models, modelId, effort, handleModelChange, handleSendMsg, handleSelectSessionIndexItem, handleNewSession} = useSessions();


  return (
    <main className="flex flex-row">
      <Sidebar items={sessionIndexItems} onSelect={handleSelectSessionIndexItem} onNewSession={handleNewSession}/>
      <div className="flex flex-col">
      <Chat
        sessionId={selectedSessionId}
        session={selectedSession}
        streamingBlock={selectedSessionId ? streamingContentBlock[selectedSessionId] ?? null : null}
      />
      <ChatInput onSend={handleSendMsg} models={models} modelId={modelId} effort={effort} onModelChange={handleModelChange}/>
      </div>
    </main>
  );
}

export default App;
