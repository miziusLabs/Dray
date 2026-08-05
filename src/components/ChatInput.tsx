import { useState } from "react";
import ModelSelector from "./ModelSelector";
import type { Effort, Model, ModelId } from "../types/events";

export default function ChatInput({
    onSend,
    models,
    modelId,
    effort,
    onModelChange,
}: {
    onSend: (message: string) => void,
    models: Model[],
    modelId: ModelId,
    effort: Effort | null,
    onModelChange: (modelId: ModelId, effort: Effort | null) => void,
}) {
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const handleSubmit = () => {
        setError("");
        setMessage("");
        
        if(!message.trim()) {
            setError("Type something to send");
            return;
        }

        onSend(message.trim());
    };

    return(
        <div className="flex mx-24 my-24">
        <form
        className="flex flex-row gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <div>
        <input
          type="text"
          placeholder="Ask anything..."
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
        />
        {error && <p>{error}</p>}
        </div>
        <ModelSelector
          models={models}
          modelId={modelId}
          effort={effort}
          onChange={onModelChange}
        />
        <button type="submit">Send</button>
      </form>
        </div>
    )
}