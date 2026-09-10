/// Splits prompt text into lossless runs for the composer overlay and the
/// rendered prompt bubble. The overlay keeps delimiters so its glyphs remain
/// aligned with the textarea; the bubble uses `inner` to draw inline marks.
import { findPromptPaths } from "@/lib/filePath";
import { parseSlashCommand } from "@/lib/slash";

export type Segment = {
  kind:
    | "text"
    | "command"
    | "mention"
    | "url"
    | "strong"
    | "em"
    | "code"
    | "strike"
    | "link"
    | "path";
  text: string;
  inner?: string;
  href?: string;
  line?: number;
};

export const SEGMENT_COLOR: Record<Segment["kind"], string> = {
  text: "",
  command: "text-accent-command",
  mention: "text-accent-mention",
  url: "underline decoration-muted-foreground underline-offset-2",
  strong: "",
  em: "",
  code: "",
  strike: "",
  link: "",
  path: "text-accent-mention",
};

export function splitMention(text: string): { dir: string; name: string } {
  const cut = text.lastIndexOf("/");
  if (cut === -1) return { dir: "@", name: text.slice(1) };
  return { dir: text.slice(0, cut + 1), name: text.slice(cut + 1) };
}

const SPACE = /\s/;
const MARK_OPENERS = new Set(["*", "_", "~", "`", "["]);
const MARKS: [string, Segment["kind"]][] = [
  ["**", "strong"],
  ["__", "strong"],
  ["~~", "strike"],
  ["*", "em"],
  ["_", "em"],
];

type Exhausted = Map<string, number>;

function lineEnd(text: string, from: number): number {
  const end = text.indexOf("\n", from);
  return end === -1 ? text.length : end;
}

function closeIndex(text: string, mark: string, from: number): number {
  for (let i = from + 1; i < text.length; i += 1) {
    if (text[i] === "\n") return -1;
    if (!text.startsWith(mark, i) || SPACE.test(text[i - 1])) continue;
    if (mark.length === 1 && (text[i - 1] === mark || text[i + 1] === mark)) continue;
    return i;
  }
  return -1;
}

function hrefEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === "\n") return -1;
    if (text[i] === "(") depth += 1;
    if (text[i] === ")") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

function linkAt(text: string, i: number, exhausted: Exhausted): Segment | null {
  if (i < (exhausted.get("]") ?? -1)) return null;
  const bound = lineEnd(text, i);
  let label = -1;
  for (let j = i + 1; j < bound; j += 1) {
    if (text[j] === "]") {
      label = j;
      break;
    }
  }
  if (label === -1 || text[label + 1] !== "(") {
    exhausted.set("]", label === -1 ? bound : label + 1);
    return null;
  }
  const close = hrefEnd(text, label + 2);
  if (close === -1 || close === label + 2) return null;
  const href = text.slice(label + 2, close);
  if (!/^https?:\/\//i.test(href) || label === i + 1) return null;
  return {
    kind: "link",
    text: text.slice(i, close + 1),
    inner: text.slice(i + 1, label),
    href,
  };
}

function inlineAt(text: string, i: number, exhausted: Exhausted): Segment | null {
  const previous = i > 0 ? text[i - 1] : " ";
  if (!SPACE.test(previous) && !"([{<".includes(previous)) return null;

  if (text[i] === "`") {
    if (i < (exhausted.get("`") ?? -1)) return null;
    const close = text.indexOf("`", i + 1);
    if (close === -1) {
      exhausted.set("`", text.length);
      return null;
    }
    const inner = text.slice(i + 1, close);
    if (!inner || inner.includes("\n") || text[close + 1] === "`") return null;
    return { kind: "code", text: text.slice(i, close + 1), inner };
  }

  if (text[i] === "[") return linkAt(text, i, exhausted);

  for (const [mark, kind] of MARKS) {
    if (!text.startsWith(mark, i) || i < (exhausted.get(mark) ?? -1)) continue;
    const from = i + mark.length;
    if (from >= text.length || SPACE.test(text[from])) continue;
    const close = closeIndex(text, mark, from);
    if (close === -1) {
      exhausted.set(mark, lineEnd(text, from));
      continue;
    }
    return { kind, text: text.slice(i, close + mark.length), inner: text.slice(from, close) };
  }
  return null;
}

function urlAt(text: string, i: number): string | null {
  if (!/^https?:\/\/\S/i.test(text.slice(i))) return null;
  let end = i;
  while (end < text.length && !SPACE.test(text[end])) end += 1;
  let url = text.slice(i, end).replace(/[.,;:!?\"'»›]+$/, "");
  while (url.endsWith(")") && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) {
    url = url.slice(0, -1);
  }
  return url;
}

/// The composer-facing segmentation is lossless: joining `text` returns input.
export function highlightSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const exhausted: Exhausted = new Map();
  let plainFrom = 0;
  let i = 0;

  const command = parseSlashCommand(text);
  if (command) {
    segments.push({ kind: "command", text: `${text[0]}${command.name}` });
    i = command.name.length + 1;
    plainFrom = i;
  }

  for (; i < text.length; i += 1) {
    const opener = text[i];
    if (opener === "h" && (i === 0 || SPACE.test(text[i - 1]) || "([{<".includes(text[i - 1]))) {
      const url = urlAt(text, i);
      if (url) {
        if (i > plainFrom) segments.push({ kind: "text", text: text.slice(plainFrom, i) });
        segments.push({ kind: "url", text: url });
        plainFrom = i + url.length;
        i = plainFrom - 1;
        continue;
      }
    }

    if (MARK_OPENERS.has(opener)) {
      const mark = inlineAt(text, i, exhausted);
      if (mark) {
        if (i > plainFrom) segments.push({ kind: "text", text: text.slice(plainFrom, i) });
        segments.push(mark);
        plainFrom = i + mark.text.length;
        i = plainFrom - 1;
        continue;
      }
    }

    if (opener !== "@") continue;
    if (i > 0 && !SPACE.test(text[i - 1])) continue;
    let end = i + 1;
    while (end < text.length && !SPACE.test(text[end])) end += 1;
    if (end === i + 1) continue;
    if (i > plainFrom) segments.push({ kind: "text", text: text.slice(plainFrom, i) });
    segments.push({ kind: "mention", text: text.slice(i, end) });
    plainFrom = end;
    i = end - 1;
  }

  if (plainFrom < text.length) segments.push({ kind: "text", text: text.slice(plainFrom) });
  return segments;
}

/// Converts the literal escape used by relay messages into a visual line break.
export function withLineBreaks(text: string): string {
  return text.replace(/\\n/g, "\n");
}

/// Finds bare paths only in ordinary text runs, preserving the original string.
export function withPaths(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    if (segment.kind !== "text") {
      out.push(segment);
      continue;
    }
    let at = 0;
    for (const match of findPromptPaths(segment.text)) {
      if (match.start > at) out.push({ kind: "text", text: segment.text.slice(at, match.start) });
      out.push({
        kind: "path",
        text: segment.text.slice(match.start, match.end),
        inner: match.path,
        line: match.line,
      });
      at = match.end;
    }
    if (at < segment.text.length) out.push({ kind: "text", text: segment.text.slice(at) });
  }
  return out;
}
