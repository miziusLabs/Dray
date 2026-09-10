import { Image } from "lucide-react";

import SessionAvatar from "@/components/SessionAvatar";
import FileLink from "@/components/chat/FileLink";
import ImageRow from "@/components/chat/ImageRow";
import { inlineMark } from "@/components/chat/InlineMark";
import { absolutePath } from "@/lib/filePath";
import {
  SEGMENT_COLOR,
  highlightSegments,
  splitMention,
  withLineBreaks,
  withPaths,
} from "@/lib/highlight";
import { openLink } from "@/lib/openLink";
import { stripSenderPrefix } from "@/lib/relay";
import { shortenPath } from "@/lib/tools";
import type { ImageRef, MessageSender } from "@/types/events";

/// The user's prompt, rendered with the same inline marks and mention colours
/// used while it was being typed. Block markdown remains literal by design.
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
  const segments = withPaths(highlightSegments(body));
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
          <span className="text-chat whitespace-pre-wrap wrap-anywhere">
            {segments.map((segment, i) => {
              const mark = inlineMark(segment, i);
              if (mark) return mark;

              if (segment.kind === "mention") {
                const { name } = splitMention(segment.text);
                const raw = segment.text.slice(1);
                const path = absolutePath(raw, cwd);
                if (!path) {
                  return <span key={i} className={SEGMENT_COLOR.mention} title={raw}>@{name}</span>;
                }
                return (
                  <FileLink key={i} path={path} title={raw} className={SEGMENT_COLOR.mention}>
                    @{name}
                  </FileLink>
                );
              }

              if (segment.kind === "path") {
                const file = segment.inner ?? segment.text;
                const name =
                  (file.split("/").filter(Boolean).at(-1) ?? file) + segment.text.slice(file.length);
                const path = absolutePath(file, cwd);
                if (!path) {
                  return <span key={i} className={SEGMENT_COLOR.path} title={segment.text}>@{name}</span>;
                }
                return (
                  <FileLink
                    key={i}
                    path={path}
                    line={segment.line}
                    title={segment.text}
                    className={SEGMENT_COLOR.path}
                  >
                    @{name}
                  </FileLink>
                );
              }

              if (segment.kind === "url") {
                return (
                  <button
                    key={i}
                    type="button"
                    className={SEGMENT_COLOR.url}
                    onClick={(event) => openLink(segment.text, event)}
                  >
                    {segment.text}
                  </button>
                );
              }

              return <span key={i} className={SEGMENT_COLOR[segment.kind]}>{segment.text}</span>;
            })}
          </span>
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
