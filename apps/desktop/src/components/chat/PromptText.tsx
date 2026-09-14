import FileLink from "@/components/chat/FileLink";
import { inlineMark } from "@/components/chat/InlineMark";
import { Markdown } from "@/components/chat/Markdown";
import { absolutePath } from "@/lib/filePath";
import {
  SEGMENT_COLOR,
  highlightSegments,
  splitFencedCodeBlocks,
  splitMention,
  withPaths,
} from "@/lib/highlight";
import { openLink } from "@/lib/openLink";

/// Renders prompt prose with its inline marks while handing complete fenced
/// blocks to the shared Markdown renderer.
export default function PromptText({
  text,
  cwd = null,
}: {
  text: string;
  cwd?: string | null;
}) {
  return (
    <>
      {splitFencedCodeBlocks(text).map((block, i) => {
        if (block.kind === "code") {
          return <Markdown key={i}>{block.text}</Markdown>;
        }

        const segments = withPaths(highlightSegments(block.text));
        return (
          <span key={i}>
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
                  <FileLink
                    key={s}
                    path={path}
                    line={segment.line}
                    title={segment.text}
                    className={SEGMENT_COLOR[segment.kind]}
                  >
                    @{name}
                  </FileLink>
                );
              }

              if (segment.kind === "url") {
                return (
                  <button
                    key={s}
                    type="button"
                    className={SEGMENT_COLOR.url}
                    onClick={(event) => openLink(segment.text, event)}
                  >
                    {segment.text}
                  </button>
                );
              }

              return <span key={s} className={SEGMENT_COLOR[segment.kind]}>{segment.text}</span>;
            })}
          </span>
        );
      })}
    </>
  );
}
