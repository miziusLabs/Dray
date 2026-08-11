import type { AgentEvent } from "@/types/events";

/// The tree the panel diffs against: the newest prompt's snapshot, so the range
/// is the last turn. Null when there is nothing to diff against.
///
/// Null is the ordinary case, not an error: a session in a plain directory
/// records no snapshots, and neither does one whose prompts predate the field.
/// The panel reads it as "nothing to show" either way.
///
/// A prompt whose own baseline is null is skipped rather than ending the
/// search. That matters for a worktree session, whose first prompt can fail to
/// snapshot — falling through to the neighbouring prompt shows a range slightly
/// off from the one asked for, which beats showing nothing.
///
/// Deliberately only the last turn. A session-wide baseline is the same code
/// reading a different prompt, but it would be *wrong* rather than merely
/// wider: a snapshot covers the whole working tree, so anything another session
/// — or the user in their editor — changed in the same repo since that prompt
/// gets attributed to this one. A turn is short enough for that overlap to be
/// unlikely; a session is not.
export function baselineFor(events: AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const payload = events[i].payload;
    if (payload.type === "user_message" && payload.baseline) return payload.baseline;
  }
  return null;
}

/// Splits a path into the part that gets dimmed and the part that doesn't. The
/// basename is what the reader scans for, so it stays at full contrast while
/// the directories recede.
export function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf("/");
  if (cut === -1) return { dir: "", name: path };
  return { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) };
}
