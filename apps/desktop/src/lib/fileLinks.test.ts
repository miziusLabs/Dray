import { describe, expect, it } from "vitest";

import { isLocalLink, proxyLocalLink, unwrapLocalLink } from "./fileLinks";

describe("local file links", () => {
  it("recognizes Windows drive paths as local links", () => {
    const path = String.raw`C:\Users\jan\repo\README.md`;
    expect(isLocalLink(path)).toBe(true);
    expect(unwrapLocalLink(proxyLocalLink(path))).toBe(path);
  });
});
