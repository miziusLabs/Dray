import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import AssistantMessage from "@/components/chat/AssistantMessage";
import EventRow from "@/components/chat/EventRow";
import type { StreamingBlock } from "@/hooks/useSessions";
import type { AgentEvent, SessionSnapshot } from "@/types/events";

type ChatProps = {
  session: SessionSnapshot | null;
  streamingBlock: StreamingBlock | null;
};

/// `seq` is the ordering key — most Claude Code events carry no usable `ts`.
function bySeq(a: AgentEvent, b: AgentEvent) {
  return a.seq - b.seq;
}

export default function Chat({ session, streamingBlock }: ChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Whether to keep pinning to the bottom. Cleared once the user scrolls up, so
  // reading back through a transcript isn't yanked forward by incoming deltas.
  const followRef = useRef(true);

  const events = useMemo(() => [...(session?.events ?? [])].sort(bySeq), [session?.events]);

  // callId → whether it errored. A call with no entry is still in flight.
  const resultByCallId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const event of events) {
      if (event.payload.type === "tool_call_completed") {
        map.set(event.payload.callId, event.payload.result.isError);
      }
    }
    return map;
  }, [events]);

  const streamingText = streamingBlock?.type === "text" ? streamingBlock.text : "";

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

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-chat text-muted-foreground">Start a new session</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} onWheel={onWheel} className="h-full overflow-y-auto">
      <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        {events.map((event) => (
          <EventRow key={event.id} event={event} resultByCallId={resultByCallId} />
        ))}

        {/* Deltas are never persisted, so this trailing block is replaced by the
            committed `assistant_text` the moment the turn's block closes. */}
        {streamingText && <AssistantMessage text={streamingText} streaming />}
      </div>
    </div>
  );
}
