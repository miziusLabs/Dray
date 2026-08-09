import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatToolInput, toolLabel, toolSummary } from "@/lib/tools";
import type { ToolResult, ToolType } from "@/types/events";
import type { JsonValue } from "@/types/serde_json/JsonValue";

// Shown in the header, so the expanded body omits them to avoid repeating itself.
const SUMMARY_FIELDS = [
  "file_path",
  "path",
  "notebook_path",
  "command",
  "pattern",
  "query",
  "url",
  "description",
];

// Long results are the norm — reads come back in the thousands of characters —
// so expanding shows a head and the rest scrolls rather than pushing the
// composer off-screen.
const PREVIEW_CHARS = 4000;

type ToolCallProps = {
  name: string;
  toolType: ToolType;
  title: string | null;
  input: JsonValue;
  rawInput: string | null;
  /// Absent while the call is still in flight.
  result?: ToolResult;
  /// Set for a row inside a `ToolGroupRow`, whose header already names the tool
  /// — repeating "Edited" down all 30 rows is noise, and the path is the only
  /// thing that varies.
  hideLabel?: boolean;
};

export default function ToolCall({
  name,
  toolType,
  title,
  input,
  rawInput,
  result,
  hideLabel = false,
}: ToolCallProps) {
  const [open, setOpen] = useState(false);

  // A failure is the one case worth showing unprompted — the error text is the
  // reason the row is interesting at all. Tracked as an effect rather than an
  // initial state because a live call mounts pending and only fails later.
  const failedOnce = useRef(false);
  useEffect(() => {
    if (result?.isError && !failedOnce.current) {
      failedOnce.current = true;
      setOpen(true);
    }
  }, [result?.isError]);

  const summary = title ?? toolSummary(name, toolType, input);
  const pending = result === undefined;
  const failed = result?.isError ?? false;

  // Inside a group the label is redundant — except with no summary to stand in
  // its place, where dropping it would leave a blank, unclickable row.
  const showLabel = !hideLabel || !summary;

  const body = rawInput ?? formatToolInput(input, SUMMARY_FIELDS);
  const output = result?.text.trim() ?? "";
  const shown = output.length > PREVIEW_CHARS ? `${output.slice(0, PREVIEW_CHARS)}…` : output;

  // Output stays behind the expander regardless of length. Auto-showing short
  // results only made rows inconsistent — some opened, some didn't, with no
  // visible reason why.
  const expandable = Boolean(body) || Boolean(output);

  return (
    <div className="group/tool flex flex-col gap-1.5">
      {/* The collapsed row is text on the page — no card, no padding. Chrome
          belongs to the expanded content, which is what needs the containment. */}
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 text-left text-chat"
      >
        {/* The shimmer is the running state; it stops the moment the result
            lands, so a settled row is plain text again. The label carries the
            same information in its tense — "Reading" then "Read". */}
        {showLabel && (
          <span
            className={cn(
              "shrink-0",
              failed ? "text-destructive" : "text-foreground/80",
              pending && "shimmer-text",
            )}
          >
            {toolLabel(name, pending)}
          </span>
        )}

        {/* `min-w-0` lets it shrink and `max-w-fit` stops it claiming the row's
            free space, which would push the caret out to the far right. With the
            label hidden this is the whole row, so it inherits the shimmer and
            the failure color the label would have carried. */}
        {summary && (
          <span
            className={cn(
              "min-w-0 max-w-fit truncate font-mono",
              !showLabel && failed ? "text-destructive" : "text-muted-foreground",
              !showLabel && pending && "shimmer-text",
            )}
          >
            {summary}
          </span>
        )}

        {/* Trails the text rather than pinning to the far right, so it reads as
            part of the row instead of a column of its own. */}
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-all",
            open ? "rotate-90 opacity-100" : "opacity-0 group-hover/tool:opacity-100",
            !expandable && "invisible",
          )}
        />

        {/* No pending dot — the shimmering label is the running state, and two
            indicators for one fact just competed with each other. A non-zero
            exit stays: that is an outcome, which the label never encodes. */}
        {result?.exitCode != null && result.exitCode !== 0 && (
          <span className="ml-auto shrink-0 text-destructive">exit {result.exitCode}</span>
        )}
      </button>

      {open && body && (
        <pre className="overflow-x-auto rounded-md bg-surface-raised px-2.5 py-2 font-mono text-tool text-muted-foreground">
          {body}
        </pre>
      )}

      {/* A failure drops the box and reads at the row's own size: an error is
          the reason to look at the row, so it should not be the smallest text on
          it. Nothing here is tinted — the red label above already marks the row,
          and the "Error:" lead-in names the text without a second color
          repeating what the label said. */}
      {open && shown && (
        <pre
          className={cn(
            "max-h-96 overflow-auto whitespace-pre-wrap",
            failed
              ? "font-mono text-chat text-foreground/90"
              : "rounded-md bg-surface-raised px-2.5 py-2 font-mono text-tool text-muted-foreground",
          )}
        >
          {failed && "Error: "}
          {shown}
        </pre>
      )}
    </div>
  );
}
