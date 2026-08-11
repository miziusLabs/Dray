import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import AssistantMessage from "@/components/chat/AssistantMessage";
import BackgroundTasksIndicator from "@/components/chat/BackgroundTasksIndicator";
import CompactingIndicator from "@/components/chat/CompactingIndicator";
import PermissionRequest from "@/components/chat/PermissionRequest";
import QuestionRequest from "@/components/chat/QuestionRequest";
import Reasoning from "@/components/chat/Reasoning";
import ThinkingIndicator from "@/components/chat/ThinkingIndicator";
import TurnBlock from "@/components/chat/TurnBlock";
import type { StreamingBlock } from "@/hooks/useSessions";
import { toolArgument } from "@/lib/tools";
import { buildTranscript, rendersRow, type PendingAsk } from "@/lib/transcript";
import type { SessionSnapshot } from "@/types/events";

type ChatProps = {
  session: SessionSnapshot | null;
  streamingBlock: StreamingBlock | null;
  onOpenSubagent: (id: string) => void;
  /// Answers a permission request. The agent is blocked until this fires, so it
  /// is the one callback here whose absence stalls a session rather than
  /// degrading a view.
  onRespondPermission: (requestId: string, optionId: string) => void;
  /// Answers an `AskUserQuestion`. Blocks the agent the same way, and an empty
  /// map is a real answer — the reader skipped every question.
  onAnswerQuestions: (requestId: string, answers: Record<string, string>) => void;
  /// Whether this session has a turn in flight, so the transcript can show the
  /// agent is still working.
  busy?: boolean;
  /// Outstanding async subagents. Rendered after the turns rather than inside
  /// one: the tasks outlive the turn that spawned them, so no single block owns
  /// them — unlike the thinking indicator, which must sit where its turn's
  /// text will land.
  backgroundTaskCount?: number;
  /// Whether a compaction is running. Sits beside the task indicator for the
  /// same reason: it belongs to the session, not to any one turn.
  compacting?: boolean;
};

/// How long an answered permission card holds its place before going.
///
/// Answering one and being asked the next are two separate events, so they land
/// in two commits. Removing the card on the first collapses the transcript by a
/// card's height, and the second grows it straight back — at the bottom of a
/// pinned scroller that reads as everything above lurching down and bouncing up.
/// Waiting one beat lets the replacement arrive in the same commit, turning two
/// jumps into one small resize.
///
/// Only tuned against the fast case, which is the one that jitters: a gap longer
/// than this still clears the card first, and reads as two separate things
/// happening because it is.
const CARD_EXIT_MS = 500;

/// The cards to draw: the live set, but one beat behind when it empties.
function useLingeringCards(pending: PendingAsk[]): PendingAsk[] {
  const [shown, setShown] = useState(pending);

  // Identity changes on every event, so the effect keys off the ids instead —
  // re-running it per event would set state in a loop.
  const key = pending.map((request) => request.requestId).join(" ");
  const latest = useRef(pending);
  latest.current = pending;

  useEffect(() => {
    // Arrivals are never delayed; the agent is blocked on them.
    if (latest.current.length > 0) {
      setShown(latest.current);
      return;
    }

    const timer = setTimeout(
      () => setShown((prev) => (prev.length === 0 ? prev : [])),
      CARD_EXIT_MS,
    );
    return () => clearTimeout(timer);
  }, [key]);

  return shown;
}

export default function Chat({
  session,
  streamingBlock,
  onOpenSubagent,
  onRespondPermission,
  onAnswerQuestions,
  busy = false,
  backgroundTaskCount = 0,
  compacting = false,
}: ChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Whether to keep pinning to the bottom. Cleared once the user scrolls up, so
  // reading back through a transcript isn't yanked forward by incoming deltas.
  const followRef = useRef(true);

  const { events, turns, subagentById, resultByCallId, pendingAsks } = useMemo(
    () => buildTranscript(session?.events ?? [], busy),
    [session?.events, busy],
  );

  const cards = useLingeringCards(pendingAsks);

  // Told apart by the type `block_start` declared, not by content — thinking
  // deltas are plain text on the wire. Only one block streams at a time, so at
  // most one of these is non-empty.
  const streamingText = streamingBlock?.type === "text" ? streamingBlock.text : "";
  const streamingThinking =
    streamingBlock?.type === "thinking" ? streamingBlock.text : "";
  const streamingAny = streamingText || streamingThinking;

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
  //
  // A compaction suppresses it outright. The turn is genuinely open and drawing
  // nothing, so every test above passes — but the agent is not thinking, it is
  // waiting on the compaction, and `CompactingIndicator` already says so.
  //
  // An open request — for consent or for an answer — suppresses it for the same
  // reason a compaction does, and now more strongly: the card renders outside
  // the turn, so the turn genuinely draws nothing and every other test passes —
  // but the agent is not thinking, it is waiting on the reader, who is looking
  // at the card.
  //
  // Gated on what is drawn, not on what is pending, so the indicator can't slip
  // into a lingering card's window and undo the quiet it buys.
  const waitingTurn =
    busy &&
    !compacting &&
    cards.length === 0 &&
    lastTurn &&
    !lastTurn.completed &&
    !streamingAny &&
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
    streamingAny && lastTurn && !lastTurn.completed ? lastTurn : null;

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
  }, [session?.sessionId, events.length, streamingAny]);

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
              ) : turn !== streamingTurn ? (
                undefined
              ) : streamingThinking ? (
                // The same component the committed `reasoning` event renders with,
                // in its `streaming` presentation — the multi-line preview keeps
                // growing live; it collapses to one line once committed.
                <Reasoning text={streamingThinking} encrypted={false} streaming />
              ) : (
                <AssistantMessage text={streamingText} streaming />
              )
            }
          />
        ))}

        {cards.map((ask) =>
          ask.type === "questions_asked" ? (
            <QuestionRequest
              key={ask.requestId}
              questions={ask.questions}
              onAnswer={(answers) => onAnswerQuestions(ask.requestId, answers)}
            />
          ) : (
            <PermissionRequest
              key={ask.requestId}
              // The agent writes a description for nearly every call; the tool's
              // own name is the floor, so the card always has a subject.
              description={
                ask.description ?? ask.title ?? ask.displayName ?? ask.toolName
              }
              argument={toolArgument(ask.input)}
              options={ask.options}
              onRespond={(optionId) => onRespondPermission(ask.requestId, optionId)}
            />
          ),
        )}

        {backgroundTaskCount > 0 && (
          <BackgroundTasksIndicator count={backgroundTaskCount} />
        )}

        {compacting && <CompactingIndicator />}
      </div>
    </div>
  );
}
