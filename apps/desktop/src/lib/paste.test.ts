import { describe, expect, it } from "vitest";

import { isImagePath, pastedImagePath } from "@/lib/paste";

describe("pasted image paths", () => {
  it("recognizes supported image extensions case-insensitively", () => {
    expect(isImagePath("/tmp/screenshot.PNG")).toBe(true);
    expect(isImagePath("/tmp/notes.txt")).toBe(false);
  });

  it("decodes file URIs before checking the image extension", () => {
    expect(pastedImagePath("file:///Users/me/My%20Screenshot.png", "")).toBe(
      "/Users/me/My Screenshot.png",
    );
  });

  it("falls back to a plain path and ignores non-file text", () => {
    expect(pastedImagePath("", '"/tmp/photo.webp"')).toBe("/tmp/photo.webp");
    expect(pastedImagePath("", "Here is /tmp/photo.webp")).toBe(null);
  });
});
