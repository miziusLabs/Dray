import { describe, expect, it } from "vitest";

import {
  absolutePath,
  findPromptPaths,
  isFilePath,
  isRelativePath,
  splitLocator,
} from "./filePath";

describe("file paths", () => {
  it("recognizes absolute paths without confusing URLs", () => {
    expect(isFilePath("/Users/me/project/src/a.ts")).toBe(true);
    expect(isFilePath("/compact")).toBe(false);
    expect(isFilePath("/Users/me//project/a.ts")).toBe(false);
  });

  it("recognizes ordinary relative files but not prose or hosts", () => {
    expect(isRelativePath("src/lib/highlight.ts")).toBe(true);
    expect(isRelativePath(".github/workflows/ci.yml")).toBe(true);
    expect(isRelativePath("and/or")).toBe(false);
    expect(isRelativePath("github.com/org/repo/a.ts")).toBe(false);
    expect(isRelativePath("localhost/api/schema.json")).toBe(false);
    expect(isRelativePath("@scope/pkg/index.js")).toBe(false);
  });

  it("keeps a line locator on the match but off the opened path", () => {
    expect(findPromptPaths("fix (src/a.ts:12:5) and /tmp/b.rs#L7")).toEqual([
      { start: 5, end: 18, path: "src/a.ts", line: 12 },
      { start: 24, end: 36, path: "/tmp/b.rs", line: 7 },
    ]);
    expect(splitLocator("src/a.ts:L2")).toEqual({ path: "src/a.ts", line: 2 });
  });

  it("does not overlap an absolute path with a nested relative path", () => {
    const matches = findPromptPaths("/tmp/(src/a.ts)");
    expect(matches).toHaveLength(1);
    expect(matches[0].path).toBe("/tmp/(src/a.ts");
  });

  it("resolves relative paths only with a session cwd", () => {
    expect(absolutePath("src/a.ts", "/work/project")).toBe("/work/project/src/a.ts");
    expect(absolutePath("src/a.ts", null)).toBeNull();
    expect(absolutePath("/tmp/a.ts", null)).toBe("/tmp/a.ts");
  });
});
