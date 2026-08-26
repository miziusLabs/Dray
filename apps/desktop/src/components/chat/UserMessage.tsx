import { Image } from "lucide-react";

import SessionAvatar from "@/components/SessionAvatar";
import ImageRow from "@/components/chat/ImageRow";
import { Markdown } from "@/components/chat/Markdown";
import { stripSenderPrefix } from "@/lib/relay";
import { shortenPath } from "@/lib/tools";
import type { ImageRef, MessageSender } from "@/types/events";

/// The user's own text, echoed from the event log rather than local state — the
/// backend synthesizes and persists it, so this renders the same live or replayed.
///
/// Markdown is rendered with the same safe renderer as assistant output, so sent
/// prompts preserve formatting instead of displaying their source syntax.
///
/// Images sit **outside the bubble**. The bubble is a container for speech, and
/// a picture given a fill and a padding reads as speech with a frame drawn round
/// it; unwrapped, the image is its own edge. They stay inside this component and
/// on its column, so the change is only what the reader sees.
///
/// A message relayed by `dray send` keeps the user's side of the transcript —
/// whoever wrote it, it is not this session's assistant speaking — and is named
/// above the bubble instead of being drawn as a second kind of speech. The name
/// comes off the event's own `from` field and never out of the text: the model
/// on the other end can write any line it likes, so prose is not attribution.
/// The line the backend writes into the prompt for the receiving agent is taken
/// back off here, since the row above already says who is talking — safe to
/// mute precisely because the field, not the prose, is what draws it.
export default function UserMessage({
  text,
  images = [],
  from = null,
  onOpenSession,
}: {
  text: string;
  images?: ImageRef[];
  /// The session that relayed this, or `null` for a prompt the user typed.
  from?: MessageSender | null;
  /// Opens the sending session. Absent where nothing can navigate, which draws
  /// the attribution as a plain line rather than hiding it.
  onOpenSession?: (sessionId: string) => void;
}) {
  const body = stripSenderPrefix(text, from);
  // An image with neither an archived copy nor bytes of its own — the file was
  // cleared out from under a transcript that still names it. `ImageRow` drops
  // those, so this row is what is left to say about them.
  const missing = images.filter((image) => !image.path && !image.url);

  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* Topmost, above even the attachments: who is talking is read before
          anything they sent. The mark is generated from the session's id rather
          than fetched — a session is not an account and has no picture — so it
          is the same shape every time this session speaks. */}
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

      {/* Above the text, matching the composer's own tray — what was attached is
          read before the sentence written about it, on the way in and on the way
          back out. `end` so the row grows leftwards from the same edge the
          bubble sits on. */}
      <ImageRow images={images} variant="sent" align="end" />

      {body && (
        <div className="max-w-[85%] rounded-xl bg-card px-3 py-2 text-card-foreground">
          <Markdown
            className="text-card-foreground [&_p]:whitespace-pre-wrap"
          >
            {body}
          </Markdown>
        </div>
      )}

      {/* An image whose file is gone. Named rather than drawn as a broken frame,
          which says nothing about what was sent. */}
      {missing.map((image, i) => (
        <span key={i} className="flex items-center gap-1.5 text-chat text-muted-foreground">
          <Image className="size-3.5 shrink-0" />
          <span className="truncate">{image.path ? shortenPath(image.path) : "image"}</span>
        </span>
      ))}

    </div>
  );
}
