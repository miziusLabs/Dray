
import "./App.css";
import Chat from "./components/Chat";
import ChatInput from "./components/ChatInput";
import { useSessions } from "./hooks/useSessions";

function App() {
  let {selectedSessionId, selectedSession, streamingContentBlock, handleSendMsg} = useSessions();
  

  return (
    <main className="container">
      <Chat sessionId={selectedSessionId} session={selectedSession} streamingBlock={streamingContentBlock}/>
      <ChatInput onSend={handleSendMsg}/>
    </main>
  );
}

export default App;
