import { inlineMark } from "@/components/chat/InlineMark";
import {
  SEGMENT_COLOR,
  highlightSegments,
  splitMention,
  withLineBreaks,
  withPaths,
} from "@/lib/highlight";
import { absolutePath } from "@/lib/filePath";
import { openLink } from "@/lib/openLink";
import { stripSenderPrefix } from "@/lib/relay";
import type { QueuedMessage } from "@/types/events";
import FileLink from "@/components/chat/FileLink";

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
        const segments = withPaths(highlightSegments(body));
        return (
          <div key={message.id} className="flex w-full flex-col items-end gap-1">
            <div className="max-w-[85%] rounded-xl bg-card px-3 py-2 text-chat text-card-foreground opacity-55">
              <span className="whitespace-pre-wrap wrap-anywhere">
                {segments.map((segment, s) => {
                  const mark = inlineMark(segment, s);
                  if (mark) return mark;

                  if (segment.kind === "mention" || segment.kind === "path") {
                    const raw = segment.kind === "mention" ? segment.text.slice(1) : segment.inner ?? segment.text;
                    const { name } = splitMention(`@${raw}`);
                    const path = absolutePath(raw, cwd);
                    if (!path) {
                      return <span key={s} className={SEGMENT_COLOR[segment.kind]} title={raw}>@{name}</span>;
                    }
                    return (
                      <FileLink key={s} path={path} line={segment.line} title={segment.text} className={SEGMENT_COLOR[segment.kind]}>
                        @{name}
                      </FileLink>
                    );
                  }

                  if (segment.kind === "url") {
                    return (
                      <button key={s} type="button" className={SEGMENT_COLOR.url} onClick={(event) => openLink(segment.text, event)}>
                        {segment.text}
                      </button>
                    );
                  }

                  return <span key={s} className={SEGMENT_COLOR[segment.kind]}>{segment.text}</span>;
                })}
              </span>
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
