import { findPromptPaths, isFilePath, isRelativePath, splitLocator } from "@/lib/filePath";

export const FILE_PATH_CLASS = "dray-file-path";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const NOT_PROSE = new Set(["pre", "a", "script", "style"]);

function marked(path: string, children: HastNode[], line?: number): HastNode {
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: [FILE_PATH_CLASS],
      title: path,
      ...(line ? { dataLine: String(line) } : {}),
    },
    children,
  };
}

function anchorToFile(node: HastNode): HastNode | null {
  if (node.tagName !== "a") return null;
  const href = node.properties?.href;
  if (typeof href !== "string") return null;

  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // Keep the original value; the path checks below will safely reject it if
    // the malformed escape changes its shape.
  }

  const { path, line } = splitLocator(decoded);
  if (!isFilePath(path) && !isRelativePath(path)) return null;
  return marked(path, node.children ?? [], line);
}

/// Marks bare file paths after sanitization, so the custom marker survives the
/// renderer's safety pass. Explicit markdown file links become the same marker,
/// while ordinary web links remain untouched.
export function rehypeFilePaths() {
  return (tree: HastNode) => walk(tree);
}

export function walk(node: HastNode) {
  const children = node.children;
  if (!children) return;
  let next: HastNode[] | null = null;

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.type === "element") {
      const file = anchorToFile(child);
      if (file) {
        next ??= children.slice(0, i);
        next.push(file);
        continue;
      }
      if (!NOT_PROSE.has(child.tagName ?? "")) walk(child);
      next?.push(child);
      continue;
    }

    const value = child.type === "text" ? child.value : undefined;
    const matches = value ? findPromptPaths(value) : [];
    if (!value || !matches.length) {
      next?.push(child);
      continue;
    }

    next ??= children.slice(0, i);
    let at = 0;
    for (const match of matches) {
      if (match.start > at) next.push({ type: "text", value: value.slice(at, match.start) });
      next.push(
        marked(
          match.path,
          [{ type: "text", value: value.slice(match.start, match.end) }],
          match.line,
        ),
      );
      at = match.end;
    }
    if (at < value.length) next.push({ type: "text", value: value.slice(at) });
  }

  if (next) node.children = next;
}

