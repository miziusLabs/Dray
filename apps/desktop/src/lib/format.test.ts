import { describe, expect, it } from "vitest";

import { basename } from "@/lib/format";

describe("basename", () => {
  it("takes the final segment from POSIX and Windows paths", () => {
    expect(basename("/Users/y/proj")).toBe("proj");
    expect(basename("C:\\Users\\y\\proj")).toBe("proj");
  });

  it("ignores trailing separators", () => {
    expect(basename("/Users/y/proj/")).toBe("proj");
    expect(basename("C:\\Users\\y\\proj\\")).toBe("proj");
  });
});
