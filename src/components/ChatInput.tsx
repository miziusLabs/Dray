import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpIcon, StopIcon } from "@heroicons/react/24/outline";

import ModelSelector from "@/components/ModelSelector";
import { Button } from "@/components/ui/button";
import type { Effort, Model, ModelId } from "@/types/events";

type ChatInputProps = {
  onSend: (message: string) => void;
  models: Model[];
  modelId: ModelId;
  effort: Effort | null;
  onModelChange: (modelId: ModelId, effort: Effort | null) => void;
  busy?: boolean;
  /// Refocuses the composer when the user switches sessions.
  sessionId?: string | null;
};

const MAX_ROWS = 10;

export default function ChatInput({
  onSend,
  models,
  modelId,
  effort,
  onModelChange,
  busy = false,
  sessionId = null,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [fontsReady, setFontsReady] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow to fit, then scroll. Height must be cleared before scrollHeight is read
  // or it reports the current height and the box can never shrink back down.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    const card = el?.parentElement;
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
  }, [message, fontsReady]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [sessionId]);

  // The sizing effect above runs before the webfont resolves, so its first
  // measurement is against the fallback metrics and can clamp an empty box to
  // the row cap. Nothing re-measures until the next keystroke, so nudge it once
  // fonts are ready.
  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
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
        {/* The ring lives on the card so the whole composer reads as one control. */}
        <div className="rounded-xl border border-input bg-card transition-colors focus-within:border-ring/60">
          <textarea
            ref={textareaRef}
            rows={1}
            autoFocus
            value={message}
            placeholder="Ask anything..."
            onChange={(e) => setMessage(e.currentTarget.value)}
            onKeyDown={(e) => {
              // Shift+Enter is the only way to get a newline; plain Enter sends.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="block w-full resize-none overflow-y-auto bg-transparent px-3 pt-3 pb-2 text-composer text-foreground placeholder:text-muted-foreground focus:outline-none"
          />

          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <ModelSelector
              models={models}
              modelId={modelId}
              effort={effort}
              onChange={onModelChange}
            />

            <Button
              type="submit"
              size="icon-sm"
              disabled={!canSend}
              title={busy ? "Running…" : "Send"}
            >
              {busy ? <StopIcon className="fill-current" /> : <ArrowUpIcon />}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
