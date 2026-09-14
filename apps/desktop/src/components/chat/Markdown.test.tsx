import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "@/components/chat/Markdown";
import PromptText from "@/components/chat/PromptText";

describe("Markdown", () => {
  it.each([
    "Read [`session.rs`](file:///tmp/session.rs).",
    "Read [`session.rs`](apps/desktop/src-tauri/src/session.rs).",
  ])("keeps local file links clickable instead of marking them blocked", (text) => {
    const html = renderToStaticMarkup(<Markdown>{text}</Markdown>);

    expect(html).toContain('data-streamdown="link"');
    expect(html).not.toContain("[blocked]");
  });

  it("renders fenced code blocks as code blocks", () => {
    const html = renderToStaticMarkup(
      <Markdown>{"```ts\nconst answer = 42;\n```"}</Markdown>,
    );

    expect(html).toContain('data-streamdown="code-block"');
    expect(html).toContain('data-language="ts"');
    expect(html).toContain("const answer = 42;");
  });

  it("renders fenced code blocks in prompt text without changing prose marks", () => {
    const html = renderToStaticMarkup(
      <PromptText text={"See @src/App.tsx.\n```tsx\nreturn <App />;\n```"} />,
    );

    expect(html).toContain('data-streamdown="code-block"');
    expect(html).toContain("return &lt;App /&gt;;");
    expect(html).toContain("text-accent-mention");
  });
});
