import { describe, expect, it } from "vitest";

import { baselineFor, splitPath } from "@/lib/changes";
import type { AgentEvent } from "@/types/events";

/// A prompt carrying a snapshot, or one that failed to take one. Only the
/// fields `baselineFor` reads are filled — the rest of the envelope has no
/// bearing on which prompt gets picked.
function prompt(baseline: string | null): AgentEvent {
  return {
    id: `e-${baseline ?? "none"}`,
    sessionId: "s",
    harness: "claude_code",
    seq: 0,
    ts: "2026-08-11T00:00:00Z",
    turnId: null,
    subagent: null,
    payload: { type: "user_message", text: "hi", images: [], baseline },
    raw: null,
  } as AgentEvent;
}

function noise(): AgentEvent {
  return { ...prompt(null), payload: { type: "assistant_text", block: null, text: "ok" } } as AgentEvent;
}

describe("baselineFor", () => {
  it("takes the newest snapshot, so the range is the last turn", () => {
    const events = [prompt("aaa"), noise(), prompt("bbb"), noise(), prompt("ccc")];

    expect(baselineFor(events)).toBe("ccc");
  });

  it("falls through a prompt that took no snapshot rather than giving up", () => {
    // Otherwise the newest prompt would answer null and hide a diff the
    // previous baseline can still produce. Reachable on a worktree session,
    // whose first prompt has no tree to snapshot yet.
    expect(baselineFor([prompt("aaa"), prompt(null)])).toBe("aaa");
    expect(baselineFor([prompt(null), prompt("bbb")])).toBe("bbb");
  });

  it("is null when nothing recorded a snapshot", () => {
    // The ordinary state of a session in a plain directory, and of every
    // prompt logged before the field existed. Not an error.
    expect(baselineFor([prompt(null), noise()])).toBeNull();
    expect(baselineFor([])).toBeNull();
  });
});

describe("splitPath", () => {
  it("keeps the basename whole and leaves the trailing slash on the directory", () => {
    // The two halves are rendered adjacent, so the separator has to live on
    // one of them or the path reads as "src/libtools.ts".
    expect(splitPath("src/lib/tools.ts")).toEqual({ dir: "src/lib/", name: "tools.ts" });
    expect(splitPath("README.md")).toEqual({ dir: "", name: "README.md" });
  });
});
