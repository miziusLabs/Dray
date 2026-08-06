import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

const PREVIEW_CHARS = 280;

/// Thinking text, dimmed and collapsed. Encrypted reasoning carries no readable
/// text at all, so it renders nothing rather than an empty block.
export default function Reasoning({
  text,
  encrypted,
}: {
  text: string;
  encrypted: boolean;
}) {
  const [open, setOpen] = useState(false);

  const trimmed = text.trim();
  if (encrypted || !trimmed) return null;

  const long = trimmed.length > PREVIEW_CHARS;
  const shown = open || !long ? trimmed : `${trimmed.slice(0, PREVIEW_CHARS)}…`;

  return (
    <div>
      <button
        type="button"
        disabled={!long}
        onClick={() => setOpen((prev) => !prev)}
        className="group/think flex items-center gap-1.5 text-chat text-muted-foreground"
      >
        <span>Thinking</span>
        {long && (
          <ChevronRight
            className={cn(
              "size-3 transition-all",
              open ? "rotate-90 opacity-100" : "opacity-0 group-hover/think:opacity-100",
            )}
          />
        )}
      </button>

      <p className="mt-1 whitespace-pre-wrap text-chat text-muted-foreground italic">
        {shown}
      </p>
    </div>
  );
}
