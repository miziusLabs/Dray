import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";

import { Markdown } from "@/components/chat/Markdown";
import { cn } from "@/lib/utils";


/// Thinking text, dimmed and collapsed. Encrypted reasoning carries no readable
/// text at all, so it renders nothing rather than an empty block.
///
/// Reasoning details stay hidden while the agent is working and after the turn
/// completes. The reader must explicitly open the section to see them; the live
/// section keeps its composing orb so it remains clear that work is in progress.
export default function Reasoning({
  text,
  encrypted,
  streaming = false,
}: {
  text: string;
  encrypted: boolean;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const trimmed = text.trim();
  if (encrypted || !trimmed) return null;

  if (streaming) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="group/think flex items-center gap-1.5 text-chat text-muted-foreground"
        >
          <ThinkingOrb state="composing" size={20} theme="dark" aria-hidden />
          <span>Thinking</span>
          <ChevronRight
            className={cn(
              "size-3 transition-all",
              open ? "rotate-90 opacity-100" : "opacity-0 group-hover/think:opacity-100",
            )}
          />
        </button>

        {open && (
          <Markdown
            streaming
            className="mt-1 text-muted-foreground italic [&_p]:whitespace-pre-wrap"
          >
            {trimmed}
          </Markdown>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="group/think flex items-center gap-1.5 text-chat text-muted-foreground"
      >
        <span>Thought</span>
        <ChevronRight
          className={cn(
            "size-3 transition-all",
            open ? "rotate-90 opacity-100" : "opacity-0 group-hover/think:opacity-100",
          )}
        />
      </button>

      {open && (
        <Markdown className="mt-1 text-muted-foreground italic [&_p]:whitespace-pre-wrap">
          {trimmed}
        </Markdown>
      )}
    </div>
  );
}
