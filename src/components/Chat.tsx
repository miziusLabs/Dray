import { StreamingBlock } from "../hooks/useSessions";
import { AgentEvent, SessionSnapshot } from "../types/events";

export default function Chat(
  { sessionId,
    session,
    streamingBlock
  }:
  { sessionId: string | null,
    session: SessionSnapshot | null,
    streamingBlock: StreamingBlock[],
  }) {
    const events: AgentEvent[] | null = session?.events ? session?.events : null;
    const id = sessionId;
 

  return (
    <div className="flex flex-col items-start mx-24 my-24">
      <p>Session id: {id}</p>
      <div className="flex flex-col items-start gap-2">
        {events?.map((event) => {
          let text: string | null = null;

            switch (event.payload.type) {
              case "user_message":
                text = event.payload.text;
                break;

                case "assistant_text":
                  text = event.payload.text;
                  break;
            
              default:
                break;
            }

            if (text == null) return null;

            return <p key={event.id} className="text-left">{text}</p>;
  })}
    
    {streamingBlock?.map((b) => <p key={b.index} className="text-left">{b.text}</p>)}

      </div>
   
    </div>
  )
}
