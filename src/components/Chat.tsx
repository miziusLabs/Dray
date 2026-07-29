import { useState } from "react";
import { Session } from "../App";

export default function Chat(
  { sessionId,
    session,
  }:
  { sessionId: string | null,
    session: Session | null,
  }) {
  const [events] = useState<string[]>();
  const id = sessionId;
 

  return (
    <div className="flex mx-24 my-24">
      <div className="flex flex-row gap-2">
        {events?.map((event, index) => (
          <p key={index}>{event}</p>
        ))}
      </div>
   
    </div>
  )
}
