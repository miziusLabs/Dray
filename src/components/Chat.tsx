import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import AssistantMessage from "@/components/chat/AssistantMessage";
import ThinkingIndicator from "@/components/chat/ThinkingIndicator";
import TurnBlock from "@/components/chat/TurnBlock";
import type { StreamingBlock } from "@/hooks/useSessions";
import { buildTranscript } from "@/lib/transcript";
import type { SessionSnapshot } from "@/types/events";

type ChatProps = {
  session: SessionSnapshot | null;
  streamingBlock: StreamingBlock | null;
  onOpenSubagent: (id: string) => void;
  /// Whether this session has a turn in flight, so the transcript can show the
  /// agent is still working.
  busy?: boolean;
};

/// Payload types that put something on screen. The complement of the
/// `return null` arms in [EventRow](chat/EventRow.tsx) — keep the two in step,
/// or the thinking indicator hides against an event that draws nothing.
const RENDERS = new Set([
  "assistant_text",
  "reasoning",
  "tool_call_started",
  "file_edits",
  "error",
  "context_compacted",
]);

export default function Chat({
  session,
  streamingBlock,
  onOpenSubagent,
  busy = false,
}: ChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Whether to keep pinning to the bottom. Cleared once the user scrolls up, so
  // reading back through a transcript isn't yanked forward by incoming deltas.
  const followRef = useRef(true);

  const { events, turns, subagentById, resultByCallId } = useMemo(
    () => buildTranscript(session?.events ?? []),
    [session?.events],
  );

  const streamingText = streamingBlock?.type === "text" ? streamingBlock.text : "";

  // `busy` flips the instant the user hits send, but their prompt only reaches
  // the transcript when the backend echoes it back as a `user_message`. Showing
  // the indicator on `busy` alone puts it on screen above the message it is
  // meant to follow. An open trailing turn is the signal that the echo landed.
  const lastTurn = turns.at(-1);
  const promptLanded = Boolean(lastTurn?.prompt && !lastTurn.completed);

  // Not `work.length`: that counts harness plumbing the transcript never draws
  // — `turn_started` above all, which lands before any real output and so hid
  // the indicator a beat early. Only an event that renders means the turn has
  // something to show, with the streaming text covering the window before the
  // first one commits.
  const producing =
    Boolean(lastTurn?.work.some((e) => RENDERS.has(e.payload.type))) ||
    streamingText.length > 0;


  // A new session resets the pin, or the previous session's scroll position
  // would decide whether this one follows. Must run before the pin effect below,
  // which is why it sits first.
  useLayoutEffect(() => {
    followRef.current = true;
  }, [session?.sessionId]);

  // Keyed on the session too: switching between transcripts with equal event
  // counts must still land at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !followRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [session?.sessionId, events.length, streamingText]);

  // Heights change with no React commit involved — Shiki highlighting lands
  // async and grows the content, and the composer growing shrinks this pane from
  // outside. Observing both boxes is the only signal that covers all of it; the
  // callback runs after layout but before paint, so re-pinning here never
  // flickers. Re-armed per session because the empty state unmounts these nodes.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const ro = new ResizeObserver(() => {
      if (followRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
    ro.observe(scroller);
    ro.observe(content);
    return () => ro.disconnect();
  }, [session?.sessionId]);

  // Unfollow only on an upward gesture, not in onScroll: resize-induced clamp
  // scrolls land at the bottom and pinning writes land at the bottom, so
  // position alone re-confirms the pin — but a wheel-up during streaming must
  // win instantly, before the next delta's pin can yank the view back down.
  const onWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) followRef.current = false;
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  // With no session there is no transcript to draw; AppShell centers the
  // composer and skips this pane entirely.
  if (!session) return null;

  return (
    <div ref={scrollRef} onScroll={onScroll} onWheel={onWheel} className="h-full overflow-y-auto">
      <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        {turns.map((turn, i) => (
          <TurnBlock
            key={turn.key}
            turn={turn}
            subagentById={subagentById}
            resultByCallId={resultByCallId}
            onOpenSubagent={onOpenSubagent}
            // Covers the silence between the prompt landing and the first
            // output; the turn's own content replaces it from then on. Inside
            // the block so it sits at the gap the first event will occupy.
            footer={
              i === turns.length - 1 && busy && promptLanded && !producing ? (
                <ThinkingIndicator />
              ) : undefined
            }
          />
        ))}

        {/* Deltas are never persisted, so this trailing block is replaced by the
            committed `assistant_text` the moment the turn's block closes. */}
        {streamingText && <AssistantMessage text={streamingText} streaming />}
      </div>
    </div>
  );
}
