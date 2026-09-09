import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import CloudToggle from "@/components/composer/CloudToggle";

describe("CloudToggle", () => {
  it("is disabled when Docker is unavailable", () => {
    const html = renderToStaticMarkup(
      <CloudToggle on={false} onToggle={vi.fn()} disabled />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toMatch(/\sdisabled(?:=|>)/);
    expect(html).toContain('title="Docker must be installed and running to use Cloud"');
  });

  it("remains interactive when Docker is available", () => {
    const html = renderToStaticMarkup(<CloudToggle on onToggle={vi.fn()} />);

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toMatch(/\sdisabled(?:=|>)/);
    expect(html).not.toContain("Docker must be installed and running");
  });
});
