import { Image } from "lucide-react";

import SessionAvatar from "@/components/SessionAvatar";
import ImageRow from "@/components/chat/ImageRow";
import PromptText from "@/components/chat/PromptText";
import { withLineBreaks } from "@/lib/highlight";
import { stripSenderPrefix } from "@/lib/relay";
import { shortenPath } from "@/lib/tools";
import type { ImageRef, MessageSender } from "@/types/events";

/// The user's prompt, rendered with the same inline marks and mention colours
/// used while it was being typed. Complete fenced blocks use the shared Markdown
/// renderer so pasted code stays readable.
export default function UserMessage({
  text,
  images = [],
  from = null,
  cwd = null,
  onOpenSession,
}: {
  text: string;
  images?: ImageRef[];
  from?: MessageSender | null;
  cwd?: string | null;
  onOpenSession?: (sessionId: string) => void;
}) {
  const body = withLineBreaks(stripSenderPrefix(text, from));
  const missing = images.filter((image) => !image.path && !image.url);

  return (
    <div className="flex flex-col items-end gap-1.5">
      {from && (
        <button
          type="button"
          onClick={() => onOpenSession?.(from.sessionId)}
          disabled={!onOpenSession}
          className="flex max-w-[85%] cursor-pointer items-center gap-1 text-ui text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
        >
          <SessionAvatar sessionId={from.sessionId} name={from.title} />
          <span className="truncate">{from.title}</span>
        </button>
      )}

      <ImageRow images={images} variant="sent" align="end" />

      {body && (
        <div className="user-bubble max-w-[85%] rounded-xl bg-card px-3 py-2 text-card-foreground shadow-(--shadow-card)">
          <div className="text-chat whitespace-pre-wrap wrap-anywhere">
            <PromptText text={body} cwd={cwd} />
          </div>
        </div>
      )}

      {missing.map((image, i) => (
        <span key={i} className="flex items-center gap-1.5 text-chat text-muted-foreground">
          <Image className="size-3.5 shrink-0" />
          <span className="truncate">{image.path ? shortenPath(image.path) : "image"}</span>
        </span>
      ))}
    </div>
  );
}
