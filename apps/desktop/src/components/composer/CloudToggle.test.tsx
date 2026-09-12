import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import CloudToggle from "@/components/composer/CloudToggle";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("CloudToggle", () => {
  it("is disabled when Docker is unavailable", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <CloudToggle
          on={false}
          onToggle={vi.fn()}
          disabled
          disabledReason="Docker is not installed or is not running."
        />
      </TooltipProvider>,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toMatch(/\sdisabled(?:=|>)/);
    expect(html).toContain('data-slot="tooltip-trigger"');
  });

  it("remains interactive when Docker is available", () => {
    const html = renderToStaticMarkup(<CloudToggle on onToggle={vi.fn()} />);

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toMatch(/\sdisabled(?:=|>)/);
    expect(html).not.toContain('data-slot="tooltip-trigger"');
  });
});
