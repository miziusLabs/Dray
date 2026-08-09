import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpIcon, StopIcon } from "@heroicons/react/24/outline";
import { CornerDownLeft, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ChatInputProps = {
  onSend: (message: string) => void;
  /// Rendered outside the card — below it normally, above it on a new task. A
  /// node rather than the controls' own props, so this component keeps owning
  /// layout and measurement and nothing else.
  toolbar?: ReactNode;
  busy?: boolean;
  /// Refocuses the composer when the user switches sessions.
  sessionId?: string | null;
  /// No session yet, so the composer stands alone mid-window. Nothing sits
  /// behind it to separate it from: the card drops its fill, border, and
  /// padding, the toolbar moves above — reading order runs settings first, then
  /// the box they apply to — and the send button gives way to a keyboard hint.
  isNewTask?: boolean;
  /// A backend failure, shown above the composer. Lives here rather than in the
  /// shell so it inherits the form's `max-w-3xl` column and lines up with the
  /// input; the transcript is the wrong home for it, since most of these fail
  /// before any session exists to have a transcript.
  error?: string | null;
  onDismissError?: () => void;
};

const MAX_ROWS = 10;

export default function ChatInput({
  onSend,
  toolbar,
  busy = false,
  sessionId = null,
  isNewTask = false,
  error = null,
  onDismissError,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [resizeTick, setResizeTick] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Grow to fit, then scroll. Height must be cleared before scrollHeight is read
  // or it reports the current height and the box can never shrink back down.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    // Referenced rather than reached via `parentElement`, so the freeze below
    // keeps working as the composer's nesting changes.
    const card = cardRef.current;
    if (!el || !card) return;

    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const chrome =
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderBottomWidth);

    // Freeze the card while measuring: reading scrollHeight forces a layout with
    // the textarea at 0px, and if that phantom layout reaches the flex column the
    // chat pane momentarily grows and the browser clamps its scrollTop — the
    // transcript ratchets up a few pixels on every value change.
    card.style.height = `${card.offsetHeight}px`;
    el.style.height = "0px";
    // scrollHeight includes padding, so the row cap has to as well.
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_ROWS + chrome)}px`;
    card.style.height = "";
  }, [message, resizeTick]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [sessionId]);

  // The sizing effect first measures against fallback font metrics, which can
  // clamp an empty box to the row cap; nothing re-measures until the next
  // keystroke, so the composer opens ten rows tall with a scrollbar. Waiting on
  // document.fonts.ready isn't enough — the promise can resolve a frame before
  // the new metrics reach layout, and that one shot is all it gets. Observing
  // the box re-measures whenever its size actually changes, font swap included.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => setResizeTick((t) => t + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const canSend = message.trim().length > 0 && !busy;

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed || busy) return;

    onSend(trimmed);
    setMessage("");
  };

  return (
    <div className="px-4 pb-4">
      <form
        className="mx-auto max-w-3xl"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* Above the toolbar in both states, so the failure reads before the
            controls rather than after them. `whitespace-pre-wrap` because these
            are raw messages from git and the CLI, which carry their own line
            breaks — flattening them runs the offending filenames together.

            The button is positioned out of flow and the first line cleared for
            it with `text-indent`, rather than floating it or giving it a flex
            column. Both of those reserve space per-line: a float clears after
            line one, so a message with its own `\n` breaks lands on three
            different left edges. This way every line shares one edge and only
            the first is inset. */}
        {error && (
          <div className="relative mb-2 px-1 text-ui break-words whitespace-pre-wrap text-destructive">
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                aria-label="Dismiss error"
                className="absolute top-px left-1 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            )}
            {/* Matches the button's 14px glyph plus its padding and the gap.
                Applied inline: an arbitrary Tailwind value would work, but the
                number has to track the icon size above and reads clearer next
                to it. */}
            <span style={onDismissError ? { textIndent: "1.5rem" } : undefined} className="block">
              {error}
            </span>
          </div>
        )}

        {/* Pulled left by the toolbar's own `px-1` plus the ghost button's 6px
            icon inset, so the `+` glyph — not the button box — lands on the
            same edge as the text below it. */}
        {isNewTask && <div className="-ml-2.5 pb-1.5">{toolbar}</div>}

        {/* The ring lives on the card so the whole composer reads as one control.
            --input bakes in its own alpha, which makes Tailwind's /40-style opacity
            modifiers silently no-op, so both states set an explicit color. */}
        <div
          ref={cardRef}
          className={cn(
            "rounded-2xl transition-colors",
            !isNewTask &&
              "border border-[oklch(1_0_0/6%)] bg-card focus-within:border-[oklch(1_0_0/8%)]",
          )}
        >
          {/* Both buttons sit on the last line. At one line that reads as
              centered anyway, because the textarea's vertical padding below is
              tuned to match the buttons' own height — no `self-center` needed,
              and nothing drifts as the box grows. */}
          <div className={cn("flex items-end gap-1 py-3", isNewTask ? "px-0" : "px-3")}>
            <textarea
              ref={textareaRef}
              rows={1}
              autoFocus
              value={message}
              placeholder={isNewTask ? "Describe a task..." : "Send follow-up"}
              onChange={(e) => setMessage(e.currentTarget.value)}
              onKeyDown={(e) => {
                // Shift+Enter is the only way to get a newline; plain Enter sends.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              // `min-w-0` is load-bearing: without it one long unbroken token
              // sets this flex item's floor and pushes the buttons off the row.
              // `py-1` puts one line at 28px — the buttons' own height — so the
              // first row looks centered against them without being.
              className={cn(
                "block min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1 text-composer text-foreground placeholder:text-muted-foreground focus:outline-none",
                // At `px-0` the card contributes no inset, so the textarea drops
                // its own too and the text sits on the form edge — the line the
                // toolbar and hint align to.
                isNewTask ? "px-0" : "px-1",
              )}
            />

            {/* Enter-to-send lives in `onKeyDown`, not in this button being the
                form's submitter, so the empty state can drop it for the hint
                below without losing the keyboard path. `busy` is unreachable
                there too — nothing is running before a session exists. */}
            {!isNewTask && (
              <Button
                type="submit"
                size="icon-sm"
                disabled={!canSend}
                title={busy ? "Running…" : "Send"}
                className="rounded-full"
              >
                {busy ? (
                  <StopIcon className="fill-current" />
                ) : (
                  <ArrowUpIcon strokeWidth={2} />
                )}
              </Button>
            )}
          </div>
        </div>

        {isNewTask ? (
          <div className="flex items-center gap-1 pt-2 text-ui text-muted-foreground/60">
            Press <CornerDownLeft className="size-3" strokeWidth={2} /> to send
          </div>
        ) : (
          <div className="pt-1.5">{toolbar}</div>
        )}
      </form>
    </div>
  );
}
