import { Session } from "../App";
import { AgentEvent } from "../types/events";

export default function Chat(
  { sessionId,
    session,
  }:
  { sessionId: string | null,
    session: Session | null,
  }) {
    const events: AgentEvent[] | null = session?.events ? session?.events : null;
    const id = sessionId;
 

  return (
    <div className="flex mx-24 my-24">
      <div className="flex flex-row gap-2">
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

            return <p key={event.id}>{text}</p>;
  })}
        Session id: {id}
      </div>
   
    </div>
  )
}
