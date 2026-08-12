import { useEffect, useRef } from "react";
import { CornerDownLeft } from "lucide-react";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { CommandGroup } from "@/lib/slash";
import { cn } from "@/lib/utils";
import type { SlashCommand } from "@/types/events";

/// The command picker that opens over the composer while a `/` is being typed.
///
/// Deliberately not a Radix menu, unlike every other picker in the toolbar:
/// those take focus when they open, and this one must not — the textarea stays
/// focused so typing keeps filtering the list. Every key it responds to is
/// handled by the composer's own `onKeyDown` and arrives here as `activeIndex`,
/// which is the same bargain the questionnaire card makes for the same reason.
///
/// `groups` arrive in render order and `activeIndex` addresses the whole list
/// flattened, so the caller's keyboard navigation and this drawing can't
/// disagree about which row is which.
export default function SlashCommandMenu({
  groups,
  activeIndex,
  onPick,
  onHover,
}: {
  groups: CommandGroup[];
  activeIndex: number;
  onPick: (command: SlashCommand) => void;
  /// Hovering *moves* the selection rather than painting a second highlight.
  /// Two independently lit rows would leave Enter and the click landing on
  /// different commands, which is the one thing this list must never do.
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  /// The last position the pointer was actually at. Compared against, not
  /// merely stored — see the guard in `handleMove`.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  // Keeps the selected row in view by scrolling *this* container and nothing
  // else. `scrollIntoView` was wrong here even with `block: "nearest"`: it
  // walks every scrollable ancestor, so arrowing through the list also nudged
  // the transcript behind it, which read as the whole view shifting.
  //
  // The container's own padding is subtracted from both edges, so a row
  // scrolled to either end stops short of the box rather than against it —
  // without that the padding only ever shows at rest, and the highlighted row
  // sat flush on the border exactly when it was the one being looked at.
  useEffect(() => {
    const list = listRef.current;
    const row = activeRef.current;
    if (!list || !row) return;

    const style = getComputedStyle(list);
    const padTop = parseFloat(style.paddingTop);
    const padBottom = parseFloat(style.paddingBottom);

    const rowBox = row.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();

    const top = listBox.top + padTop;
    const bottom = listBox.bottom - padBottom;

    if (rowBox.top < top) {
      list.scrollTop -= top - rowBox.top;
    } else if (rowBox.bottom > bottom) {
      list.scrollTop += rowBox.bottom - bottom;
    }
  }, [activeIndex]);

  /// Hover only counts when the pointer genuinely moved.
  ///
  /// Scrolling the list slides a different row under a stationary cursor, and
  /// the browser reports that as a `mousemove` at the same coordinates. Taken
  /// at face value it hijacked the selection: arrowing past the last visible
  /// row scrolled the next one into place, the phantom move selected whatever
  /// had slid under the pointer, and the highlight snapped backwards.
  const handleMove = (event: React.MouseEvent, index: number) => {
    const { clientX: x, clientY: y } = event;
    const last = pointerRef.current;
    if (last && last.x === x && last.y === y) return;

    pointerRef.current = { x, y };
    onHover(index);
  };

  if (!groups.length) return null;

  // Runs across the whole list rather than restarting per group, so it lines up
  // with the flat index the composer navigates by.
  let row = -1;

  return (
    // Anchored to the card above it and lifted clear, so the list grows upward
    // into empty space rather than pushing the composer around as it filters.
    <div className="absolute bottom-full left-0 z-50 mb-1.5 w-full">
      {/* Above the box and unstyled: nothing about a list that never holds
          focus says it is navigable, but the hint is chrome about the list
          rather than part of it. Escape is left out — it's the one key everyone
          already tries. */}
      {/* `bg-background` rather than transparent: the row floats over the
          transcript, and without a fill the text sat on whatever happened to be
          scrolled behind it. Body's own colour, so it reads as a gap in the
          page rather than as another surface. The padding is the row's own —
          the fill has to cover the text, not just sit under the box. */}
      <div className="mb-1.5 flex items-center gap-3 rounded-lg bg-background px-1.5 py-1 text-ui text-muted-foreground/50">
        <KbdGroup>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          <span className="ml-0.5">navigate</span>
        </KbdGroup>
        <KbdGroup>
          <Kbd>
            <CornerDownLeft strokeWidth={2} />
          </Kbd>
          <span className="ml-0.5">select</span>
        </KbdGroup>
      </div>

      <div
        ref={listRef}
        role="listbox"
        aria-label="Slash commands"
        // Seven rows: 7 × the row's own `h-8` (2rem), plus the 0.5rem of `py-2`
        // at each end. Written out rather than computed, so it costs nothing at
        // render — but it does mean this number, `h-8`, and `py-2` have to move
        // together.
        className="max-h-[15rem] overflow-y-auto overscroll-contain rounded-xl border border-[oklch(1_0_0/8%)] bg-popover px-1 py-2 text-popover-foreground shadow-md"
      >
        {groups.map((group, g) => (
          <div
            key={group.label ?? `group-${g}`}
            className={cn(
              g > 0 && "mt-2",
              // Only a labelled section is closed off by a rule, which today
              // means recents and nothing else. The unlabelled groups are
              // separated by their gap alone.
              g > 0 && groups[g - 1].label !== null && "border-t border-dotted border-border/40 pt-2",
            )}
          >
            {group.label && (
              <div className="px-2 pb-0.5 text-ui text-muted-foreground/50">{group.label}</div>
            )}

            {group.commands.map((command) => {
              row += 1;
              const index = row;

              return (
                <button
                  key={command.name}
                  ref={index === activeIndex ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  // The textarea must keep focus — losing it on mousedown would
                  // close the menu before the click ever lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={(e) => handleMove(e, index)}
                  onClick={() => onPick(command)}
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-ui",
                    index === activeIndex
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground",
                  )}
                >
                  <span className="shrink-0 font-medium">/{command.name}</span>

                  {command.argumentHint && (
                    <span className="shrink-0 text-muted-foreground/60">
                      {command.argumentHint}
                    </span>
                  )}

                  {/* Descriptions run to a paragraph on skill-backed commands,
                      so this is one line that gives way to the name rather than
                      wrapping the row to three. */}
                  {command.description && (
                    <span className="truncate text-muted-foreground">{command.description}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
