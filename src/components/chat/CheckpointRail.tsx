import { useEffect, useRef } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type Checkpoint = {
  /// The turn's key, which is its prompt event's id — what the chat scrolls to.
  key: string;
  /// The prompt itself, shown on hover. Already trimmed and never empty.
  preview: string;
};

type CheckpointRailProps = {
  checkpoints: Checkpoint[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  /// Fires on the rail's own scroll container, so the handler can tell whether
  /// the rail has room to absorb the gesture before forwarding it.
  onWheel?: React.WheelEventHandler<HTMLDivElement>;
  className?: string;
};

/// The transcript's spine: one tick per user message, in the gutter left of the
/// chat column. Hovering one previews the prompt, clicking scrolls to it.
///
/// Deliberately marks prompts and nothing else. A turn is what a reader
/// remembers a conversation by, and the tick spacing is fixed rather than
/// proportional to the turn's length — this is a table of contents, not a
/// minimap.
export default function CheckpointRail({
  checkpoints,
  activeKey,
  onSelect,
  onWheel,
  className,
}: CheckpointRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  // A long session overflows the rail, so following the transcript has to move
  // the rail too or the active tick scrolls out of it. `nearest` keeps it still
  // whenever the tick is already visible, which is the common case.
  useEffect(() => {
    railRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  return (
    <div
      ref={railRef}
      onWheel={onWheel}
      // Hit areas stack with no gap: the rail reads as one scrubber rather than
      // a column of small targets, so there is nowhere between two ticks that
      // answers to neither.
      className={cn(
        "flex max-h-[70%] flex-col overflow-y-auto [scrollbar-width:none]",
        className,
      )}
    >
      {checkpoints.map((checkpoint, i) => {
        const active = checkpoint.key === activeKey;

        return (
          <Tooltip key={checkpoint.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-active={active}
                aria-label={`Jump to message ${i + 1}`}
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(checkpoint.key)}
                className="group flex h-3 w-7 shrink-0 items-center"
              >
                {/* Active is brightness alone, at the default width. Length is
                    the hover affordance — reaching for a tick and having it grow
                    is the rail answering the pointer, and an active tick that
                    stayed long read as a second, competing hover. */}
                <span
                  className={cn(
                    "h-0.5 w-3 rounded-full transition-all duration-200 group-hover:w-5",
                    active
                      ? "bg-foreground"
                      : "bg-muted-foreground/40 group-hover:bg-muted-foreground",
                  )}
                />
              </button>
            </TooltipTrigger>

            {/* Left-aligned, multi-line and at the transcript's own size, unlike
                every other tooltip in the app — this one carries a sentence the
                reader wrote, not a label, so it is read rather than glanced at. */}
            <TooltipContent
              side="right"
              align="center"
              className="block max-w-80 whitespace-pre-wrap py-2 text-left text-chat"
            >
              <span className="line-clamp-4">{checkpoint.preview}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
