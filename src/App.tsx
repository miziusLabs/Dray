
import "./App.css";
import Chat from "./components/Chat";
import ChatInput from "./components/ChatInput";
import Sidebar from "./components/Sidebar";
import { useSessions } from "./hooks/useSessions";

function App() {
  let {selectedSessionId, selectedSession, streamingContentBlock, sessionIndexItems, handleSendMsg} = useSessions();
  

  return (
    <main className="flex flex-row">
      <Sidebar items={sessionIndexItems}/>
      <div className="flex flex-col">
      <Chat sessionId={selectedSessionId} session={selectedSession} streamingBlock={streamingContentBlock}/>
      <ChatInput onSend={handleSendMsg}/>
      </div>
    </main>
  );
}

export default App;
