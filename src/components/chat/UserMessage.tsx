import { Image } from "lucide-react";

import { SEGMENT_COLOR, highlightSegments, splitMention } from "@/lib/highlight";
import { shortenPath } from "@/lib/tools";
import type { ImageRef } from "@/types/events";

/// The user's own text, echoed from the event log rather than local state — the
/// backend synthesizes and persists it, so this renders the same live or replayed.
///
/// A slash command and a file mention are coloured and nothing more — same size,
/// same weight, same line. Each stays part of the sentence it sits in, which a
/// chip or a monospace run made them stop being. The segments come from the same
/// function the composer's overlay uses, so a word coloured while typing is
/// still coloured once sent.
export default function UserMessage({
  text,
  images = [],
}: {
  text: string;
  images?: ImageRef[];
}) {
  const segments = highlightSegments(text);

  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] flex-col gap-1.5 rounded-xl bg-card px-3 py-2 text-card-foreground">
        {text && (
          <span className="text-chat whitespace-pre-wrap">
            {/* Plain runs concatenate back to `text` exactly, so the spacing the
                user typed survives — nothing here is rebuilt from a parse.
                A mention is the one run drawn shorter than it was sent: the
                directory is dropped and kept on the tooltip, since a deep path
                is most of a line and says little the filename doesn't. The
                composer can't do this — see `splitMention`. */}
            {segments.map((segment, i) => {
              if (segment.kind === "mention") {
                const { name } = splitMention(segment.text);

                return (
                  <span key={i} className={SEGMENT_COLOR.mention} title={segment.text.slice(1)}>
                    @{name}
                  </span>
                );
              }

              return (
                <span key={i} className={SEGMENT_COLOR[segment.kind]}>
                  {segment.text}
                </span>
              );
            })}
          </span>
        )}

        {images.map((image, i) => {
          const src = image.url ?? image.path;
          // A local path isn't loadable from the webview without a Tauri asset
          // URL, so a path-only image is named rather than shown.
          return image.url ? (
            <img
              key={i}
              src={image.url}
              alt=""
              className="max-h-64 rounded-md object-contain"
            />
          ) : (
            <span key={i} className="flex items-center gap-1.5 text-chat text-muted-foreground">
              <Image className="size-3.5 shrink-0" />
              <span className="truncate">{src ? shortenPath(src) : "image"}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
