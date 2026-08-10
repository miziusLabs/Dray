import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import AssistantMessage from "@/components/chat/AssistantMessage";
import BackgroundTasksIndicator from "@/components/chat/BackgroundTasksIndicator";
import ThinkingIndicator from "@/components/chat/ThinkingIndicator";
import TurnBlock from "@/components/chat/TurnBlock";
import type { StreamingBlock } from "@/hooks/useSessions";
import { buildTranscript, rendersRow } from "@/lib/transcript";
import type { SessionSnapshot } from "@/types/events";

type ChatProps = {
  session: SessionSnapshot | null;
  streamingBlock: StreamingBlock | null;
  onOpenSubagent: (id: string) => void;
  /// Whether this session has a turn in flight, so the transcript can show the
  /// agent is still working.
  busy?: boolean;
  /// Outstanding async subagents. Rendered after the turns rather than inside
  /// one: the tasks outlive the turn that spawned them, so no single block owns
  /// them — unlike the thinking indicator, which must sit where its turn's
  /// text will land.
  backgroundTaskCount?: number;
};

export default function Chat({
  session,
  streamingBlock,
  onOpenSubagent,
  busy = false,
  backgroundTaskCount = 0,
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

  // The turn the indicator belongs to, or null when nothing is waiting on
  // output.
  //
  // An *open* trailing turn is the whole test. Not "has a prompt": a run
  // routinely closes a turn and opens another with no `user_message` between
  // them, and that continuation turn is exactly when the indicator is wanted.
  // Requiring a prompt lost it for the rest of the session. The window between
  // the user hitting send and the backend echoing their message back is covered
  // by the same check from the other side — until the echo lands the previous
  // turn is still closed, so there is no open turn to attach to.
  //
  // A turn stops waiting once it draws something. Not `work.length`, which
  // counts harness plumbing the transcript renders nothing for — `turn_started`
  // above all, which lands before any real output and hid the indicator early.
  const lastTurn = turns.at(-1);
  const waitingTurn =
    busy &&
    lastTurn &&
    !lastTurn.completed &&
    !streamingText &&
    !lastTurn.work.some(rendersRow)
      ? lastTurn
      : null;

  // Which turn hosts the preview. It has to render inside the same stack the
  // committed `assistant_text` will land in, or the two sit at different gaps
  // (the between-turn gap is wider than the within-turn one) and the text
  // jumps by the difference on the swap.
  //
  // Always the open trailing turn while anything is streaming. `turn_completed`
  // maps from `result`, which fires once per run rather than per message, so a
  // turn stays open across every `message_start` in it — and after a `result`
  // the next thing is a `user_message`, which opens the next turn before any
  // delta arrives. So this is non-null whenever `streamingText` is.
  const streamingTurn =
    streamingText && lastTurn && !lastTurn.completed ? lastTurn : null;

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
        {turns.map((turn) => (
          <TurnBlock
            key={turn.key}
            turn={turn}
            subagentById={subagentById}
            resultByCallId={resultByCallId}
            onOpenSubagent={onOpenSubagent}
            // Both cover the wait for output, and never at once — `waitingTurn`
            // requires no streaming text. Inside the block so they sit at the
            // gap the committed event will occupy, rather than the wider one
            // between turns: the preview belongs to this turn, not after it.
            footer={
              turn === waitingTurn ? (
                <ThinkingIndicator />
              ) : turn === streamingTurn ? (
                <AssistantMessage text={streamingText} streaming />
              ) : undefined
            }
          />
        ))}

        {backgroundTaskCount > 0 && (
          <BackgroundTasksIndicator count={backgroundTaskCount} />
        )}
      </div>
    </div>
  );
}
