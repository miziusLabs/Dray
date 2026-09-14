import PromptText from "@/components/chat/PromptText";
import { withLineBreaks } from "@/lib/highlight";
import { stripSenderPrefix } from "@/lib/relay";
import type { QueuedMessage } from "@/types/events";

/// Prompts held while a turn is running. It uses the same inline renderer as a
/// delivered prompt so queued text does not change meaning when it is sent.
export default function QueuedMessages({
  messages,
  cwd = null,
}: {
  messages: QueuedMessage[];
  cwd?: string | null;
}) {
  if (!messages.length) return null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      {messages.map((message, i) => {
        const body = withLineBreaks(stripSenderPrefix(message.text, message.from));
        return (
          <div key={message.id} className="flex w-full flex-col items-end gap-1">
            <div className="max-w-[85%] rounded-xl bg-card px-3 py-2 text-chat text-card-foreground opacity-55">
              <div className="whitespace-pre-wrap wrap-anywhere">
                <PromptText text={body} cwd={cwd} />
              </div>
            </div>
            {i === messages.length - 1 && (
              <span className="pr-1 text-ui text-muted-foreground/60">Esc to cancel</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
