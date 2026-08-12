import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, CornerDownLeft, Square, X } from "lucide-react";

import FileMentionMenu from "@/components/composer/FileMentionMenu";
import SlashCommandMenu from "@/components/composer/SlashCommandMenu";
import { Button } from "@/components/ui/button";
import { useFileSearch } from "@/hooks/useFileSearch";
import { useRecentCommands } from "@/hooks/useRecentCommands";
import { SEGMENT_COLOR, highlightSegments, splitMention } from "@/lib/highlight";
import { applyMention, mentionSpan } from "@/lib/mention";
import {
  applyCommand,
  filterCommands,
  groupCommands,
  parseSlashCommand,
  slashQuery,
} from "@/lib/slash";
import { cn } from "@/lib/utils";
import type { FileMatch, SlashCommand } from "@/types/events";

type ChatInputProps = {
  onSend: (message: string) => void;
  /// What the `/` picker offers. Empty until the backend's probe lands, and
  /// empty forever if it failed — the picker simply never opens, and a command
  /// typed by hand still works, since the CLI parses the text either way.
  commands?: SlashCommand[];
  /// Where the `@` picker searches for files. The session's own directory, so a
  /// worktree session mentions paths inside its tree — the CLI resolves `@path`
  /// against the directory it was spawned in, and those are the same one.
  cwd?: string | null;
  /// Interrupts the running turn. Only reachable while `busy` — the same
  /// button is Send otherwise.
  onStop?: () => void;
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
  /// A settled session takes no new turns, so the composer is replaced by the one
  /// control that can change that. Handled here rather than in the shell so the
  /// bar inherits the form's column and sits exactly where the card would.
  archived?: boolean;
  onUnarchive?: () => void;
};

const MAX_ROWS = 10;
// The empty state has no transcript above it to crowd, so the box can take a lot
// more of the window before it starts scrolling. Capped rather than unbounded
// because this composer is centered: past the window's height it would overflow
// off both ends at once, putting the wordmark past the top edge with nothing to
// scroll it back.
const NEW_TASK_MAX_ROWS = 20;

// Everything that decides where a glyph lands. The textarea and the overlay that
// colours a command inside it must agree on all of it exactly, or the two copies
// of the text drift apart and show as ghosting — so they share one constant
// rather than two matching class lists. The horizontal padding varies by state
// and is applied at both call sites alongside this.
const TEXT_BOX = "py-1 text-composer";

// `String.raw` because the glyphs are drawn with backslashes; an ordinary
// template literal would eat them as escapes.
const WORDMARK = String.raw` ___    ____    ____  __ __
|   \  |    \  /    ||  |  |
|    \ |  D  )|  o  ||  |  |
|  D  ||    / |     ||  ~  |
|     ||    \ |  _  ||___, |
|     ||  .  \|  |  ||     |
|_____||__|\_||__|__||____/`;

export default function ChatInput({
  onSend,
  commands = [],
  cwd = null,
  onStop,
  toolbar,
  busy = false,
  sessionId = null,
  isNewTask = false,
  error = null,
  onDismissError,
  archived = false,
  onUnarchive,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [resizeTick, setResizeTick] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  // Where the caret is, tracked so the picker can tell a command being typed
  // from a slash that has already been left behind.
  const [caret, setCaret] = useState(0);
  // Escape shuts the picker without clearing what was typed. Cleared again as
  // soon as the caret leaves the command, so the next `/` reopens it.
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Set by a pick, applied once React has painted the new value — a controlled
  // textarea otherwise puts the caret at the end, which is wrong whenever the
  // completed command has arguments after it.
  const pendingCaretRef = useRef<number | null>(null);

  const [recent, recordCommand] = useRecentCommands();

  // The runs that take a colour. Empty of anything but plain text most of the
  // time, which is what the overlay below checks before mounting at all.
  const segments = useMemo(() => highlightSegments(message), [message]);
  const highlighted = segments.some((segment) => segment.kind !== "text");

  // Two modes, and the difference is deliberate. With nothing typed this is
  // browsing, so the list is grouped — what you just used, then what shipped
  // with the harness, then what was installed. Once there is a query it is
  // searching, and headers would hide matches behind section chrome, so the
  // ranked list is drawn flat.
  const query = slashQuery(message, caret);
  const groups = useMemo(() => {
    if (query === null) return [];
    if (query === "") return groupCommands(commands, recent);

    const matches = filterCommands(commands, query);
    return matches.length ? [{ label: null, items: matches }] : [];
  }, [commands, query, recent]);

  // The two pickers are mutually exclusive without needing to be arbitrated:
  // the caret sits in exactly one token, and a token opening with `/` at
  // position zero is not one opening with `@`. Kept as two independent reads so
  // neither has to know the other exists.
  const mention = mentionSpan(message, caret);
  const files = useFileSearch(cwd, mention?.query ?? null);

  // Flattened in render order, so arrowing through the list and drawing it
  // can't disagree about which row an index names.
  const commandMatches = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // Only the count is shared between the two pickers — the lists themselves stay
  // separate all the way to the pick, so nothing has to be narrowed back out of
  // a union that `mention` already decided.
  const rowCount = mention ? files.length : commandMatches.length;
  const menuOpen = !dismissed && rowCount > 0 && (query !== null || mention !== null);
  // Clamped rather than trusted: both lists arrive asynchronously, so a list
  // that shrinks under an already-moved selection would otherwise index past
  // its end — and an undefined row only shows up as a crash on the keystroke
  // that picks it.
  const active = Math.min(activeIndex, Math.max(rowCount - 1, 0));

  // Keyed on the query text rather than on the span, which is a fresh object
  // every keystroke and would reset the selection on a bare cursor move.
  const mentionQuery = mention?.query ?? null;
  useEffect(() => {
    setActiveIndex(0);
    if (query === null && mentionQuery === null) setDismissed(false);
  }, [query, mentionQuery]);

  const pickCommand = (command: SlashCommand) => {
    const next = applyCommand(message, command.name);
    pendingCaretRef.current = next.caret;
    setMessage(next.text);
    textareaRef.current?.focus();
  };

  const pickFile = (file: FileMatch) => {
    if (!mention) return;

    const next = applyMention(message, mention, file.path);
    pendingCaretRef.current = next.caret;
    setMessage(next.text);
    textareaRef.current?.focus();
  };

  /// The keyboard's way into whichever list is drawn. A click calls the same
  /// two functions directly, so the two routes cannot diverge.
  const pickRow = (index: number) => {
    if (mention) {
      const file = files[index];
      if (file) pickFile(file);
      return;
    }

    const command = commandMatches[index];
    if (command) pickCommand(command);
  };

  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (pending === null) return;
    pendingCaretRef.current = null;

    textareaRef.current?.setSelectionRange(pending, pending);
    setCaret(pending);
  }, [message]);

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
    const rows = isNewTask ? NEW_TASK_MAX_ROWS : MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * rows + chrome)}px`;
    card.style.height = "";
  }, [message, resizeTick, isNewTask]);

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

    // Recorded on send rather than on pick: choosing a command from the list
    // and then deleting it is not using it. Taken from the text, so a command
    // typed by hand counts the same as one picked.
    const command = parseSlashCommand(trimmed);
    if (command) recordCommand(command.name);

    onSend(trimmed);
    setMessage("");
  };

  // Returns before the form, so there is no disabled textarea to focus and no
  // submit path to reach at all — a disabled input still reads as "type here,
  // but not now", and this session isn't waiting on anything.
  //
  // After the hooks above, which must stay unconditional: settling the open
  // session swaps this in under a mounted composer.
  //
  // The live composer is a card plus a 34px toolbar row beneath it. Only the card
  // has a settled counterpart, so that row's height is held below as empty space:
  // `pb-4` + 34px. Without it the bar sits 34px lower than every other session's
  // composer and the transcript shifts down with it.
  if (archived) {
    return (
      <div className="px-4 pb-[3.125rem]">
        {/* `px-3 py-3` is the live card's own padding, so the button's right edge
            lands where the submit button's does. The label carries the textarea's
            extra `px-1` itself — inside the card those two sit on different
            edges, and matching only one of them is what reads as a shift. */}
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-2xl border border-[oklch(1_0_0/6%)] bg-card px-3 py-3">
          <span className="px-1 text-composer text-muted-foreground">
            Unsettle this task to send a follow-up.
          </span>

          <Button variant="secondary" size="sm" onClick={onUnarchive}>
            Unsettle
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4">
      <form
        className="mx-auto max-w-3xl"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* Decoration, so it is hidden from assistive tech rather than read out
            as punctuation. Sits on the form edge like the toolbar and the text
            below it, and `whitespace-pre` keeps the drawing from reflowing. */}
        {isNewTask && (
          <pre
            aria-hidden
            className="mb-4 font-mono text-[10px] leading-[1.15] whitespace-pre text-foreground/20 select-none"
          >
            {WORDMARK}
          </pre>
        )}

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
            modifiers silently no-op, so both states set an explicit color.
            `relative` anchors the command picker, which opens upward out of the
            card rather than displacing anything as it filters. */}
        <div
          ref={cardRef}
          className={cn(
            "relative rounded-2xl transition-colors",
            !isNewTask &&
              "border border-[oklch(1_0_0/6%)] bg-card focus-within:border-[oklch(1_0_0/8%)]",
          )}
        >
          {/* Two separate consequences of the empty state, passed separately
              because they are separate things that happen to coincide. The
              toolbar sits above the input there and the window is empty below
              it, so the list opens downward — upward it would cover the controls
              it sits next to. And the card behind it has no fill or border, so
              the list drops its own to match. */}
          {menuOpen &&
            (mention ? (
              <FileMentionMenu
                files={files}
                activeIndex={active}
                onPick={pickFile}
                onHover={setActiveIndex}
                placement={isNewTask ? "below" : "above"}
                bare={isNewTask}
              />
            ) : (
              <SlashCommandMenu
                groups={groups}
                activeIndex={active}
                onPick={pickCommand}
                onHover={setActiveIndex}
                placement={isNewTask ? "below" : "above"}
                bare={isNewTask}
              />
            ))}

          {/* Both buttons sit on the last line. At one line that reads as
              centered anyway, because the textarea's vertical padding below is
              tuned to match the buttons' own height — no `self-center` needed,
              and nothing drifts as the box grows. */}
          <div className={cn("flex items-end gap-1 py-3", isNewTask ? "px-0" : "px-3")}>
            <div className="relative min-w-0 flex-1">
              <textarea
                ref={textareaRef}
                rows={1}
                autoFocus
                value={message}
                // Kept in step with the overlay below, which cannot scroll itself.
                onScroll={(e) => {
                  const mirror = mirrorRef.current;
                  if (mirror) mirror.scrollTop = e.currentTarget.scrollTop;
                }}
                placeholder={isNewTask ? "Describe a task. @files. /skills and commands." : "Send follow-up"}
                onChange={(e) => {
                  setMessage(e.currentTarget.value);
                  setCaret(e.currentTarget.selectionStart);
                }}
                // Fires for arrow keys, clicks, and drags alike, so the picker
                // follows the caret however it moved rather than only on typing.
                onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                onKeyDown={(e) => {
                  // Whichever picker is open owns these keys, and only while it
                  // is — Enter completes the highlighted row instead of sending,
                  // which is the one place the composer's usual rule gives way.
                  if (menuOpen && !e.nativeEvent.isComposing) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActiveIndex((active + 1) % rowCount);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveIndex((active - 1 + rowCount) % rowCount);
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      pickRow(active);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setDismissed(true);
                      return;
                    }
                  }

                  // Shift+Enter is the only way to get a newline; plain Enter sends.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                // `py-1` puts one line at 28px — the buttons' own height — so the
                // first row looks centered against them without being. `min-w-0`
                // moved to the wrapper, where it still stops one long unbroken
                // token setting the flex item's floor and pushing the buttons off
                // the row.
                className={cn(
                  "block w-full resize-none overflow-y-auto bg-transparent placeholder:text-muted-foreground focus:outline-none",
                  TEXT_BOX,
                  isNewTask ? "px-0" : "px-1",
                  // Hands the glyphs to the overlay only while there is something
                  // to colour. Every other moment the textarea draws its own text
                  // as before, so the usual case keeps no dependency on the
                  // overlay rendering correctly.
                  highlighted ? "text-transparent caret-foreground" : "text-foreground",
                )}
              />

              {/* Draws the text the textarea is hiding, so a command or a file
                  mention can take a colour — a textarea has no way to style part
                  of its value. Painted *over* the textarea rather than under it,
                  so a selection band sits behind these glyphs instead of covering
                  them; the caret still shows, since it falls between them.

                  Mounted only alongside `text-transparent` above, and built from
                  the same segments the transcript renders, so neither the two
                  copies of the text nor the two surfaces can disagree about what
                  is coloured. `TEXT_BOX` and the padding are shared with the
                  textarea for the same reason — any drift shows up as doubled
                  text. */}
              {highlighted && (
                <div
                  ref={mirrorRef}
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-foreground",
                    TEXT_BOX,
                    isNewTask ? "px-0" : "px-1",
                  )}
                >
                  {segments.map((segment, i) => {
                    // Every glyph the textarea lays out has to be laid out here
                    // too, so a mention is dimmed rather than shortened — the
                    // transcript is where it collapses to the filename.
                    if (segment.kind === "mention") {
                      const { dir, name } = splitMention(segment.text);

                      return (
                        <span key={i} className={SEGMENT_COLOR.mention}>
                          <span className="opacity-45">{dir}</span>
                          {name}
                        </span>
                      );
                    }

                    return (
                      <span key={i} className={SEGMENT_COLOR[segment.kind]}>
                        {segment.text}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* One button, two jobs. Busy makes it a Stop: `type="button"` so
                pressing it can't also submit whatever is typed, and it stays
                enabled where Send would be disabled — stopping needs no text.
                Enter-to-send lives in `onKeyDown`, not in this button being the
                form's submitter, so the empty state can drop it for the hint
                below without losing the keyboard path. `busy` is unreachable
                there too — nothing is running before a session exists. */}
            {!isNewTask && (
              <Button
                type={busy ? "button" : "submit"}
                size="icon-sm"
                disabled={busy ? !onStop : !canSend}
                onClick={busy ? onStop : undefined}
                title={busy ? "Stop" : "Send"}
                className="rounded-full"
              >
                {busy ? (
                  <Square className="fill-current" />
                ) : (
                  <ArrowUp strokeWidth={2} />
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
