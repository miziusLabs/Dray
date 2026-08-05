
import "./App.css";
import Chat from "./components/Chat";
import ChatInput from "./components/ChatInput";
import Sidebar from "./components/Sidebar";
import { useSessions } from "./hooks/useSessions";

function App() {
  let {selectedSessionId, selectedSession, streamingContentBlock, sessionIndexItems, models, modelId, effort, handleModelChange, handleSendMsg, handleSelectSessionIndexItem} = useSessions();


  return (
    <main className="flex flex-row">
      <Sidebar items={sessionIndexItems} onSelect={handleSelectSessionIndexItem}/>
      <div className="flex flex-col">
      <Chat sessionId={selectedSessionId} session={selectedSession} streamingBlock={streamingContentBlock}/>
      <ChatInput onSend={handleSendMsg} models={models} modelId={modelId} effort={effort} onModelChange={handleModelChange}/>
      </div>
    </main>
  );
}

export default App;
