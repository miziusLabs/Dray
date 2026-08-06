import type { JsonValue } from "@/types/serde_json/JsonValue";
import type { ToolType } from "@/types/events";

/// `input` is always an object per the mapper's contract, but it arrives as an
/// untyped `JsonValue` — this narrows it without trusting the shape.
function field(input: JsonValue, key: string): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const value = (input as Record<string, JsonValue>)[key];
  return typeof value === "string" ? value : null;
}

/// The interesting argument, shown next to the tool name. Claude Code leaves
/// `title` null on every call, so the row has to derive its own summary and each
/// tool keeps whichever field actually identifies the work.
export function toolSummary(
  name: string,
  toolType: ToolType,
  input: JsonValue,
): string | null {
  const path = field(input, "file_path") ?? field(input, "path") ?? field(input, "notebook_path");
  if (path) return shortenPath(path);

  switch (toolType) {
    case "shell":
      return field(input, "command");
    case "search":
      return field(input, "pattern") ?? field(input, "query");
    case "web":
      return field(input, "url") ?? field(input, "query");
    case "subagent_spawn":
      return field(input, "description") ?? field(input, "subagent_type");
    default:
      break;
  }

  // A tool the mapper classified as `other` still deserves a label, so fall back
  // to whichever conventional field it happens to carry.
  return (
    field(input, "description") ??
    field(input, "command") ??
    field(input, "query") ??
    field(input, "prompt") ??
    (name ? null : null)
  );
}

/// Absolute paths dominate the row otherwise; the last two segments are enough
/// to recognize a file and still fit beside the tool name.
export function shortenPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return parts.slice(-2).join("/");
}

/// Formats a duration the way a reader scans it, not to full precision.
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/// Pretty-prints tool input for the expanded view, dropping the fields the row
/// header already shows so the body isn't a duplicate of the summary line.
export function formatToolInput(input: JsonValue, omit: string[]): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return input === null ? null : JSON.stringify(input, null, 2);
  }

  const rest = Object.fromEntries(
    Object.entries(input as Record<string, JsonValue>).filter(([k]) => !omit.includes(k)),
  );

  return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : null;
}
