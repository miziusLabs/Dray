import { describe, expect, it } from "vitest";

import { usageBarColorClass } from "@/lib/usage";

describe("usageBarColorClass", () => {
  it("colors based on remaining usage when displaying usage left", () => {
    expect(usageBarColorClass(25, "left")).toBe("bg-primary");
    expect(usageBarColorClass(24, "left")).toBe("bg-yellow-500");
    expect(usageBarColorClass(15, "left")).toBe("bg-yellow-500");
    expect(usageBarColorClass(14, "left")).toBe("bg-red-500");
  });

  it("colors based on remaining usage when displaying usage used", () => {
    expect(usageBarColorClass(75, "used")).toBe("bg-primary");
    expect(usageBarColorClass(76, "used")).toBe("bg-yellow-500");
    expect(usageBarColorClass(85, "used")).toBe("bg-yellow-500");
    expect(usageBarColorClass(86, "used")).toBe("bg-red-500");
  });

  it("uses the default color while usage is loading", () => {
    expect(usageBarColorClass(null, "left")).toBe("bg-primary");
  });
});
