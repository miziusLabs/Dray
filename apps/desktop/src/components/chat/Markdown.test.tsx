import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "@/components/chat/Markdown";

describe("Markdown", () => {
  it.each([
    "Read [`session.rs`](file:///tmp/session.rs).",
    "Read [`session.rs`](apps/desktop/src-tauri/src/session.rs).",
  ])("keeps local file links clickable instead of marking them blocked", (text) => {
    const html = renderToStaticMarkup(<Markdown>{text}</Markdown>);

    expect(html).toContain('data-streamdown="link"');
    expect(html).not.toContain("[blocked]");
  });
});
