import type { ReactElement } from "react";

import type { Segment } from "@/lib/highlight";
import { openLink } from "@/lib/openLink";
import { cn } from "@/lib/utils";

/// Renders the inline-only marks understood in a prompt bubble.
export function inlineMark(segment: Segment, key: number): ReactElement | null {
  const inner = segment.inner ?? "";
  switch (segment.kind) {
    case "strong":
      return <strong key={key}>{inner}</strong>;
    case "em":
      return <em key={key}>{inner}</em>;
    case "strike":
      return <s key={key} className="opacity-60">{inner}</s>;
    case "code":
      return <code key={key} className="rounded bg-muted/60 px-1 py-0.5 font-mono text-code">{inner}</code>;
    case "link":
      return (
        <button
          key={key}
          type="button"
          title={segment.href}
          className={cn("cursor-pointer underline decoration-muted-foreground underline-offset-2", "hover:decoration-foreground")}
          onClick={(event) => segment.href && openLink(segment.href, event)}
        >
          {inner}
        </button>
      );
    default:
      return null;
  }
}
