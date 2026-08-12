import { Image } from "lucide-react";

import { parseSlashCommand } from "@/lib/slash";
import { shortenPath } from "@/lib/tools";
import type { ImageRef } from "@/types/events";

/// The user's own text, echoed from the event log rather than local state — the
/// backend synthesizes and persists it, so this renders the same live or replayed.
///
/// A slash command is coloured and nothing more — same size, same weight, same
/// line. It stays part of the sentence it starts, which a chip or a monospace
/// run made it stop being.
export default function UserMessage({
  text,
  images = [],
}: {
  text: string;
  images?: ImageRef[];
}) {
  const command = parseSlashCommand(text);

  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] flex-col gap-1.5 rounded-xl bg-card px-3 py-2 text-card-foreground">
        {text && (
          <span className="text-chat whitespace-pre-wrap">
            {command ? (
              <>
                <span className="text-accent-command">/{command.name}</span>
                {/* Sliced from the original rather than rebuilt from the parse,
                    so the spacing the user typed survives — `args` is trimmed,
                    and joining with a single space would rewrite their text. */}
                {text.slice(command.name.length + 1)}
              </>
            ) : (
              text
            )}
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
