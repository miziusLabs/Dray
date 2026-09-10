/// A path found in prose, including the full reference and the file it opens.
export type FilePathMatch = {
  start: number;
  end: number;
  path: string;
  line?: number;
};

const OPENS_PATH = /[\s([{<"']/;
const TRAILING = new Set([...".,;:!?)]}>\\\"'"]);
const GAP = /[^\S\r\n]/;
const LOCATOR = /(?::L?(\d+)(?::\d+)?|#L(\d+))$/;
const NAMES_FILE = /\.[A-Za-z][A-Za-z0-9]{0,9}$/;
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/i;
const HOST_PORT = /:\d+$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/// Whether an absolute path has enough structure to be worth opening.
export function isFilePath(path: string): boolean {
  return path.startsWith("/") && !path.includes("//") && path.split("/").filter(Boolean).length >= 2;
}

function namesAHost(segment: string): boolean {
  return (
    segment.toLowerCase() === "localhost" ||
    HOSTNAME.test(segment) ||
    HOST_PORT.test(segment) ||
    IPV4.test(segment)
  );
}

/// Relative paths need a filename suffix to distinguish them from ordinary prose.
export function isRelativePath(path: string): boolean {
  if (path.startsWith("/") || path.includes("//")) return false;
  const parts = path.split("/");
  if (parts.length < 2 || parts.some((part) => !part)) return false;
  if (namesAHost(parts[0]) || parts[0].startsWith("@")) return false;
  return NAMES_FILE.test(parts.at(-1) ?? "");
}

function trimTail(
  text: string,
  from: number,
  stop: number,
): { end: number; pathEnd: number; line?: number } {
  let end = stop;
  while (end > from && TRAILING.has(text[end - 1])) end -= 1;
  const locator = LOCATOR.exec(text.slice(from, end));
  if (!locator) return { end, pathEnd: end };
  return { end, pathEnd: end - locator[0].length, line: Number(locator[1] ?? locator[2]) };
}

/// Splits the line locator from a markdown link target.
export function splitLocator(raw: string): { path: string; line?: number } {
  const locator = LOCATOR.exec(raw);
  if (!locator) return { path: raw };
  return {
    path: raw.slice(0, raw.length - locator[0].length),
    line: Number(locator[1] ?? locator[2]),
  };
}

export function findFilePaths(text: string): FilePathMatch[] {
  const found: FilePathMatch[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "/" || (i > 0 && !OPENS_PATH.test(text[i - 1]))) continue;
    let stop = i;
    while (stop < text.length && !/\s/.test(text[stop])) stop += 1;
    const { end, pathEnd, line } = trimTail(text, i, stop);
    const path = text.slice(i, pathEnd);
    if (!isFilePath(path) || continuesPath(text, stop, path)) continue;
    found.push({ start: i, end, path, line });
    i = end - 1;
  }
  return found;
}

export function findRelativePaths(text: string): FilePathMatch[] {
  const found: FilePathMatch[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if ((i > 0 && !OPENS_PATH.test(text[i - 1])) || OPENS_PATH.test(text[i])) continue;
    let stop = i;
    while (stop < text.length && !OPENS_PATH.test(text[stop]) && !/\s/.test(text[stop])) stop += 1;
    const { end, pathEnd, line } = trimTail(text, i, stop);
    const path = text.slice(i, pathEnd);
    if (!isRelativePath(path)) continue;
    found.push({ start: i, end, path, line });
    i = end - 1;
  }
  return found;
}

/// Finds absolute and relative paths without allowing overlapping matches.
export function findPromptPaths(text: string): FilePathMatch[] {
  const all = [...findFilePaths(text), ...findRelativePaths(text)].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  );
  const kept: FilePathMatch[] = [];
  let end = 0;
  for (const match of all) {
    if (match.start < end) continue;
    kept.push(match);
    end = match.end;
  }
  return kept;
}

function continuesPath(text: string, stop: number, path: string): boolean {
  const finished = NAMES_FILE.test(path.split("/").filter(Boolean).at(-1) ?? "");
  let at = stop;
  while (GAP.test(text[at] ?? "")) {
    let end = at + 1;
    while (end < text.length && !/\s/.test(text[end])) end += 1;
    const word = text.slice(at + 1, end);
    if (word.startsWith("/")) return false;
    if (word.includes("/")) return true;
    if (finished) return false;
    at = end;
  }
  return false;
}

/// Resolves a relative path against the session's working directory.
export function absolutePath(raw: string, cwd: string | null): string | null {
  if (!raw) return null;
  if (raw.startsWith("/")) return raw;
  if (!cwd) return null;
  return `${cwd.replace(/\/+$/, "")}/${raw.replace(/^\.\//, "")}`;
}
