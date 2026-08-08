import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpIcon, PlusIcon, StopIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";

type ChatInputProps = {
  onSend: (message: string) => void;
  /// Rendered below the card. A node rather than the controls' own props, so
  /// this component keeps owning layout and measurement and nothing else.
  toolbar?: ReactNode;
  busy?: boolean;
  /// Refocuses the composer when the user switches sessions.
  sessionId?: string | null;
};

const MAX_ROWS = 10;

export default function ChatInput({
  onSend,
  toolbar,
  busy = false,
  sessionId = null,
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
        {/* The ring lives on the card so the whole composer reads as one control.
            --input bakes in its own alpha, which makes Tailwind's /40-style opacity
            modifiers silently no-op, so both states set an explicit color. */}
        <div
          ref={cardRef}
          className="rounded-2xl border border-[oklch(1_0_0/6%)] bg-card transition-colors focus-within:border-[oklch(1_0_0/12%)]"
        >
          {/* Both buttons sit on the last line. At one line that reads as
              centered anyway, because the textarea's vertical padding below is
              tuned to match the buttons' own height — no `self-center` needed,
              and nothing drifts as the box grows. */}
          <div className="flex items-end gap-1 px-2 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled
              title="Attach"
              className="rounded-full text-muted-foreground"
            >
              <PlusIcon />
            </Button>

            <textarea
              ref={textareaRef}
              rows={1}
              autoFocus
              value={message}
              placeholder="Describe a task..."
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
              className="block min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1 text-composer text-foreground placeholder:text-muted-foreground focus:outline-none"
            />

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
          </div>
        </div>

        {toolbar}
      </form>
    </div>
  );
}
