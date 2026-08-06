/// Compact relative time for session rows — "now", "4m", "3h", "2d", then a date.
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";

  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`;

  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/// Trailing path segment, for showing a project as its folder name.
export function basename(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}
