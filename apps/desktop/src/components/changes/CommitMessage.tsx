import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { Commit } from "@/types/events";

/// The open commit's message, above the diff it explains.
///
/// The history list has room for a subject and nothing else, so a commit whose
/// reasoning lives in its body — the ones worth opening — read as a bare
/// headline. This is the only place that body is on screen, and it belongs on
/// the diff's side rather than in the list: the list is for finding a commit,
/// this is for reading the one already found.
///
/// Collapsed to two lines by default, because the message must not push the
/// diff below the fold on the way to it. Expanded it simply grows: pressing
/// "Show more" is the reader asking for the whole message, and a scrollbox
/// inside a pane makes them ask twice for the rest of it.
export default function CommitMessage({ commit }: { commit: Commit }) {
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);

  // Measured rather than guessed from the text's length: whether two lines hold
  // the body depends on how wide the pane is, and a "Show more" that expands to
  // the same two lines is a control that does nothing. Only read while
  // collapsed — expanded, the element is its own full height and would report
  // no overflow, retiring the button that collapses it again.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || open) return;

    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  return (
    <div className="shrink-0 border-b border-border px-3 py-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-ui text-sidebar-foreground">{commit.subject}</p>
        {/* The short sha is the one fact about a commit that is nowhere else in
            this window, and it is what any other git tool wants pasted into it. */}
        <span className="shrink-0 font-mono text-ui text-muted-foreground">
          {commit.sha.slice(0, 7)}
        </span>
      </div>

      {commit.body && (
        <p
          ref={body}
          className={cn(
            "mt-1 text-ui whitespace-pre-wrap text-muted-foreground",
            !open && "line-clamp-2",
          )}
        >
          {commit.body}
        </p>
      )}

      {(clipped || open) && (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="mt-1 text-ui text-muted-foreground hover:text-foreground"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
